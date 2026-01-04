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
import { ProxyAgent, fetch as undiciFetch } from "undici";

// Oxylabs proxy configuration for bypassing Polymarket's US IP block
// Returns undefined if proxy is not configured
function getOxylabsProxyAgent(): ProxyAgent | undefined {
  const proxyUser = process.env.OXYLABS_USER;
  const proxyPass = process.env.OXYLABS_PASS;
  
  if (!proxyUser || !proxyPass) {
    console.log("Oxylabs proxy: NOT CONFIGURED (missing OXYLABS_USER or OXYLABS_PASS)");
    return undefined;
  }
  
  // Oxylabs residential proxy format:
  // Username: customer-YOUR_USERNAME-cc-COUNTRY (e.g., customer-john123-cc-ch for Switzerland)
  // Password: YOUR_PASSWORD
  // Host: pr.oxylabs.io:7777
  // Target Switzerland (ch) to bypass Polymarket's US geo-blocking
  const fullUsername = `customer-${proxyUser}-cc-ch`;
  const proxyUrl = `http://${encodeURIComponent(fullUsername)}:${encodeURIComponent(proxyPass)}@pr.oxylabs.io:7777`;
  console.log(`Oxylabs proxy: CONFIGURED - username format: customer-[${proxyUser.length} chars]-cc-ch`);
  return new ProxyAgent(proxyUrl);
}

// Wrapper to make fetch requests through the proxy using undici
async function proxyFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const proxyAgent = getOxylabsProxyAgent();
  
  if (proxyAgent) {
    // Use undici fetch with proxy dispatcher
    const response = await undiciFetch(url, {
      ...options,
      dispatcher: proxyAgent,
    } as any);
    return response as unknown as Response;
  }
  
  // Fall back to regular fetch if no proxy
  return fetch(url, options);
}

// Test the proxy connection by checking the outbound IP
async function testProxyConnection(): Promise<{ success: boolean; ip?: string; country?: string; error?: string; proxyUrl?: string }> {
  try {
    const proxyUser = process.env.OXYLABS_USER;
    const proxyPass = process.env.OXYLABS_PASS;
    
    if (!proxyUser || !proxyPass) {
      return { success: false, error: "Proxy not configured" };
    }
    
    // Oxylabs format: customer-USERNAME-cc-COUNTRY:PASSWORD@pr.oxylabs.io:7777
    const fullUsername = `customer-${proxyUser}-cc-ch`;
    const proxyUrl = `http://${encodeURIComponent(fullUsername)}:${encodeURIComponent(proxyPass)}@pr.oxylabs.io:7777`;
    
    console.log(`Testing proxy URL: customer-[${proxyUser.length} chars]-cc-ch`);
    
    const proxyAgent = new ProxyAgent(proxyUrl);
    
    // Use ipinfo.io to check the outbound IP
    const response = await undiciFetch("https://ipinfo.io/json", {
      headers: { "Accept": "application/json" },
      dispatcher: proxyAgent,
    } as any);
    
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}`, proxyUrl: `http://${fullUsername}:****@pr.oxylabs.io:7777` };
    }
    
    const data = await response.json() as { ip: string; country: string; city?: string; org?: string };
    return { 
      success: true, 
      ip: data.ip, 
      country: data.country,
      proxyUrl: `http://${fullUsername}:****@pr.oxylabs.io:7777`,
    };
  } catch (error: any) {
    console.error("Proxy test error details:", error);
    return { success: false, error: error.message || String(error), proxyUrl: "see logs" };
  }
}

// Check if Oxylabs proxy is configured
export function hasOxylabsProxy(): boolean {
  return !!(process.env.OXYLABS_USER && process.env.OXYLABS_PASS);
}

// Browser-like headers to bypass Cloudflare bot detection
function getBrowserHeaders(): Record<string, string> {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Origin": "https://polymarket.com",
    "Referer": "https://polymarket.com/",
    "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
  };
}

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

  // ============ Client Configuration (Runtime) ============
  // This endpoint provides environment variables to the client at RUNTIME
  // instead of relying on Vite's build-time replacement
  // IMPORTANT: In production, VITE_* vars may not be available at runtime since they're 
  // injected at build time. We provide runtime fallbacks for critical frontend config.
  app.get("/api/config", (req, res) => {
    // Magic publishable key - check both possible env var names
    // MAGIC_PUBLISHABLE_KEY is for server-side runtime, VITE_MAGIC_API_KEY for build-time
    const magicApiKey = process.env.MAGIC_PUBLISHABLE_KEY || process.env.VITE_MAGIC_API_KEY || "";
    
    // WalletConnect project ID - runtime fallback for production
    const walletConnectProjectId = process.env.VITE_WALLETCONNECT_PROJECT_ID || "";
    
    if (!magicApiKey) {
      console.warn("[Config Warning] Magic API key not found in environment. Set MAGIC_PUBLISHABLE_KEY or VITE_MAGIC_API_KEY secret.");
    }
    
    if (!walletConnectProjectId) {
      console.warn("[Config Warning] WalletConnect project ID not found. Set VITE_WALLETCONNECT_PROJECT_ID environment variable.");
    }
    
    res.json({
      magicApiKey,
      walletConnectProjectId,
    });
  });

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
  // Uses BuilderSigner class exactly like official Polymarket builder-signing-server
  // Matches SDK's RemoteSignerPayload: { method, path, body?, timestamp? }
  app.post("/api/polymarket/sign", async (req, res) => {
    try {
      const { method, path, body: requestBody, timestamp } = req.body;
      
      if (!method || !path) {
        return res.status(400).json({ error: "Missing required parameters: method, path" });
      }

      const builderApiKey = process.env.POLY_BUILDER_API_KEY;
      const builderSecret = process.env.POLY_BUILDER_SECRET;
      const builderPassphrase = process.env.POLY_BUILDER_PASSPHRASE;
      
      if (!builderApiKey || !builderSecret || !builderPassphrase) {
        return res.status(500).json({ error: "Builder credentials not configured" });
      }

      // Use BuilderSigner class exactly like official Polymarket server
      const { BuilderSigner } = await import("@polymarket/builder-signing-sdk");
      
      // BuilderSigner expects a credentials object with { key, secret, passphrase }
      const signer = new BuilderSigner({ 
        key: builderApiKey, 
        secret: builderSecret, 
        passphrase: builderPassphrase 
      });
      // Pass timestamp if provided by SDK (4th parameter)
      const payload = signer.createBuilderHeaderPayload(method, path, requestBody || "", timestamp);

      console.log("Builder sign request:", { method, path, bodyLength: (requestBody || "").length, timestamp });

      // Return the payload directly (same format as official server)
      res.json(payload);
    } catch (error) {
      console.error("Signing error:", error);
      res.status(500).json({ error: "Failed to sign message" });
    }
  });

  // Same endpoint used by RelayClient's remoteBuilderConfig
  // Matches the official Polymarket wagmi-safe-builder-example implementation
  app.post("/api/polymarket/builder-sign", async (req, res) => {
    try {
      const { method, path: rawPath, body: requestBody } = req.body;
      
      console.log("=== BUILDER-SIGN REQUEST ===");
      console.log("Full request body:", JSON.stringify(req.body, null, 2));
      
      if (!method || !rawPath) {
        return res.status(400).json({ error: "method and path are required" });
      }
      
      // Strip proxy prefix if present - SDK sends /api/polymarket/relayer/... 
      // but signature must be for the canonical relayer path /...
      const proxyPrefix = "/api/polymarket/relayer";
      const path = rawPath.startsWith(proxyPrefix) 
        ? rawPath.substring(proxyPrefix.length) 
        : rawPath;
      
      console.log("Path normalization:", { rawPath, normalizedPath: path });

      const builderApiKey = process.env.POLY_BUILDER_API_KEY;
      const builderSecret = process.env.POLY_BUILDER_SECRET;
      const builderPassphrase = process.env.POLY_BUILDER_PASSPHRASE;
      
      if (!builderApiKey || !builderSecret || !builderPassphrase) {
        console.log("Builder credentials missing!");
        return res.status(503).json({ 
          error: "Builder credentials not configured",
          available: false 
        });
      }

      console.log("Builder credentials found, API key prefix:", builderApiKey.substring(0, 10) + "...");

      // Use buildHmacSignature directly - matches official Polymarket example
      const { buildHmacSignature } = await import("@polymarket/builder-signing-sdk");
      
      // Generate our own timestamp as per the official example
      const sigTimestamp = Date.now().toString();
      
      // Build signature with the exact parameters from official example
      const signature = buildHmacSignature(
        builderSecret,
        parseInt(sigTimestamp),
        method,
        path,
        requestBody || ""
      );

      const payload = {
        POLY_BUILDER_SIGNATURE: signature,
        POLY_BUILDER_TIMESTAMP: sigTimestamp,
        POLY_BUILDER_API_KEY: builderApiKey,
        POLY_BUILDER_PASSPHRASE: builderPassphrase,
      };

      console.log("Generated payload:", JSON.stringify(payload, null, 2));
      console.log("=== END BUILDER-SIGN ===");

      res.json(payload);
    } catch (error) {
      console.error("Failed to generate builder signature:", error);
      res.status(500).json({ error: "Failed to generate builder signature" });
    }
  });

  // Proxy for Polymarket relayer API (needed to bypass CORS in browser)
  // The RelayClient SDK tries to call the relayer directly, which gets blocked
  app.all("/api/polymarket/relayer/*", async (req, res) => {
    try {
      // Extract path after /api/polymarket/relayer/
      const fullPath = req.path;
      const relayerPath = fullPath.replace("/api/polymarket/relayer/", "");
      
      // Build URL with query string if present
      const queryString = req.originalUrl.includes('?') 
        ? req.originalUrl.substring(req.originalUrl.indexOf('?'))
        : '';
      const relayerUrl = `https://relayer-v2.polymarket.com/${relayerPath}${queryString}`;
      
      console.log(`Proxying relayer request: ${req.method} ${relayerUrl}`);
      
      // Forward all headers except host
      const forwardHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (key.toLowerCase() !== 'host' && key.toLowerCase() !== 'content-length' && typeof value === 'string') {
          forwardHeaders[key] = value;
        }
      }
      
      const fetchOptions: RequestInit = {
        method: req.method,
        headers: forwardHeaders,
      };
      
      // Only include body for non-GET requests
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
        fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      }
      
      const response = await fetch(relayerUrl, fetchOptions);
      const responseText = await response.text();
      
      console.log(`Relayer response: ${response.status} ${responseText.substring(0, 200)}`);
      
      // Forward response headers
      const headerEntries = Array.from(response.headers.entries());
      for (const [key, value] of headerEntries) {
        if (key.toLowerCase() !== 'content-encoding' && key.toLowerCase() !== 'transfer-encoding') {
          res.setHeader(key, value);
        }
      }
      
      res.status(response.status);
      
      // Try to parse as JSON, otherwise send as text
      try {
        const jsonData = JSON.parse(responseText);
        res.json(jsonData);
      } catch {
        res.send(responseText);
      }
    } catch (error: any) {
      console.error("Relayer proxy error:", error);
      res.status(500).json({ 
        error: "request error", 
        status: 0, 
        statusText: error.message || "Proxy error" 
      });
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

  // Check if Oxylabs proxy is configured (for bypassing US geo-blocking)
  app.get("/api/polymarket/proxy-status", async (req, res) => {
    try {
      res.json({ 
        available: hasOxylabsProxy(),
        provider: "oxylabs",
        targetCountry: "ch"
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to check proxy status" });
    }
  });

  // Test the proxy connection by making a request through it
  app.get("/api/polymarket/proxy-test", async (req, res) => {
    try {
      console.log("=== PROXY CONNECTION TEST ===");
      const result = await testProxyConnection();
      console.log("Proxy test result:", JSON.stringify(result));
      console.log("=== PROXY CONNECTION TEST END ===");
      
      res.json({
        configured: hasOxylabsProxy(),
        ...result
      });
    } catch (error: any) {
      console.error("Proxy test error:", error);
      res.status(500).json({ 
        configured: hasOxylabsProxy(),
        success: false, 
        error: error.message || String(error) 
      });
    }
  });

  // Generate a curl command for testing builder credentials directly
  // This helps debug authentication issues by letting you test outside the app
  app.get("/api/polymarket/debug-curl", async (req, res) => {
    try {
      const builderApiKey = process.env.POLY_BUILDER_API_KEY;
      const builderSecret = process.env.POLY_BUILDER_SECRET;
      const builderPassphrase = process.env.POLY_BUILDER_PASSPHRASE;
      
      if (!builderApiKey || !builderSecret || !builderPassphrase) {
        return res.status(503).json({ error: "Builder credentials not configured" });
      }

      // Create a simple test request to GET /auth/api-keys (requires builder auth)
      const { buildHmacSignature } = await import("@polymarket/builder-signing-sdk");
      
      const timestamp = Date.now();
      const method = "GET";
      const path = "/auth/api-keys";
      const body = "";
      
      const signature = buildHmacSignature(
        builderSecret,
        timestamp,
        method,
        path,
        body
      );

      // Generate the curl command
      const curlCommand = `curl -X GET "https://clob.polymarket.com/auth/api-keys" \\
  -H "Content-Type: application/json" \\
  -H "POLY_BUILDER_API_KEY: ${builderApiKey}" \\
  -H "POLY_BUILDER_PASSPHRASE: ${builderPassphrase}" \\
  -H "POLY_BUILDER_SIGNATURE: ${signature}" \\
  -H "POLY_BUILDER_TIMESTAMP: ${timestamp}"`;

      console.log("=== DEBUG CURL COMMAND ===");
      console.log(curlCommand);
      console.log("=== END DEBUG CURL ===");

      res.json({
        message: "Run this curl command to test your builder credentials",
        note: "This tests the /auth/api-keys endpoint which requires builder authentication",
        curlCommand,
        headers: {
          POLY_BUILDER_API_KEY: builderApiKey,
          POLY_BUILDER_PASSPHRASE: builderPassphrase,
          POLY_BUILDER_SIGNATURE: signature,
          POLY_BUILDER_TIMESTAMP: timestamp.toString(),
        },
        timestamp,
        path,
        method,
      });
    } catch (error: any) {
      console.error("Debug curl error:", error);
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // ============ Polymarket Relayer Client (Remote Signing) ============
  
  // Check if relayer credentials are available
  app.get("/api/polymarket/relayer-status", async (req, res) => {
    try {
      const { hasRelayerCredentials } = await import("./polymarket");
      res.json({ available: hasRelayerCredentials() });
    } catch (error) {
      res.status(500).json({ error: "Failed to check relayer status" });
    }
  });

  // ========================================
  // 0x Swap API Endpoints (USDC <-> USDC.e)
  // ========================================
  
  // Token addresses on Polygon
  const USDC_NATIVE = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"; // Native USDC
  const USDC_BRIDGED = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"; // USDC.e (bridged)
  
  // Check if 0x API is configured
  app.get("/api/swap/status", async (req, res) => {
    const hasApiKey = !!process.env.ZEROX_API_KEY;
    res.json({ 
      available: hasApiKey,
      tokens: {
        usdc: USDC_NATIVE,
        usdce: USDC_BRIDGED,
      }
    });
  });
  
  // Helper to convert human-readable amount to base units (6 decimals for USDC)
  // Uses ethers.parseUnits for battle-tested precision handling
  async function parseUsdcAmount(amount: string): Promise<string | null> {
    try {
      const { parseUnits } = await import("ethers");
      const cleanAmount = amount.trim();
      // Validate format: positive decimal number, no scientific notation
      if (!/^\d+(\.\d+)?$/.test(cleanAmount)) {
        return null;
      }
      const baseUnits = parseUnits(cleanAmount, 6);
      // Reject zero or excessively large amounts (> 10 billion USDC)
      if (baseUnits <= 0n || baseUnits > parseUnits("10000000000", 6)) {
        return null;
      }
      return baseUnits.toString();
    } catch {
      return null;
    }
  }
  
  // Get swap price (for display purposes, no transaction data)
  app.get("/api/swap/price", async (req, res) => {
    try {
      const { direction, amount, taker } = req.query;
      
      if (!direction || !amount || !taker) {
        return res.status(400).json({ error: "direction, amount, and taker are required" });
      }
      
      // Validate direction
      if (direction !== "deposit" && direction !== "withdraw") {
        return res.status(400).json({ error: "direction must be 'deposit' or 'withdraw'" });
      }
      
      // Validate taker address format
      if (typeof taker !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(taker)) {
        return res.status(400).json({ error: "taker must be a valid Ethereum address" });
      }
      
      // Validate and convert amount to base units
      const sellAmount = await parseUsdcAmount(amount as string);
      if (!sellAmount) {
        return res.status(400).json({ error: "amount must be a positive number with up to 6 decimals" });
      }
      
      const apiKey = process.env.ZEROX_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ error: "0x API not configured" });
      }
      
      // Direction: "deposit" = USDC -> USDC.e, "withdraw" = USDC.e -> USDC
      const sellToken = direction === "deposit" ? USDC_NATIVE : USDC_BRIDGED;
      const buyToken = direction === "deposit" ? USDC_BRIDGED : USDC_NATIVE;
      
      const params = new URLSearchParams({
        chainId: "137",
        sellToken,
        buyToken,
        sellAmount,
        taker: taker as string,
      });
      
      const response = await fetch(
        `https://api.0x.org/swap/allowance-holder/price?${params.toString()}`,
        {
          headers: {
            "0x-api-key": apiKey,
            "0x-version": "v2",
          },
        }
      );
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("0x price API error:", response.status, errorText);
        return res.status(response.status).json({ error: "Failed to get price", details: errorText });
      }
      
      const data = await response.json();
      
      // Convert amounts back to human-readable format (6 decimals)
      res.json({
        liquidityAvailable: data.liquidityAvailable,
        sellAmount: parseFloat(data.sellAmount) / 1e6,
        buyAmount: parseFloat(data.buyAmount) / 1e6,
        sellToken: data.sellToken,
        buyToken: data.buyToken,
        direction,
        estimatedGas: data.estimatedGas,
      });
    } catch (error) {
      console.error("Swap price error:", error);
      res.status(500).json({ error: "Failed to get swap price" });
    }
  });
  
  // Get swap quote (includes transaction data for execution)
  app.get("/api/swap/quote", async (req, res) => {
    try {
      const { direction, amount, taker, slippageBps } = req.query;
      
      if (!direction || !amount || !taker) {
        return res.status(400).json({ error: "direction, amount, and taker are required" });
      }
      
      // Validate direction
      if (direction !== "deposit" && direction !== "withdraw") {
        return res.status(400).json({ error: "direction must be 'deposit' or 'withdraw'" });
      }
      
      // Validate taker address format
      if (typeof taker !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(taker)) {
        return res.status(400).json({ error: "taker must be a valid Ethereum address" });
      }
      
      // Validate and convert amount to base units
      const sellAmount = await parseUsdcAmount(amount as string);
      if (!sellAmount) {
        return res.status(400).json({ error: "amount must be a positive number with up to 6 decimals" });
      }
      
      // Validate slippageBps if provided (must be 1-10000)
      let validSlippageBps = "50"; // 0.5% default
      if (slippageBps) {
        const parsed = parseInt(slippageBps as string, 10);
        if (isNaN(parsed) || parsed < 1 || parsed > 10000) {
          return res.status(400).json({ error: "slippageBps must be between 1 and 10000" });
        }
        validSlippageBps = String(parsed);
      }
      
      const apiKey = process.env.ZEROX_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ error: "0x API not configured" });
      }
      
      // Direction: "deposit" = USDC -> USDC.e, "withdraw" = USDC.e -> USDC
      const sellToken = direction === "deposit" ? USDC_NATIVE : USDC_BRIDGED;
      const buyToken = direction === "deposit" ? USDC_BRIDGED : USDC_NATIVE;
      
      const params = new URLSearchParams({
        chainId: "137",
        sellToken,
        buyToken,
        sellAmount,
        taker: taker as string,
        slippageBps: validSlippageBps,
      });
      
      const response = await fetch(
        `https://api.0x.org/swap/allowance-holder/quote?${params.toString()}`,
        {
          headers: {
            "0x-api-key": apiKey,
            "0x-version": "v2",
          },
        }
      );
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("0x quote API error:", response.status, errorText);
        return res.status(response.status).json({ error: "Failed to get quote", details: errorText });
      }
      
      const data = await response.json();
      
      if (!data.liquidityAvailable) {
        return res.status(400).json({ error: "No liquidity available for this swap" });
      }
      
      // Return full quote data including transaction
      res.json({
        liquidityAvailable: data.liquidityAvailable,
        sellAmount: parseFloat(data.sellAmount) / 1e6,
        buyAmount: parseFloat(data.buyAmount) / 1e6,
        sellToken: data.sellToken,
        buyToken: data.buyToken,
        direction,
        allowanceTarget: data.allowanceTarget,
        transaction: data.transaction,
        issues: data.issues,
        fees: data.fees,
      });
    } catch (error) {
      console.error("Swap quote error:", error);
      res.status(500).json({ error: "Failed to get swap quote" });
    }
  });

  // Remote BuilderConfig endpoint for @polymarket/builder-signing-sdk
  // The SDK will call this URL with { method, path, body?, timestamp? } and expect back the auth headers
  app.post("/api/polymarket/builder-sign", async (req, res) => {
    try {
      const { method, path, body, timestamp } = req.body;
      
      if (!method || !path) {
        return res.status(400).json({ error: "method and path are required" });
      }

      const { signRelayerRequest, hasRelayerCredentials } = await import("./polymarket");
      
      if (!hasRelayerCredentials()) {
        return res.status(503).json({ error: "Builder credentials not configured" });
      }

      // Pass through the timestamp if provided by SDK, and handle body serialization
      const headers = signRelayerRequest({
        method: method.toUpperCase(),
        path,
        body: body, // signRelayerRequest will handle object/string conversion
        timestamp: timestamp ? parseInt(timestamp, 10) : undefined,
      });
      
      if (!headers) {
        return res.status(500).json({ error: "Failed to generate signature" });
      }

      // Return the headers in the format expected by BuilderConfig
      res.json({
        POLY_BUILDER_API_KEY: headers.POLY_BUILDER_API_KEY,
        POLY_BUILDER_TIMESTAMP: headers.POLY_BUILDER_TIMESTAMP,
        POLY_BUILDER_PASSPHRASE: headers.POLY_BUILDER_PASSPHRASE,
        POLY_BUILDER_SIGNATURE: headers.POLY_BUILDER_SIGNATURE,
      });
    } catch (error) {
      console.error("Builder signing failed:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Signing failed" });
    }
  });

  // Server-side proxy for relayer requests - credentials NEVER leave the server
  // Client sends transaction data, server signs and executes the relayer request
  // For Safe wallets, eoaAddress (the signer) is used as owner for Polymarket's relayer
  app.post("/api/polymarket/relayer-execute", async (req, res) => {
    try {
      const { walletAddress, walletType, transactions, description, eoaAddress } = req.body;
      
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
      // For Safe wallets, pass eoaAddress as the owner (required by Polymarket's relayer)
      const result = await executeRelayerTransaction(
        walletAddress,
        walletType || "proxy",
        transactions,
        description || "",
        eoaAddress  // EOA address for Safe wallets
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
  // For Safe wallets, eoaAddress (the signer) is used as owner
  app.post("/api/polymarket/relayer-deploy", async (req, res) => {
    try {
      const { walletAddress, walletType, eoaAddress } = req.body;
      
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

      // For Safe wallets, pass eoaAddress as the owner
      const result = await deployRelayerWallet(walletAddress, walletType || "proxy", eoaAddress);
      
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

  // ============ Arbitrage Detection ============
  
  // Get arbitrage opportunities comparing Polymarket vs sportsbook odds
  app.get("/api/arbitrage/opportunities", async (req, res) => {
    try {
      const { getConstructorsMarket, getDriversMarket } = await import("./polymarket");
      const { getArbitrageOpportunities, hasOddsApiKey } = await import("./oddsSync");
      
      // Fetch current Polymarket prices
      const constructorsData = await getConstructorsMarket();
      const driversData = await getDriversMarket();
      
      // Convert to format expected by arbitrage engine
      const polyConstructors = constructorsData.map(c => ({ name: c.name, price: c.price }));
      const polyDrivers = driversData.map(d => ({ name: d.name, price: d.price }));
      
      // Get arbitrage opportunities
      const opportunities = await getArbitrageOpportunities(polyConstructors, polyDrivers);
      
      res.json({
        ...opportunities,
        hasLiveOdds: hasOddsApiKey(),
        dataSource: hasOddsApiKey() ? "TheOddsAPI" : "Mock Data (bet365 estimates)",
      });
    } catch (error) {
      console.error("Failed to fetch arbitrage opportunities:", error);
      res.status(500).json({ error: "Failed to fetch arbitrage opportunities" });
    }
  });

  // Get cached sportsbook odds (for debugging/transparency)
  app.get("/api/arbitrage/odds", async (req, res) => {
    try {
      const { getCachedOdds, hasOddsApiKey } = await import("./oddsSync");
      const odds = getCachedOdds();
      
      res.json({
        ...odds,
        hasLiveOdds: hasOddsApiKey(),
        dataSource: hasOddsApiKey() ? "TheOddsAPI" : "Mock Data (bet365 estimates)",
      });
    } catch (error) {
      console.error("Failed to fetch cached odds:", error);
      res.status(500).json({ error: "Failed to fetch cached odds" });
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

      const proxyAgent = getOxylabsProxyAgent();
      const headers = {
        ...getBrowserHeaders(),
        "Content-Type": "application/json",
        "POLY_ADDRESS": walletAddress,
        "POLY_SIGNATURE": signature,
        "POLY_TIMESTAMP": timestamp.toString(),
        "POLY_NONCE": (nonce || 0).toString(),
      };
      
      if (proxyAgent) {
        console.log("Using Oxylabs proxy (undici) for derive-api-key");
      }
      
      const response = await (proxyAgent 
        ? undiciFetch("https://clob.polymarket.com/auth/derive-api-key", {
            method: "GET",
            headers,
            dispatcher: proxyAgent,
          } as any)
        : fetch("https://clob.polymarket.com/auth/derive-api-key", { method: "GET", headers }));

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

  // Validate API credentials by making an authenticated request to Polymarket
  // This uses proper HMAC signing to check if credentials are still valid
  app.post("/api/polymarket/validate-credentials", async (req, res) => {
    try {
      const apiKey = req.headers["x-poly-api-key"] as string;
      const apiSecret = req.headers["x-poly-api-secret"] as string;
      const passphrase = req.headers["x-poly-passphrase"] as string;

      if (!apiKey || !apiSecret || !passphrase) {
        return res.json({ valid: false, error: "Missing credentials" });
      }

      console.log("[validate-credentials] Validating API key:", apiKey.substring(0, 10) + "...");

      // Create HMAC signature for a simple GET request to validate credentials
      // We use GET /auth/api-key which returns the API key info if valid
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const method = "GET";
      const path = "/auth/api-key";
      const message = timestamp + method + path;

      // Decode secret (base64url or hex)
      let secretBytes: Buffer;
      if (/^[0-9a-fA-F]+$/.test(apiSecret) && apiSecret.length % 2 === 0) {
        secretBytes = Buffer.from(apiSecret, "hex");
      } else {
        let base64 = apiSecret.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) base64 += '=';
        secretBytes = Buffer.from(base64, "base64");
      }

      const crypto = await import("crypto");
      const hmac = crypto.createHmac("sha256", secretBytes);
      hmac.update(message);
      const hmacSignature = hmac.digest("base64");

      const proxyAgent = getOxylabsProxyAgent();
      const headers = {
        ...getBrowserHeaders(),
        "POLY_API_KEY": apiKey,
        "POLY_PASSPHRASE": passphrase,
        "POLY_TIMESTAMP": timestamp,
        "POLY_SIGNATURE": hmacSignature,
      };

      const response = await (proxyAgent
        ? undiciFetch("https://clob.polymarket.com/auth/api-key", {
            method: "GET",
            headers,
            dispatcher: proxyAgent,
          } as any)
        : fetch("https://clob.polymarket.com/auth/api-key", { method: "GET", headers }));

      const responseText = await response.text();
      console.log("[validate-credentials] Response:", response.status, responseText.substring(0, 100));

      if (response.status === 401 || response.status === 403) {
        return res.json({ valid: false, error: "Credentials expired or invalid" });
      }

      if (response.status === 200) {
        return res.json({ valid: true });
      }

      // For 405 (Method Not Allowed), the endpoint doesn't support this method
      // Return inconclusive so client can try createApiKey() to register credentials
      if (response.status === 405) {
        console.log("[validate-credentials] Endpoint returned 405 - validation inconclusive");
        return res.json({ valid: false, inconclusive: true, warning: "Validation endpoint unavailable (405)" });
      }
      
      // For other errors, mark as inconclusive so client can try createApiKey()
      console.log("[validate-credentials] Unexpected response:", response.status);
      return res.json({ valid: false, inconclusive: true, warning: `Validation returned ${response.status}` });
    } catch (error: any) {
      console.error("[validate-credentials] Error:", error.message);
      // On network error, assume valid to not block users
      return res.json({ valid: true, warning: "Could not reach Polymarket API" });
    }
  });

  // Server-side proxy for submitting orders to Polymarket CLOB
  // Accepts signedOrder from ClobClient unchanged and forwards to Polymarket
  // Credentials are passed via headers for security (not logged)
  app.post("/api/polymarket/submit-order", async (req, res) => {
    try {
      // Read credentials from headers (more secure than body)
      const apiKey = req.headers["x-poly-api-key"] as string;
      const apiSecret = req.headers["x-poly-api-secret"] as string;
      const passphrase = req.headers["x-poly-passphrase"] as string;
      
      // Support both new format (signedOrder) and legacy format (order + signature)
      let signedOrder = req.body.signedOrder;
      if (!signedOrder && req.body.order) {
        // Legacy format: reconstruct signedOrder from order + signature
        signedOrder = { ...req.body.order, signature: req.body.signature };
      }
      
      if (!signedOrder || !apiKey || !apiSecret || !passphrase) {
        return res.status(400).json({ error: "Missing required fields: signedOrder or API credentials" });
      }

      // CRITICAL DEBUG: Log signer and maker immediately upon receipt
      console.log("[submit-order] ===== ORDER RECEIVED =====");
      console.log("[submit-order] signedOrder.signer:", signedOrder.signer);
      console.log("[submit-order] signedOrder.maker:", signedOrder.maker);
      console.log("[submit-order] signedOrder.signatureType:", signedOrder.signatureType);
      
      // Only log non-sensitive order info (tokenId not credentials)
      const sideString = signedOrder.side === 0 ? "BUY" : "SELL";
      console.log("Proxying order submission:", { 
        tokenId: signedOrder.tokenId,
        side: sideString,
        makerAmount: signedOrder.makerAmount,
        takerAmount: signedOrder.takerAmount,
        maker: signedOrder.maker,
        signer: signedOrder.signer,
        signatureType: signedOrder.signatureType
      });

      // Get orderType from request (default to GTC)
      const orderType = req.body.orderType || "GTC";
      
      // Transform order to Polymarket API format (see SDK's orderToJson)
      // The API expects a wrapped format with order, owner, orderType fields
      // 
      // Per Polymarket docs: owner = "api key of order owner" (the API key STRING, not an address!)
      // See: https://docs.polymarket.com/developers/CLOB/orders/create-order#request-payload-parameters
      // 
      // For Safe wallets (signatureType=2):
      //   - order.maker = Safe wallet (where funds are held and trades execute from)
      //   - order.signer = EOA (who controls the Safe and signs orders)
      //   - owner = API KEY STRING (not an address!)
      const owner = apiKey;  // Per docs: owner is the API key string, not a wallet address
      console.log("[submit-order] Using owner (API key):", apiKey.substring(0, 15) + "...");
      const apiOrderPayload = {
        order: {
          salt: parseInt(signedOrder.salt, 10),  // Must be integer
          maker: signedOrder.maker,
          signer: signedOrder.signer,
          taker: signedOrder.taker,
          tokenId: signedOrder.tokenId,
          makerAmount: signedOrder.makerAmount,
          takerAmount: signedOrder.takerAmount,
          side: sideString,  // Must be "BUY" or "SELL" string
          expiration: signedOrder.expiration,
          nonce: signedOrder.nonce,
          feeRateBps: signedOrder.feeRateBps,
          signatureType: signedOrder.signatureType,
          signature: signedOrder.signature,
        },
        owner: owner,  // Owner must match API key owner (signer/EOA for Safe wallets)
        orderType: orderType,
      };
      
      console.log("[submit-order] Formatted payload:", JSON.stringify(apiOrderPayload).substring(0, 200) + "...");

      // Create HMAC signature for the Polymarket API request
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const method = "POST";
      const path = "/order";
      const body = JSON.stringify(apiOrderPayload);
      const message = timestamp + method + path + body;
      
      // Decode secret (base64url or hex)
      // Polymarket SDK returns secrets in base64url format
      let secretBytes: Buffer;
      const isHex = /^[0-9a-fA-F]+$/.test(apiSecret) && apiSecret.length % 2 === 0;
      if (isHex) {
        secretBytes = Buffer.from(apiSecret, "hex");
        console.log("[submit-order] Secret decoded as hex, length:", secretBytes.length);
      } else {
        // Convert base64url to base64
        let base64 = apiSecret.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) base64 += '=';
        secretBytes = Buffer.from(base64, "base64");
        console.log("[submit-order] Secret decoded as base64url, length:", secretBytes.length);
      }

      const crypto = await import("crypto");
      const hmac = crypto.createHmac("sha256", secretBytes);
      hmac.update(message);
      const hmacBase64 = hmac.digest("base64");
      // Convert to URL-safe base64 (Polymarket SDK format): '+' -> '-', '/' -> '_'
      const hmacSignature = hmacBase64.replace(/\+/g, '-').replace(/\//g, '_');
      
      // Debug: Log HMAC inputs (not the actual secret)
      console.log("[submit-order] HMAC message preview:", message.substring(0, 50) + "...");
      console.log("[submit-order] HMAC signature (url-safe base64):", hmacSignature.substring(0, 20) + "...");
      console.log("[submit-order] API key:", apiKey.substring(0, 15) + "...");
      console.log("[submit-order] Timestamp:", timestamp);

      const proxyAgent = getOxylabsProxyAgent();
      // POLY_ADDRESS is required for L2 authentication - it must match the API key binding
      // API keys are bound to EOA (via L1 auth ecrecover), so POLY_ADDRESS must be EOA (signer)
      const polyAddress = signedOrder.signer;  // Must be EOA for HMAC verification
      console.log("[submit-order] POLY_ADDRESS:", polyAddress, "(EOA/signer - for HMAC auth)");
      console.log("[submit-order] Order owner (API key):", apiKey.substring(0, 15) + "...");
      console.log("[submit-order] Order maker (Safe wallet):", signedOrder.maker);
      console.log("[submit-order] Order signer (EOA):", signedOrder.signer);
      
      const submitHeaders = {
        ...getBrowserHeaders(),
        "Content-Type": "application/json",
        "POLY_ADDRESS": polyAddress,
        "POLY_API_KEY": apiKey,
        "POLY_PASSPHRASE": passphrase,
        "POLY_TIMESTAMP": timestamp,
        "POLY_SIGNATURE": hmacSignature,
      };
      // Send properly formatted order payload to Polymarket
      const submitBody = body;  // Already JSON.stringify(apiOrderPayload)
      
      if (proxyAgent) {
        console.log("Using Oxylabs proxy (undici) for submit-order");
      }
      
      const response = await (proxyAgent
        ? undiciFetch("https://clob.polymarket.com/order", {
            method: "POST",
            headers: submitHeaders,
            body: submitBody,
            dispatcher: proxyAgent,
          } as any)
        : fetch("https://clob.polymarket.com/order", { method: "POST", headers: submitHeaders, body: submitBody }));

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
    } catch (error: any) {
      console.error("Failed to submit order to Polymarket:", error);
      // Include more error details for debugging
      const errorMessage = error.message || "Failed to submit order";
      const errorDetails = {
        error: errorMessage,
        cause: error.cause?.message,
        code: error.code,
        type: error.name,
      };
      console.error("Order submission error details:", JSON.stringify(errorDetails));
      res.status(500).json(errorDetails);
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

      console.log("=== BUILDER ORDER REQUEST START ===");
      console.log("Wallet Address:", walletAddress.substring(0, 10) + "...");
      console.log("Order tokenID:", order.tokenID);
      console.log("Order price:", order.price, "size:", order.size);

      // Include the user's EIP-712 signature in the order body BEFORE signing
      const orderWithSignature = {
        ...order,
        signature: userSignature,
      };
      const requestBody = JSON.stringify(orderWithSignature);

      // Use the official Polymarket builder-signing-sdk for HMAC signature
      // Timestamp must be in milliseconds for the SDK
      const { buildHmacSignature } = await import("@polymarket/builder-signing-sdk");
      const timestamp = Date.now();
      const builderSignature = buildHmacSignature(
        builderSecret,
        timestamp,
        "POST",
        "/order",
        requestBody
      );

      // Build request with builder headers for submitting on behalf of user
      // Include browser-like headers to bypass Cloudflare bot detection
      const headers: Record<string, string> = {
        ...getBrowserHeaders(),
        "Content-Type": "application/json",
        "POLY_ADDRESS": walletAddress,
        "POLY_BUILDER_API_KEY": builderApiKey,
        "POLY_BUILDER_PASSPHRASE": builderPassphrase,
        "POLY_BUILDER_SIGNATURE": builderSignature,
        "POLY_BUILDER_TIMESTAMP": timestamp.toString(),
      };

      const proxyAgent = getOxylabsProxyAgent();
      
      // Log proxy status (skip IP check to avoid delays)
      const proxyStatus = proxyAgent ? "Oxylabs Switzerland residential proxy" : "direct (no proxy)";
      
      // Log request details with masked sensitive values for debugging
      console.log("Request URL: https://clob.polymarket.com/order");
      console.log("Request via:", proxyStatus);
      console.log("Builder API key (first 8 chars):", builderApiKey.substring(0, 8) + "...");
      console.log("Builder passphrase (first 8 chars):", builderPassphrase.substring(0, 8) + "...");
      console.log("Signature generated:", builderSignature.substring(0, 20) + "...");
      console.log("Timestamp:", timestamp);
      console.log("Request body preview:", requestBody.substring(0, 200) + "...");
      
      if (proxyAgent) {
        console.log("Using Oxylabs proxy (undici/Switzerland) for builder-order");
      } else {
        console.log("WARNING: No proxy configured - request may be geo-blocked");
      }
      
      const response = await (proxyAgent
        ? undiciFetch("https://clob.polymarket.com/order", {
            method: "POST",
            headers,
            body: requestBody,
            dispatcher: proxyAgent,
          } as any)
        : fetch("https://clob.polymarket.com/order", { method: "POST", headers, body: requestBody }));

      const responseText = await response.text();
      console.log("Response Status:", response.status);
      console.log("Response Body:", responseText);
      console.log("=== BUILDER ORDER REQUEST END ===");

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
        ...getBrowserHeaders(),
        "Content-Type": "application/json",
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

      const proxyAgent = getOxylabsProxyAgent();
      const clobUrl = `https://clob.polymarket.com${path}`;
      const clobMethod = method.toUpperCase();
      const clobBody = (body && (clobMethod === "POST" || clobMethod === "PUT")) ? bodyStr : undefined;
      
      if (proxyAgent) {
        console.log("Using Oxylabs proxy (undici) for clob-proxy:", path);
      }

      const response = await (proxyAgent
        ? undiciFetch(clobUrl, {
            method: clobMethod,
            headers,
            body: clobBody,
            dispatcher: proxyAgent,
          } as any)
        : fetch(clobUrl, { method: clobMethod, headers, body: clobBody }));

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
      const { userId, tokenId, marketName, outcome, side, price, size, totalCost, polymarketOrderId, status, postOrderResponse } = req.body;
      
      if (!userId || !tokenId || !outcome || !side || price === undefined || size === undefined) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Log the full postOrder response for debugging
      if (postOrderResponse) {
        console.log("DEBUG: Full postOrder response from Polymarket:", JSON.stringify(postOrderResponse, null, 2));
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
        status,
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

  // Debug logging endpoint for client-side Polymarket errors
  app.post("/api/polymarket/debug-log", async (req, res) => {
    const { event, data, error, walletAddress, timestamp } = req.body;
    console.log(`[CLIENT DEBUG ${timestamp || new Date().toISOString()}] ${event}:`, {
      walletAddress,
      data: data ? JSON.stringify(data).substring(0, 500) : undefined,
      error: error ? JSON.stringify(error).substring(0, 1000) : undefined,
    });
    res.json({ logged: true });
  });

  // Fetch user positions from Polymarket API
  app.get("/api/polymarket/positions/:walletAddress", async (req, res) => {
    try {
      const { walletAddress } = req.params;
      
      if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
        return res.status(400).json({ error: "Invalid wallet address" });
      }

      // Fetch positions from Polymarket Data API
      const positionsUrl = `https://data-api.polymarket.com/positions?user=${walletAddress.toLowerCase()}`;
      console.log("Fetching Polymarket positions:", positionsUrl);
      
      const positionsResponse = await fetch(positionsUrl, {
        headers: { "Accept": "application/json" }
      });

      if (!positionsResponse.ok) {
        console.error("Polymarket positions API error:", positionsResponse.status, await positionsResponse.text());
        return res.json({ positions: [], totalValue: 0, totalPnl: 0 });
      }

      const rawPositions = await positionsResponse.json();
      console.log("Raw positions response:", JSON.stringify(rawPositions).substring(0, 500));

      // Transform positions from Data API format to our format
      // Data API returns: asset, size, avgPrice, curPrice, cashPnl, percentPnl, currentValue, title, outcome, slug, conditionId
      const positions = (rawPositions || []).map((pos: any) => {
        const size = parseFloat(pos.size || "0");
        const avgPrice = parseFloat(pos.avgPrice || "0");
        const currentPrice = parseFloat(pos.curPrice || avgPrice);
        const value = parseFloat(pos.currentValue || (size * currentPrice).toString());
        const pnl = parseFloat(pos.cashPnl || "0");
        const pnlPercent = parseFloat(pos.percentPnl || "0");

        return {
          tokenId: pos.asset || "",
          outcome: pos.outcome || "Yes",
          size,
          averagePrice: avgPrice,
          currentPrice,
          pnl,
          pnlPercent,
          value,
          conditionId: pos.conditionId || "",
          marketSlug: pos.slug || pos.eventSlug || "",
          title: pos.title || "Unknown Market",
          icon: pos.icon || "",
          eventSlug: pos.eventSlug || "",
        };
      }).filter((p: any) => p.size > 0);

      const totalValue = positions.reduce((sum: number, p: any) => sum + p.value, 0);
      const totalPnl = positions.reduce((sum: number, p: any) => sum + p.pnl, 0);

      console.log(`Found ${positions.length} active positions for ${walletAddress}`);
      res.json({ positions, totalValue, totalPnl });
    } catch (error: any) {
      console.error("Failed to fetch positions:", error);
      res.status(500).json({ error: "Failed to fetch positions", details: error.message });
    }
  });

  // Diagnostic: Check wallet approval status on-chain
  app.get("/api/polymarket/check-approvals/:walletAddress", async (req, res) => {
    try {
      const { walletAddress } = req.params;
      const { ethers } = await import("ethers");
      
      const POLYGON_RPC = "https://polygon-rpc.com";
      const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
      
      const CONTRACTS = {
        CTF_EXCHANGE: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
        NEG_RISK_CTF_EXCHANGE: "0xC5d563A36AE78145C45a50134d48A1215220f80a",
        USDC: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
        CTF: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045",
      };
      
      const ERC20_ABI = [
        "function allowance(address owner, address spender) view returns (uint256)",
        "function balanceOf(address account) view returns (uint256)"
      ];
      const ERC1155_ABI = [
        "function isApprovedForAll(address account, address operator) view returns (bool)"
      ];
      
      const usdc = new ethers.Contract(CONTRACTS.USDC, ERC20_ABI, provider);
      const ctf = new ethers.Contract(CONTRACTS.CTF, ERC1155_ABI, provider);
      
      // Check USDC balance
      const usdcBalance = await usdc.balanceOf(walletAddress);
      const usdcBalanceFormatted = ethers.formatUnits(usdcBalance, 6);
      
      // Check USDC allowances for each exchange
      const ctfExchangeAllowance = await usdc.allowance(walletAddress, CONTRACTS.CTF_EXCHANGE);
      const negRiskExchangeAllowance = await usdc.allowance(walletAddress, CONTRACTS.NEG_RISK_CTF_EXCHANGE);
      const ctfContractAllowance = await usdc.allowance(walletAddress, CONTRACTS.CTF);
      
      // Check CTF approvals (ERC1155 setApprovalForAll)
      const ctfApprovedForExchange = await ctf.isApprovedForAll(walletAddress, CONTRACTS.CTF_EXCHANGE);
      const ctfApprovedForNegRisk = await ctf.isApprovedForAll(walletAddress, CONTRACTS.NEG_RISK_CTF_EXCHANGE);
      
      const result = {
        walletAddress,
        usdcBalance: usdcBalanceFormatted,
        approvals: {
          ctfExchange: {
            address: CONTRACTS.CTF_EXCHANGE,
            usdcAllowance: ethers.formatUnits(ctfExchangeAllowance, 6),
            hasApproval: ctfExchangeAllowance > 0n
          },
          negRiskExchange: {
            address: CONTRACTS.NEG_RISK_CTF_EXCHANGE,
            usdcAllowance: ethers.formatUnits(negRiskExchangeAllowance, 6),
            hasApproval: negRiskExchangeAllowance > 0n
          },
          ctfContract: {
            address: CONTRACTS.CTF,
            usdcAllowance: ethers.formatUnits(ctfContractAllowance, 6),
            hasApproval: ctfContractAllowance > 0n
          }
        },
        ctfTokenApprovals: {
          ctfExchange: ctfApprovedForExchange,
          negRiskExchange: ctfApprovedForNegRisk
        },
        summary: {
          allUSDCApprovalsSet: ctfExchangeAllowance > 0n && negRiskExchangeAllowance > 0n && ctfContractAllowance > 0n,
          allCTFApprovalsSet: ctfApprovedForExchange && ctfApprovedForNegRisk,
          readyToTrade: ctfExchangeAllowance > 0n && negRiskExchangeAllowance > 0n && ctfContractAllowance > 0n && ctfApprovedForExchange && ctfApprovedForNegRisk
        }
      };
      
      console.log("Approval check for", walletAddress, ":", JSON.stringify(result, null, 2));
      res.json(result);
    } catch (error: any) {
      console.error("Failed to check approvals:", error);
      res.status(500).json({ error: "Failed to check approvals", details: error.message });
    }
  });

  // Debug: Check CTF token balance for a specific token ID (for debugging sell order issues)
  app.get("/api/polymarket/ctf-balance/:walletAddress/:tokenId", async (req, res) => {
    try {
      const { walletAddress, tokenId } = req.params;
      const { ethers } = await import("ethers");
      
      if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
        return res.status(400).json({ error: "Invalid wallet address" });
      }
      
      const POLYGON_RPC = "https://polygon-rpc.com";
      const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
      
      const CTF_ADDRESS = "0x4d97dcd97ec945f40cf65f87097ace5ea0476045";
      const CTF_EXCHANGE = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
      const NEG_RISK_CTF_EXCHANGE = "0xC5d563A36AE78145C45a50134d48A1215220f80a";
      
      const ERC1155_ABI = [
        "function balanceOf(address account, uint256 id) view returns (uint256)",
        "function isApprovedForAll(address account, address operator) view returns (bool)"
      ];
      
      const ctf = new ethers.Contract(CTF_ADDRESS, ERC1155_ABI, provider);
      
      // Check CTF token balance for the specific token ID
      const balance = await ctf.balanceOf(walletAddress, tokenId);
      const balanceFormatted = ethers.formatUnits(balance, 6); // CTF tokens use 6 decimals
      
      // Check CTF approval status
      const approvedForExchange = await ctf.isApprovedForAll(walletAddress, CTF_EXCHANGE);
      const approvedForNegRisk = await ctf.isApprovedForAll(walletAddress, NEG_RISK_CTF_EXCHANGE);
      
      const result = {
        walletAddress,
        tokenId,
        ctfBalance: balanceFormatted,
        ctfBalanceRaw: balance.toString(),
        approvals: {
          ctfExchange: approvedForExchange,
          negRiskExchange: approvedForNegRisk
        },
        canSell: balance > 0n && (approvedForExchange || approvedForNegRisk),
        note: balance === 0n ? "No CTF tokens found - position may not be settled or tokens are in different wallet" : "CTF tokens available"
      };
      
      console.log("[CTF Balance Check]", walletAddress, "token", tokenId.substring(0, 20) + "...", "=", balanceFormatted);
      res.json(result);
    } catch (error: any) {
      console.error("Failed to check CTF balance:", error);
      res.status(500).json({ error: "Failed to check CTF balance", details: error.message });
    }
  });

  // Delete a Polymarket order (for failed/local orders)
  app.delete("/api/polymarket/orders/:orderId", async (req, res) => {
    try {
      const { orderId } = req.params;
      const { userId } = req.body;
      
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }
      
      const order = await storage.getPolymarketOrder(orderId);
      
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      
      // Verify ownership - order must belong to the requesting user
      if (order.userId !== userId) {
        return res.status(403).json({ error: "Not authorized to delete this order" });
      }
      
      // Only allow deletion of orders that failed to reach Polymarket (no polymarketOrderId)
      // or cancelled/expired orders
      if (order.polymarketOrderId && !["cancelled", "expired"].includes(order.status)) {
        return res.status(400).json({ 
          error: "Cannot delete active orders on Polymarket. Use cancel instead." 
        });
      }
      
      await storage.deletePolymarketOrder(orderId);
      res.json({ success: true, message: "Order deleted" });
    } catch (error) {
      console.error("Failed to delete order:", error);
      res.status(500).json({ error: "Failed to delete order" });
    }
  });

  // Update order status (for cancelled orders)
  app.patch("/api/polymarket/orders/:orderId/status", async (req, res) => {
    try {
      const { orderId } = req.params;
      const { status } = req.body;
      
      if (!status) {
        return res.status(400).json({ error: "status is required" });
      }
      
      const validStatuses = ["open", "filled", "partial", "cancelled", "expired", "pending", "failed"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: "Invalid status value" });
      }
      
      const order = await storage.getPolymarketOrder(orderId);
      
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      
      const updated = await storage.updatePolymarketOrder(orderId, {
        status,
        updatedAt: new Date()
      });
      
      if (updated) {
        res.json(updated);
      } else {
        res.status(500).json({ error: "Failed to update order" });
      }
    } catch (error) {
      console.error("Failed to update order status:", error);
      res.status(500).json({ error: "Failed to update order status" });
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
      
      // Cache for market names to avoid redundant API calls
      const marketNameCache: Record<string, string> = {};
      
      // Helper to fetch market name from Polymarket data API
      async function fetchMarketName(tokenId: string): Promise<string | null> {
        if (marketNameCache[tokenId]) return marketNameCache[tokenId];
        try {
          const response = await fetch(`https://gamma-api.polymarket.com/markets?clob_token_ids=${tokenId}`);
          if (response.ok) {
            const markets = await response.json();
            if (markets && markets.length > 0) {
              // Use question (market title) for the name
              const marketName = markets[0].question || markets[0].title || null;
              if (marketName) {
                marketNameCache[tokenId] = marketName;
                return marketName;
              }
            }
          }
        } catch (e) {
          console.error(`Failed to fetch market name for ${tokenId}:`, e);
        }
        return null;
      }
      
      const syncedOrders = [];
      for (const order of orders) {
        const updates: any = { lastSyncedAt: new Date() };
        
        // Check if marketName needs updating (missing or set to generic values)
        const needsMarketName = !order.marketName || 
          order.marketName === "Yes" || 
          order.marketName === "No" ||
          order.marketName === "Unknown Market";
        
        if (needsMarketName && order.tokenId) {
          const fetchedName = await fetchMarketName(order.tokenId);
          if (fetchedName) {
            updates.marketName = fetchedName;
            console.log(`Updated market name for order ${order.id}: ${fetchedName}`);
          }
        }
        
        // If order has polymarketOrderId, fetch its status from CLOB
        if (order.polymarketOrderId) {
          try {
            const clobOrder = await getOrderStatus(order.polymarketOrderId);
            if (clobOrder) {
              // Use the normalized status from getOrderStatus
              updates.status = clobOrder.normalizedStatus || order.status;
              
              // Determine filled size
              if (clobOrder.sizeMatched !== undefined) {
                updates.filledSize = parseFloat(clobOrder.sizeMatched) || 0;
              } else if (updates.status === "filled") {
                updates.filledSize = order.size;
              }
            }
          } catch (syncError) {
            console.error(`Failed to sync order ${order.id}:`, syncError);
          }
        }
        
        const updated = await storage.updatePolymarketOrder(order.id, updates);
        if (updated) syncedOrders.push(updated);
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

  // Migrate orphan orders with user_id="undefined" to a wallet address
  // Security: Only migrates orders with the literal value "undefined" - no custom fromUserIds allowed
  app.post("/api/polymarket/orders/migrate", async (req, res) => {
    try {
      const { walletAddress } = req.body;
      
      if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/i.test(walletAddress)) {
        return res.status(400).json({ error: "Invalid wallet address" });
      }
      
      // SECURITY: Only migrate orders with userId="undefined" - hardcoded, not from client
      // This prevents attackers from hijacking orders by specifying custom user IDs
      const orphanUserId = "undefined";
      const orders = await storage.getPolymarketOrdersByUser(orphanUserId);
      
      let migratedCount = 0;
      for (const order of orders) {
        await storage.updatePolymarketOrder(order.id, { 
          userId: walletAddress.toLowerCase() 
        });
        migratedCount++;
      }
      
      if (migratedCount > 0) {
        console.log(`Migrated ${migratedCount} orphan orders to wallet ${walletAddress}`);
      }
      res.json({ success: true, migratedCount });
    } catch (error) {
      console.error("Failed to migrate orders:", error);
      res.status(500).json({ error: "Failed to migrate orders" });
    }
  });

  // ============ Portfolio History Routes ============

  // Save portfolio snapshot
  app.post("/api/portfolio/snapshot", async (req, res) => {
    try {
      const { insertPortfolioHistorySchema } = await import("@shared/schema");
      
      const parsed = insertPortfolioHistorySchema.safeParse({
        ...req.body,
        walletAddress: req.body.walletAddress?.toLowerCase(),
      });
      
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid snapshot data", details: parsed.error.issues });
      }

      const snapshot = await storage.savePortfolioSnapshot(parsed.data);
      res.json({ success: true, snapshot });
    } catch (error) {
      console.error("Failed to save portfolio snapshot:", error);
      res.status(500).json({ error: "Failed to save portfolio snapshot" });
    }
  });

  // Get portfolio history
  app.get("/api/portfolio/history/:walletAddress/:period", async (req, res) => {
    try {
      const { walletAddress, period } = req.params;
      const periodFilter = ["1D", "1W", "1M", "ALL"].includes(period) ? period : "1W";
      
      const history = await storage.getPortfolioHistory(
        walletAddress.toLowerCase(),
        periodFilter
      );

      res.json(history);
    } catch (error) {
      console.error("Failed to get portfolio history:", error);
      res.status(500).json({ error: "Failed to get portfolio history" });
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

  // ============ Fee Configuration Routes (Admin) ============

  // Get current fee configuration
  app.get("/api/admin/fee-config", requireAdmin, async (req, res) => {
    try {
      const feePercentage = await storage.getConfig("fee_percentage");
      const treasuryAddress = await storage.getConfig("treasury_address");
      
      res.json({
        feePercentage: feePercentage ? parseFloat(feePercentage) : 0,
        treasuryAddress: treasuryAddress || null,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get fee config" });
    }
  });

  // Update fee configuration
  app.post("/api/admin/fee-config", requireAdmin, async (req, res) => {
    try {
      const { feePercentage, treasuryAddress } = req.body;
      const adminWallet = req.headers["x-wallet-address"] as string;
      
      if (typeof feePercentage === "number") {
        if (feePercentage < 0 || feePercentage > 10) {
          return res.status(400).json({ error: "Fee percentage must be between 0 and 10" });
        }
        await storage.setConfig("fee_percentage", feePercentage.toString(), adminWallet);
      }
      
      if (treasuryAddress !== undefined) {
        await storage.setConfig("treasury_address", treasuryAddress, adminWallet);
      }
      
      res.json({ success: true, message: "Fee configuration updated" });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to update fee config" });
    }
  });

  // Public endpoint to get fee info for bet modal
  app.get("/api/fees/current", async (req, res) => {
    try {
      const feePercentage = await storage.getConfig("fee_percentage");
      const treasuryAddress = await storage.getConfig("treasury_address");
      
      res.json({
        feePercentage: feePercentage ? parseFloat(feePercentage) : 0,
        treasuryAddress: treasuryAddress || null,
        enabled: !!feePercentage && parseFloat(feePercentage) > 0,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get fee info" });
    }
  });

  // Record a fee expectation (when order is placed)
  app.post("/api/fees/record", async (req, res) => {
    try {
      const { walletAddress, orderType, marketName, tokenId, polymarketOrderId, orderAmount, feePercentage, feeAmount, txHash } = req.body;
      
      if (!walletAddress || !orderType || !orderAmount || feePercentage === undefined || !feeAmount) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      
      const fee = await storage.recordCollectedFee({
        walletAddress,
        orderType,
        marketName,
        tokenId,
        polymarketOrderId,
        orderAmount,
        feePercentage,
        feeAmount,
        txHash,
      });
      
      res.json({ success: true, feeId: fee.id });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to record fee" });
    }
  });

  // Get recent fee expectations (admin)
  app.get("/api/admin/fees/recent", requireAdmin, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const fees = await storage.getRecentFees(limit);
      res.json(fees);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get recent fees" });
    }
  });

  // Get fee expectation stats (admin)
  app.get("/api/admin/fees/stats", requireAdmin, async (req, res) => {
    try {
      const stats = await storage.getFeeExpectationStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get fee stats" });
    }
  });

  // Get treasury summary (on-chain collected fees)
  app.get("/api/admin/treasury/summary", requireAdmin, async (req, res) => {
    try {
      const summary = await storage.getTreasurySummary();
      const treasuryAddress = await storage.getConfig("treasury_address");
      res.json({ ...summary, treasuryAddress });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get treasury summary" });
    }
  });

  // Get recent treasury transfers
  app.get("/api/admin/treasury/transfers", requireAdmin, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const transfers = await storage.getTreasuryTransfers(limit);
      res.json(transfers);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get treasury transfers" });
    }
  });

  // Get reconciliation data (compare expected vs actual)
  app.get("/api/admin/fees/reconciliation", requireAdmin, async (req, res) => {
    try {
      const expectationStats = await storage.getFeeExpectationStats();
      const treasurySummary = await storage.getTreasurySummary();
      const unmatchedExpectations = await storage.getUnmatchedExpectations();
      const unmatchedTransfers = await storage.getUnmatchedTransfers();
      
      const discrepancy = expectationStats.totalExpectedFees - treasurySummary.totalCollected;
      
      res.json({
        expected: expectationStats,
        collected: treasurySummary,
        discrepancy: {
          amount: discrepancy,
          percentage: expectationStats.totalExpectedFees > 0 
            ? (discrepancy / expectationStats.totalExpectedFees * 100).toFixed(2) 
            : "0.00",
        },
        unmatched: {
          expectationCount: unmatchedExpectations.length,
          transferCount: unmatchedTransfers.length,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get reconciliation data" });
    }
  });

  // Sync treasury wallet transfers from blockchain
  app.post("/api/admin/treasury/sync", requireAdmin, async (req, res) => {
    try {
      const { syncTreasuryTransfers } = await import("./treasurySync");
      const result = await syncTreasuryTransfers();
      res.json(result);
    } catch (error: any) {
      console.error("Failed to sync treasury transfers:", error);
      res.status(500).json({ error: error.message || "Failed to sync treasury transfers" });
    }
  });

  // Get unmatched expectations (fees without corresponding treasury transfers)
  app.get("/api/admin/fees/unmatched", requireAdmin, async (req, res) => {
    try {
      const unmatched = await storage.getUnmatchedExpectations();
      res.json(unmatched);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get unmatched fees" });
    }
  });

  // Collect pending fees from a user's Safe wallet (client-initiated)
  // This is called by the client when the user has authorized fee collection
  // Uses Polymarket relayer to transfer USDC from Safe to treasury
  app.post("/api/fees/collect", async (req, res) => {
    try {
      const { safeAddress, eoaAddress } = req.body;
      
      if (!safeAddress || !eoaAddress) {
        return res.status(400).json({ error: "safeAddress and eoaAddress are required" });
      }
      
      // Get pending fees for this Safe address
      const pendingFees = await storage.getPendingFeesForWallet(safeAddress);
      
      if (!pendingFees || pendingFees.length === 0) {
        return res.json({ 
          success: true, 
          message: "No pending fees to collect",
          collected: 0,
          count: 0
        });
      }
      
      // Calculate total pending fees
      const totalPending = pendingFees.reduce((sum, fee) => sum + (fee.feeAmount || 0), 0);
      
      // Skip collection if amount is too small (less than 0.01 USDC)
      if (totalPending < 0.01) {
        console.log(`[FeeCollection] Skipping collection for ${safeAddress}: ${totalPending.toFixed(6)} USDC is below minimum threshold`);
        return res.json({
          success: true,
          message: "Fee amount below minimum threshold",
          pending: totalPending,
          count: pendingFees.length
        });
      }
      
      console.log(`[FeeCollection] Attempting to collect ${totalPending.toFixed(6)} USDC from ${safeAddress} (${pendingFees.length} orders)`);
      
      // Attempt to collect fees via Polymarket relayer
      const { collectFeesViaRelayer } = await import("./polymarket");
      const result = await collectFeesViaRelayer(safeAddress, eoaAddress, totalPending);
      
      if (result.success) {
        // Mark fees as collected
        const feeIds = pendingFees.map(f => f.id);
        await storage.markFeesCollected(feeIds, result.transactionHash || "");
        
        res.json({
          success: true,
          message: "Fees collected successfully",
          collected: totalPending,
          count: pendingFees.length,
          transactionHash: result.transactionHash
        });
      } else {
        // Relayer rejected the transfer (possibly only supports Polymarket addresses)
        console.log(`[FeeCollection] Relayer rejected fee collection: ${result.error}`);
        res.json({
          success: false,
          message: "Fee collection failed",
          error: result.error,
          pending: totalPending,
          count: pendingFees.length,
          note: "Polymarket relayer may not support transfers to non-Polymarket addresses"
        });
      }
    } catch (error: any) {
      console.error("Fee collection error:", error);
      res.status(500).json({ error: error.message || "Failed to collect fees" });
    }
  });

  // Get pending fees for a wallet
  app.get("/api/fees/pending/:safeAddress", async (req, res) => {
    try {
      const { safeAddress } = req.params;
      
      if (!safeAddress) {
        return res.status(400).json({ error: "safeAddress is required" });
      }
      
      const pendingFees = await storage.getPendingFeesForWallet(safeAddress);
      const totalPending = pendingFees.reduce((sum, fee) => sum + (fee.feeAmount || 0), 0);
      
      res.json({
        safeAddress,
        pendingFees: pendingFees.length,
        totalPending,
        fees: pendingFees
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get pending fees" });
    }
  });

  // ============ Builder Volume Routes (Admin) ============

  // Get builder volume statistics from Polymarket
  app.get("/api/admin/builder-volume", requireAdmin, async (req, res) => {
    try {
      const response = await proxyFetch("https://gamma-api.polymarket.com/builders/daily-volume");
      
      if (!response.ok) {
        throw new Error(`Polymarket API error: ${response.status}`);
      }
      
      const allBuilderData = await response.json();
      
      // Filter for our builder if we have an identifier (use first entry if none specified)
      // In practice, you'd filter by your builder ID here
      res.json({
        data: allBuilderData,
        note: "Raw builder volume data from Polymarket. Filter by your builder ID.",
      });
    } catch (error: any) {
      console.error("Failed to fetch builder volume:", error);
      res.status(500).json({ error: error.message || "Failed to fetch builder volume" });
    }
  });

  // Get builder leaderboard from Polymarket
  app.get("/api/admin/builder-leaderboard", requireAdmin, async (req, res) => {
    try {
      const response = await proxyFetch("https://gamma-api.polymarket.com/builders/leaderboard");
      
      if (!response.ok) {
        throw new Error(`Polymarket API error: ${response.status}`);
      }
      
      const leaderboard = await response.json();
      res.json(leaderboard);
    } catch (error: any) {
      console.error("Failed to fetch builder leaderboard:", error);
      res.status(500).json({ error: error.message || "Failed to fetch builder leaderboard" });
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

  // =====================================================
  // DISPLAY NAME AND COMMENTS ROUTES
  // =====================================================

  // Get user profile (display name) by wallet address
  app.get("/api/user/profile/:walletAddress", async (req, res) => {
    try {
      const { walletAddress } = req.params;
      const profile = await storage.getUserProfile(walletAddress);
      res.json(profile || { walletAddress, displayName: null });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch profile" });
    }
  });

  // Check username availability
  app.get("/api/user/check-username/:username", async (req, res) => {
    try {
      const { username } = req.params;
      const excludeWallet = req.query.excludeWallet as string | undefined;
      
      if (!username || !/^[a-zA-Z0-9_]+$/.test(username)) {
        return res.status(400).json({ error: "Invalid username format" });
      }
      
      const available = await storage.isUsernameAvailable(username, excludeWallet);
      res.json({ available, username });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to check username" });
    }
  });

  // Get Polymarket profile for a wallet
  app.get("/api/polymarket/profile/:walletAddress", async (req, res) => {
    try {
      const { walletAddress } = req.params;
      
      if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
        return res.status(400).json({ error: "Invalid wallet address format" });
      }
      
      const { getPolymarketProfile } = await import("./polymarket");
      const profile = await getPolymarketProfile(walletAddress);
      res.json(profile || { name: null, pseudonym: null });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch Polymarket profile" });
    }
  });

  // Update display name
  app.patch("/api/user/display-name", async (req, res) => {
    try {
      const { walletAddress, displayName } = req.body;
      
      if (!walletAddress) {
        return res.status(400).json({ error: "Wallet address required" });
      }
      
      if (!displayName || displayName.length < 1 || displayName.length > 30) {
        return res.status(400).json({ error: "Display name must be 1-30 characters" });
      }
      
      if (!/^[a-zA-Z0-9_]+$/.test(displayName)) {
        return res.status(400).json({ error: "Only letters, numbers, and underscores allowed" });
      }
      
      // Check if username is available
      const available = await storage.isUsernameAvailable(displayName, walletAddress);
      if (!available) {
        return res.status(409).json({ error: "Username is already taken" });
      }
      
      const updated = await storage.updateDisplayName(walletAddress, displayName);
      res.json({ success: true, displayName: updated });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to update display name" });
    }
  });

  // Get comments for a market
  app.get("/api/comments/:marketType/:marketId", async (req, res) => {
    try {
      const { marketType, marketId } = req.params;
      const comments = await storage.getMarketComments(marketType, marketId);
      res.json(comments);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch comments" });
    }
  });

  // Add a comment
  app.post("/api/comments", async (req, res) => {
    try {
      const { walletAddress, marketType, marketId, content } = req.body;
      
      // Validate wallet address format (0x followed by 40 hex chars)
      if (!walletAddress || typeof walletAddress !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
        return res.status(400).json({ error: "Valid wallet address required" });
      }
      
      // Validate market type
      const validMarketTypes = ['constructor', 'driver', 'race'];
      if (!marketType || !validMarketTypes.includes(marketType)) {
        return res.status(400).json({ error: "Invalid market type" });
      }
      
      // Validate marketId
      if (!marketId || typeof marketId !== 'string' || marketId.length === 0 || marketId.length > 100) {
        return res.status(400).json({ error: "Valid market ID required" });
      }
      
      // Validate content
      if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: "Comment content required" });
      }
      
      const trimmedContent = content.trim();
      if (trimmedContent.length === 0) {
        return res.status(400).json({ error: "Comment cannot be empty" });
      }
      
      if (trimmedContent.length > 1000) {
        return res.status(400).json({ error: "Comment too long (max 1000 characters)" });
      }
      
      // Get user's display name
      const profile = await storage.getUserProfile(walletAddress.toLowerCase());
      const displayName = profile?.displayName || null;
      
      const comment = await storage.createComment({
        walletAddress: walletAddress.toLowerCase(),
        marketType,
        marketId,
        content: trimmedContent,
        displayName,
      });
      
      res.json(comment);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to create comment" });
    }
  });

  // =====================================================
  // ARTICLES ENDPOINTS - F1 News
  // =====================================================

  // Get published articles (public)
  app.get("/api/articles", async (req, res) => {
    try {
      const articles = await storage.getArticles("published");
      res.json(articles);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch articles" });
    }
  });

  // Get article by slug (public)
  app.get("/api/articles/slug/:slug", async (req, res) => {
    try {
      const { slug } = req.params;
      const article = await storage.getArticleBySlug(slug);
      
      if (!article) {
        return res.status(404).json({ error: "Article not found" });
      }
      
      if (article.status !== "published") {
        return res.status(404).json({ error: "Article not found" });
      }
      
      res.json(article);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch article" });
    }
  });

  // Admin: Get all articles (including drafts)
  app.get("/api/admin/articles", async (req, res) => {
    try {
      const { status } = req.query;
      const articles = await storage.getArticles(status as string | undefined);
      res.json(articles);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch articles" });
    }
  });

  // Admin: Get single article by ID
  app.get("/api/admin/articles/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const article = await storage.getArticle(id);
      
      if (!article) {
        return res.status(404).json({ error: "Article not found" });
      }
      
      res.json(article);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch article" });
    }
  });

  // Admin: Create new article
  app.post("/api/admin/articles", async (req, res) => {
    try {
      const { createArticleSchema } = await import("@shared/schema");
      const validatedData = createArticleSchema.parse(req.body);
      
      const article = await storage.createArticle({
        ...validatedData,
        slug: "", // Will be auto-generated
        status: "draft",
      });
      
      res.status(201).json(article);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ error: "Invalid article data", details: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to create article" });
    }
  });

  // Admin: Update article
  app.patch("/api/admin/articles/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { updateArticleSchema } = await import("@shared/schema");
      const validatedData = updateArticleSchema.parse(req.body);
      
      const article = await storage.updateArticle(id, validatedData);
      
      if (!article) {
        return res.status(404).json({ error: "Article not found" });
      }
      
      res.json(article);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ error: "Invalid article data", details: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to update article" });
    }
  });

  // Admin: Publish article
  app.post("/api/admin/articles/:id/publish", async (req, res) => {
    try {
      const { id } = req.params;
      const article = await storage.publishArticle(id);
      
      if (!article) {
        return res.status(404).json({ error: "Article not found" });
      }
      
      res.json(article);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to publish article" });
    }
  });

  // Admin: Delete article
  app.delete("/api/admin/articles/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteArticle(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to delete article" });
    }
  });

  // Admin: Generate AI article
  app.post("/api/admin/articles/generate", requireAdmin, async (req, res) => {
    try {
      const { topic } = req.body;
      const { generateAndSaveArticle, F1_TOPICS } = await import("./articleGenerator");
      
      const result = await generateAndSaveArticle(topic);
      res.json({
        success: true,
        article: result,
        availableTopics: F1_TOPICS,
      });
    } catch (error: any) {
      console.error("Failed to generate AI article:", error);
      res.status(500).json({ error: error.message || "Failed to generate article" });
    }
  });

  // Admin: Generate multiple AI articles
  app.post("/api/admin/articles/generate-batch", requireAdmin, async (req, res) => {
    try {
      const { count = 3 } = req.body;
      const { generateMultipleArticles } = await import("./articleGenerator");
      
      const results = await generateMultipleArticles(Math.min(count, 5));
      res.json({
        success: true,
        articles: results,
        generated: results.length,
      });
    } catch (error: any) {
      console.error("Failed to generate AI articles batch:", error);
      res.status(500).json({ error: error.message || "Failed to generate articles" });
    }
  });

  // Admin: Get available article topics (public - topics list isn't sensitive)
  app.get("/api/admin/articles/topics", async (req, res) => {
    try {
      const { F1_TOPICS } = await import("./articleGenerator");
      res.json({ topics: F1_TOPICS });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get topics" });
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
