import { 
  users, teams, holdings, transactions, deposits,
  type User, type InsertUser, 
  type Team, type InsertTeam,
  type Holding, type InsertHolding,
  type Transaction, type InsertTransaction,
  type Deposit, type InsertDeposit,
  type BuySharesRequest,
  type SellSharesRequest
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, sql } from "drizzle-orm";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserBalance(id: string, newBalance: number): Promise<User | undefined>;
  
  // Teams
  getTeams(): Promise<Team[]>;
  getTeam(id: string): Promise<Team | undefined>;
  createTeam(team: InsertTeam): Promise<Team>;
  updateTeam(id: string, updates: Partial<Team>): Promise<Team | undefined>;
  seedTeams(): Promise<void>;
  
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

    // Check balance
    if (user.balance < totalCost) {
      return { success: false, error: "Insufficient balance" };
    }

    // Update user balance
    await this.updateUserBalance(userId, user.balance - totalCost);

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

    // Update user balance (add proceeds)
    await this.updateUserBalance(userId, user.balance + totalProceeds);

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
      .where(eq(deposits.stellarTxHash, txHash));
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
}

export const storage = new DatabaseStorage();
