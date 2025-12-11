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

  return httpServer;
}
