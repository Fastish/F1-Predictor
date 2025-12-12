import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { buySharesSchema, sellSharesSchema, insertUserSchema, depositRequestSchema, placeOrderSchema, cancelOrderSchema } from "@shared/schema";
import { z } from "zod";
import { 
  validateStellarAddress, 
  getUSDCBalance, 
  accountExists, 
  hasUSDCTrustline,
  getRecentUSDCPayments,
  generateDepositMemo,
  sendUSDCPayment,
  USE_TESTNET,
  USDC_ISSUER
} from "./stellar";
import { matchingEngine } from "./matchingEngine";
import { marketMaker } from "./marketMaker";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Seed teams on startup
  await storage.seedTeams();
  
  // Record initial price snapshots if no history exists
  const existingHistory = await storage.getPriceHistory(undefined, 1);
  if (existingHistory.length === 0) {
    await storage.recordAllTeamPrices();
    console.log("Seeded initial price history snapshots");
  }

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
      
      // Validate the wallet address format
      const isValid = await validateStellarAddress(walletAddress);
      if (!isValid) {
        return res.status(400).json({ error: "Invalid Stellar wallet address format" });
      }
      
      // Verify account exists on Stellar network
      const exists = await accountExists(walletAddress);
      if (!exists) {
        return res.status(400).json({ error: "Stellar account does not exist. Please fund your wallet first." });
      }
      
      // Verify account has USDC trustline
      const hasTrustline = await hasUSDCTrustline(walletAddress);
      if (!hasTrustline) {
        return res.status(400).json({ error: "Wallet does not have USDC trustline. Please add USDC trustline in your wallet." });
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

  // ============ Stellar/USDC Routes ============

  // Get Stellar network info
  app.get("/api/stellar/info", async (req, res) => {
    res.json({
      network: USE_TESTNET ? "testnet" : "mainnet",
      usdcIssuer: USDC_ISSUER,
      depositAddress: process.env.STELLAR_DEPOSIT_ADDRESS || "Not configured",
    });
  });

  // Validate a Stellar address
  app.post("/api/stellar/validate-address", async (req, res) => {
    try {
      const { address } = req.body;
      if (!address) {
        return res.status(400).json({ error: "Address is required" });
      }
      
      const isValid = await validateStellarAddress(address);
      if (!isValid) {
        return res.json({ valid: false, reason: "Invalid Stellar address format" });
      }

      const exists = await accountExists(address);
      if (!exists) {
        return res.json({ valid: false, reason: "Account does not exist on Stellar network" });
      }

      const hasTrustline = await hasUSDCTrustline(address);
      
      res.json({ 
        valid: true, 
        exists,
        hasTrustline,
        warning: !hasTrustline ? "Account does not have USDC trustline" : undefined
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to validate address" });
    }
  });

  // Get USDC balance for an address
  app.get("/api/stellar/balance/:address", async (req, res) => {
    try {
      const { address } = req.params;
      const isValid = await validateStellarAddress(address);
      if (!isValid) {
        return res.status(400).json({ error: "Invalid Stellar address" });
      }

      const balance = await getUSDCBalance(address);
      res.json({ address, balance, asset: "USDC" });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch balance" });
    }
  });

  // Get deposit info for a user
  app.get("/api/users/:userId/deposit-info", async (req, res) => {
    try {
      const user = await storage.getUser(req.params.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const depositAddress = process.env.STELLAR_DEPOSIT_ADDRESS;
      const memo = generateDepositMemo(user.id);

      res.json({
        depositAddress,
        memo,
        network: USE_TESTNET ? "testnet" : "mainnet",
        usdcIssuer: USDC_ISSUER,
        instructions: depositAddress 
          ? `Send USDC to ${depositAddress} with memo: ${memo}`
          : "Deposit address not configured. Contact support.",
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

  // ============ CLOB (Central Limit Order Book) Routes ============

  // Get all markets
  app.get("/api/clob/markets", async (req, res) => {
    try {
      const markets = await storage.getMarkets();
      res.json(markets);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch markets" });
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

  // Place an order
  app.post("/api/clob/orders", async (req, res) => {
    try {
      const parsed = placeOrderSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid order data", details: parsed.error.errors });
      }

      const { marketId, userId, outcome, side, price, quantity } = parsed.data;
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

  // ============ Admin Authentication ============

  // Helper to check if wallet is admin
  function isAdminWallet(walletAddress: string | undefined): boolean {
    if (!walletAddress) return false;
    const adminAddresses = (process.env.ADMIN_WALLET_ADDRESSES || "").split(",").map(a => a.trim());
    return adminAddresses.includes(walletAddress);
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
      
      res.json({ ...season, markets });
    } catch (error) {
      res.status(500).json({ error: "Failed to create season" });
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

      // Get current prize pool
      const prizePool = await storage.getPrizePool();

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

      // Get all holders of the winning team
      const holders = await storage.getHoldersOfTeam(currentSeason.winningTeamId);
      if (holders.length === 0) {
        return res.json({ success: true, message: "No holders of winning team", payouts: [] });
      }

      // Calculate total shares held
      const totalShares = holders.reduce((sum, h) => sum + h.shares, 0);

      // Create payout records for each holder
      const payouts = [];
      for (const holder of holders) {
        const sharePercentage = holder.shares / totalShares;
        const payoutAmount = currentSeason.prizePool * sharePercentage;

        const payout = await storage.createPayout({
          seasonId: currentSeason.id,
          userId: holder.userId,
          teamId: currentSeason.winningTeamId,
          sharesHeld: holder.shares,
          sharePercentage,
          payoutAmount,
          status: "pending",
        });
        payouts.push({ ...payout, walletAddress: holder.walletAddress });
      }

      res.json({ 
        success: true, 
        totalShares,
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

        // Send USDC payment
        const transferResult = await sendUSDCPayment(
          user.walletAddress,
          payout.payoutAmount.toFixed(7),
          `F1 Predict Payout`
        );

        if (transferResult.success) {
          await storage.updatePayoutStatus(payout.id, "sent", transferResult.transactionHash);
          results.push({
            payoutId: payout.id,
            userId: payout.userId,
            walletAddress: user.walletAddress,
            amount: payout.payoutAmount,
            success: true,
            transactionHash: transferResult.transactionHash,
          });
        } else {
          await storage.updatePayoutStatus(payout.id, "failed");
          results.push({
            payoutId: payout.id,
            userId: payout.userId,
            success: false,
            error: transferResult.error,
          });
        }
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

  return httpServer;
}
