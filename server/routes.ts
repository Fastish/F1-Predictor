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
import { randomBytes } from "crypto";
import { registerPoolRoutes } from "./pool-routes";

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

  // ============ Polymarket Relayer Client (Server-Side Proxy) ============
  
  // Check if relayer credentials are available
  app.get("/api/polymarket/relayer-status", async (req, res) => {
    try {
      const { hasRelayerCredentials } = await import("./polymarket");
      res.json({ available: hasRelayerCredentials() });
    } catch (error) {
      res.status(500).json({ error: "Failed to check relayer status" });
    }
  });

  // Server-side proxy for relayer requests - credentials NEVER leave the server
  // Client sends transaction data, server signs and executes the relayer request
  app.post("/api/polymarket/relayer-execute", async (req, res) => {
    try {
      const { walletAddress, walletType, transactions, description } = req.body;
      
      if (!walletAddress || !transactions || !Array.isArray(transactions)) {
        return res.status(400).json({ error: "walletAddress and transactions are required" });
      }

      const { executeRelayerTransaction, hasRelayerCredentials } = await import("./polymarket");
      
      if (!hasRelayerCredentials()) {
        return res.status(503).json({ 
          error: "Relayer credentials not configured",
          available: false 
        });
      }

      // Execute the relayer transaction server-side (credentials never exposed)
      const result = await executeRelayerTransaction(
        walletAddress,
        walletType || "proxy",
        transactions,
        description || ""
      );
      
      if (!result.success) {
        return res.status(400).json({ error: result.error || "Relayer transaction failed" });
      }

      res.json({ 
        success: true,
        transactionHash: result.transactionHash,
        proxyAddress: result.proxyAddress
      });
    } catch (error) {
      console.error("Relayer execution failed:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Relayer execution failed" });
    }
  });

  // Deploy a Safe/Proxy wallet via relayer
  app.post("/api/polymarket/relayer-deploy", async (req, res) => {
    try {
      const { walletAddress, walletType } = req.body;
      
      if (!walletAddress) {
        return res.status(400).json({ error: "walletAddress is required" });
      }

      const { deployRelayerWallet, hasRelayerCredentials } = await import("./polymarket");
      
      if (!hasRelayerCredentials()) {
        return res.status(503).json({ 
          error: "Relayer credentials not configured",
          available: false 
        });
      }

      const result = await deployRelayerWallet(walletAddress, walletType || "proxy");
      
      if (!result.success) {
        return res.status(400).json({ error: result.error || "Wallet deployment failed" });
      }

      res.json({ 
        success: true,
        transactionHash: result.transactionHash,
        proxyAddress: result.proxyAddress
      });
    } catch (error) {
      console.error("Wallet deployment failed:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Wallet deployment failed" });
    }
  });

  // ============ Polymarket Championship Markets ============
  
  // Get F1 Constructors Championship market from Polymarket (with 24h price changes)
  app.get("/api/polymarket/constructors", async (req, res) => {
    try {
      const { getConstructorsMarket, getPriceChanges } = await import("./polymarket");
      const outcomes = await getConstructorsMarket();
      
      // Fetch 24h price changes for all tokens (filter out empty/invalid token IDs)
      const tokenIds = outcomes.map(o => o.tokenId).filter(id => id && id.length > 10);
      if (tokenIds.length > 0) {
        const priceChanges = await getPriceChanges(tokenIds);
        for (const outcome of outcomes) {
          outcome.priceChange = priceChanges.get(outcome.tokenId) || 0;
        }
      }
      
      res.json(outcomes);
    } catch (error) {
      console.error("Failed to fetch constructors market:", error);
      res.status(500).json({ error: "Failed to fetch constructors market" });
    }
  });

  // Get F1 Drivers Championship market from Polymarket (with 24h price changes)
  app.get("/api/polymarket/drivers", async (req, res) => {
    try {
      const { getDriversMarket, getPriceChanges } = await import("./polymarket");
      const outcomes = await getDriversMarket();
      
      // Fetch 24h price changes for all tokens (filter out empty/invalid token IDs)
      const tokenIds = outcomes.map(o => o.tokenId).filter(id => id && id.length > 10);
      if (tokenIds.length > 0) {
        const priceChanges = await getPriceChanges(tokenIds);
        for (const outcome of outcomes) {
          outcome.priceChange = priceChanges.get(outcome.tokenId) || 0;
        }
      }
      
      res.json(outcomes);
    } catch (error) {
      console.error("Failed to fetch drivers market:", error);
      res.status(500).json({ error: "Failed to fetch drivers market" });
    }
  });

  // Get price history for a token from Polymarket CLOB
  app.get("/api/polymarket/price-history/:tokenId", async (req, res) => {
    try {
      const { tokenId } = req.params;
      const { interval = "all", fidelity = "60" } = req.query;
      
      const response = await fetch(
        `https://clob.polymarket.com/prices-history?market=${tokenId}&interval=${interval}&fidelity=${fidelity}`,
        {
          headers: {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0",
          },
        }
      );
      
      if (!response.ok) {
        return res.status(response.status).json({ error: "Failed to fetch price history" });
      }
      
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Failed to fetch price history:", error);
      res.status(500).json({ error: "Failed to fetch price history" });
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
      const { userId, tokenId, side, outcome, price, size, marketName } = req.body;
      
      if (!userId || !tokenId || !side || !outcome || price === undefined || size === undefined) {
        return res.status(400).json({ error: "Missing required fields: userId, tokenId, side, outcome, price, size" });
      }

      const { hasOrderExecutionCredentials, executePolymarketOrder } = await import("./polymarket");
      
      if (!hasOrderExecutionCredentials()) {
        return res.status(503).json({ 
          error: "Order execution credentials not configured. Orders cannot be placed.",
          available: false 
        });
      }

      // Calculate total cost (price * size for buy orders)
      const totalCost = price * size;

      // Save order to database with pending status first
      const savedOrder = await storage.createPolymarketOrder({
        userId,
        tokenId,
        marketName: marketName || null,
        outcome,
        side,
        price,
        size,
        filledSize: 0,
        status: "pending",
        totalCost,
        polymarketOrderId: null,
      });

      console.log("Polymarket order saved to database:", {
        orderId: savedOrder.id,
        tokenId,
        side,
        outcome,
        price,
        size,
        totalCost,
        timestamp: new Date().toISOString()
      });

      // Execute the order on Polymarket CLOB
      const executionResult = await executePolymarketOrder(
        tokenId,
        side as "BUY" | "SELL",
        price,
        size
      );

      console.log("Polymarket execution result:", executionResult);

      if (executionResult.success && executionResult.orderId) {
        // Update order with Polymarket order ID and normalized status
        // executionResult.status is already normalized to lowercase (open, filled, etc.)
        const orderStatus = executionResult.status || "open";
        await storage.updatePolymarketOrder(savedOrder.id, {
          polymarketOrderId: executionResult.orderId,
          status: orderStatus,
        });

        res.json({
          success: true,
          message: "Order placed on Polymarket",
          order: {
            id: savedOrder.id,
            polymarketOrderId: executionResult.orderId,
            tokenId,
            side,
            outcome,
            price,
            size,
            totalCost,
            status: orderStatus,
            createdAt: savedOrder.createdAt
          }
        });
      } else {
        // Mark order as failed
        await storage.updatePolymarketOrder(savedOrder.id, {
          status: "failed",
        });

        res.status(400).json({
          success: false,
          error: executionResult.error || "Failed to execute order on Polymarket",
          order: {
            id: savedOrder.id,
            status: "failed"
          }
        });
      }
    } catch (error) {
      console.error("Failed to place Polymarket order:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      console.error("Error details:", { message: errorMessage, stack: errorStack });
      res.status(500).json({ error: "Failed to place order", details: errorMessage });
    }
  });

  // Server-side proxy for deriving Polymarket API credentials
  // This bypasses CORS/Cloudflare restrictions by making the request from the server
  app.post("/api/polymarket/derive-credentials", async (req, res) => {
    try {
      const { walletAddress, signature, timestamp, nonce } = req.body;
      
      if (!walletAddress || !signature || !timestamp) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      console.log("Proxying credential derivation for:", walletAddress);

      const response = await fetch("https://clob.polymarket.com/auth/derive-api-key", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Origin": "https://polymarket.com",
          "Referer": "https://polymarket.com/",
          "POLY_ADDRESS": walletAddress,
          "POLY_SIGNATURE": signature,
          "POLY_TIMESTAMP": timestamp.toString(),
          "POLY_NONCE": (nonce || 0).toString(),
        },
      });

      const responseText = await response.text();
      console.log("Polymarket derive-api-key response:", response.status, responseText.substring(0, 200));

      if (responseText.includes("<!DOCTYPE html>") || responseText.includes("Cloudflare")) {
        return res.status(503).json({ error: "Polymarket API is blocking requests" });
      }

      if (!response.ok) {
        return res.status(response.status).json({ error: responseText });
      }

      const data = JSON.parse(responseText);
      res.json(data);
    } catch (error) {
      console.error("Failed to derive Polymarket credentials:", error);
      res.status(500).json({ error: "Failed to derive credentials" });
    }
  });

  // Server-side proxy for submitting orders to Polymarket CLOB
  app.post("/api/polymarket/submit-order", async (req, res) => {
    try {
      const { order, signature, apiKey, apiSecret, passphrase } = req.body;
      
      if (!order || !signature || !apiKey || !apiSecret || !passphrase) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      console.log("Proxying order submission:", { 
        tokenId: order.tokenId, 
        side: order.side === 0 ? "BUY" : "SELL" 
      });

      // Create HMAC signature for the request
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const method = "POST";
      const path = "/order";
      const body = JSON.stringify(order);
      const message = timestamp + method + path + body;
      
      // Decode secret (base64url or hex)
      let secretBytes: Buffer;
      if (/^[0-9a-fA-F]+$/.test(apiSecret) && apiSecret.length % 2 === 0) {
        secretBytes = Buffer.from(apiSecret, "hex");
      } else {
        // Convert base64url to base64
        let base64 = apiSecret.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) base64 += '=';
        secretBytes = Buffer.from(base64, "base64");
      }

      const crypto = await import("crypto");
      const hmac = crypto.createHmac("sha256", secretBytes);
      hmac.update(message);
      const hmacSignature = hmac.digest("base64");

      const response = await fetch("https://clob.polymarket.com/order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Origin": "https://polymarket.com",
          "Referer": "https://polymarket.com/",
          "POLY_API_KEY": apiKey,
          "POLY_PASSPHRASE": passphrase,
          "POLY_TIMESTAMP": timestamp,
          "POLY_SIGNATURE": hmacSignature,
        },
        body: JSON.stringify({
          ...order,
          signature: signature,
        }),
      });

      const responseText = await response.text();
      console.log("Polymarket order response:", response.status, responseText.substring(0, 200));

      if (responseText.includes("<!DOCTYPE html>") || responseText.includes("Cloudflare")) {
        return res.status(503).json({ error: "Polymarket API is blocking requests" });
      }

      if (!response.ok) {
        return res.status(response.status).json({ error: responseText });
      }

      const data = JSON.parse(responseText);
      res.json(data);
    } catch (error) {
      console.error("Failed to submit order to Polymarket:", error);
      res.status(500).json({ error: "Failed to submit order" });
    }
  });

  // Builder-only order placement - uses builder credentials without requiring per-user API keys
  // This is for users who haven't been onboarded to Polymarket yet
  app.post("/api/polymarket/builder-order", async (req, res) => {
    try {
      const { order, userSignature, walletAddress } = req.body;
      
      if (!order || !userSignature || !walletAddress) {
        return res.status(400).json({ error: "Missing required fields: order, userSignature, walletAddress" });
      }

      // Get builder credentials from environment
      const builderApiKey = process.env.POLY_BUILDER_API_KEY;
      const builderSecret = process.env.POLY_BUILDER_SECRET;
      const builderPassphrase = process.env.POLY_BUILDER_PASSPHRASE;
      
      if (!builderApiKey || !builderSecret || !builderPassphrase) {
        console.error("Builder credentials not configured");
        return res.status(503).json({ error: "Builder program not configured" });
      }

      console.log("Builder-only order:", { 
        walletAddress: walletAddress.substring(0, 10) + "...",
        tokenId: order.tokenID,
        side: order.side,
        price: order.price,
        size: order.size
      });

      // Create HMAC signature for builder authentication
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const method = "POST";
      const path = "/order";
      const bodyStr = JSON.stringify(order);
      const message = timestamp + method + path + bodyStr;
      
      // Decode builder secret (base64)
      let secretBytes: Buffer;
      if (/^[0-9a-fA-F]+$/.test(builderSecret) && builderSecret.length % 2 === 0) {
        secretBytes = Buffer.from(builderSecret, "hex");
      } else {
        let base64 = builderSecret.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) base64 += '=';
        secretBytes = Buffer.from(base64, "base64");
      }

      const crypto = await import("crypto");
      const hmac = crypto.createHmac("sha256", secretBytes);
      hmac.update(message);
      const builderSignature = hmac.digest("base64");

      // Build request with builder headers for submitting on behalf of user
      // Include browser-like headers to help with Cloudflare
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Origin": "https://polymarket.com",
        "Referer": "https://polymarket.com/",
        "POLY_ADDRESS": walletAddress,
        "POLY_BUILDER_API_KEY": builderApiKey,
        "POLY_BUILDER_PASSPHRASE": builderPassphrase,
        "POLY_BUILDER_SIGNATURE": builderSignature,
        "POLY_BUILDER_TIMESTAMP": timestamp,
      };

      // Include the user's EIP-712 signature in the order body
      const orderWithSignature = {
        ...order,
        signature: userSignature,
      };

      const response = await fetch("https://clob.polymarket.com/order", {
        method: "POST",
        headers,
        body: JSON.stringify(orderWithSignature),
      });

      const responseText = await response.text();
      console.log("Builder order response:", response.status, responseText);

      if (responseText.includes("<!DOCTYPE html>") || responseText.includes("Cloudflare")) {
        return res.status(503).json({ 
          error: "Polymarket API is blocking requests",
          details: "Request blocked by Cloudflare"
        });
      }

      if (!response.ok) {
        try {
          const errorJson = JSON.parse(responseText);
          return res.status(response.status).json({ 
            error: errorJson.error || errorJson.message || responseText,
            details: errorJson
          });
        } catch {
          return res.status(response.status).json({ error: responseText });
        }
      }

      const data = JSON.parse(responseText);
      res.json(data);
    } catch (error: any) {
      console.error("Builder order error:", error);
      res.status(500).json({ 
        error: "Builder order failed",
        details: error.message || String(error)
      });
    }
  });

  // Generic CLOB API proxy - forwards authenticated requests to Polymarket CLOB
  // This avoids CORS issues when calling from production
  app.post("/api/polymarket/clob-proxy", async (req, res) => {
    try {
      const { method, path, body, credentials, walletAddress, builderHeaders } = req.body;
      
      if (!method || !path || !credentials || !walletAddress) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const { apiKey, secret, passphrase } = credentials;
      if (!apiKey || !secret || !passphrase) {
        return res.status(400).json({ error: "Missing API credentials" });
      }

      console.log("CLOB Proxy request:", { method, path, walletAddress: walletAddress.substring(0, 10) + "...", hasBuilderHeaders: !!builderHeaders });

      // Create HMAC signature for the request
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const bodyStr = body ? JSON.stringify(body) : "";
      const message = timestamp + method.toUpperCase() + path + bodyStr;
      
      // Decode secret (base64url or hex)
      let secretBytes: Buffer;
      if (/^[0-9a-fA-F]+$/.test(secret) && secret.length % 2 === 0) {
        secretBytes = Buffer.from(secret, "hex");
      } else {
        // Convert base64url to base64
        let base64 = secret.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) base64 += '=';
        secretBytes = Buffer.from(base64, "base64");
      }

      const crypto = await import("crypto");
      const hmac = crypto.createHmac("sha256", secretBytes);
      hmac.update(message);
      const hmacSignature = hmac.digest("base64");

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Origin": "https://polymarket.com",
        "Referer": "https://polymarket.com/",
        "POLY_API_KEY": apiKey,
        "POLY_PASSPHRASE": passphrase,
        "POLY_TIMESTAMP": timestamp,
        "POLY_SIGNATURE": hmacSignature,
        "POLY_ADDRESS": walletAddress,
        "POLY_NONCE": timestamp,
      };

      // Forward builder headers if provided (for builder program integration)
      if (builderHeaders) {
        if (builderHeaders.POLY_BUILDER_API_KEY) {
          headers["POLY_BUILDER_API_KEY"] = builderHeaders.POLY_BUILDER_API_KEY;
        }
        if (builderHeaders.POLY_BUILDER_PASSPHRASE) {
          headers["POLY_BUILDER_PASSPHRASE"] = builderHeaders.POLY_BUILDER_PASSPHRASE;
        }
        if (builderHeaders.POLY_BUILDER_SIGNATURE) {
          headers["POLY_BUILDER_SIGNATURE"] = builderHeaders.POLY_BUILDER_SIGNATURE;
        }
        if (builderHeaders.POLY_BUILDER_TIMESTAMP) {
          headers["POLY_BUILDER_TIMESTAMP"] = builderHeaders.POLY_BUILDER_TIMESTAMP;
        }
      }

      const fetchOptions: RequestInit = {
        method: method.toUpperCase(),
        headers,
      };

      if (body && (method.toUpperCase() === "POST" || method.toUpperCase() === "PUT")) {
        fetchOptions.body = bodyStr;
      }

      const response = await fetch(`https://clob.polymarket.com${path}`, fetchOptions);

      const responseText = await response.text();
      console.log("CLOB Proxy response:", response.status, responseText);

      if (responseText.includes("<!DOCTYPE html>") || responseText.includes("Cloudflare")) {
        console.error("CLOB Proxy: Cloudflare block detected");
        return res.status(503).json({ 
          error: "Polymarket API is blocking requests",
          details: "Request blocked by Cloudflare. This may be a rate limit or geo-restriction."
        });
      }

      if (!response.ok) {
        console.error("CLOB Proxy error response:", { 
          status: response.status, 
          path, 
          method, 
          response: responseText 
        });
        
        // Try to parse JSON error for more details
        try {
          const errorJson = JSON.parse(responseText);
          return res.status(response.status).json({ 
            error: errorJson.error || errorJson.message || responseText,
            details: errorJson,
            status: response.status
          });
        } catch {
          return res.status(response.status).json({ 
            error: responseText,
            status: response.status
          });
        }
      }

      try {
        const data = JSON.parse(responseText);
        res.json(data);
      } catch {
        res.json({ raw: responseText });
      }
    } catch (error: any) {
      console.error("CLOB proxy error:", error);
      res.status(500).json({ 
        error: "CLOB proxy request failed",
        details: error.message || String(error)
      });
    }
  });

  // Record a client-submitted Polymarket order (for client-side signing flow)
  app.post("/api/polymarket/record-order", async (req, res) => {
    try {
      const { userId, tokenId, marketName, outcome, side, price, size, totalCost, polymarketOrderId, status } = req.body;
      
      if (!userId || !tokenId || !outcome || !side || price === undefined || size === undefined) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const savedOrder = await storage.createPolymarketOrder({
        userId,
        tokenId,
        marketName: marketName || null,
        outcome,
        side,
        price,
        size,
        filledSize: 0,
        status: status || "open",
        totalCost: totalCost || (price * size),
        polymarketOrderId: polymarketOrderId || null,
      });

      console.log("Client-submitted Polymarket order recorded:", {
        orderId: savedOrder.id,
        polymarketOrderId,
        tokenId,
        side,
        outcome,
        price,
        size,
        timestamp: new Date().toISOString()
      });

      res.json({
        success: true,
        order: savedOrder
      });
    } catch (error) {
      console.error("Failed to record Polymarket order:", error);
      res.status(500).json({ error: "Failed to record order" });
    }
  });

  // Get user's Polymarket orders
  app.get("/api/polymarket/orders/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const orders = await storage.getPolymarketOrdersByUser(userId);
      res.json(orders);
    } catch (error) {
      console.error("Failed to fetch user orders:", error);
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });

  // Sync order statuses from Polymarket CLOB API
  app.post("/api/polymarket/orders/sync", async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      const { getOrderStatus } = await import("./polymarket");
      const orders = await storage.getPolymarketOrdersByUser(userId);
      
      const syncedOrders = [];
      for (const order of orders) {
        // If order has polymarketOrderId, fetch its status from CLOB
        if (order.polymarketOrderId) {
          try {
            const clobOrder = await getOrderStatus(order.polymarketOrderId);
            if (clobOrder) {
              // Use the normalized status from getOrderStatus
              const newStatus = clobOrder.normalizedStatus || order.status;
              
              // Determine filled size
              let filledSize = 0;
              if (clobOrder.sizeMatched !== undefined) {
                filledSize = parseFloat(clobOrder.sizeMatched) || 0;
              } else if (newStatus === "filled") {
                filledSize = order.size;
              }

              const updated = await storage.updatePolymarketOrder(order.id, {
                status: newStatus,
                filledSize: filledSize,
                lastSyncedAt: new Date()
              });
              if (updated) syncedOrders.push(updated);
            } else {
              // Could not fetch order status, just update lastSyncedAt
              const updated = await storage.updatePolymarketOrder(order.id, {
                lastSyncedAt: new Date()
              });
              if (updated) syncedOrders.push(updated);
            }
          } catch (syncError) {
            console.error(`Failed to sync order ${order.id}:`, syncError);
            // Continue with next order
            syncedOrders.push(order);
          }
        } else {
          // No Polymarket order ID, just update lastSyncedAt
          const updated = await storage.updatePolymarketOrder(order.id, {
            lastSyncedAt: new Date()
          });
          if (updated) syncedOrders.push(updated);
        }
      }

      res.json({
        success: true,
        syncedCount: syncedOrders.length,
        orders: syncedOrders
      });
    } catch (error) {
      console.error("Failed to sync orders:", error);
      res.status(500).json({ error: "Failed to sync orders" });
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

  // ============ Race Markets Routes ============

  // Get all race markets (public)
  app.get("/api/race-markets", async (req, res) => {
    try {
      const markets = await storage.getRaceMarkets();
      // Filter to only visible markets for public access
      const visibleMarkets = markets.filter(m => m.isVisible);
      res.json(visibleMarkets);
    } catch (error) {
      console.error("Error fetching race markets:", error);
      res.status(500).json({ error: "Failed to fetch race markets" });
    }
  });

  // Get all race markets (admin - includes hidden)
  app.get("/api/admin/race-markets", requireAdmin, async (req, res) => {
    try {
      const markets = await storage.getRaceMarkets();
      res.json(markets);
    } catch (error) {
      console.error("Error fetching race markets:", error);
      res.status(500).json({ error: "Failed to fetch race markets" });
    }
  });

  // Get single race market with outcomes and driver info
  app.get("/api/race-markets/:id", async (req, res) => {
    try {
      const market = await storage.getRaceMarket(req.params.id);
      if (!market) {
        return res.status(404).json({ error: "Race market not found" });
      }
      const outcomes = await storage.getRaceMarketOutcomes(market.id);
      
      // Enrich outcomes with driver information
      const drivers = await storage.getDrivers();
      const driverMap = new Map(drivers.map(d => [d.id, d]));
      
      const enrichedOutcomes = outcomes.map(outcome => ({
        ...outcome,
        driver: driverMap.get(outcome.driverId) || null
      }));
      
      res.json({ ...market, outcomes: enrichedOutcomes });
    } catch (error) {
      console.error("Error fetching race market:", error);
      res.status(500).json({ error: "Failed to fetch race market" });
    }
  });

  // Create race market (admin)
  app.post("/api/admin/race-markets", requireAdmin, async (req, res) => {
    try {
      const { name, shortName, location, raceDate, polymarketConditionId, polymarketSlug, status, isVisible } = req.body;
      
      if (!name || !shortName || !location || !raceDate) {
        return res.status(400).json({ error: "name, shortName, location, and raceDate are required" });
      }

      const market = await storage.createRaceMarket({
        name,
        shortName,
        location,
        raceDate: new Date(raceDate),
        polymarketConditionId: polymarketConditionId || null,
        polymarketSlug: polymarketSlug || null,
        status: status || "upcoming",
        isVisible: isVisible !== false,
      });

      res.json(market);
    } catch (error) {
      console.error("Error creating race market:", error);
      res.status(500).json({ error: "Failed to create race market" });
    }
  });

  // Update race market (admin)
  app.patch("/api/admin/race-markets/:id", requireAdmin, async (req, res) => {
    try {
      const { name, shortName, location, raceDate, polymarketConditionId, polymarketSlug, status, isVisible, winnerDriverId } = req.body;
      
      const updates: Record<string, any> = {};
      if (name !== undefined) updates.name = name;
      if (shortName !== undefined) updates.shortName = shortName;
      if (location !== undefined) updates.location = location;
      if (raceDate !== undefined) updates.raceDate = new Date(raceDate);
      if (polymarketConditionId !== undefined) updates.polymarketConditionId = polymarketConditionId;
      if (polymarketSlug !== undefined) updates.polymarketSlug = polymarketSlug;
      if (status !== undefined) updates.status = status;
      if (isVisible !== undefined) updates.isVisible = isVisible;
      if (winnerDriverId !== undefined) updates.winnerDriverId = winnerDriverId;

      const market = await storage.updateRaceMarket(req.params.id, updates);
      if (!market) {
        return res.status(404).json({ error: "Race market not found" });
      }
      res.json(market);
    } catch (error) {
      console.error("Error updating race market:", error);
      res.status(500).json({ error: "Failed to update race market" });
    }
  });

  // Delete race market (admin)
  app.delete("/api/admin/race-markets/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteRaceMarket(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting race market:", error);
      res.status(500).json({ error: "Failed to delete race market" });
    }
  });

  // Get race market outcomes with drivers (admin)
  app.get("/api/admin/race-markets/:id/outcomes", requireAdmin, async (req, res) => {
    try {
      const outcomes = await storage.getRaceMarketOutcomes(req.params.id);
      const drivers = await storage.getDrivers();
      const driverMap = new Map(drivers.map(d => [d.id, d]));
      
      const enrichedOutcomes = outcomes.map(outcome => ({
        ...outcome,
        driver: driverMap.get(outcome.driverId) || null
      }));
      
      res.json(enrichedOutcomes);
    } catch (error) {
      console.error("Error fetching race market outcomes:", error);
      res.status(500).json({ error: "Failed to fetch race market outcomes" });
    }
  });

  // Add outcome to race market (admin)
  app.post("/api/admin/race-markets/:id/outcomes", requireAdmin, async (req, res) => {
    try {
      const { driverId, polymarketTokenId } = req.body;
      
      if (!driverId || !polymarketTokenId) {
        return res.status(400).json({ error: "driverId and polymarketTokenId are required" });
      }

      const outcome = await storage.createRaceMarketOutcome({
        raceMarketId: req.params.id,
        driverId,
        polymarketTokenId,
        currentPrice: 0,
      });

      res.json(outcome);
    } catch (error) {
      console.error("Error creating race market outcome:", error);
      res.status(500).json({ error: "Failed to create race market outcome" });
    }
  });

  // Update race market outcome (admin)
  app.patch("/api/admin/race-market-outcomes/:id", requireAdmin, async (req, res) => {
    try {
      const { polymarketTokenId, currentPrice } = req.body;
      
      const updates: Record<string, any> = {};
      if (polymarketTokenId !== undefined) updates.polymarketTokenId = polymarketTokenId;
      if (currentPrice !== undefined) updates.currentPrice = parseFloat(currentPrice);

      const outcome = await storage.updateRaceMarketOutcome(req.params.id, updates);
      if (!outcome) {
        return res.status(404).json({ error: "Outcome not found" });
      }
      res.json(outcome);
    } catch (error) {
      console.error("Error updating race market outcome:", error);
      res.status(500).json({ error: "Failed to update race market outcome" });
    }
  });

  // Delete outcome from race market (admin)
  app.delete("/api/admin/race-market-outcomes/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteRaceMarketOutcome(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting race market outcome:", error);
      res.status(500).json({ error: "Failed to delete race market outcome" });
    }
  });

  // Update race market outcome (admin)
  app.patch("/api/admin/race-market-outcomes/:id", requireAdmin, async (req, res) => {
    try {
      const { polymarketTokenId, currentPrice } = req.body;
      
      const updates: { polymarketTokenId?: string; currentPrice?: number } = {};
      if (polymarketTokenId !== undefined) updates.polymarketTokenId = polymarketTokenId;
      if (currentPrice !== undefined) updates.currentPrice = currentPrice;
      
      const outcome = await storage.updateRaceMarketOutcome(req.params.id, updates);
      if (!outcome) {
        return res.status(404).json({ error: "Outcome not found" });
      }
      
      res.json(outcome);
    } catch (error) {
      console.error("Error updating race market outcome:", error);
      res.status(500).json({ error: "Failed to update outcome" });
    }
  });

  // Bulk populate all drivers as outcomes for a race market (admin)
  app.post("/api/admin/race-markets/:id/populate-drivers", requireAdmin, async (req, res) => {
    try {
      const raceId = req.params.id;
      const drivers = await storage.getDrivers();
      
      // Check if race exists
      const race = await storage.getRaceMarket(raceId);
      if (!race) {
        return res.status(404).json({ error: "Race market not found" });
      }

      // Get existing outcomes to avoid duplicates
      const existingOutcomes = await storage.getRaceMarketOutcomes(raceId);
      const existingDriverIds = new Set(existingOutcomes.map(o => o.driverId));

      // Create outcomes for drivers not already added
      const newOutcomes = [];
      for (const driver of drivers) {
        if (!existingDriverIds.has(driver.id)) {
          const outcome = await storage.createRaceMarketOutcome({
            raceMarketId: raceId,
            driverId: driver.id,
            polymarketTokenId: "", // Will need to be filled in later
            currentPrice: 0.05, // Default starting price
          });
          newOutcomes.push(outcome);
        }
      }

      res.json({ 
        success: true, 
        addedCount: newOutcomes.length,
        totalOutcomes: existingOutcomes.length + newOutcomes.length
      });
    } catch (error) {
      console.error("Error populating race market with drivers:", error);
      res.status(500).json({ error: "Failed to populate drivers" });
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
