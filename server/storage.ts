import { 
  users, teams, drivers, holdings, transactions, deposits, priceHistory, seasons, payouts, markets, orderFills,
  championshipPools, championshipOutcomes, poolTrades, poolPositions, poolPayouts, zkProofs, poolPriceHistory,
  raceMarkets, raceMarketOutcomes, polymarketOrders, portfolioHistory, platformConfig, collectedFees, treasuryFeeTransfers, marketComments, articles,
  type User, type InsertUser, 
  type Team, type InsertTeam,
  type Driver, type InsertDriver,
  type Holding, type InsertHolding,
  type Transaction, type InsertTransaction,
  type Deposit, type InsertDeposit,
  type PriceHistory, type InsertPriceHistory,
  type Season, type InsertSeason,
  type Payout, type InsertPayout,
  type Market, type InsertMarket,
  type ChampionshipPool, type InsertChampionshipPool,
  type ChampionshipOutcome, type InsertChampionshipOutcome,
  type PoolTrade, type InsertPoolTrade,
  type PoolPosition, type InsertPoolPosition,
  type PoolPayout, type InsertPoolPayout,
  type ZkProof, type InsertZkProof,
  type PoolPriceHistory, type InsertPoolPriceHistory,
  type RaceMarket, type InsertRaceMarket,
  type RaceMarketOutcome, type InsertRaceMarketOutcome,
  type PolymarketOrder, type InsertPolymarketOrder,
  type PortfolioHistory, type InsertPortfolioHistory,
  type PlatformConfig, type InsertPlatformConfig,
  type CollectedFee, type InsertCollectedFee,
  type TreasuryFeeTransfer, type InsertTreasuryFeeTransfer,
  type MarketComment,
  type BuySharesRequest,
  type SellSharesRequest,
  type Article, type InsertArticle
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, asc, sql, inArray, gte } from "drizzle-orm";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserBalance(id: string, newBalance: number): Promise<User | undefined>;
  linkWallet(id: string, walletAddress: string): Promise<User | undefined>;
  
  // Teams
  getTeams(): Promise<Team[]>;
  getTeam(id: string): Promise<Team | undefined>;
  createTeam(team: InsertTeam): Promise<Team>;
  updateTeam(id: string, updates: Partial<Team>): Promise<Team | undefined>;
  seedTeams(): Promise<void>;
  
  // Drivers
  getDrivers(): Promise<Driver[]>;
  getDriver(id: string): Promise<Driver | undefined>;
  getDriversByTeam(teamId: string): Promise<Driver[]>;
  createDriver(driver: InsertDriver): Promise<Driver>;
  seedDrivers(): Promise<void>;
  
  // Holdings
  getHoldingsByUser(userId: string): Promise<Holding[]>;
  getHolding(userId: string, teamId: string): Promise<Holding | undefined>;
  upsertHolding(holding: InsertHolding): Promise<Holding>;
  
  // Transactions
  getTransactionsByUser(userId: string): Promise<Transaction[]>;
  createTransaction(transaction: InsertTransaction): Promise<Transaction>;
  getRecentTransactions(limit: number): Promise<Transaction[]>;
  
  // Market operations
  buyShares(request: BuySharesRequest): Promise<{ success: boolean; error?: string; transaction?: Transaction }>;
  sellShares(request: SellSharesRequest): Promise<{ success: boolean; error?: string; transaction?: Transaction }>;
  getPrizePool(): Promise<number>;
  getSharesSoldByTeam(): Promise<Map<string, number>>;
  deleteHolding(userId: string, teamId: string): Promise<void>;
  
  // Deposits
  createDeposit(deposit: InsertDeposit): Promise<Deposit>;
  getDepositByTxHash(txHash: string): Promise<Deposit | undefined>;
  getDepositsByUser(userId: string): Promise<Deposit[]>;
  confirmDeposit(depositId: string): Promise<Deposit | undefined>;
  
  // Price History
  recordPriceSnapshot(teamId: string, price: number): Promise<PriceHistory>;
  getPriceHistory(teamId?: string, limit?: number): Promise<PriceHistory[]>;
  recordAllTeamPrices(): Promise<void>;
  
  // Season management
  getCurrentSeason(): Promise<Season | undefined>;
  createSeason(season: InsertSeason): Promise<Season>;
  concludeSeason(seasonId: string, winningTeamId: string, prizePool: number): Promise<Season | undefined>;
  isSeasonActive(): Promise<boolean>;
  
  // Payouts
  createPayout(payout: InsertPayout): Promise<Payout>;
  getPayoutsBySeason(seasonId: string): Promise<Payout[]>;
  getPayoutsByUser(userId: string): Promise<Payout[]>;
  updatePayoutStatus(payoutId: string, status: string, polygonTxHash?: string): Promise<Payout | undefined>;
  getHoldersOfTeam(teamId: string): Promise<{ userId: string; shares: number; walletAddress: string | null }[]>;
  
  // CLOB Markets
  getMarkets(): Promise<Market[]>;
  getMarket(id: string): Promise<Market | undefined>;
  createMarket(market: InsertMarket): Promise<Market>;
  createMarketsForSeason(seasonId: string): Promise<Market[]>;
  createDriverMarketsForSeason(seasonId: string): Promise<Market[]>;
  getMarketsBySeason(seasonId: string): Promise<Market[]>;
  getMarketsByType(seasonId: string, marketType: 'team' | 'driver'): Promise<Market[]>;
  
  // CLOB Price History
  getCLOBPriceHistory(teamId?: string, limit?: number): Promise<{ id: string; teamId: string; price: number; recordedAt: string }[]>;
  
  // Championship Pools (LMSR)
  getChampionshipPools(): Promise<ChampionshipPool[]>;
  getChampionshipPool(id: string): Promise<ChampionshipPool | undefined>;
  getChampionshipPoolByType(seasonId: string, type: 'team' | 'driver'): Promise<ChampionshipPool | undefined>;
  createChampionshipPool(pool: InsertChampionshipPool): Promise<ChampionshipPool>;
  updatePoolCollateral(poolId: string, additionalCollateral: number): Promise<ChampionshipPool | undefined>;
  
  // Championship Outcomes
  getChampionshipOutcomes(poolId: string): Promise<ChampionshipOutcome[]>;
  getChampionshipOutcome(id: string): Promise<ChampionshipOutcome | undefined>;
  getChampionshipOutcomeByParticipant(poolId: string, participantId: string): Promise<ChampionshipOutcome | undefined>;
  createChampionshipOutcome(outcome: InsertChampionshipOutcome): Promise<ChampionshipOutcome>;
  updateOutcomeShares(outcomeId: string, additionalShares: number): Promise<ChampionshipOutcome | undefined>;
  
  // Pool Trades
  createPoolTrade(trade: InsertPoolTrade): Promise<PoolTrade>;
  getPoolTradesByUser(userId: string): Promise<PoolTrade[]>;
  getPoolTradesByPool(poolId: string): Promise<PoolTrade[]>;
  
  // Pool Positions
  getPoolPosition(poolId: string, outcomeId: string, userId: string): Promise<PoolPosition | undefined>;
  getPoolPositionsByUser(userId: string): Promise<PoolPosition[]>;
  getPoolPositionsByPool(poolId: string): Promise<PoolPosition[]>;
  upsertPoolPosition(position: InsertPoolPosition & { poolId: string; outcomeId: string; userId: string }): Promise<PoolPosition>;
  deletePoolPosition(positionId: string): Promise<void>;
  updatePoolPosition(positionId: string, updates: { sharesOwned: number; totalCost: number }): Promise<PoolPosition | undefined>;
  
  // Pool Initialization
  initializePoolsForSeason(seasonId: string): Promise<{ teamPool: ChampionshipPool; driverPool: ChampionshipPool }>;
  
  // Pool Payout Management
  concludePool(poolId: string, winningOutcomeId: string): Promise<ChampionshipPool | undefined>;
  getPoolPositionsByOutcome(outcomeId: string): Promise<PoolPosition[]>;
  createPoolPayout(payout: InsertPoolPayout): Promise<PoolPayout>;
  getPoolPayoutsByPool(poolId: string): Promise<PoolPayout[]>;
  getPoolPayoutsByUser(userId: string): Promise<PoolPayout[]>;
  updatePoolPayoutStatus(payoutId: string, status: string, polygonTxHash?: string): Promise<PoolPayout | undefined>;
  
  // ZK Proofs (TLSNotary)
  createZkProof(proof: InsertZkProof): Promise<ZkProof>;
  getZkProof(id: string): Promise<ZkProof | undefined>;
  getZkProofsByPool(poolId: string): Promise<ZkProof[]>;
  updateZkProofStatus(proofId: string, status: string, winnerId?: string, winnerName?: string, rejectionReason?: string): Promise<ZkProof | undefined>;
  
  // Pool Price History
  recordPoolPrices(poolId: string): Promise<void>;
  getPoolPriceHistory(poolId: string, limit?: number): Promise<PoolPriceHistory[]>;
  getPricesFromTimeAgo(poolId: string, hoursAgo: number): Promise<Map<string, number>>;
  
  // Race Markets
  getRaceMarkets(): Promise<RaceMarket[]>;
  getRaceMarket(id: string): Promise<RaceMarket | undefined>;
  createRaceMarket(market: InsertRaceMarket): Promise<RaceMarket>;
  updateRaceMarket(id: string, updates: Partial<RaceMarket>): Promise<RaceMarket | undefined>;
  deleteRaceMarket(id: string): Promise<void>;
  
  // Race Market Outcomes
  getRaceMarketOutcomes(raceMarketId: string): Promise<RaceMarketOutcome[]>;
  createRaceMarketOutcome(outcome: InsertRaceMarketOutcome): Promise<RaceMarketOutcome>;
  updateRaceMarketOutcome(id: string, updates: Partial<RaceMarketOutcome>): Promise<RaceMarketOutcome | undefined>;
  deleteRaceMarketOutcome(id: string): Promise<void>;
  
  // Polymarket Orders
  createPolymarketOrder(order: InsertPolymarketOrder): Promise<PolymarketOrder>;
  getPolymarketOrdersByUser(userId: string): Promise<PolymarketOrder[]>;
  getPolymarketOrder(id: string): Promise<PolymarketOrder | undefined>;
  updatePolymarketOrder(id: string, updates: Partial<PolymarketOrder>): Promise<PolymarketOrder | undefined>;
  deletePolymarketOrder(id: string): Promise<void>;
  
  // Portfolio History
  savePortfolioSnapshot(snapshot: InsertPortfolioHistory): Promise<PortfolioHistory>;
  getPortfolioHistory(walletAddress: string, period: string): Promise<PortfolioHistory[]>;
  
  // Platform Configuration
  getConfig(key: string): Promise<string | null>;
  setConfig(key: string, value: string, updatedBy?: string): Promise<void>;
  
  // Collected Fees (fee expectations)
  recordCollectedFee(fee: InsertCollectedFee): Promise<CollectedFee>;
  getFeeByOrderId(polymarketOrderId: string): Promise<CollectedFee | undefined>;
  getRecentFees(limit: number): Promise<CollectedFee[]>;
  getFeeExpectationStats(): Promise<{ totalExpectedFees: number; totalVolume: number; feeCount: number }>;
  matchFeeToTransfer(feeId: string, txHash: string): Promise<void>;
  markFeesCollected(feeIds: string[], txHash: string): Promise<void>;
  getPendingFeesForWallet(walletAddress: string): Promise<CollectedFee[]>;
  
  // Treasury Fee Transfers (on-chain records)
  recordTreasuryTransfer(transfer: InsertTreasuryFeeTransfer): Promise<TreasuryFeeTransfer>;
  getTreasuryTransfers(limit: number): Promise<TreasuryFeeTransfer[]>;
  getTreasuryTransferByTxHash(txHash: string): Promise<TreasuryFeeTransfer | undefined>;
  getTreasurySummary(): Promise<{ totalCollected: number; transferCount: number; lastBlockNumber: number | null }>;
  getUnmatchedExpectations(): Promise<CollectedFee[]>;
  getUnmatchedTransfers(): Promise<TreasuryFeeTransfer[]>;
  
  // User Profiles & Comments
  getUserProfile(walletAddress: string): Promise<{ walletAddress: string; displayName: string | null } | undefined>;
  updateDisplayName(walletAddress: string, displayName: string): Promise<string>;
  isUsernameAvailable(displayName: string, excludeWallet?: string): Promise<boolean>;
  getMarketComments(marketType: string, marketId: string): Promise<MarketComment[]>;
  createComment(data: { walletAddress: string; marketType: string; marketId: string; content: string; displayName: string | null }): Promise<MarketComment>;
  
  // Articles
  getArticles(status?: string): Promise<Article[]>;
  getArticle(id: string): Promise<Article | undefined>;
  getArticleBySlug(slug: string): Promise<Article | undefined>;
  createArticle(article: InsertArticle): Promise<Article>;
  updateArticle(id: string, updates: Partial<Article>): Promise<Article | undefined>;
  publishArticle(id: string): Promise<Article | undefined>;
  deleteArticle(id: string): Promise<void>;
}

// Initial F1 2026 teams data - all teams start at equal $0.10 price
const initialTeams: InsertTeam[] = [
  { id: "redbull", name: "Red Bull Racing", shortName: "RBR", color: "#1E41FF", price: 0.10, priceChange: 0, totalShares: 10000, availableShares: 10000 },
  { id: "ferrari", name: "Scuderia Ferrari", shortName: "FER", color: "#DC0000", price: 0.10, priceChange: 0, totalShares: 10000, availableShares: 10000 },
  { id: "mercedes", name: "Mercedes-AMG", shortName: "MER", color: "#00D2BE", price: 0.10, priceChange: 0, totalShares: 10000, availableShares: 10000 },
  { id: "mclaren", name: "McLaren F1", shortName: "MCL", color: "#FF8700", price: 0.10, priceChange: 0, totalShares: 10000, availableShares: 10000 },
  { id: "astonmartin", name: "Aston Martin", shortName: "AMR", color: "#006F62", price: 0.10, priceChange: 0, totalShares: 10000, availableShares: 10000 },
  { id: "alpine", name: "Alpine F1", shortName: "ALP", color: "#0090FF", price: 0.10, priceChange: 0, totalShares: 10000, availableShares: 10000 },
  { id: "williams", name: "Williams Racing", shortName: "WIL", color: "#005AFF", price: 0.10, priceChange: 0, totalShares: 10000, availableShares: 10000 },
  { id: "rb", name: "RB Formula One", shortName: "RB", color: "#2B4562", price: 0.10, priceChange: 0, totalShares: 10000, availableShares: 10000 },
  { id: "audi", name: "Audi F1 Team", shortName: "AUD", color: "#FF0000", price: 0.10, priceChange: 0, totalShares: 10000, availableShares: 10000 },
  { id: "haas", name: "Haas F1 Team", shortName: "HAS", color: "#B6BABD", price: 0.10, priceChange: 0, totalShares: 10000, availableShares: 10000 },
  { id: "cadillac", name: "Cadillac F1 Team", shortName: "CAD", color: "#C4A747", price: 0.10, priceChange: 0, totalShares: 10000, availableShares: 10000 },
];

// Initial F1 2026 drivers data - confirmed driver lineup
const initialDrivers: InsertDriver[] = [
  // Red Bull Racing
  { id: "verstappen", name: "Max Verstappen", shortName: "VER", teamId: "redbull", number: 1, color: "#1E41FF" },
  { id: "lawson", name: "Liam Lawson", shortName: "LAW", teamId: "redbull", number: 30, color: "#1E41FF" },
  // Ferrari
  { id: "leclerc", name: "Charles Leclerc", shortName: "LEC", teamId: "ferrari", number: 16, color: "#DC0000" },
  { id: "hamilton", name: "Lewis Hamilton", shortName: "HAM", teamId: "ferrari", number: 44, color: "#DC0000" },
  // Mercedes
  { id: "russell", name: "George Russell", shortName: "RUS", teamId: "mercedes", number: 63, color: "#00D2BE" },
  { id: "antonelli", name: "Andrea Kimi Antonelli", shortName: "ANT", teamId: "mercedes", number: 12, color: "#00D2BE" },
  // McLaren
  { id: "norris", name: "Lando Norris", shortName: "NOR", teamId: "mclaren", number: 4, color: "#FF8700" },
  { id: "piastri", name: "Oscar Piastri", shortName: "PIA", teamId: "mclaren", number: 81, color: "#FF8700" },
  // Aston Martin
  { id: "alonso", name: "Fernando Alonso", shortName: "ALO", teamId: "astonmartin", number: 14, color: "#006F62" },
  { id: "stroll", name: "Lance Stroll", shortName: "STR", teamId: "astonmartin", number: 18, color: "#006F62" },
  // Alpine
  { id: "gasly", name: "Pierre Gasly", shortName: "GAS", teamId: "alpine", number: 10, color: "#0090FF" },
  { id: "doohan", name: "Jack Doohan", shortName: "DOO", teamId: "alpine", number: 5, color: "#0090FF" },
  // Williams
  { id: "albon", name: "Alex Albon", shortName: "ALB", teamId: "williams", number: 23, color: "#005AFF" },
  { id: "sainz", name: "Carlos Sainz", shortName: "SAI", teamId: "williams", number: 55, color: "#005AFF" },
  // RB (Visa Cash App RB)
  { id: "tsunoda", name: "Yuki Tsunoda", shortName: "TSU", teamId: "rb", number: 22, color: "#2B4562" },
  { id: "hadjar", name: "Isack Hadjar", shortName: "HAD", teamId: "rb", number: 6, color: "#2B4562" },
  // Audi (formerly Sauber)
  { id: "hulkenberg", name: "Nico Hulkenberg", shortName: "HUL", teamId: "audi", number: 27, color: "#FF0000" },
  { id: "bortoleto", name: "Gabriel Bortoleto", shortName: "BOR", teamId: "audi", number: 49, color: "#FF0000" },
  // Haas
  { id: "ocon", name: "Esteban Ocon", shortName: "OCO", teamId: "haas", number: 31, color: "#B6BABD" },
  { id: "bearman", name: "Oliver Bearman", shortName: "BEA", teamId: "haas", number: 87, color: "#B6BABD" },
  // Cadillac (placeholder drivers for new entry)
  { id: "cadillac_driver1", name: "TBD Driver 1", shortName: "TBD", teamId: "cadillac", number: 98, color: "#C4A747" },
  { id: "cadillac_driver2", name: "TBD Driver 2", shortName: "TBD", teamId: "cadillac", number: 99, color: "#C4A747" },
];

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUserBalance(id: string, newBalance: number): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ balance: newBalance })
      .where(eq(users.id, id))
      .returning();
    return user || undefined;
  }

  async linkWallet(id: string, walletAddress: string): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ walletAddress })
      .where(eq(users.id, id))
      .returning();
    return user || undefined;
  }

  // Teams
  async getTeams(): Promise<Team[]> {
    return await db.select().from(teams);
  }

  async getTeam(id: string): Promise<Team | undefined> {
    const [team] = await db.select().from(teams).where(eq(teams.id, id));
    return team || undefined;
  }

  async createTeam(team: InsertTeam): Promise<Team> {
    const [newTeam] = await db.insert(teams).values(team as any).returning();
    return newTeam;
  }

  async updateTeam(id: string, updates: Partial<Team>): Promise<Team | undefined> {
    const [team] = await db
      .update(teams)
      .set(updates)
      .where(eq(teams.id, id))
      .returning();
    return team || undefined;
  }

  async seedTeams(): Promise<void> {
    const existingTeams = await this.getTeams();
    if (existingTeams.length === 0) {
      for (const team of initialTeams) {
        await this.createTeam(team);
      }
    }
  }

  // Drivers
  async getDrivers(): Promise<Driver[]> {
    return await db.select().from(drivers);
  }

  async getDriver(id: string): Promise<Driver | undefined> {
    const [driver] = await db.select().from(drivers).where(eq(drivers.id, id));
    return driver || undefined;
  }

  async getDriversByTeam(teamId: string): Promise<Driver[]> {
    return await db.select().from(drivers).where(eq(drivers.teamId, teamId));
  }

  async createDriver(driver: InsertDriver): Promise<Driver> {
    const [newDriver] = await db.insert(drivers).values(driver).returning();
    return newDriver;
  }

  async seedDrivers(): Promise<void> {
    const existingDrivers = await this.getDrivers();
    if (existingDrivers.length === 0) {
      for (const driver of initialDrivers) {
        await this.createDriver(driver);
      }
    }
  }

  // Holdings
  async getHoldingsByUser(userId: string): Promise<Holding[]> {
    return await db.select().from(holdings).where(eq(holdings.userId, userId));
  }

  async getHolding(userId: string, teamId: string): Promise<Holding | undefined> {
    const [holding] = await db
      .select()
      .from(holdings)
      .where(and(eq(holdings.userId, userId), eq(holdings.teamId, teamId)));
    return holding || undefined;
  }

  async upsertHolding(holding: InsertHolding): Promise<Holding> {
    const existing = await this.getHolding(holding.userId, holding.teamId);
    if (existing) {
      const [updated] = await db
        .update(holdings)
        .set({ shares: holding.shares, avgPrice: holding.avgPrice })
        .where(eq(holdings.id, existing.id))
        .returning();
      return updated;
    } else {
      const [newHolding] = await db.insert(holdings).values(holding).returning();
      return newHolding;
    }
  }

  // Transactions
  async getTransactionsByUser(userId: string): Promise<Transaction[]> {
    return await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.createdAt));
  }

  async createTransaction(transaction: InsertTransaction): Promise<Transaction> {
    const [newTransaction] = await db.insert(transactions).values(transaction).returning();
    return newTransaction;
  }

  async getRecentTransactions(limit: number): Promise<Transaction[]> {
    return await db
      .select()
      .from(transactions)
      .orderBy(desc(transactions.createdAt))
      .limit(limit);
  }

  async getSharesSoldByTeam(): Promise<Map<string, number>> {
    const allTransactions = await db.select().from(transactions);
    const sharesByTeam = new Map<string, number>();
    
    for (const tx of allTransactions) {
      const current = sharesByTeam.get(tx.teamId) || 0;
      if (tx.type === "buy") {
        sharesByTeam.set(tx.teamId, current + tx.shares);
      } else if (tx.type === "sell") {
        sharesByTeam.set(tx.teamId, current - tx.shares);
      }
    }
    
    return sharesByTeam;
  }

  // Market operations
  async buyShares(request: BuySharesRequest): Promise<{ success: boolean; error?: string; transaction?: Transaction }> {
    const { teamId, quantity, userId } = request;

    // Get user and team
    const user = await this.getUser(userId);
    if (!user) {
      return { success: false, error: "User not found" };
    }

    const team = await this.getTeam(teamId);
    if (!team) {
      return { success: false, error: "Team not found" };
    }

    // Calculate cost
    const totalCost = team.price * quantity;

    // Note: USDC balance verification is done in the route before calling this method
    // No demo balance deduction - purchases are based on real USDC wallet balance

    // Update team price (slight increase on demand) - no share limit
    const priceIncrease = quantity * 0.000001; // Small price increase based on demand
    await this.updateTeam(teamId, {
      price: team.price + priceIncrease,
    });

    // Update or create holding
    const existingHolding = await this.getHolding(userId, teamId);
    if (existingHolding) {
      const newShares = existingHolding.shares + quantity;
      const newAvgPrice = 
        (existingHolding.shares * existingHolding.avgPrice + quantity * team.price) / newShares;
      await this.upsertHolding({
        userId,
        teamId,
        shares: newShares,
        avgPrice: newAvgPrice,
      });
    } else {
      await this.upsertHolding({
        userId,
        teamId,
        shares: quantity,
        avgPrice: team.price,
      });
    }

    // Create transaction record
    const transaction = await this.createTransaction({
      userId,
      teamId,
      type: "buy",
      shares: quantity,
      pricePerShare: team.price,
      totalAmount: totalCost,
    });

    // Record price snapshot for charts
    await this.recordPriceSnapshot(teamId, team.price + priceIncrease);

    return { success: true, transaction };
  }

  async sellShares(request: SellSharesRequest): Promise<{ success: boolean; error?: string; transaction?: Transaction }> {
    const { teamId, quantity, userId } = request;

    // Get user and team
    const user = await this.getUser(userId);
    if (!user) {
      return { success: false, error: "User not found" };
    }

    const team = await this.getTeam(teamId);
    if (!team) {
      return { success: false, error: "Team not found" };
    }

    // Get user's holding for this team
    const holding = await this.getHolding(userId, teamId);
    if (!holding || holding.shares < quantity) {
      return { success: false, error: "Insufficient shares" };
    }

    // Capture current price BEFORE applying market impact
    const sellPrice = team.price;
    const totalProceeds = sellPrice * quantity;

    // Note: In a full implementation, USDC would be transferred to user's wallet
    // For now, we just record the transaction and update holdings

    // Update team price (slight decrease on selling) - applied AFTER sale
    const priceDecrease = quantity * 0.000001;
    await this.updateTeam(teamId, {
      price: Math.max(0.01, team.price - priceDecrease), // Minimum price floor
    });

    // Update holding (reduce shares)
    const newShares = holding.shares - quantity;
    if (newShares === 0) {
      // Delete holding if no shares left
      await this.deleteHolding(userId, teamId);
    } else {
      await this.upsertHolding({
        userId,
        teamId,
        shares: newShares,
        avgPrice: holding.avgPrice, // Keep original avg price for remaining shares
      });
    }

    // Create transaction record with the actual sell price (pre-impact)
    const transaction = await this.createTransaction({
      userId,
      teamId,
      type: "sell",
      shares: quantity,
      pricePerShare: sellPrice,
      totalAmount: totalProceeds,
    });

    // Record price snapshot for charts
    await this.recordPriceSnapshot(teamId, Math.max(0.01, team.price - priceDecrease));

    return { success: true, transaction };
  }

  async deleteHolding(userId: string, teamId: string): Promise<void> {
    await db
      .delete(holdings)
      .where(and(eq(holdings.userId, userId), eq(holdings.teamId, teamId)));
  }

  async getPrizePool(): Promise<number> {
    // Calculate prize pool from all buy transactions
    const allTransactions = await db.select().from(transactions).where(eq(transactions.type, "buy"));
    return allTransactions.reduce((acc, tx) => acc + tx.totalAmount, 0);
  }

  // Deposits
  async createDeposit(deposit: InsertDeposit): Promise<Deposit> {
    const [newDeposit] = await db.insert(deposits).values(deposit).returning();
    return newDeposit;
  }

  async getDepositByTxHash(txHash: string): Promise<Deposit | undefined> {
    const [deposit] = await db
      .select()
      .from(deposits)
      .where(eq(deposits.polygonTxHash, txHash));
    return deposit || undefined;
  }

  async getDepositsByUser(userId: string): Promise<Deposit[]> {
    return await db
      .select()
      .from(deposits)
      .where(eq(deposits.userId, userId))
      .orderBy(desc(deposits.createdAt));
  }

  async confirmDeposit(depositId: string): Promise<Deposit | undefined> {
    const [deposit] = await db
      .select()
      .from(deposits)
      .where(eq(deposits.id, depositId));
    
    if (!deposit) return undefined;
    
    // Idempotency check - don't re-credit already confirmed deposits
    if (deposit.status === "confirmed") {
      return deposit;
    }

    const [updated] = await db
      .update(deposits)
      .set({ 
        status: "confirmed", 
        confirmedAt: new Date() 
      })
      .where(and(eq(deposits.id, depositId), eq(deposits.status, "pending")))
      .returning();

    // Only credit if we actually updated from pending -> confirmed
    if (updated) {
      const user = await this.getUser(deposit.userId);
      if (user) {
        await this.updateUserBalance(deposit.userId, user.balance + deposit.amount);
      }
    }

    return updated || deposit;
  }

  // Price History
  async recordPriceSnapshot(teamId: string, price: number): Promise<PriceHistory> {
    const [record] = await db.insert(priceHistory).values({ teamId, price }).returning();
    return record;
  }

  async getPriceHistory(teamId?: string, limit: number = 100): Promise<PriceHistory[]> {
    if (teamId) {
      return await db
        .select()
        .from(priceHistory)
        .where(eq(priceHistory.teamId, teamId))
        .orderBy(asc(priceHistory.recordedAt))
        .limit(limit);
    }
    return await db
      .select()
      .from(priceHistory)
      .orderBy(asc(priceHistory.recordedAt))
      .limit(limit);
  }

  async recordAllTeamPrices(): Promise<void> {
    const allTeams = await this.getTeams();
    for (const team of allTeams) {
      await this.recordPriceSnapshot(team.id, team.price);
    }
  }

  // Season management
  async getCurrentSeason(): Promise<Season | undefined> {
    const [season] = await db
      .select()
      .from(seasons)
      .orderBy(desc(seasons.createdAt))
      .limit(1);
    return season || undefined;
  }

  async createSeason(season: InsertSeason): Promise<Season> {
    const [newSeason] = await db.insert(seasons).values(season).returning();
    return newSeason;
  }

  async concludeSeason(seasonId: string, winningTeamId: string, prizePool: number): Promise<Season | undefined> {
    const [updated] = await db
      .update(seasons)
      .set({
        status: "concluded",
        winningTeamId,
        prizePool,
        concludedAt: new Date(),
      })
      .where(eq(seasons.id, seasonId))
      .returning();
    return updated || undefined;
  }

  async isSeasonActive(): Promise<boolean> {
    const currentSeason = await this.getCurrentSeason();
    return currentSeason?.status === "active";
  }

  // Payouts
  async createPayout(payout: InsertPayout): Promise<Payout> {
    const [newPayout] = await db.insert(payouts).values(payout).returning();
    return newPayout;
  }

  async getPayoutsBySeason(seasonId: string): Promise<Payout[]> {
    return await db
      .select()
      .from(payouts)
      .where(eq(payouts.seasonId, seasonId))
      .orderBy(desc(payouts.payoutAmount));
  }

  async getPayoutsByUser(userId: string): Promise<Payout[]> {
    return await db
      .select()
      .from(payouts)
      .where(eq(payouts.userId, userId))
      .orderBy(desc(payouts.createdAt));
  }

  async updatePayoutStatus(payoutId: string, status: string, polygonTxHash?: string): Promise<Payout | undefined> {
    const updates: Partial<Payout> = { status };
    if (polygonTxHash) {
      updates.polygonTxHash = polygonTxHash;
    }
    if (status === "sent") {
      updates.paidAt = new Date();
    }
    const [updated] = await db
      .update(payouts)
      .set(updates)
      .where(eq(payouts.id, payoutId))
      .returning();
    return updated || undefined;
  }

  async getHoldersOfTeam(teamId: string): Promise<{ userId: string; shares: number; walletAddress: string | null }[]> {
    const result = await db
      .select({
        userId: holdings.userId,
        shares: holdings.shares,
        walletAddress: users.walletAddress,
      })
      .from(holdings)
      .innerJoin(users, eq(holdings.userId, users.id))
      .where(and(eq(holdings.teamId, teamId), sql`${holdings.shares} > 0`));
    return result;
  }

  // CLOB Markets
  async getMarkets(): Promise<Market[]> {
    return await db.select().from(markets).orderBy(asc(markets.createdAt));
  }

  async getMarketsBySeason(seasonId: string): Promise<Market[]> {
    return await db.select().from(markets).where(eq(markets.seasonId, seasonId));
  }

  async getMarket(id: string): Promise<Market | undefined> {
    const [market] = await db.select().from(markets).where(eq(markets.id, id));
    return market || undefined;
  }

  async createMarket(market: InsertMarket): Promise<Market> {
    const [newMarket] = await db.insert(markets).values(market).returning();
    return newMarket;
  }

  async createMarketsForSeason(seasonId: string): Promise<Market[]> {
    const allTeams = await this.getTeams();
    const createdMarkets: Market[] = [];
    
    for (const team of allTeams) {
      const market = await this.createMarket({
        seasonId,
        teamId: team.id,
        driverId: null,
        marketType: "team",
        outstandingPairs: 0,
        lockedCollateral: 0,
        lastPrice: 0.5,
        status: "active",
      });
      createdMarkets.push(market);
    }
    
    return createdMarkets;
  }

  async createDriverMarketsForSeason(seasonId: string): Promise<Market[]> {
    const allDrivers = await this.getDrivers();
    const createdMarkets: Market[] = [];
    
    for (const driver of allDrivers) {
      const market = await this.createMarket({
        seasonId,
        teamId: null,
        driverId: driver.id,
        marketType: "driver",
        outstandingPairs: 0,
        lockedCollateral: 0,
        lastPrice: 0.5,
        status: "active",
      });
      createdMarkets.push(market);
    }
    
    return createdMarkets;
  }

  async getMarketsByType(seasonId: string, marketType: 'team' | 'driver'): Promise<Market[]> {
    return await db.select().from(markets).where(
      and(eq(markets.seasonId, seasonId), eq(markets.marketType, marketType))
    );
  }

  // CLOB Price History - derives price history from order fills
  // Returns chronologically ascending data for chart rendering
  async getCLOBPriceHistory(teamId?: string, limit: number = 500): Promise<{ id: string; teamId: string; price: number; recordedAt: string }[]> {
    // Get all markets with their team IDs
    const allMarkets = await db.select({
      marketId: markets.id,
      teamId: markets.teamId,
    }).from(markets);
    
    const marketToTeam = new Map(allMarkets.map(m => [m.marketId, m.teamId]));
    
    // Get order fills (each fill represents a trade with a price)
    // Ordered ascending for chronological chart display
    let fills;
    if (teamId) {
      // Filter by team via market using proper inArray helper
      const marketIds = allMarkets.filter(m => m.teamId === teamId).map(m => m.marketId);
      if (marketIds.length === 0) return [];
      
      fills = await db.select({
        id: orderFills.id,
        marketId: orderFills.marketId,
        yesPrice: orderFills.yesPrice,
        createdAt: orderFills.createdAt,
      })
      .from(orderFills)
      .where(inArray(orderFills.marketId, marketIds))
      .orderBy(asc(orderFills.createdAt))
      .limit(limit);
    } else {
      fills = await db.select({
        id: orderFills.id,
        marketId: orderFills.marketId,
        yesPrice: orderFills.yesPrice,
        createdAt: orderFills.createdAt,
      })
      .from(orderFills)
      .orderBy(asc(orderFills.createdAt))
      .limit(limit);
    }
    
    // Transform to price history format (yesPrice represents the team's win probability/price)
    return fills.map(fill => ({
      id: fill.id,
      teamId: marketToTeam.get(fill.marketId) || "",
      price: fill.yesPrice,
      recordedAt: fill.createdAt.toISOString(),
    })).filter(f => f.teamId);
  }

  // ============ Championship Pools (LMSR) ============

  async getChampionshipPools(): Promise<ChampionshipPool[]> {
    return await db.select().from(championshipPools);
  }

  async getChampionshipPool(id: string): Promise<ChampionshipPool | undefined> {
    const [pool] = await db.select().from(championshipPools).where(eq(championshipPools.id, id));
    return pool || undefined;
  }

  async getChampionshipPoolByType(seasonId: string, type: 'team' | 'driver'): Promise<ChampionshipPool | undefined> {
    const [pool] = await db.select().from(championshipPools).where(
      and(eq(championshipPools.seasonId, seasonId), eq(championshipPools.type, type))
    );
    return pool || undefined;
  }

  async createChampionshipPool(pool: InsertChampionshipPool): Promise<ChampionshipPool> {
    const [created] = await db.insert(championshipPools).values(pool).returning();
    return created;
  }

  async updatePoolCollateral(poolId: string, additionalCollateral: number): Promise<ChampionshipPool | undefined> {
    const pool = await this.getChampionshipPool(poolId);
    if (!pool) return undefined;
    
    const [updated] = await db
      .update(championshipPools)
      .set({ totalCollateral: pool.totalCollateral + additionalCollateral })
      .where(eq(championshipPools.id, poolId))
      .returning();
    return updated || undefined;
  }

  // ============ Championship Outcomes ============

  async getChampionshipOutcomes(poolId: string): Promise<ChampionshipOutcome[]> {
    return await db.select().from(championshipOutcomes).where(eq(championshipOutcomes.poolId, poolId));
  }

  async getChampionshipOutcome(id: string): Promise<ChampionshipOutcome | undefined> {
    const [outcome] = await db.select().from(championshipOutcomes).where(eq(championshipOutcomes.id, id));
    return outcome || undefined;
  }

  async getChampionshipOutcomeByParticipant(poolId: string, participantId: string): Promise<ChampionshipOutcome | undefined> {
    const [outcome] = await db.select().from(championshipOutcomes).where(
      and(eq(championshipOutcomes.poolId, poolId), eq(championshipOutcomes.participantId, participantId))
    );
    return outcome || undefined;
  }

  async createChampionshipOutcome(outcome: InsertChampionshipOutcome): Promise<ChampionshipOutcome> {
    const [created] = await db.insert(championshipOutcomes).values(outcome).returning();
    return created;
  }

  async updateOutcomeShares(outcomeId: string, additionalShares: number): Promise<ChampionshipOutcome | undefined> {
    const outcome = await this.getChampionshipOutcome(outcomeId);
    if (!outcome) return undefined;
    
    const [updated] = await db
      .update(championshipOutcomes)
      .set({ sharesOutstanding: outcome.sharesOutstanding + additionalShares })
      .where(eq(championshipOutcomes.id, outcomeId))
      .returning();
    return updated || undefined;
  }

  // ============ Pool Trades ============

  async createPoolTrade(trade: InsertPoolTrade): Promise<PoolTrade> {
    const [created] = await db.insert(poolTrades).values(trade).returning();
    return created;
  }

  async getPoolTradesByUser(userId: string): Promise<PoolTrade[]> {
    return await db.select().from(poolTrades).where(eq(poolTrades.userId, userId)).orderBy(desc(poolTrades.createdAt));
  }

  async getPoolTradesByPool(poolId: string): Promise<PoolTrade[]> {
    return await db.select().from(poolTrades).where(eq(poolTrades.poolId, poolId)).orderBy(desc(poolTrades.createdAt));
  }

  // ============ Pool Positions ============

  async getPoolPosition(poolId: string, outcomeId: string, userId: string): Promise<PoolPosition | undefined> {
    const [position] = await db.select().from(poolPositions).where(
      and(
        eq(poolPositions.poolId, poolId),
        eq(poolPositions.outcomeId, outcomeId),
        eq(poolPositions.userId, userId)
      )
    );
    return position || undefined;
  }

  async getPoolPositionsByUser(userId: string): Promise<PoolPosition[]> {
    return await db.select().from(poolPositions).where(eq(poolPositions.userId, userId));
  }

  async getPoolPositionsByPool(poolId: string): Promise<PoolPosition[]> {
    return await db.select().from(poolPositions).where(eq(poolPositions.poolId, poolId));
  }

  async upsertPoolPosition(position: InsertPoolPosition & { poolId: string; outcomeId: string; userId: string }): Promise<PoolPosition> {
    const existing = await this.getPoolPosition(position.poolId, position.outcomeId, position.userId);
    
    if (existing) {
      const [updated] = await db
        .update(poolPositions)
        .set({
          sharesOwned: (existing.sharesOwned || 0) + (position.sharesOwned || 0),
          totalCost: (existing.totalCost || 0) + (position.totalCost || 0),
          updatedAt: new Date(),
        })
        .where(eq(poolPositions.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(poolPositions).values(position).returning();
      return created;
    }
  }

  async deletePoolPosition(positionId: string): Promise<void> {
    await db.delete(poolPositions).where(eq(poolPositions.id, positionId));
  }

  async updatePoolPosition(positionId: string, updates: { sharesOwned: number; totalCost: number }): Promise<PoolPosition | undefined> {
    const [updated] = await db
      .update(poolPositions)
      .set({
        sharesOwned: updates.sharesOwned,
        totalCost: updates.totalCost,
        updatedAt: new Date(),
      })
      .where(eq(poolPositions.id, positionId))
      .returning();
    return updated;
  }

  // ============ Pool Initialization ============

  async initializePoolsForSeason(seasonId: string): Promise<{ teamPool: ChampionshipPool; driverPool: ChampionshipPool }> {
    // Create team championship pool
    const teamPool = await this.createChampionshipPool({
      seasonId,
      type: "team",
      bParameter: 100,
      totalCollateral: 0,
      status: "active",
    });

    // Create driver championship pool
    const driverPool = await this.createChampionshipPool({
      seasonId,
      type: "driver",
      bParameter: 100,
      totalCollateral: 0,
      status: "active",
    });

    // Add outcomes for all teams
    const allTeams = await this.getTeams();
    for (const team of allTeams) {
      await this.createChampionshipOutcome({
        poolId: teamPool.id,
        participantId: team.id,
        sharesOutstanding: 0,
      });
    }

    // Add outcomes for all drivers
    const allDrivers = await this.getDrivers();
    for (const driver of allDrivers) {
      await this.createChampionshipOutcome({
        poolId: driverPool.id,
        participantId: driver.id,
        sharesOutstanding: 0,
      });
    }

    return { teamPool, driverPool };
  }

  // ============ Pool Payout Management ============

  async concludePool(poolId: string, winningOutcomeId: string): Promise<ChampionshipPool | undefined> {
    const [updated] = await db
      .update(championshipPools)
      .set({ 
        status: "concluded",
        winningOutcomeId,
      })
      .where(eq(championshipPools.id, poolId))
      .returning();
    return updated || undefined;
  }

  async getPoolPositionsByOutcome(outcomeId: string): Promise<PoolPosition[]> {
    return await db.select().from(poolPositions).where(eq(poolPositions.outcomeId, outcomeId));
  }

  async createPoolPayout(payout: InsertPoolPayout): Promise<PoolPayout> {
    const [created] = await db.insert(poolPayouts).values(payout).returning();
    return created;
  }

  async getPoolPayoutsByPool(poolId: string): Promise<PoolPayout[]> {
    return await db.select().from(poolPayouts).where(eq(poolPayouts.poolId, poolId)).orderBy(desc(poolPayouts.createdAt));
  }

  async getPoolPayoutsByUser(userId: string): Promise<PoolPayout[]> {
    return await db.select().from(poolPayouts).where(eq(poolPayouts.userId, userId)).orderBy(desc(poolPayouts.createdAt));
  }

  async updatePoolPayoutStatus(payoutId: string, status: string, polygonTxHash?: string): Promise<PoolPayout | undefined> {
    const updateData: any = { status };
    if (polygonTxHash) {
      updateData.polygonTxHash = polygonTxHash;
    }
    if (status === "sent") {
      updateData.paidAt = new Date();
    }
    
    const [updated] = await db
      .update(poolPayouts)
      .set(updateData)
      .where(eq(poolPayouts.id, payoutId))
      .returning();
    return updated || undefined;
  }

  // ============ ZK Proofs (TLSNotary) ============

  async createZkProof(proof: InsertZkProof): Promise<ZkProof> {
    const [created] = await db.insert(zkProofs).values(proof).returning();
    return created;
  }

  async getZkProof(id: string): Promise<ZkProof | undefined> {
    const [proof] = await db.select().from(zkProofs).where(eq(zkProofs.id, id));
    return proof || undefined;
  }

  async getZkProofsByPool(poolId: string): Promise<ZkProof[]> {
    return await db.select().from(zkProofs).where(eq(zkProofs.poolId, poolId)).orderBy(desc(zkProofs.createdAt));
  }

  async updateZkProofStatus(
    proofId: string, 
    status: string, 
    winnerId?: string, 
    winnerName?: string, 
    rejectionReason?: string
  ): Promise<ZkProof | undefined> {
    const updateData: any = { verificationStatus: status };
    if (winnerId) updateData.extractedWinnerId = winnerId;
    if (winnerName) updateData.extractedWinnerName = winnerName;
    if (rejectionReason) updateData.rejectionReason = rejectionReason;
    if (status === "verified") updateData.verifiedAt = new Date();
    
    const [updated] = await db
      .update(zkProofs)
      .set(updateData)
      .where(eq(zkProofs.id, proofId))
      .returning();
    return updated || undefined;
  }

  // ============ Pool Price History ============
  
  async recordPoolPrices(poolId: string): Promise<void> {
    const pool = await this.getChampionshipPool(poolId);
    if (!pool || pool.status !== "active") return;
    
    const outcomes = await this.getChampionshipOutcomes(poolId);
    if (outcomes.length === 0) return;
    
    // Calculate LMSR prices
    const shares = outcomes.map(o => o.sharesOutstanding);
    const b = pool.bParameter;
    const expSum = shares.reduce((sum, s) => sum + Math.exp(s / b), 0);
    
    const priceRecords: InsertPoolPriceHistory[] = outcomes.map((outcome, i) => ({
      poolId,
      outcomeId: outcome.id,
      participantId: outcome.participantId,
      price: Math.exp(shares[i] / b) / expSum,
    }));
    
    if (priceRecords.length > 0) {
      await db.insert(poolPriceHistory).values(priceRecords);
    }
  }

  async getPoolPriceHistory(poolId: string, limit?: number): Promise<PoolPriceHistory[]> {
    let query = db
      .select()
      .from(poolPriceHistory)
      .where(eq(poolPriceHistory.poolId, poolId))
      .orderBy(desc(poolPriceHistory.recordedAt));
    
    if (limit) {
      return await query.limit(limit);
    }
    return await query;
  }

  async getPricesFromTimeAgo(poolId: string, hoursAgo: number): Promise<Map<string, number>> {
    const targetTime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
    
    // Get the most recent price record for each outcome that's older than targetTime
    // This gives us the price from approximately 24 hours ago
    const priceRecords = await db
      .select()
      .from(poolPriceHistory)
      .where(
        and(
          eq(poolPriceHistory.poolId, poolId),
          sql`${poolPriceHistory.recordedAt} <= ${targetTime}`
        )
      )
      .orderBy(desc(poolPriceHistory.recordedAt));
    
    // Group by participantId and take the most recent (first) for each
    const priceMap = new Map<string, number>();
    for (const record of priceRecords) {
      if (!priceMap.has(record.participantId)) {
        priceMap.set(record.participantId, record.price);
      }
    }
    
    // If we have no historical data from 24h ago, fallback to the earliest available record
    // This handles new pools where we don't have 24 hours of history yet
    if (priceMap.size === 0) {
      const earliestRecords = await db
        .select()
        .from(poolPriceHistory)
        .where(eq(poolPriceHistory.poolId, poolId))
        .orderBy(asc(poolPriceHistory.recordedAt));
      
      for (const record of earliestRecords) {
        if (!priceMap.has(record.participantId)) {
          priceMap.set(record.participantId, record.price);
        }
      }
    }
    
    return priceMap;
  }

  // ============ Race Markets ============
  
  async getRaceMarkets(): Promise<RaceMarket[]> {
    return await db.select().from(raceMarkets).orderBy(asc(raceMarkets.raceDate));
  }

  async getRaceMarket(id: string): Promise<RaceMarket | undefined> {
    const [market] = await db.select().from(raceMarkets).where(eq(raceMarkets.id, id));
    return market || undefined;
  }

  async createRaceMarket(market: InsertRaceMarket): Promise<RaceMarket> {
    const [created] = await db.insert(raceMarkets).values(market).returning();
    return created;
  }

  async updateRaceMarket(id: string, updates: Partial<RaceMarket>): Promise<RaceMarket | undefined> {
    const [updated] = await db
      .update(raceMarkets)
      .set(updates)
      .where(eq(raceMarkets.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteRaceMarket(id: string): Promise<void> {
    // Delete associated outcomes first
    await db.delete(raceMarketOutcomes).where(eq(raceMarketOutcomes.raceMarketId, id));
    // Then delete the race market
    await db.delete(raceMarkets).where(eq(raceMarkets.id, id));
  }

  // ============ Race Market Outcomes ============
  
  async getRaceMarketOutcomes(raceMarketId: string): Promise<RaceMarketOutcome[]> {
    return await db.select().from(raceMarketOutcomes).where(eq(raceMarketOutcomes.raceMarketId, raceMarketId));
  }

  async createRaceMarketOutcome(outcome: InsertRaceMarketOutcome): Promise<RaceMarketOutcome> {
    const [created] = await db.insert(raceMarketOutcomes).values(outcome).returning();
    return created;
  }

  async updateRaceMarketOutcome(id: string, updates: Partial<RaceMarketOutcome>): Promise<RaceMarketOutcome | undefined> {
    const [updated] = await db
      .update(raceMarketOutcomes)
      .set(updates)
      .where(eq(raceMarketOutcomes.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteRaceMarketOutcome(id: string): Promise<void> {
    await db.delete(raceMarketOutcomes).where(eq(raceMarketOutcomes.id, id));
  }

  // ============ Polymarket Orders ============
  
  async createPolymarketOrder(order: InsertPolymarketOrder): Promise<PolymarketOrder> {
    const [created] = await db.insert(polymarketOrders).values(order).returning();
    return created;
  }

  async getPolymarketOrdersByUser(userId: string): Promise<PolymarketOrder[]> {
    return await db
      .select()
      .from(polymarketOrders)
      .where(eq(polymarketOrders.userId, userId))
      .orderBy(desc(polymarketOrders.createdAt));
  }

  async getPolymarketOrder(id: string): Promise<PolymarketOrder | undefined> {
    const [order] = await db.select().from(polymarketOrders).where(eq(polymarketOrders.id, id));
    return order || undefined;
  }

  async updatePolymarketOrder(id: string, updates: Partial<PolymarketOrder>): Promise<PolymarketOrder | undefined> {
    const [updated] = await db
      .update(polymarketOrders)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(polymarketOrders.id, id))
      .returning();
    return updated || undefined;
  }

  async deletePolymarketOrder(id: string): Promise<void> {
    await db.delete(polymarketOrders).where(eq(polymarketOrders.id, id));
  }

  // ============ Portfolio History ============
  
  async savePortfolioSnapshot(snapshot: InsertPortfolioHistory): Promise<PortfolioHistory> {
    const [created] = await db.insert(portfolioHistory).values(snapshot).returning();
    return created;
  }

  async getPortfolioHistory(walletAddress: string, period: string): Promise<PortfolioHistory[]> {
    const now = new Date();
    let startDate: Date;
    
    switch (period) {
      case "1D":
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case "1W":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "1M":
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "ALL":
      default:
        startDate = new Date(0);
        break;
    }

    return await db
      .select()
      .from(portfolioHistory)
      .where(
        and(
          eq(portfolioHistory.walletAddress, walletAddress),
          gte(portfolioHistory.recordedAt, startDate)
        )
      )
      .orderBy(asc(portfolioHistory.recordedAt));
  }

  // ============ Platform Configuration ============

  async getConfig(key: string): Promise<string | null> {
    const [config] = await db
      .select()
      .from(platformConfig)
      .where(eq(platformConfig.key, key));
    return config?.value ?? null;
  }

  async setConfig(key: string, value: string, updatedBy?: string): Promise<void> {
    await db
      .insert(platformConfig)
      .values({ key, value, updatedBy, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: platformConfig.key,
        set: { value, updatedBy, updatedAt: new Date() },
      });
  }

  // ============ Collected Fees (Fee Expectations) ============

  async recordCollectedFee(fee: InsertCollectedFee): Promise<CollectedFee> {
    const [created] = await db.insert(collectedFees).values(fee).returning();
    return created;
  }

  async getRecentFees(limit: number): Promise<CollectedFee[]> {
    return await db
      .select()
      .from(collectedFees)
      .orderBy(desc(collectedFees.createdAt))
      .limit(limit);
  }

  async getFeeByOrderId(polymarketOrderId: string): Promise<CollectedFee | undefined> {
    const [fee] = await db
      .select()
      .from(collectedFees)
      .where(eq(collectedFees.polymarketOrderId, polymarketOrderId));
    return fee;
  }

  async getFeeExpectationStats(): Promise<{ totalExpectedFees: number; totalVolume: number; feeCount: number }> {
    const result = await db
      .select({
        totalExpectedFees: sql<number>`COALESCE(SUM(${collectedFees.feeAmount}), 0)`,
        totalVolume: sql<number>`COALESCE(SUM(${collectedFees.orderAmount}), 0)`,
        feeCount: sql<number>`COUNT(*)`,
      })
      .from(collectedFees);
    
    return {
      totalExpectedFees: Number(result[0]?.totalExpectedFees) || 0,
      totalVolume: Number(result[0]?.totalVolume) || 0,
      feeCount: Number(result[0]?.feeCount) || 0,
    };
  }

  async matchFeeToTransfer(feeId: string, txHash: string): Promise<void> {
    await db
      .update(collectedFees)
      .set({ txHash })
      .where(eq(collectedFees.id, feeId));
    
    await db
      .update(treasuryFeeTransfers)
      .set({ matchedFeeId: feeId })
      .where(eq(treasuryFeeTransfers.txHash, txHash));
  }

  async markFeesCollected(feeIds: string[], txHash: string): Promise<void> {
    if (feeIds.length === 0) return;
    
    await db
      .update(collectedFees)
      .set({ txHash })
      .where(inArray(collectedFees.id, feeIds));
  }

  async getUnmatchedExpectations(): Promise<CollectedFee[]> {
    return await db
      .select()
      .from(collectedFees)
      .where(sql`${collectedFees.txHash} IS NULL`)
      .orderBy(asc(collectedFees.createdAt));
  }

  async getPendingFeesForWallet(walletAddress: string): Promise<CollectedFee[]> {
    return await db
      .select()
      .from(collectedFees)
      .where(
        and(
          eq(collectedFees.walletAddress, walletAddress),
          sql`${collectedFees.txHash} IS NULL`
        )
      )
      .orderBy(asc(collectedFees.createdAt));
  }

  // ============ Treasury Fee Transfers ============

  async recordTreasuryTransfer(transfer: InsertTreasuryFeeTransfer): Promise<TreasuryFeeTransfer> {
    const [created] = await db.insert(treasuryFeeTransfers).values(transfer).returning();
    return created;
  }

  async getTreasuryTransfers(limit: number): Promise<TreasuryFeeTransfer[]> {
    return await db
      .select()
      .from(treasuryFeeTransfers)
      .orderBy(desc(treasuryFeeTransfers.blockNumber))
      .limit(limit);
  }

  async getTreasuryTransferByTxHash(txHash: string): Promise<TreasuryFeeTransfer | undefined> {
    const [transfer] = await db
      .select()
      .from(treasuryFeeTransfers)
      .where(eq(treasuryFeeTransfers.txHash, txHash));
    return transfer;
  }

  async getTreasurySummary(): Promise<{ totalCollected: number; transferCount: number; lastBlockNumber: number | null }> {
    const result = await db
      .select({
        totalCollected: sql<number>`COALESCE(SUM(${treasuryFeeTransfers.amount}), 0)`,
        transferCount: sql<number>`COUNT(*)`,
        lastBlockNumber: sql<number>`MAX(${treasuryFeeTransfers.blockNumber})`,
      })
      .from(treasuryFeeTransfers);
    
    return {
      totalCollected: Number(result[0]?.totalCollected) || 0,
      transferCount: Number(result[0]?.transferCount) || 0,
      lastBlockNumber: result[0]?.lastBlockNumber ?? null,
    };
  }

  async getUnmatchedTransfers(): Promise<TreasuryFeeTransfer[]> {
    return await db
      .select()
      .from(treasuryFeeTransfers)
      .where(sql`${treasuryFeeTransfers.matchedFeeId} IS NULL`)
      .orderBy(asc(treasuryFeeTransfers.blockNumber));
  }

  // User Profiles & Comments
  async getUserProfile(walletAddress: string): Promise<{ walletAddress: string; displayName: string | null } | undefined> {
    const [user] = await db
      .select({ walletAddress: users.walletAddress, displayName: users.displayName })
      .from(users)
      .where(eq(users.walletAddress, walletAddress));
    
    if (user && user.walletAddress) {
      return { walletAddress: user.walletAddress, displayName: user.displayName };
    }
    return undefined;
  }

  async updateDisplayName(walletAddress: string, displayName: string): Promise<string> {
    const existing = await this.getUserProfile(walletAddress);
    
    if (existing) {
      await db
        .update(users)
        .set({ displayName })
        .where(eq(users.walletAddress, walletAddress));
    } else {
      await db.insert(users).values({
        username: walletAddress,
        password: "",
        walletAddress,
        displayName,
      });
    }
    
    return displayName;
  }

  async isUsernameAvailable(displayName: string, excludeWallet?: string): Promise<boolean> {
    const normalizedName = displayName.toLowerCase();
    const existingUsers = await db
      .select({ walletAddress: users.walletAddress, displayName: users.displayName })
      .from(users)
      .where(sql`LOWER(${users.displayName}) = ${normalizedName}`);
    
    if (existingUsers.length === 0) {
      return true;
    }
    
    if (excludeWallet && existingUsers.length === 1 && 
        existingUsers[0].walletAddress?.toLowerCase() === excludeWallet.toLowerCase()) {
      return true;
    }
    
    return false;
  }

  async getMarketComments(marketType: string, marketId: string): Promise<MarketComment[]> {
    return await db
      .select()
      .from(marketComments)
      .where(and(
        eq(marketComments.marketType, marketType),
        eq(marketComments.marketId, marketId)
      ))
      .orderBy(desc(marketComments.createdAt));
  }

  async createComment(data: { walletAddress: string; marketType: string; marketId: string; content: string; displayName: string | null }): Promise<MarketComment> {
    const [comment] = await db.insert(marketComments).values({
      walletAddress: data.walletAddress,
      marketType: data.marketType,
      marketId: data.marketId,
      content: data.content,
      displayName: data.displayName,
    }).returning();
    return comment;
  }

  // Articles
  async getArticles(status?: string): Promise<Article[]> {
    if (status) {
      return await db
        .select()
        .from(articles)
        .where(eq(articles.status, status))
        .orderBy(desc(articles.publishedAt), desc(articles.createdAt));
    }
    return await db
      .select()
      .from(articles)
      .orderBy(desc(articles.publishedAt), desc(articles.createdAt));
  }

  async getArticle(id: string): Promise<Article | undefined> {
    const [article] = await db.select().from(articles).where(eq(articles.id, id));
    return article || undefined;
  }

  async getArticleBySlug(slug: string): Promise<Article | undefined> {
    const [article] = await db.select().from(articles).where(eq(articles.slug, slug));
    return article || undefined;
  }

  async createArticle(article: InsertArticle): Promise<Article> {
    const slug = this.generateSlug(article.title);
    const [created] = await db.insert(articles).values({
      ...article,
      slug,
    }).returning();
    return created;
  }

  async updateArticle(id: string, updates: Partial<Article>): Promise<Article | undefined> {
    const updateData = { ...updates, updatedAt: new Date() };
    if (updates.title) {
      (updateData as any).slug = this.generateSlug(updates.title);
    }
    const [updated] = await db
      .update(articles)
      .set(updateData)
      .where(eq(articles.id, id))
      .returning();
    return updated || undefined;
  }

  async publishArticle(id: string): Promise<Article | undefined> {
    const [published] = await db
      .update(articles)
      .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(articles.id, id))
      .returning();
    return published || undefined;
  }

  async deleteArticle(id: string): Promise<void> {
    await db.delete(articles).where(eq(articles.id, id));
  }

  private generateSlug(title: string): string {
    const base = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .substring(0, 50);
    const timestamp = Date.now().toString(36);
    return `${base}-${timestamp}`;
  }
}

export const storage = new DatabaseStorage();
