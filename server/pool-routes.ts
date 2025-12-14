/**
 * Pool Routes - LMSR Championship Pool API Endpoints
 * 
 * Handles all operations for unified championship pools using LMSR pricing.
 */

import type { Express } from "express";
import { storage } from "./storage";
import { poolBuySchema } from "@shared/schema";
import { 
  getCostForShares, 
  getPrice, 
  getPrices, 
  getPoolPrices,
  validateBuyOrder 
} from "./lmsr";
import { 
  getUSDCBalance, 
  buildUSDCPaymentTransaction, 
  verifySignedTransaction, 
  submitSignedTransaction,
  sendUSDCPayment,
  hasUSDCTrustline,
  getPlatformAddress
} from "./stellar";
import { randomBytes } from "crypto";

// In-memory store for pending pool buy transaction expectations
interface PendingPoolTransaction {
  userId: string;
  walletAddress: string;
  collateralAmount: number;
  buyDetails: {
    poolId: string;
    outcomeId: string;
    shares: number;
  };
  createdAt: number;
}

const pendingPoolTransactions = new Map<string, PendingPoolTransaction>();

// Clean up expired transactions (older than 5 minutes)
function cleanupExpiredPoolTransactions() {
  const now = Date.now();
  const expirationMs = 5 * 60 * 1000;
  const entries = Array.from(pendingPoolTransactions.entries());
  for (const [nonce, tx] of entries) {
    if (now - tx.createdAt > expirationMs) {
      pendingPoolTransactions.delete(nonce);
    }
  }
}

// Run cleanup every minute
setInterval(cleanupExpiredPoolTransactions, 60 * 1000);

export function registerPoolRoutes(app: Express): void {
  // Get all championship pools
  app.get("/api/pools", async (req, res) => {
    try {
      const pools = await storage.getChampionshipPools();
      res.json(pools);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch pools" });
    }
  });

  // Get pool by ID with outcomes and LMSR prices
  app.get("/api/pools/:poolId", async (req, res) => {
    try {
      const pool = await storage.getChampionshipPool(req.params.poolId);
      if (!pool) {
        return res.status(404).json({ error: "Pool not found" });
      }

      const outcomes = await storage.getChampionshipOutcomes(pool.id);
      const shares = outcomes.map(o => o.sharesOutstanding);
      const prices = getPrices(shares, pool.bParameter);

      // Enrich outcomes with prices
      const outcomesWithPrices = outcomes.map((outcome, index) => ({
        ...outcome,
        price: prices[index],
        probability: prices[index],
      }));

      res.json({
        ...pool,
        outcomes: outcomesWithPrices,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch pool" });
    }
  });

  // Get pool by type for current season
  app.get("/api/pools/type/:type", async (req, res) => {
    try {
      const type = req.params.type as 'team' | 'driver';
      if (type !== 'team' && type !== 'driver') {
        return res.status(400).json({ error: "Type must be 'team' or 'driver'" });
      }

      const season = await storage.getCurrentSeason();
      if (!season) {
        return res.status(404).json({ error: "No active season" });
      }

      const pool = await storage.getChampionshipPoolByType(season.id, type);
      if (!pool) {
        return res.status(404).json({ error: "Pool not found for this season" });
      }

      const outcomes = await storage.getChampionshipOutcomes(pool.id);
      const shares = outcomes.map(o => o.sharesOutstanding);
      const prices = getPrices(shares, pool.bParameter);

      const outcomesWithPrices = outcomes.map((outcome, index) => ({
        ...outcome,
        price: prices[index],
        probability: prices[index],
      }));

      res.json({
        ...pool,
        outcomes: outcomesWithPrices,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch pool" });
    }
  });

  // Get outcomes with prices for a pool
  app.get("/api/pools/:poolId/outcomes", async (req, res) => {
    try {
      const pool = await storage.getChampionshipPool(req.params.poolId);
      if (!pool) {
        return res.status(404).json({ error: "Pool not found" });
      }

      const outcomes = await storage.getChampionshipOutcomes(pool.id);
      const shares = outcomes.map(o => o.sharesOutstanding);
      const prices = getPrices(shares, pool.bParameter);

      const outcomesWithPrices = outcomes.map((outcome, index) => ({
        ...outcome,
        price: prices[index],
        probability: prices[index],
      }));

      res.json(outcomesWithPrices);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch outcomes" });
    }
  });

  // Get price quote for buying shares
  app.get("/api/pools/:poolId/quote", async (req, res) => {
    try {
      const { outcomeId, shares } = req.query;
      
      if (!outcomeId || !shares) {
        return res.status(400).json({ error: "Missing outcomeId or shares parameter" });
      }

      const pool = await storage.getChampionshipPool(req.params.poolId);
      if (!pool) {
        return res.status(404).json({ error: "Pool not found" });
      }

      const outcomes = await storage.getChampionshipOutcomes(pool.id);
      const outcomeIndex = outcomes.findIndex(o => o.id === outcomeId);
      
      if (outcomeIndex === -1) {
        return res.status(404).json({ error: "Outcome not found" });
      }

      const currentShares = outcomes.map(o => o.sharesOutstanding);
      const sharesAmount = parseFloat(shares as string);
      
      const cost = getCostForShares(currentShares, pool.bParameter, outcomeIndex, sharesAmount);
      const currentPrice = getPrice(currentShares, pool.bParameter, outcomeIndex);
      
      // Calculate new price after purchase
      const newShares = [...currentShares];
      newShares[outcomeIndex] += sharesAmount;
      const newPrice = getPrice(newShares, pool.bParameter, outcomeIndex);

      res.json({
        outcomeId,
        shares: sharesAmount,
        cost,
        averagePrice: cost / sharesAmount,
        currentPrice,
        newPrice,
        priceImpact: newPrice - currentPrice,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get quote" });
    }
  });

  // Build unsigned transaction for pool buy
  app.post("/api/pools/:poolId/build-transaction", async (req, res) => {
    try {
      const { outcomeId, userId, shares } = req.body;
      
      if (!outcomeId || !userId || !shares) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const pool = await storage.getChampionshipPool(req.params.poolId);
      if (!pool) {
        return res.status(404).json({ error: "Pool not found" });
      }

      if (pool.status !== "active") {
        return res.status(403).json({ error: "Pool is not active" });
      }

      // Get user's wallet address
      const user = await storage.getUser(userId);
      if (!user?.walletAddress) {
        return res.status(400).json({ error: "Wallet not connected" });
      }

      // Get outcomes and calculate cost
      const outcomes = await storage.getChampionshipOutcomes(pool.id);
      const outcomeIndex = outcomes.findIndex(o => o.id === outcomeId);
      
      if (outcomeIndex === -1) {
        return res.status(404).json({ error: "Outcome not found" });
      }

      const currentShares = outcomes.map(o => o.sharesOutstanding);
      const cost = getCostForShares(currentShares, pool.bParameter, outcomeIndex, shares);

      if (cost <= 0) {
        return res.status(400).json({ error: "Invalid share amount" });
      }

      // Verify user has enough USDC
      const usdcBalance = await getUSDCBalance(user.walletAddress);
      if (parseFloat(usdcBalance) < cost) {
        return res.status(400).json({ 
          error: `Insufficient USDC. Need $${cost.toFixed(2)}, have $${parseFloat(usdcBalance).toFixed(2)}` 
        });
      }

      // Build unsigned transaction
      const txResult = await buildUSDCPaymentTransaction(
        user.walletAddress,
        cost.toFixed(7),
        `pool:${pool.id.slice(0, 15)}`
      );

      if (!txResult.success) {
        return res.status(500).json({ error: txResult.error });
      }

      // Generate secure nonce
      const nonce = randomBytes(16).toString("hex");
      pendingPoolTransactions.set(nonce, {
        userId,
        walletAddress: user.walletAddress,
        collateralAmount: cost,
        buyDetails: { 
          poolId: pool.id, 
          outcomeId, 
          shares 
        },
        createdAt: Date.now(),
      });

      res.json({
        nonce,
        xdr: txResult.xdr,
        networkPassphrase: txResult.networkPassphrase,
        collateralAmount: cost,
        shares,
        currentPrice: getPrice(currentShares, pool.bParameter, outcomeIndex),
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to build transaction" });
    }
  });

  // Submit signed transaction and execute pool buy
  app.post("/api/pools/submit-signed", async (req, res) => {
    try {
      const { signedXdr, nonce } = req.body;
      
      if (!signedXdr || !nonce) {
        return res.status(400).json({ error: "Missing signed transaction or nonce" });
      }

      const pending = pendingPoolTransactions.get(nonce);
      if (!pending) {
        return res.status(400).json({ 
          error: "Invalid or expired transaction. Please start a new order." 
        });
      }

      // Delete immediately (single-use nonce)
      pendingPoolTransactions.delete(nonce);

      // Check expiration
      if (Date.now() - pending.createdAt > 5 * 60 * 1000) {
        return res.status(400).json({ 
          error: "Transaction expired. Please start a new order." 
        });
      }

      // Verify signed transaction
      const verification = verifySignedTransaction(
        signedXdr,
        pending.walletAddress,
        pending.collateralAmount.toFixed(7)
      );

      if (!verification.valid) {
        return res.status(400).json({ 
          error: `Transaction verification failed: ${verification.error}` 
        });
      }

      // Submit to Stellar
      const submitResult = await submitSignedTransaction(signedXdr);
      
      if (!submitResult.success) {
        return res.status(400).json({ error: submitResult.error });
      }

      // Execute the pool buy
      const { poolId, outcomeId, shares } = pending.buyDetails;
      
      const pool = await storage.getChampionshipPool(poolId);
      if (!pool) {
        return res.status(400).json({ error: "Pool not found" });
      }

      const outcomes = await storage.getChampionshipOutcomes(pool.id);
      const outcomeIndex = outcomes.findIndex(o => o.id === outcomeId);
      const currentShares = outcomes.map(o => o.sharesOutstanding);
      const priceAtTrade = getPrice(currentShares, pool.bParameter, outcomeIndex);

      // Update outcome shares
      await storage.updateOutcomeShares(outcomeId, shares);

      // Update pool collateral
      await storage.updatePoolCollateral(poolId, pending.collateralAmount);

      // Record the trade
      const trade = await storage.createPoolTrade({
        poolId,
        outcomeId,
        userId: pending.userId,
        sharesAmount: shares,
        collateralCost: pending.collateralAmount,
        priceAtTrade,
      });

      // Update user's position
      await storage.upsertPoolPosition({
        poolId,
        outcomeId,
        userId: pending.userId,
        sharesOwned: shares,
        totalCost: pending.collateralAmount,
      });

      res.json({
        success: true,
        trade,
        transactionHash: submitResult.transactionHash,
        shares,
        cost: pending.collateralAmount,
        priceAtTrade,
        message: "Shares purchased successfully"
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to submit order" });
    }
  });

  // Demo buy endpoint - allows purchasing shares using demo credits (no real USDC required)
  app.post("/api/pools/:poolId/demo-buy", async (req, res) => {
    try {
      const { poolId } = req.params;
      const { outcomeId, userId, shares } = req.body;

      if (!outcomeId || !userId || !shares || shares <= 0) {
        return res.status(400).json({ error: "Missing or invalid required fields" });
      }

      const pool = await storage.getChampionshipPool(poolId);
      if (!pool) {
        return res.status(404).json({ error: "Pool not found" });
      }

      if (pool.status !== "active") {
        return res.status(403).json({ error: "Pool is not active" });
      }

      // Get user and check demo credit balance
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Get outcomes and calculate cost
      const outcomes = await storage.getChampionshipOutcomes(pool.id);
      const outcomeIndex = outcomes.findIndex(o => o.id === outcomeId);
      
      if (outcomeIndex === -1) {
        return res.status(404).json({ error: "Outcome not found" });
      }

      const currentShares = outcomes.map(o => o.sharesOutstanding);
      const cost = getCostForShares(currentShares, pool.bParameter, outcomeIndex, shares);

      if (cost <= 0) {
        return res.status(400).json({ error: "Invalid share amount" });
      }

      // Check if user has enough demo credits (stored in balance field)
      if (user.balance < cost) {
        return res.status(400).json({ 
          error: `Insufficient demo credits. Need $${cost.toFixed(2)}, have $${user.balance.toFixed(2)}` 
        });
      }

      // Deduct demo credits from user balance
      await storage.updateUserBalance(userId, user.balance - cost);

      // Update outcome shares outstanding (pass delta, not total)
      await storage.updateOutcomeShares(outcomeId, shares);

      // Update pool total collateral (pass delta, not total)
      await storage.updatePoolCollateral(poolId, cost);

      // Get updated price after purchase
      const newShares = [...currentShares];
      newShares[outcomeIndex] += shares;
      const priceAtTrade = getPrice(newShares, pool.bParameter, outcomeIndex);

      // Record the trade
      const trade = await storage.createPoolTrade({
        poolId,
        outcomeId,
        userId,
        sharesAmount: shares,
        collateralCost: cost,
        priceAtTrade,
      });

      // Update user's position
      await storage.upsertPoolPosition({
        poolId,
        outcomeId,
        userId,
        sharesOwned: shares,
        totalCost: cost,
      });

      res.json({
        success: true,
        trade,
        shares,
        cost,
        priceAtTrade,
        newBalance: user.balance - cost,
        message: "Demo shares purchased successfully"
      });
    } catch (error: any) {
      console.error("Demo buy error:", error);
      res.status(400).json({ error: error.message || "Failed to complete demo purchase" });
    }
  });

  // Get user's pool positions
  app.get("/api/pools/positions/:userId", async (req, res) => {
    try {
      const positions = await storage.getPoolPositionsByUser(req.params.userId);
      
      // Enrich with current prices and potential payouts
      const enrichedPositions = await Promise.all(positions.map(async (position) => {
        const pool = await storage.getChampionshipPool(position.poolId);
        if (!pool) return position;

        const outcomes = await storage.getChampionshipOutcomes(pool.id);
        const outcomeIndex = outcomes.findIndex(o => o.id === position.outcomeId);
        
        if (outcomeIndex === -1) return position;

        const currentShares = outcomes.map(o => o.sharesOutstanding);
        const currentPrice = getPrice(currentShares, pool.bParameter, outcomeIndex);
        const currentValue = position.sharesOwned * currentPrice;
        const pnl = currentValue - position.totalCost;

        // Calculate potential payout if this outcome wins
        const outcome = outcomes[outcomeIndex];
        const potentialPayout = outcome.sharesOutstanding > 0 
          ? (position.sharesOwned / outcome.sharesOutstanding) * pool.totalCollateral
          : 0;

        return {
          ...position,
          currentPrice,
          currentValue,
          pnl,
          potentialPayout,
          poolType: pool.type,
          poolStatus: pool.status,
        };
      }));

      res.json(enrichedPositions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch positions" });
    }
  });

  // Get user's pool trades history
  app.get("/api/pools/trades/:userId", async (req, res) => {
    try {
      const trades = await storage.getPoolTradesByUser(req.params.userId);
      res.json(trades);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch trades" });
    }
  });

  // Initialize pools for a season (admin endpoint)
  app.post("/api/pools/initialize/:seasonId", async (req, res) => {
    try {
      const { seasonId } = req.params;
      
      const season = await storage.getCurrentSeason();
      if (!season || season.id !== seasonId) {
        return res.status(400).json({ error: "Invalid season ID" });
      }

      // Check if pools already exist
      const existingTeamPool = await storage.getChampionshipPoolByType(seasonId, 'team');
      const existingDriverPool = await storage.getChampionshipPoolByType(seasonId, 'driver');
      
      if (existingTeamPool || existingDriverPool) {
        return res.status(400).json({ error: "Pools already exist for this season" });
      }

      const { teamPool, driverPool } = await storage.initializePoolsForSeason(seasonId);

      res.json({
        success: true,
        teamPool,
        driverPool,
        message: "Championship pools initialized successfully"
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to initialize pools" });
    }
  });

  // Conclude a pool and declare winning outcome (admin endpoint)
  app.post("/api/pools/:poolId/conclude", async (req, res) => {
    try {
      const { poolId } = req.params;
      const { winningOutcomeId } = req.body;

      if (!winningOutcomeId) {
        return res.status(400).json({ error: "Missing winningOutcomeId" });
      }

      const pool = await storage.getChampionshipPool(poolId);
      if (!pool) {
        return res.status(404).json({ error: "Pool not found" });
      }

      if (pool.status === "concluded") {
        return res.status(400).json({ error: "Pool already concluded" });
      }

      // Verify the outcome exists and belongs to this pool
      const outcome = await storage.getChampionshipOutcome(winningOutcomeId);
      if (!outcome || outcome.poolId !== poolId) {
        return res.status(400).json({ error: "Invalid winning outcome for this pool" });
      }

      const updatedPool = await storage.concludePool(poolId, winningOutcomeId);

      res.json({
        success: true,
        pool: updatedPool,
        message: `Pool concluded with winning outcome: ${outcome.participantId}`
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to conclude pool" });
    }
  });

  // Calculate payouts for a concluded pool (admin endpoint)
  app.post("/api/pools/:poolId/calculate-payouts", async (req, res) => {
    try {
      const { poolId } = req.params;

      const pool = await storage.getChampionshipPool(poolId);
      if (!pool) {
        return res.status(404).json({ error: "Pool not found" });
      }

      if (pool.status !== "concluded" || !pool.winningOutcomeId) {
        return res.status(400).json({ error: "Pool must be concluded with a winning outcome first" });
      }

      // Check if payouts already exist
      const existingPayouts = await storage.getPoolPayoutsByPool(poolId);
      if (existingPayouts.length > 0) {
        return res.status(400).json({ error: "Payouts already calculated for this pool" });
      }

      // Get all positions for the winning outcome
      const winningPositions = await storage.getPoolPositionsByOutcome(pool.winningOutcomeId);

      if (winningPositions.length === 0) {
        return res.json({
          success: true,
          payouts: [],
          message: "No shareholders in winning outcome - no payouts to distribute"
        });
      }

      // Calculate total shares held in winning outcome
      const totalWinningShares = winningPositions.reduce((sum, p) => sum + p.sharesOwned, 0);
      const prizePool = pool.totalCollateral;

      // Create payout records for each winner
      const payouts = [];
      for (const position of winningPositions) {
        const sharePercentage = position.sharesOwned / totalWinningShares;
        const payoutAmount = sharePercentage * prizePool;

        const payout = await storage.createPoolPayout({
          poolId,
          outcomeId: pool.winningOutcomeId,
          userId: position.userId,
          sharesHeld: position.sharesOwned,
          sharePercentage,
          payoutAmount,
          status: "pending",
        });
        payouts.push(payout);
      }

      res.json({
        success: true,
        payouts,
        totalPrizePool: prizePool,
        totalWinningShares,
        winnersCount: payouts.length,
        message: `Calculated payouts for ${payouts.length} winners`
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to calculate payouts" });
    }
  });

  // Distribute payouts via Stellar USDC (admin endpoint)
  app.post("/api/pools/:poolId/distribute-payouts", async (req, res) => {
    try {
      const { poolId } = req.params;

      const pool = await storage.getChampionshipPool(poolId);
      if (!pool) {
        return res.status(404).json({ error: "Pool not found" });
      }

      if (pool.status !== "concluded") {
        return res.status(400).json({ error: "Pool must be concluded first" });
      }

      const payouts = await storage.getPoolPayoutsByPool(poolId);
      const pendingPayouts = payouts.filter(p => p.status === "pending");

      if (pendingPayouts.length === 0) {
        return res.status(400).json({ error: "No pending payouts to distribute" });
      }

      // Pre-flight check: Verify platform wallet has enough USDC
      const platformAddress = getPlatformAddress();
      if (!platformAddress) {
        return res.status(500).json({ error: "Platform wallet not configured" });
      }

      const totalPayoutAmount = pendingPayouts.reduce((sum, p) => sum + p.payoutAmount, 0);
      const platformBalance = await getUSDCBalance(platformAddress);
      const platformUSDC = parseFloat(platformBalance);

      if (platformUSDC < totalPayoutAmount) {
        return res.status(400).json({ 
          error: `Insufficient platform USDC. Need $${totalPayoutAmount.toFixed(2)}, have $${platformUSDC.toFixed(2)}` 
        });
      }

      // Pre-flight check: Verify all recipients have valid wallets and trustlines
      const preFlightResults = [];
      for (const payout of pendingPayouts) {
        const user = await storage.getUser(payout.userId);
        
        if (!user?.walletAddress) {
          preFlightResults.push({
            payoutId: payout.id,
            userId: payout.userId,
            valid: false,
            error: "User has no linked wallet"
          });
          continue;
        }

        const hasTrustline = await hasUSDCTrustline(user.walletAddress);
        if (!hasTrustline) {
          preFlightResults.push({
            payoutId: payout.id,
            userId: payout.userId,
            valid: false,
            error: "User wallet does not have USDC trustline"
          });
          continue;
        }

        preFlightResults.push({
          payoutId: payout.id,
          userId: payout.userId,
          walletAddress: user.walletAddress,
          valid: true
        });
      }

      // Report pre-flight failures but continue with valid payouts
      const validPayouts = preFlightResults.filter(p => p.valid);
      const invalidPayouts = preFlightResults.filter(p => !p.valid);

      // Mark invalid payouts as failed
      for (const invalid of invalidPayouts) {
        await storage.updatePoolPayoutStatus(invalid.payoutId, "failed");
      }

      if (validPayouts.length === 0) {
        return res.status(400).json({ 
          error: "No valid payouts to distribute",
          failures: invalidPayouts.map(p => ({ payoutId: p.payoutId, error: p.error }))
        });
      }

      const results = [];
      let successCount = 0;
      let failCount = invalidPayouts.length;

      // Process valid payouts
      for (const validPayout of validPayouts) {
        const payout = pendingPayouts.find(p => p.id === validPayout.payoutId)!;
        
        // Send USDC payment
        const transferResult = await sendUSDCPayment(
          validPayout.walletAddress!,
          payout.payoutAmount.toFixed(7),
          `payout:${poolId.slice(0, 14)}`
        );

        if (transferResult.success) {
          await storage.updatePoolPayoutStatus(payout.id, "sent", transferResult.transactionHash);
          results.push({
            payoutId: payout.id,
            userId: payout.userId,
            success: true,
            amount: payout.payoutAmount,
            transactionHash: transferResult.transactionHash
          });
          successCount++;
        } else {
          await storage.updatePoolPayoutStatus(payout.id, "failed");
          results.push({
            payoutId: payout.id,
            userId: payout.userId,
            success: false,
            error: transferResult.error
          });
          failCount++;
        }
      }

      // Add pre-flight failures to results
      for (const invalid of invalidPayouts) {
        results.push({
          payoutId: invalid.payoutId,
          userId: invalid.userId,
          success: false,
          error: invalid.error
        });
      }

      res.json({
        success: true,
        results,
        summary: {
          total: pendingPayouts.length,
          successful: successCount,
          failed: failCount
        },
        message: `Distributed ${successCount} payouts, ${failCount} failed`
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to distribute payouts" });
    }
  });

  // Get payouts for a pool
  app.get("/api/pools/:poolId/payouts", async (req, res) => {
    try {
      const payouts = await storage.getPoolPayoutsByPool(req.params.poolId);
      res.json(payouts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch payouts" });
    }
  });

  // Get user's payouts across all pools
  app.get("/api/pools/payouts/user/:userId", async (req, res) => {
    try {
      const payouts = await storage.getPoolPayoutsByUser(req.params.userId);
      res.json(payouts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user payouts" });
    }
  });
}
