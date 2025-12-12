import { db } from "./db";
import { eq, and, or, desc, asc, sql, ne, lte, gte } from "drizzle-orm";
import {
  orders,
  orderFills,
  markets,
  marketPositions,
  collateralLedger,
  users,
  type Order,
  type Market,
  type MarketPosition,
} from "@shared/schema";

interface MatchResult {
  filled: boolean;
  fills: Array<{
    makerOrderId: string;
    quantity: number;
    yesPrice: number;
    noPrice: number;
    fillType: "mint" | "burn";
  }>;
  remainingQuantity: number;
}

interface OrderBookLevel {
  price: number;
  quantity: number;
  orders: Order[];
}

interface OrderBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export class MatchingEngine {
  async getMarket(marketId: string): Promise<Market | null> {
    const [market] = await db
      .select()
      .from(markets)
      .where(eq(markets.id, marketId));
    return market || null;
  }

  async getOrderBook(marketId: string): Promise<{
    yesBids: OrderBookLevel[];
    yesAsks: OrderBookLevel[];
    noBids: OrderBookLevel[];
    noAsks: OrderBookLevel[];
  }> {
    const openOrders = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.marketId, marketId),
          or(eq(orders.status, "open"), eq(orders.status, "partial"))
        )
      )
      .orderBy(desc(orders.price), asc(orders.createdAt));

    const yesBids: Map<number, Order[]> = new Map();
    const yesAsks: Map<number, Order[]> = new Map();
    const noBids: Map<number, Order[]> = new Map();
    const noAsks: Map<number, Order[]> = new Map();

    for (const order of openOrders) {
      const remaining = order.quantity - order.filledQuantity;
      if (remaining <= 0) continue;

      const target =
        order.outcome === "yes"
          ? order.side === "buy"
            ? yesBids
            : yesAsks
          : order.side === "buy"
          ? noBids
          : noAsks;

      if (!target.has(order.price)) {
        target.set(order.price, []);
      }
      target.get(order.price)!.push(order);
    }

    const mapToLevels = (
      map: Map<number, Order[]>,
      sortDesc: boolean
    ): OrderBookLevel[] => {
      const levels: OrderBookLevel[] = [];
      const sortedPrices = Array.from(map.keys()).sort((a, b) =>
        sortDesc ? b - a : a - b
      );
      for (const price of sortedPrices) {
        const orders = map.get(price)!;
        const quantity = orders.reduce(
          (sum, o) => sum + (o.quantity - o.filledQuantity),
          0
        );
        levels.push({ price, quantity, orders });
      }
      return levels;
    };

    return {
      yesBids: mapToLevels(yesBids, true),
      yesAsks: mapToLevels(yesAsks, false),
      noBids: mapToLevels(noBids, true),
      noAsks: mapToLevels(noAsks, false),
    };
  }

  async placeOrder(
    marketId: string,
    userId: string,
    outcome: "yes" | "no",
    side: "buy" | "sell",
    price: number,
    quantity: number
  ): Promise<{ order: Order; fills: MatchResult["fills"] }> {
    const market = await this.getMarket(marketId);
    if (!market) throw new Error("Market not found");
    if (market.status !== "active") throw new Error("Market is not active");

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) throw new Error("User not found");

    if (side === "buy") {
      const requiredCollateral = price * quantity;
      if (user.balance < requiredCollateral) {
        throw new Error(
          `Insufficient balance. Need $${requiredCollateral.toFixed(2)}, have $${user.balance.toFixed(2)}`
        );
      }

      await db
        .update(users)
        .set({ balance: user.balance - requiredCollateral })
        .where(eq(users.id, userId));

      await db.insert(collateralLedger).values({
        userId,
        marketId,
        amount: -requiredCollateral,
        reason: "order_lock",
        balanceBefore: user.balance,
        balanceAfter: user.balance - requiredCollateral,
      });
    } else {
      const position = await this.getPosition(marketId, userId);
      const sharesHeld = outcome === "yes" ? position.yesShares : position.noShares;
      if (sharesHeld < quantity) {
        throw new Error(
          `Insufficient shares. Have ${sharesHeld}, trying to sell ${quantity}`
        );
      }
    }

    const [newOrder] = await db
      .insert(orders)
      .values({
        marketId,
        userId,
        outcome,
        side,
        price,
        quantity,
        filledQuantity: 0,
        status: "open",
        collateralLocked: side === "buy" ? price * quantity : 0,
      })
      .returning();

    const matchResult = await this.matchOrder(newOrder);

    const [updatedOrder] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, newOrder.id));

    return { order: updatedOrder, fills: matchResult.fills };
  }

  private async matchOrder(takerOrder: Order): Promise<MatchResult> {
    const fills: MatchResult["fills"] = [];
    let remainingQty = takerOrder.quantity - takerOrder.filledQuantity;

    const orderBook = await this.getOrderBook(takerOrder.marketId);

    if (takerOrder.side === "buy") {
      const oppositeOutcome = takerOrder.outcome === "yes" ? "no" : "yes";
      const oppositeBids =
        oppositeOutcome === "yes" ? orderBook.yesBids : orderBook.noBids;

      for (const level of oppositeBids) {
        if (remainingQty <= 0) break;
        if (takerOrder.price + level.price < 1) continue;

        for (const makerOrder of level.orders) {
          if (remainingQty <= 0) break;
          if (makerOrder.userId === takerOrder.userId) continue;

          const makerRemaining = makerOrder.quantity - makerOrder.filledQuantity;
          const fillQty = Math.min(remainingQty, makerRemaining);

          const yesPrice =
            takerOrder.outcome === "yes" ? takerOrder.price : makerOrder.price;
          const noPrice =
            takerOrder.outcome === "no" ? takerOrder.price : makerOrder.price;

          await this.executeMint(
            takerOrder,
            makerOrder,
            fillQty,
            yesPrice,
            noPrice
          );

          fills.push({
            makerOrderId: makerOrder.id,
            quantity: fillQty,
            yesPrice,
            noPrice,
            fillType: "mint",
          });

          remainingQty -= fillQty;
        }
      }
    } else {
      const oppositeOutcome = takerOrder.outcome === "yes" ? "no" : "yes";
      const oppositeAsks =
        oppositeOutcome === "yes" ? orderBook.yesAsks : orderBook.noAsks;

      for (const level of oppositeAsks) {
        if (remainingQty <= 0) break;
        if (takerOrder.price + level.price > 1) continue;

        for (const makerOrder of level.orders) {
          if (remainingQty <= 0) break;
          if (makerOrder.userId === takerOrder.userId) continue;

          const makerRemaining = makerOrder.quantity - makerOrder.filledQuantity;
          const fillQty = Math.min(remainingQty, makerRemaining);

          const yesPrice =
            takerOrder.outcome === "yes" ? takerOrder.price : makerOrder.price;
          const noPrice =
            takerOrder.outcome === "no" ? takerOrder.price : makerOrder.price;

          await this.executeBurn(
            takerOrder,
            makerOrder,
            fillQty,
            yesPrice,
            noPrice
          );

          fills.push({
            makerOrderId: makerOrder.id,
            quantity: fillQty,
            yesPrice,
            noPrice,
            fillType: "burn",
          });

          remainingQty -= fillQty;
        }
      }
    }

    const newStatus =
      remainingQty === 0
        ? "filled"
        : remainingQty < takerOrder.quantity
        ? "partial"
        : "open";

    await db
      .update(orders)
      .set({
        filledQuantity: takerOrder.quantity - remainingQty,
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, takerOrder.id));

    return { filled: remainingQty === 0, fills, remainingQuantity: remainingQty };
  }

  private async executeMint(
    takerOrder: Order,
    makerOrder: Order,
    quantity: number,
    yesPrice: number,
    noPrice: number
  ): Promise<void> {
    const market = await this.getMarket(takerOrder.marketId);
    if (!market) throw new Error("Market not found");

    const yesUserId =
      takerOrder.outcome === "yes" ? takerOrder.userId : makerOrder.userId;
    const noUserId =
      takerOrder.outcome === "no" ? takerOrder.userId : makerOrder.userId;

    const collateralPerPair = 1;
    const totalCollateral = collateralPerPair * quantity;

    await db.insert(orderFills).values({
      marketId: takerOrder.marketId,
      takerOrderId: takerOrder.id,
      makerOrderId: makerOrder.id,
      takerUserId: takerOrder.userId,
      makerUserId: makerOrder.userId,
      fillType: "mint",
      quantity,
      yesPrice,
      noPrice,
      collateralMoved: totalCollateral,
    });

    await this.updatePosition(takerOrder.marketId, yesUserId, "yes", quantity, yesPrice);
    await this.updatePosition(takerOrder.marketId, noUserId, "no", quantity, noPrice);

    await db
      .update(markets)
      .set({
        outstandingPairs: market.outstandingPairs + quantity,
        lockedCollateral: market.lockedCollateral + totalCollateral,
        lastPrice: takerOrder.outcome === "yes" ? yesPrice : noPrice,
      })
      .where(eq(markets.id, market.id));

    const makerFilledQty = makerOrder.filledQuantity + quantity;
    await db
      .update(orders)
      .set({
        filledQuantity: makerFilledQty,
        status: makerFilledQty >= makerOrder.quantity ? "filled" : "partial",
        updatedAt: new Date(),
      })
      .where(eq(orders.id, makerOrder.id));
  }

  private async executeBurn(
    takerOrder: Order,
    makerOrder: Order,
    quantity: number,
    yesPrice: number,
    noPrice: number
  ): Promise<void> {
    const market = await this.getMarket(takerOrder.marketId);
    if (!market) throw new Error("Market not found");

    const yesUserId =
      takerOrder.outcome === "yes" ? takerOrder.userId : makerOrder.userId;
    const noUserId =
      takerOrder.outcome === "no" ? takerOrder.userId : makerOrder.userId;

    const collateralPerPair = 1;
    const totalCollateral = collateralPerPair * quantity;

    await db.insert(orderFills).values({
      marketId: takerOrder.marketId,
      takerOrderId: takerOrder.id,
      makerOrderId: makerOrder.id,
      takerUserId: takerOrder.userId,
      makerUserId: makerOrder.userId,
      fillType: "burn",
      quantity,
      yesPrice,
      noPrice,
      collateralMoved: totalCollateral,
    });

    await this.updatePosition(takerOrder.marketId, yesUserId, "yes", -quantity, 0);
    await this.updatePosition(takerOrder.marketId, noUserId, "no", -quantity, 0);

    const [yesSeller] = await db.select().from(users).where(eq(users.id, yesUserId));
    const [noSeller] = await db.select().from(users).where(eq(users.id, noUserId));

    const yesProceeds = yesPrice * quantity;
    const noProceeds = noPrice * quantity;

    await db
      .update(users)
      .set({ balance: yesSeller.balance + yesProceeds })
      .where(eq(users.id, yesUserId));

    await db
      .update(users)
      .set({ balance: noSeller.balance + noProceeds })
      .where(eq(users.id, noUserId));

    await db.insert(collateralLedger).values({
      userId: yesUserId,
      marketId: market.id,
      amount: yesProceeds,
      reason: "burn_release",
      balanceBefore: yesSeller.balance,
      balanceAfter: yesSeller.balance + yesProceeds,
    });

    await db.insert(collateralLedger).values({
      userId: noUserId,
      marketId: market.id,
      amount: noProceeds,
      reason: "burn_release",
      balanceBefore: noSeller.balance,
      balanceAfter: noSeller.balance + noProceeds,
    });

    await db
      .update(markets)
      .set({
        outstandingPairs: Math.max(0, market.outstandingPairs - quantity),
        lockedCollateral: Math.max(0, market.lockedCollateral - totalCollateral),
        lastPrice: takerOrder.outcome === "yes" ? yesPrice : noPrice,
      })
      .where(eq(markets.id, market.id));

    const makerFilledQty = makerOrder.filledQuantity + quantity;
    await db
      .update(orders)
      .set({
        filledQuantity: makerFilledQty,
        status: makerFilledQty >= makerOrder.quantity ? "filled" : "partial",
        updatedAt: new Date(),
      })
      .where(eq(orders.id, makerOrder.id));
  }

  async getPosition(marketId: string, userId: string): Promise<MarketPosition> {
    const [position] = await db
      .select()
      .from(marketPositions)
      .where(
        and(
          eq(marketPositions.marketId, marketId),
          eq(marketPositions.userId, userId)
        )
      );

    if (position) return position;

    const [newPosition] = await db
      .insert(marketPositions)
      .values({
        marketId,
        userId,
        yesShares: 0,
        noShares: 0,
        avgYesPrice: 0,
        avgNoPrice: 0,
        realizedPnl: 0,
      })
      .returning();

    return newPosition;
  }

  private async updatePosition(
    marketId: string,
    userId: string,
    outcome: "yes" | "no",
    quantityDelta: number,
    price: number
  ): Promise<void> {
    const position = await this.getPosition(marketId, userId);

    if (outcome === "yes") {
      const newShares = position.yesShares + quantityDelta;
      let newAvgPrice = position.avgYesPrice;
      
      if (quantityDelta > 0 && newShares > 0) {
        newAvgPrice =
          (position.yesShares * position.avgYesPrice + quantityDelta * price) /
          newShares;
      }

      await db
        .update(marketPositions)
        .set({
          yesShares: Math.max(0, newShares),
          avgYesPrice: newShares > 0 ? newAvgPrice : 0,
          updatedAt: new Date(),
        })
        .where(eq(marketPositions.id, position.id));
    } else {
      const newShares = position.noShares + quantityDelta;
      let newAvgPrice = position.avgNoPrice;
      
      if (quantityDelta > 0 && newShares > 0) {
        newAvgPrice =
          (position.noShares * position.avgNoPrice + quantityDelta * price) /
          newShares;
      }

      await db
        .update(marketPositions)
        .set({
          noShares: Math.max(0, newShares),
          avgNoPrice: newShares > 0 ? newAvgPrice : 0,
          updatedAt: new Date(),
        })
        .where(eq(marketPositions.id, position.id));
    }
  }

  async cancelOrder(orderId: string, userId: string): Promise<Order> {
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    if (!order) throw new Error("Order not found");
    if (order.userId !== userId) throw new Error("Not authorized to cancel this order");
    if (order.status === "filled" || order.status === "cancelled") {
      throw new Error("Order cannot be cancelled");
    }

    const unfilledQty = order.quantity - order.filledQuantity;

    if (order.side === "buy" && order.collateralLocked > 0) {
      const refund = (unfilledQty / order.quantity) * order.collateralLocked;
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      
      await db
        .update(users)
        .set({ balance: user.balance + refund })
        .where(eq(users.id, userId));

      await db.insert(collateralLedger).values({
        userId,
        marketId: order.marketId,
        orderId: order.id,
        amount: refund,
        reason: "order_release",
        balanceBefore: user.balance,
        balanceAfter: user.balance + refund,
      });
    }

    const [cancelledOrder] = await db
      .update(orders)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(orders.id, orderId))
      .returning();

    return cancelledOrder;
  }

  async getUserOrders(userId: string, marketId?: string): Promise<Order[]> {
    if (marketId) {
      return db
        .select()
        .from(orders)
        .where(and(eq(orders.userId, userId), eq(orders.marketId, marketId)))
        .orderBy(desc(orders.createdAt));
    }
    return db
      .select()
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt));
  }

  async getUserPositions(userId: string): Promise<MarketPosition[]> {
    return db
      .select()
      .from(marketPositions)
      .where(eq(marketPositions.userId, userId));
  }

  async settleMarket(marketId: string, winningOutcome: "yes" | "no"): Promise<void> {
    const market = await this.getMarket(marketId);
    if (!market) throw new Error("Market not found");

    await db
      .update(orders)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(orders.marketId, marketId),
          or(eq(orders.status, "open"), eq(orders.status, "partial"))
        )
      );

    const positions = await db
      .select()
      .from(marketPositions)
      .where(eq(marketPositions.marketId, marketId));

    for (const position of positions) {
      const winningShares =
        winningOutcome === "yes" ? position.yesShares : position.noShares;

      if (winningShares > 0) {
        const payout = winningShares * 1;

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, position.userId));

        await db
          .update(users)
          .set({ balance: user.balance + payout })
          .where(eq(users.id, position.userId));

        await db.insert(collateralLedger).values({
          userId: position.userId,
          marketId,
          amount: payout,
          reason: "settlement_payout",
          balanceBefore: user.balance,
          balanceAfter: user.balance + payout,
        });
      }
    }

    await db
      .update(markets)
      .set({ status: "settled" })
      .where(eq(markets.id, marketId));
  }
}

export const matchingEngine = new MatchingEngine();
