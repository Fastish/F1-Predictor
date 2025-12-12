import { db } from "./db";
import { eq, and, or, desc, asc } from "drizzle-orm";
import { markets, orders, users, marketPositions, type Market } from "@shared/schema";
import { matchingEngine } from "./matchingEngine";

const MM_BOT_USERNAME = "market_maker_bot";
const DEFAULT_SPREAD = 0.02;
const ORDER_SIZE = 10;
const MIN_PRICE = 0.05;
const MAX_PRICE = 0.95;
const INVENTORY_LIMIT = 100;

interface MarketMakerConfig {
  spread: number;
  orderSize: number;
  midPrice: number;
}

export class MarketMaker {
  private botUserId: string | null = null;
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;

  async initialize(): Promise<void> {
    let [bot] = await db.select().from(users).where(eq(users.username, MM_BOT_USERNAME));
    
    if (!bot) {
      [bot] = await db.insert(users).values({
        username: MM_BOT_USERNAME,
        password: "bot",
        balance: 100000,
      }).returning();
      console.log(`Created market maker bot with ID: ${bot.id}`);
    }
    
    this.botUserId = bot.id;
  }

  async start(intervalMs: number = 30000): Promise<void> {
    if (this.isRunning) {
      console.log("Market maker is already running");
      return;
    }

    await this.initialize();
    this.isRunning = true;

    console.log(`Market maker started with ${intervalMs}ms interval`);
    
    this.intervalId = setInterval(async () => {
      try {
        await this.runCycle();
      } catch (error) {
        console.error("Market maker cycle error:", error);
      }
    }, intervalMs);

    await this.runCycle();
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log("Market maker stopped");
  }

  private async runCycle(): Promise<void> {
    if (!this.botUserId) {
      console.log("Bot not initialized");
      return;
    }

    const activeMarkets = await db
      .select()
      .from(markets)
      .where(eq(markets.status, "active"));

    for (const market of activeMarkets) {
      try {
        await this.quoteMarket(market);
      } catch (error) {
        console.error(`Error quoting market ${market.id}:`, error);
      }
    }
  }

  private async quoteMarket(market: Market): Promise<void> {
    if (!this.botUserId) return;

    await this.cancelExistingOrders(market.id);

    const position = await matchingEngine.getPosition(market.id, this.botUserId);
    const netPosition = position.yesShares - position.noShares;

    const [bot] = await db.select().from(users).where(eq(users.id, this.botUserId));
    if (!bot || bot.balance < ORDER_SIZE * 2) {
      console.log(`Bot has insufficient balance: ${bot?.balance}`);
      return;
    }

    const midPrice = market.lastPrice || 0.5;
    const adjustedMid = this.adjustMidForInventory(midPrice, netPosition);

    const yesBidPrice = Math.max(MIN_PRICE, adjustedMid - DEFAULT_SPREAD / 2);
    const yesAskPrice = Math.min(MAX_PRICE, adjustedMid + DEFAULT_SPREAD / 2);
    const noBidPrice = Math.max(MIN_PRICE, (1 - adjustedMid) - DEFAULT_SPREAD / 2);
    const noAskPrice = Math.min(MAX_PRICE, (1 - adjustedMid) + DEFAULT_SPREAD / 2);

    const orderSize = this.calculateOrderSize(netPosition);

    try {
      if (Math.abs(netPosition) < INVENTORY_LIMIT) {
        await matchingEngine.placeOrder(
          market.id,
          this.botUserId,
          "yes",
          "buy",
          parseFloat(yesBidPrice.toFixed(2)),
          orderSize
        );

        await matchingEngine.placeOrder(
          market.id,
          this.botUserId,
          "no",
          "buy",
          parseFloat(noBidPrice.toFixed(2)),
          orderSize
        );
      }

      if (position.yesShares > 0) {
        const sellSize = Math.min(orderSize, position.yesShares);
        await matchingEngine.placeOrder(
          market.id,
          this.botUserId,
          "yes",
          "sell",
          parseFloat(yesAskPrice.toFixed(2)),
          sellSize
        );
      }

      if (position.noShares > 0) {
        const sellSize = Math.min(orderSize, position.noShares);
        await matchingEngine.placeOrder(
          market.id,
          this.botUserId,
          "no",
          "sell",
          parseFloat(noAskPrice.toFixed(2)),
          sellSize
        );
      }
    } catch (error) {
      console.error(`Error placing MM orders for market ${market.id}:`, error);
    }
  }

  private adjustMidForInventory(mid: number, netPosition: number): number {
    const inventorySkew = netPosition / (INVENTORY_LIMIT * 2);
    const adjustment = inventorySkew * 0.05;
    return Math.max(MIN_PRICE, Math.min(MAX_PRICE, mid - adjustment));
  }

  private calculateOrderSize(netPosition: number): number {
    const absPosition = Math.abs(netPosition);
    if (absPosition > INVENTORY_LIMIT * 0.8) {
      return Math.floor(ORDER_SIZE * 0.5);
    }
    if (absPosition > INVENTORY_LIMIT * 0.5) {
      return Math.floor(ORDER_SIZE * 0.75);
    }
    return ORDER_SIZE;
  }

  private async cancelExistingOrders(marketId: string): Promise<void> {
    if (!this.botUserId) return;

    const botOrders = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.marketId, marketId),
          eq(orders.userId, this.botUserId),
          or(eq(orders.status, "open"), eq(orders.status, "partial"))
        )
      );

    for (const order of botOrders) {
      try {
        await matchingEngine.cancelOrder(order.id, this.botUserId);
      } catch (error) {
      }
    }
  }

  async getStatus(): Promise<{
    running: boolean;
    botUserId: string | null;
    botBalance: number;
    positions: Array<{ marketId: string; yesShares: number; noShares: number }>;
  }> {
    let botBalance = 0;
    let positions: Array<{ marketId: string; yesShares: number; noShares: number }> = [];

    if (this.botUserId) {
      const [bot] = await db.select().from(users).where(eq(users.id, this.botUserId));
      botBalance = bot?.balance || 0;

      const allPositions = await db
        .select()
        .from(marketPositions)
        .where(eq(marketPositions.userId, this.botUserId));

      positions = allPositions.map((p) => ({
        marketId: p.marketId,
        yesShares: p.yesShares,
        noShares: p.noShares,
      }));
    }

    return {
      running: this.isRunning,
      botUserId: this.botUserId,
      botBalance,
      positions,
    };
  }
}

export const marketMaker = new MarketMaker();
