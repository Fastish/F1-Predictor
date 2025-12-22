import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { buySharesSchema, sellSharesSchema, insertUserSchema, depositRequestSchema, placeOrderSchema, cancelOrderSchema } from "@shared/schema";
import { z } from "zod";
import { 
  validatePolygonAddress, 
  getUSDCBalance, 
  accountExists, 
  generateDepositMemo,
  getPlatformAddress,
  POLYGON_CHAIN_ID,
  USDC_CONTRACT_ADDRESS,
} from "./polygon";
import { matchingEngine } from "./matchingEngine";
import { marketMaker } from "./marketMaker";
import { randomBytes } from "crypto";
import { registerPoolRoutes } from "./pool-routes";
import { registerProofRoutes } from "./proof-routes";

// In-memory store for pending transaction expectations
// Key: nonce, Value: { userId, walletAddress, collateralAmount, orderDetails, createdAt }
interface PendingTransaction {
  userId: string;
  walletAddress: string;
  collateralAmount: number;
  orderDetails: {
    marketId: string;
    outcome: "yes" | "no";
    side: "buy" | "sell";
    price: number;
    quantity: number;
  };
  createdAt: number;
}

const pendingTransactions = new Map<string, PendingTransaction>();

// Clean up expired transactions (older than 5 minutes)
function cleanupExpiredTransactions() {
  const now = Date.now();
  const expirationMs = 5 * 60 * 1000; // 5 minutes
  const entries = Array.from(pendingTransactions.entries());
  for (const [nonce, tx] of entries) {
    if (now - tx.createdAt > expirationMs) {
      pendingTransactions.delete(nonce);
    }
  }
}

// Run cleanup every minute
setInterval(cleanupExpiredTransactions, 60 * 1000);

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Register LMSR pool routes (non-blocking)
  registerPoolRoutes(app);
  
  // Register TLSNotary proof routes (non-blocking)
  registerProofRoutes(app);

  // ============ Teams/Market Routes ============
  
  // Get all teams
  app.get("/api/teams", async (req, res) => {
    try {
      const teams = await storage.getTeams();
      res.json(teams);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch teams" });
    }
  });

  // Get single team
  app.get("/api/teams/:id", async (req, res) => {
    try {
      const team = await storage.getTeam(req.params.id);
      if (!team) {
        return res.status(404).json({ error: "Team not found" });
      }
      res.json(team);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch team" });
    }
  });

  // ============ Drivers Routes ============
  
  // Get all drivers
  app.get("/api/drivers", async (req, res) => {
    try {
      const drivers = await storage.getDrivers();
      res.json(drivers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch drivers" });
    }
  });

  // Get single driver
  app.get("/api/drivers/:id", async (req, res) => {
    try {
      const driver = await storage.getDriver(req.params.id);
      if (!driver) {
        return res.status(404).json({ error: "Driver not found" });
      }
      res.json(driver);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch driver" });
    }
  });

  // Get drivers by team
  app.get("/api/teams/:teamId/drivers", async (req, res) => {
    try {
      const drivers = await storage.getDriversByTeam(req.params.teamId);
      res.json(drivers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch drivers for team" });
    }
  });

  // Get recent transactions (market activity)
  app.get("/api/market/activity", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const transactions = await storage.getRecentTransactions(limit);
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch market activity" });
    }
  });

  // Get shares sold by team
  app.get("/api/market/shares-by-team", async (req, res) => {
    try {
      const sharesByTeam = await storage.getSharesSoldByTeam();
      // Convert Map to object for JSON response
      const result: Record<string, number> = {};
      sharesByTeam.forEach((value, key) => {
        result[key] = value;
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch shares by team" });
    }
  });

  // Get prize pool (total of all buy transactions)
  app.get("/api/market/prize-pool", async (req, res) => {
    try {
      const prizePool = await storage.getPrizePool();
      res.json({ prizePool });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch prize pool" });
    }
  });

  // Get price history for charts
  app.get("/api/market/price-history", async (req, res) => {
    try {
      const teamId = req.query.teamId as string | undefined;
      const limit = parseInt(req.query.limit as string) || 500;
      const history = await storage.getPriceHistory(teamId, limit);
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch price history" });
    }
  });

  // ============ User Routes ============

  // Create or get guest user (simplified auth for demo)
  app.post("/api/users/guest", async (req, res) => {
    try {
      const guestId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const user = await storage.createUser({
        username: guestId,
        password: "guest",
      });
      res.json(user);
    } catch (error) {
      res.status(500).json({ error: "Failed to create guest user" });
    }
  });

  // Get user by ID
  app.get("/api/users/:id", async (req, res) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      // Don't send password
      const { password, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  // Link wallet to user
  app.post("/api/users/:id/link-wallet", async (req, res) => {
    try {
      const { walletAddress } = req.body;
      if (!walletAddress || typeof walletAddress !== "string") {
        return res.status(400).json({ error: "Wallet address is required" });
      }
      
      // Validate the wallet address format (Polygon/EVM)
      const isValid = await validatePolygonAddress(walletAddress);
      if (!isValid) {
        return res.status(400).json({ error: "Invalid Polygon wallet address format" });
      }
      
      const user = await storage.linkWallet(req.params.id, walletAddress);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      const { password, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      res.status(500).json({ error: "Failed to link wallet" });
    }
  });

  // ============ Portfolio Routes ============

  // Get user holdings
  app.get("/api/users/:userId/holdings", async (req, res) => {
    try {
      const holdings = await storage.getHoldingsByUser(req.params.userId);
      res.json(holdings);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch holdings" });
    }
  });

  // Get user transactions
  app.get("/api/users/:userId/transactions", async (req, res) => {
    try {
      const transactions = await storage.getTransactionsByUser(req.params.userId);
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch transactions" });
    }
  });

  // ============ Trading Routes ============

  // Buy shares
  app.post("/api/trade/buy", async (req, res) => {
    try {
      // Check if season is active (trading locked when concluded)
      const seasonActive = await storage.isSeasonActive();
      const currentSeason = await storage.getCurrentSeason();
      if (currentSeason && !seasonActive) {
        return res.status(403).json({ error: "Trading is locked. The season has concluded." });
      }

      const parsed = buySharesSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }

      // Check if user has a linked wallet
      const user = await storage.getUser(parsed.data.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      if (!user.walletAddress) {
        return res.status(403).json({ error: "Wallet not connected. Please connect your Freighter wallet to trade." });
      }

      // Verify USDC balance in wallet
      const team = await storage.getTeam(parsed.data.teamId);
      if (!team) {
        return res.status(404).json({ error: "Team not found" });
      }
      const totalCost = team.price * parsed.data.quantity;
      const usdcBalance = await getUSDCBalance(user.walletAddress);
      const availableBalance = parseFloat(usdcBalance);
      
      if (availableBalance < totalCost) {
        return res.status(400).json({ 
          error: `Insufficient USDC balance. You have $${availableBalance.toFixed(2)} but need $${totalCost.toFixed(2)}.` 
        });
      }

      const result = await storage.buyShares(parsed.data);
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({ success: true, transaction: result.transaction });
    } catch (error) {
      res.status(500).json({ error: "Failed to process trade" });
    }
  });

  // Sell shares
  app.post("/api/trade/sell", async (req, res) => {
    try {
      // Check if season is active (trading locked when concluded)
      const seasonActive = await storage.isSeasonActive();
      const currentSeason = await storage.getCurrentSeason();
      if (currentSeason && !seasonActive) {
        return res.status(403).json({ error: "Trading is locked. The season has concluded." });
      }

      const parsed = sellSharesSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }

      // Check if user has a linked wallet
      const user = await storage.getUser(parsed.data.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      if (!user.walletAddress) {
        return res.status(403).json({ error: "Wallet not connected. Please connect your Freighter wallet to trade." });
      }

      const result = await storage.sellShares(parsed.data);
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      // Note: In a full implementation, USDC proceeds would be sent to user's wallet
      res.json({ success: true, transaction: result.transaction });
    } catch (error) {
      res.status(500).json({ error: "Failed to process trade" });
    }
  });

  // ============ Polygon/USDC Routes ============

  // Get Polygon network info
  app.get("/api/polygon/info", async (req, res) => {
    res.json({
      network: "polygon",
      chainId: POLYGON_CHAIN_ID,
      usdcContract: USDC_CONTRACT_ADDRESS,
      platformAddress: getPlatformAddress(),
    });
  });

  // Validate a Polygon address
  app.post("/api/polygon/validate-address", async (req, res) => {
    try {
      const { address } = req.body;
      if (!address) {
        return res.status(400).json({ error: "Address is required" });
      }
      
      const isValid = await validatePolygonAddress(address);
      if (!isValid) {
        return res.json({ valid: false, reason: "Invalid Polygon address format" });
      }
      
      res.json({ 
        valid: true, 
        exists: true,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to validate address" });
    }
  });

  // Get USDC balance for an address
  app.get("/api/polygon/balance/:address", async (req, res) => {
    try {
      const { address } = req.params;
      const isValid = await validatePolygonAddress(address);
      if (!isValid) {
        return res.status(400).json({ error: "Invalid Polygon address" });
      }

      const balance = await getUSDCBalance(address);
      res.json({ address, balance, asset: "USDC" });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch balance" });
    }
  });

  // Get deposit info for a user (Polygon version)
  app.get("/api/users/:userId/deposit-info", async (req, res) => {
    try {
      const user = await storage.getUser(req.params.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({
        network: "polygon",
        chainId: POLYGON_CHAIN_ID,
        usdcContract: USDC_CONTRACT_ADDRESS,
        instructions: "Send USDC on Polygon network to your connected wallet address.",
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get deposit info" });
    }
  });

  // Get user deposits
  app.get("/api/users/:userId/deposits", async (req, res) => {
    try {
      const deposits = await storage.getDepositsByUser(req.params.userId);
      res.json(deposits);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch deposits" });
    }
  });

  // ============ Polymarket API Routes (Read-Only) ============
  
  // Get active F1 markets from Polymarket
  app.get("/api/polymarket/f1-markets", async (req, res) => {
    try {
      const { fetchF1Markets } = await import("./polymarket");
      const markets = await fetchF1Markets();
      res.json(markets);
    } catch (error) {
      console.error("Failed to fetch Polymarket F1 markets:", error);
      res.status(500).json({ error: "Failed to fetch F1 markets from Polymarket" });
    }
  });

  // Get all F1 markets (including closed) from Polymarket
  app.get("/api/polymarket/f1-markets/all", async (req, res) => {
    try {
      const { fetchAllF1Markets } = await import("./polymarket");
      const markets = await fetchAllF1Markets();
      res.json(markets);
    } catch (error) {
      console.error("Failed to fetch all Polymarket F1 markets:", error);
      res.status(500).json({ error: "Failed to fetch F1 markets from Polymarket" });
    }
  });

  // Get F1 events from Polymarket
  app.get("/api/polymarket/f1-events", async (req, res) => {
    try {
      const { fetchF1Events } = await import("./polymarket");
      const events = await fetchF1Events();
      res.json(events);
    } catch (error) {
      console.error("Failed to fetch Polymarket F1 events:", error);
      res.status(500).json({ error: "Failed to fetch F1 events from Polymarket" });
    }
  });

  // Get a specific market by slug
  app.get("/api/polymarket/market/:slug", async (req, res) => {
    try {
      const { getMarketBySlug } = await import("./polymarket");
      const market = await getMarketBySlug(req.params.slug);
      if (!market) {
        return res.status(404).json({ error: "Market not found" });
      }
      res.json(market);
    } catch (error) {
      console.error("Failed to fetch Polymarket market:", error);
      res.status(500).json({ error: "Failed to fetch market from Polymarket" });
    }
  });

  // Get order book for a token
  app.get("/api/polymarket/orderbook/:tokenId", async (req, res) => {
    try {
      const { getOrderBook } = await import("./polymarket");
      const orderBook = await getOrderBook(req.params.tokenId);
      if (!orderBook) {
        return res.status(404).json({ error: "Order book not found" });
      }
      res.json(orderBook);
    } catch (error) {
      console.error("Failed to fetch Polymarket order book:", error);
      res.status(500).json({ error: "Failed to fetch order book from Polymarket" });
    }
  });

  // Get midpoint price for a token
  app.get("/api/polymarket/midpoint/:tokenId", async (req, res) => {
    try {
      const { getMidpoint } = await import("./polymarket");
      const midpoint = await getMidpoint(req.params.tokenId);
      if (midpoint === null) {
        return res.status(404).json({ error: "Midpoint not found" });
      }
      res.json({ tokenId: req.params.tokenId, midpoint });
    } catch (error) {
      console.error("Failed to fetch Polymarket midpoint:", error);
      res.status(500).json({ error: "Failed to fetch midpoint from Polymarket" });
    }
  });

  // Get price for a token and side
  app.get("/api/polymarket/price/:tokenId/:side", async (req, res) => {
    try {
      const side = req.params.side.toUpperCase() as "BUY" | "SELL";
      if (side !== "BUY" && side !== "SELL") {
        return res.status(400).json({ error: "Side must be BUY or SELL" });
      }
      const { getPrice } = await import("./polymarket");
      const price = await getPrice(req.params.tokenId, side);
      if (price === null) {
        return res.status(404).json({ error: "Price not found" });
      }
      res.json({ tokenId: req.params.tokenId, side, price });
    } catch (error) {
      console.error("Failed to fetch Polymarket price:", error);
      res.status(500).json({ error: "Failed to fetch price from Polymarket" });
    }
  });

  // Search markets
  app.get("/api/polymarket/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        return res.status(400).json({ error: "Query parameter 'q' is required" });
      }
      const { searchMarkets } = await import("./polymarket");
      const markets = await searchMarkets(query);
      res.json(markets);
    } catch (error) {
      console.error("Failed to search Polymarket markets:", error);
      res.status(500).json({ error: "Failed to search markets on Polymarket" });
    }
  });

  // Generate builder signature for order attribution (server-side to protect credentials)
  app.post("/api/polymarket/builder-sign", async (req, res) => {
    try {
      const { method, path, body } = req.body;
      
      if (!method || !path) {
        return res.status(400).json({ error: "method and path are required" });
      }

      const { generateBuilderSignature, hasBuilderCredentials } = await import("./polymarket");
      
      if (!hasBuilderCredentials()) {
        return res.status(503).json({ 
          error: "Builder credentials not configured",
          available: false 
        });
      }

      const headers = generateBuilderSignature(method, path, body || "");
      
      if (!headers) {
        return res.status(500).json({ error: "Failed to generate builder signature" });
      }

      res.json({ 
        available: true,
        headers 
      });
    } catch (error) {
      console.error("Failed to generate builder signature:", error);
      res.status(500).json({ error: "Failed to generate builder signature" });
    }
  });

  // Check if builder credentials are configured
  app.get("/api/polymarket/builder-status", async (req, res) => {
    try {
      const { hasBuilderCredentials } = await import("./polymarket");
      res.json({ available: hasBuilderCredentials() });
    } catch (error) {
      res.status(500).json({ error: "Failed to check builder status" });
    }
  });

  // ============ Polymarket Championship Markets ============
  
  // Get F1 Constructors Championship market from Polymarket
  app.get("/api/polymarket/constructors", async (req, res) => {
    try {
      const { getConstructorsMarket } = await import("./polymarket");
      const outcomes = await getConstructorsMarket();
      res.json(outcomes);
    } catch (error) {
      console.error("Failed to fetch constructors market:", error);
      res.status(500).json({ error: "Failed to fetch constructors market" });
    }
  });

  // Get F1 Drivers Championship market from Polymarket
  app.get("/api/polymarket/drivers", async (req, res) => {
    try {
      const { getDriversMarket } = await import("./polymarket");
      const outcomes = await getDriversMarket();
      res.json(outcomes);
    } catch (error) {
      console.error("Failed to fetch drivers market:", error);
      res.status(500).json({ error: "Failed to fetch drivers market" });
    }
  });

  // Get event details by slug
  app.get("/api/polymarket/event/:slug", async (req, res) => {
    try {
      const { getEventBySlug } = await import("./polymarket");
      const event = await getEventBySlug(req.params.slug);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }
      res.json(event);
    } catch (error) {
      console.error("Failed to fetch event:", error);
      res.status(500).json({ error: "Failed to fetch event" });
    }
  });

  // Place order on Polymarket (via builder API)
  app.post("/api/polymarket/place-order", async (req, res) => {
    try {
      const { tokenId, side, outcome, price, size } = req.body;
      
      if (!tokenId || !side || !outcome || price === undefined || size === undefined) {
        return res.status(400).json({ error: "Missing required fields: tokenId, side, outcome, price, size" });
      }

      const { generateBuilderSignature, hasBuilderCredentials } = await import("./polymarket");
      
      if (!hasBuilderCredentials()) {
        return res.status(503).json({ 
          error: "Builder credentials not configured. Orders cannot be placed.",
          available: false 
        });
      }

      // For now, simulate the order placement since actual CLOB order placement
      // requires complex EIP-712 signing and Polygon transaction flow
      // This is a placeholder that shows the order would be submitted
      console.log("Polymarket order request:", {
        tokenId,
        side,
        outcome,
        price,
        size,
        timestamp: new Date().toISOString()
      });

      // In a full implementation, this would:
      // 1. Generate EIP-712 signature for the order
      // 2. Submit to CLOB API with builder headers
      // 3. Return order ID and status

      res.json({
        success: true,
        message: "Order submitted to Polymarket",
        order: {
          tokenId,
          side,
          outcome,
          price,
          size,
          status: "pending",
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error("Failed to place Polymarket order:", error);
      res.status(500).json({ error: "Failed to place order" });
    }
  });

  // ============ CLOB (Central Limit Order Book) Routes ============
  // @deprecated - CLOB system is legacy. Use /api/pools/* endpoints instead.
  // The LMSR pool system (pool-routes.ts) is the active trading system.
  // These endpoints are maintained for backward compatibility only.

  // @deprecated - Use /api/pools/team-pool or /api/pools/driver-pool instead
  // Get all markets
  app.get("/api/clob/markets", async (req, res) => {
    try {
      const markets = await storage.getMarkets();
      res.json(markets);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch markets" });
    }
  });

  // Get team markets for current season
  app.get("/api/clob/team-markets", async (req, res) => {
    try {
      const season = await storage.getCurrentSeason();
      if (!season) {
        return res.json([]);
      }
      const markets = await storage.getMarketsByType(season.id, "team");
      res.json(markets);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch team markets" });
    }
  });

  // Get driver markets for current season
  app.get("/api/clob/driver-markets", async (req, res) => {
    try {
      const season = await storage.getCurrentSeason();
      if (!season) {
        return res.json([]);
      }
      const markets = await storage.getMarketsByType(season.id, "driver");
      res.json(markets);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch driver markets" });
    }
  });

  // Get market by ID
  app.get("/api/clob/markets/:marketId", async (req, res) => {
    try {
      const market = await matchingEngine.getMarket(req.params.marketId);
      if (!market) {
        return res.status(404).json({ error: "Market not found" });
      }
      res.json(market);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch market" });
    }
  });

  // Get order book for a market
  app.get("/api/clob/markets/:marketId/orderbook", async (req, res) => {
    try {
      const orderBook = await matchingEngine.getOrderBook(req.params.marketId);
      res.json(orderBook);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch order book" });
    }
  });

  // Place an order (simplified for Polygon - wallet verification on client side)
  app.post("/api/clob/orders", async (req, res) => {
    try {
      const parsed = placeOrderSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid order data", details: parsed.error.errors });
      }

      const { marketId, userId, outcome, side, price, quantity } = parsed.data;
      
      // Get user and verify wallet is connected
      const user = await storage.getUser(userId);
      if (!user?.walletAddress) {
        return res.status(400).json({ error: "Wallet not connected" });
      }

      // For buy orders, verify sufficient USDC balance
      if (side === "buy") {
        const collateralRequired = price * quantity;
        const usdcBalance = await getUSDCBalance(user.walletAddress);
        if (parseFloat(usdcBalance) < collateralRequired) {
          return res.status(400).json({ 
            error: `Insufficient USDC. Need $${collateralRequired.toFixed(2)}, have $${parseFloat(usdcBalance).toFixed(2)}` 
          });
        }
      }
      
      const result = await matchingEngine.placeOrder(marketId, userId, outcome, side, price, quantity);
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to place order" });
    }
  });

  // Cancel an order
  app.post("/api/clob/orders/cancel", async (req, res) => {
    try {
      const parsed = cancelOrderSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request data" });
      }

      const { orderId, userId } = parsed.data;
      const cancelledOrder = await matchingEngine.cancelOrder(orderId, userId);
      res.json(cancelledOrder);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to cancel order" });
    }
  });

  // Get user's orders
  app.get("/api/clob/users/:userId/orders", async (req, res) => {
    try {
      const marketId = req.query.marketId as string | undefined;
      const orders = await matchingEngine.getUserOrders(req.params.userId, marketId);
      res.json(orders);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });

  // Get user's positions
  app.get("/api/clob/users/:userId/positions", async (req, res) => {
    try {
      const positions = await matchingEngine.getUserPositions(req.params.userId);
      res.json(positions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch positions" });
    }
  });

  // Get CLOB price history (from order fills)
  app.get("/api/clob/price-history", async (req, res) => {
    try {
      const teamId = req.query.teamId as string | undefined;
      const limit = parseInt(req.query.limit as string) || 500;
      const history = await storage.getCLOBPriceHistory(teamId, limit);
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch CLOB price history" });
    }
  });

  // ============ Admin Authentication ============

  // Helper to check if wallet is admin
  function isAdminWallet(walletAddress: string | undefined): boolean {
    if (!walletAddress) return false;
    // Support both singular and plural env var names, case-insensitive comparison
    const adminEnv = process.env.ADMIN_WALLET_ADDRESSES || process.env.ADMIN_WALLET_ADDRESS || "";
    const adminAddresses = adminEnv.split(",").map(a => a.trim().toLowerCase());
    return adminAddresses.includes(walletAddress.toLowerCase());
  }

  // Middleware to protect admin routes
  function requireAdmin(req: any, res: any, next: any) {
    const walletAddress = req.headers["x-wallet-address"] as string;
    if (!isAdminWallet(walletAddress)) {
      return res.status(403).json({ error: "Unauthorized. Admin wallet required." });
    }
    next();
  }

  // Check if a wallet address is an admin
  app.get("/api/admin/check/:walletAddress", async (req, res) => {
    try {
      const { walletAddress } = req.params;
      const isAdmin = isAdminWallet(walletAddress);
      res.json({ isAdmin });
    } catch (error) {
      res.status(500).json({ error: "Failed to check admin status" });
    }
  });

  // ============ Season Management Routes ============

  // Get current season status
  app.get("/api/season", async (req, res) => {
    try {
      const season = await storage.getCurrentSeason();
      if (!season) {
        return res.json({ exists: false, status: "no_season" });
      }
      res.json({ exists: true, ...season });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch season" });
    }
  });

  // Create a new season (admin)
  app.post("/api/admin/season/create", requireAdmin, async (req, res) => {
    try {
      const { year } = req.body;
      if (!year || typeof year !== "number") {
        return res.status(400).json({ error: "Year is required" });
      }

      // Check if there's already an active season
      const currentSeason = await storage.getCurrentSeason();
      if (currentSeason && currentSeason.status === "active") {
        return res.status(400).json({ error: "There is already an active season" });
      }

      const season = await storage.createSeason({ year, status: "active" });
      
      // Create CLOB markets for each team
      const markets = await storage.createMarketsForSeason(season.id);
      
      // Initialize LMSR championship pools for team and driver betting
      const { teamPool, driverPool } = await storage.initializePoolsForSeason(season.id);
      
      res.json({ 
        ...season, 
        markets,
        pools: { teamPool, driverPool }
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to create season" });
    }
  });

  // Create driver markets for existing season (admin)
  app.post("/api/admin/driver-markets/create", requireAdmin, async (req, res) => {
    try {
      const currentSeason = await storage.getCurrentSeason();
      if (!currentSeason) {
        return res.status(400).json({ error: "No active season found. Create a season first." });
      }
      if (currentSeason.status !== "active") {
        return res.status(400).json({ error: "Season is not active" });
      }

      // Check if driver markets already exist for this season
      const existingDriverMarkets = await storage.getMarketsByType(currentSeason.id, "driver");
      if (existingDriverMarkets.length > 0) {
        return res.status(400).json({ 
          error: "Driver markets already exist for this season",
          markets: existingDriverMarkets 
        });
      }

      // Create driver markets
      const driverMarkets = await storage.createDriverMarketsForSeason(currentSeason.id);
      
      res.json({ 
        success: true, 
        seasonId: currentSeason.id,
        marketsCreated: driverMarkets.length,
        markets: driverMarkets 
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to create driver markets" });
    }
  });

  // Close season and declare winner (admin)
  app.post("/api/admin/season/conclude", requireAdmin, async (req, res) => {
    try {
      const { winningTeamId } = req.body;
      if (!winningTeamId) {
        return res.status(400).json({ error: "Winning team ID is required" });
      }

      // Get current season
      const currentSeason = await storage.getCurrentSeason();
      if (!currentSeason) {
        return res.status(400).json({ error: "No active season found" });
      }
      if (currentSeason.status !== "active") {
        return res.status(400).json({ error: "Season is already concluded" });
      }

      // Verify the team exists
      const winningTeam = await storage.getTeam(winningTeamId);
      if (!winningTeam) {
        return res.status(404).json({ error: "Team not found" });
      }

      // Freeze all CLOB markets
      await matchingEngine.freezeAllMarkets(currentSeason.id);

      // Cancel all open orders
      const cancelledOrders = await matchingEngine.cancelAllOrdersForSeason(currentSeason.id);

      // Get prize pool from locked collateral
      const seasonMarkets = await storage.getMarketsBySeason(currentSeason.id);
      const lockedCollateral = seasonMarkets.reduce((sum, m) => sum + (m.lockedCollateral || 0), 0);
      const prizePool = lockedCollateral;

      // Conclude the season
      const updatedSeason = await storage.concludeSeason(
        currentSeason.id,
        winningTeamId,
        prizePool
      );

      res.json({ 
        success: true, 
        season: updatedSeason,
        winningTeam,
        cancelledOrders,
        prizePool 
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to conclude season" });
    }
  });

  // Calculate and create payout records (admin)
  app.post("/api/admin/season/calculate-payouts", requireAdmin, async (req, res) => {
    try {
      // Get current season
      const currentSeason = await storage.getCurrentSeason();
      if (!currentSeason) {
        return res.status(400).json({ error: "No season found" });
      }
      if (currentSeason.status !== "concluded") {
        return res.status(400).json({ error: "Season must be concluded before calculating payouts" });
      }
      if (!currentSeason.winningTeamId) {
        return res.status(400).json({ error: "No winning team declared" });
      }

      // Check if payouts already exist
      const existingPayouts = await storage.getPayoutsBySeason(currentSeason.id);
      if (existingPayouts.length > 0) {
        return res.status(400).json({ error: "Payouts already calculated", payouts: existingPayouts });
      }

      // Get the market for the winning team
      const winningMarket = await matchingEngine.getMarketByTeamAndSeason(
        currentSeason.winningTeamId,
        currentSeason.id
      );
      if (!winningMarket) {
        return res.status(400).json({ error: "No market found for winning team" });
      }

      // Get all YES share holders from CLOB positions
      const yesHolders = await matchingEngine.getYesShareHolders(winningMarket.id);
      if (yesHolders.length === 0) {
        return res.json({ success: true, message: "No YES share holders for winning team", payouts: [] });
      }

      // Calculate total YES shares held
      const totalYesShares = yesHolders.reduce((sum, h) => sum + h.yesShares, 0);

      // Create payout records for each holder
      // Each YES share pays $1
      const payouts = [];
      for (const holder of yesHolders) {
        const sharePercentage = holder.yesShares / totalYesShares;
        const payoutAmount = holder.yesShares * 1; // $1 per YES share

        const payout = await storage.createPayout({
          seasonId: currentSeason.id,
          userId: holder.userId,
          teamId: currentSeason.winningTeamId,
          sharesHeld: holder.yesShares,
          sharePercentage,
          payoutAmount,
          status: "pending",
        });
        payouts.push({ ...payout, walletAddress: holder.walletAddress });
      }

      res.json({ 
        success: true, 
        totalShares: totalYesShares,
        prizePool: currentSeason.prizePool,
        payouts 
      });
    } catch (error) {
      console.error("Error calculating payouts:", error);
      res.status(500).json({ error: "Failed to calculate payouts" });
    }
  });

  // Get payouts for a season
  app.get("/api/admin/season/:seasonId/payouts", requireAdmin, async (req, res) => {
    try {
      const payouts = await storage.getPayoutsBySeason(req.params.seasonId);
      res.json(payouts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch payouts" });
    }
  });

  // Get user's payouts
  app.get("/api/users/:userId/payouts", async (req, res) => {
    try {
      const payouts = await storage.getPayoutsByUser(req.params.userId);
      res.json(payouts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user payouts" });
    }
  });

  // Distribute payouts - send USDC to winners (admin)
  app.post("/api/admin/season/distribute-payouts", requireAdmin, async (req, res) => {
    try {
      // Get current season
      const currentSeason = await storage.getCurrentSeason();
      if (!currentSeason) {
        return res.status(400).json({ error: "No season found" });
      }
      if (currentSeason.status !== "concluded") {
        return res.status(400).json({ error: "Season must be concluded before distributing payouts" });
      }

      // Get pending payouts
      const allPayouts = await storage.getPayoutsBySeason(currentSeason.id);
      const pendingPayouts = allPayouts.filter(p => p.status === "pending");

      if (pendingPayouts.length === 0) {
        return res.json({ success: true, message: "No pending payouts to distribute", results: [] });
      }

      // Process each payout
      const results = [];
      for (const payout of pendingPayouts) {
        // Get user's wallet address
        const user = await storage.getUser(payout.userId);
        if (!user || !user.walletAddress) {
          results.push({
            payoutId: payout.id,
            userId: payout.userId,
            success: false,
            error: "User has no linked wallet",
          });
          await storage.updatePayoutStatus(payout.id, "failed");
          continue;
        }

        // Mark payout as pending - actual on-chain transfer handled separately
        // For Polygon, payouts will be handled through smart contract or manual process
        await storage.updatePayoutStatus(payout.id, "pending");
        results.push({
          payoutId: payout.id,
          userId: payout.userId,
          walletAddress: user.walletAddress,
          amount: payout.payoutAmount,
          success: true,
          message: "Payout marked for processing",
        });
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      res.json({
        success: true,
        message: `Processed ${results.length} payouts: ${successCount} successful, ${failCount} failed`,
        results,
      });
    } catch (error) {
      console.error("Error distributing payouts:", error);
      res.status(500).json({ error: "Failed to distribute payouts" });
    }
  });

  // ============ Market Maker Bot Routes ============

  // Start market maker bot (admin)
  app.post("/api/admin/market-maker/start", requireAdmin, async (req, res) => {
    try {
      const intervalMs = req.body.intervalMs || 30000;
      await marketMaker.start(intervalMs);
      const status = await marketMaker.getStatus();
      res.json({ success: true, message: "Market maker started", status });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to start market maker" });
    }
  });

  // Stop market maker bot (admin)
  app.post("/api/admin/market-maker/stop", requireAdmin, async (req, res) => {
    try {
      marketMaker.stop();
      const status = await marketMaker.getStatus();
      res.json({ success: true, message: "Market maker stopped", status });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to stop market maker" });
    }
  });

  // Get market maker status (admin)
  app.get("/api/admin/market-maker/status", requireAdmin, async (req, res) => {
    try {
      const status = await marketMaker.getStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: "Failed to get market maker status" });
    }
  });

  // ============ Simulation Routes (Admin) ============

  // Simulate random trades for testing
  app.post("/api/admin/simulate-trades", requireAdmin, async (req, res) => {
    try {
      const { 
        marketId, 
        numTrades = 10, 
        minPrice = 0.20, 
        maxPrice = 0.80 
      } = req.body;

      if (!marketId) {
        return res.status(400).json({ error: "marketId is required" });
      }

      // Get or create simulation users
      const simulationUserIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        const username = `sim_trader_${i}`;
        let user = await storage.getUserByUsername(username);
        if (!user) {
          user = await storage.createUser({
            username,
            password: "simulation",
          });
          // Give simulation users initial balance
          await storage.updateUserBalance(user.id, 10000);
        }
        simulationUserIds.push(user.id);
      }

      const results: Array<{
        tradeNum: number;
        userId: string;
        outcome: string;
        side: string;
        price: number;
        quantity: number;
        success: boolean;
        error?: string;
      }> = [];

      for (let i = 0; i < numTrades; i++) {
        // Random user
        const userId = simulationUserIds[Math.floor(Math.random() * simulationUserIds.length)];
        
        // Random parameters
        const outcome = Math.random() > 0.5 ? "yes" : "no" as "yes" | "no";
        const side = Math.random() > 0.5 ? "buy" : "sell" as "buy" | "sell";
        const price = parseFloat((Math.random() * (maxPrice - minPrice) + minPrice).toFixed(2));
        const quantity = Math.floor(Math.random() * 20) + 1;

        try {
          await matchingEngine.placeOrder(marketId, userId, outcome, side, price, quantity);
          results.push({
            tradeNum: i + 1,
            userId,
            outcome,
            side,
            price,
            quantity,
            success: true,
          });
        } catch (error: any) {
          results.push({
            tradeNum: i + 1,
            userId,
            outcome,
            side,
            price,
            quantity,
            success: false,
            error: error.message,
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      res.json({
        success: true,
        message: `Simulated ${numTrades} trades: ${successCount} successful, ${failCount} failed`,
        results,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to simulate trades" });
    }
  });

  return httpServer;
}

// Deferred initialization - runs AFTER the port is listening
// This prevents deployment timeouts caused by slow startup operations
export async function initializeAfterListen(): Promise<void> {
  console.log("Starting deferred initialization...");
  
  // Seed teams and drivers
  await storage.seedTeams();
  await storage.seedDrivers();
  console.log("Seeded teams and drivers");
  
  // Record initial price snapshots if no history exists
  const existingHistory = await storage.getPriceHistory(undefined, 1);
  if (existingHistory.length === 0) {
    await storage.recordAllTeamPrices();
    console.log("Seeded initial price history snapshots");
  }

  // Auto-start market maker bot to provide liquidity
  try {
    await marketMaker.start(30000); // 30 second interval
    console.log("Market maker bot auto-started for liquidity");
  } catch (error) {
    console.error("Failed to start market maker bot:", error);
  }

  // Initialize championship pools for current season if they don't exist
  try {
    const currentSeason = await storage.getCurrentSeason();
    if (currentSeason && currentSeason.status === "active") {
      const existingTeamPool = await storage.getChampionshipPoolByType(currentSeason.id, "team");
      const existingDriverPool = await storage.getChampionshipPoolByType(currentSeason.id, "driver");
      
      if (!existingTeamPool || !existingDriverPool) {
        // Verify teams and drivers are seeded before pool initialization
        const teams = await storage.getTeams();
        const drivers = await storage.getDrivers();
        
        if (teams.length === 0) {
          console.error("Cannot initialize pools: No teams found. Ensure seedTeams() ran successfully.");
        } else if (drivers.length === 0) {
          console.error("Cannot initialize pools: No drivers found. Ensure seedDrivers() ran successfully.");
        } else {
          const { teamPool, driverPool } = await storage.initializePoolsForSeason(currentSeason.id);
          console.log("Initialized championship pools for season:", currentSeason.id);
          console.log("  Team pool:", teamPool.id, `(${teams.length} outcomes)`);
          console.log("  Driver pool:", driverPool.id, `(${drivers.length} outcomes)`);
        }
      }
    }
  } catch (error) {
    console.error("Failed to initialize championship pools:", error);
  }
  
  console.log("Deferred initialization complete");
}
