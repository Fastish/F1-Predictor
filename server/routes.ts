import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { buySharesSchema, sellSharesSchema, insertUserSchema, depositRequestSchema } from "@shared/schema";
import { z } from "zod";
import { 
  validateStellarAddress, 
  getUSDCBalance, 
  accountExists, 
  hasUSDCTrustline,
  getRecentUSDCPayments,
  generateDepositMemo,
  USE_TESTNET,
  USDC_ISSUER
} from "./stellar";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Seed teams on startup
  await storage.seedTeams();

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

  // Get prize pool
  app.get("/api/market/prize-pool", async (req, res) => {
    try {
      const prizePool = await storage.getPrizePool();
      res.json({ prizePool });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch prize pool" });
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
      const parsed = buySharesSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
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
      const parsed = sellSharesSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }

      const result = await storage.sellShares(parsed.data);
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

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

  // Add demo credits (testing only - gives user demo funds)
  // This simulates a faucet for the demo environment with per-user limits
  const DEMO_CREDIT_LIMIT_PER_USER = 5000; // Maximum total demo credits per user
  
  app.post("/api/demo/add-credits", async (req, res) => {
    try {
      const { userId, amount } = req.body;
      
      // Strict validation
      if (!userId || typeof userId !== "string") {
        return res.status(400).json({ error: "Invalid userId" });
      }
      
      const creditAmount = Number(amount);
      if (isNaN(creditAmount) || creditAmount <= 0 || creditAmount > 1000) {
        return res.status(400).json({ error: "Amount must be between 1 and 1000" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Check total demo credits already claimed by this user
      const existingDeposits = await storage.getDepositsByUser(userId);
      const totalDemoCredits = existingDeposits
        .filter(d => d.fromAddress === "demo_faucet")
        .reduce((sum, d) => sum + d.amount, 0);
      
      if (totalDemoCredits + creditAmount > DEMO_CREDIT_LIMIT_PER_USER) {
        const remaining = Math.max(0, DEMO_CREDIT_LIMIT_PER_USER - totalDemoCredits);
        return res.status(400).json({ 
          error: `Demo credit limit reached. You can claim up to $${remaining.toFixed(2)} more.`,
          remaining 
        });
      }

      // Create a demo deposit record (clearly marked as demo)
      const deposit = await storage.createDeposit({
        userId,
        amount: creditAmount,
        status: "confirmed",
        stellarTxHash: `demo_faucet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        fromAddress: "demo_faucet",
      });

      await storage.updateUserBalance(userId, user.balance + creditAmount);

      res.json({ 
        success: true, 
        deposit,
        newBalance: user.balance + creditAmount,
        message: "Demo credits added successfully",
        remainingLimit: DEMO_CREDIT_LIMIT_PER_USER - totalDemoCredits - creditAmount
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to add demo credits" });
    }
  });

  return httpServer;
}
