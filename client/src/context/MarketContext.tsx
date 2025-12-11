import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Team, Holding, User, Transaction } from "@shared/schema";

export type { Team as F1Team } from "@shared/schema";

interface MarketContextType {
  teams: Team[];
  holdings: Holding[];
  balance: number;
  prizePool: number;
  userId: string | null;
  isLoading: boolean;
  buyShares: (teamId: string, quantity: number) => Promise<boolean>;
  getTeam: (teamId: string) => Team | undefined;
  getHolding: (teamId: string) => Holding | undefined;
  getTotalInvestment: () => number;
  getCurrentValue: () => number;
  refetch: () => void;
}

const MarketContext = createContext<MarketContextType | undefined>(undefined);

const USER_STORAGE_KEY = "f1predict_user_id";

export function MarketProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(USER_STORAGE_KEY);
    }
    return null;
  });

  // Create guest user if none exists
  useEffect(() => {
    async function createGuestUser() {
      if (!userId) {
        try {
          const res = await fetch("/api/users/guest", { method: "POST" });
          const user: User = await res.json();
          setUserId(user.id);
          localStorage.setItem(USER_STORAGE_KEY, user.id);
        } catch (error) {
          console.error("Failed to create guest user:", error);
        }
      }
    }
    createGuestUser();
  }, [userId]);

  // Fetch teams
  const { data: teams = [], isLoading: teamsLoading } = useQuery<Team[]>({
    queryKey: ["/api/teams"],
  });

  // Fetch user data
  const { data: userData } = useQuery<{ id: string; username: string; balance: number }>({
    queryKey: ["/api/users", userId],
    enabled: !!userId,
  });

  // Fetch holdings
  const { data: holdings = [] } = useQuery<Holding[]>({
    queryKey: ["/api/users", userId, "holdings"],
    enabled: !!userId,
  });

  // Fetch prize pool
  const { data: prizePoolData } = useQuery<{ prizePool: number }>({
    queryKey: ["/api/market/prize-pool"],
  });

  // Buy shares mutation
  const buyMutation = useMutation({
    mutationFn: async ({ teamId, quantity }: { teamId: string; quantity: number }) => {
      const res = await fetch("/api/trade/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, quantity, userId }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Trade failed");
      }
      return res.json() as Promise<{ success: boolean; transaction: Transaction }>;
    },
    onSuccess: () => {
      // Invalidate all relevant queries
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "holdings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/market/prize-pool"] });
    },
  });

  const balance = userData?.balance ?? 100;
  const prizePool = prizePoolData?.prizePool ?? 0;

  const getTeam = (teamId: string) => teams.find((t) => t.id === teamId);
  const getHolding = (teamId: string) => holdings.find((h) => h.teamId === teamId);

  const getTotalInvestment = () => {
    return holdings.reduce((acc, h) => acc + h.shares * h.avgPrice, 0);
  };

  const getCurrentValue = () => {
    return holdings.reduce((acc, h) => {
      const team = getTeam(h.teamId);
      return acc + h.shares * (team?.price || 0);
    }, 0);
  };

  const buyShares = async (teamId: string, quantity: number): Promise<boolean> => {
    if (!userId) return false;
    try {
      const result = await buyMutation.mutateAsync({ teamId, quantity });
      return result.success;
    } catch (error) {
      console.error("Buy shares error:", error);
      return false;
    }
  };

  const refetch = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
    queryClient.invalidateQueries({ queryKey: ["/api/users", userId] });
    queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "holdings"] });
    queryClient.invalidateQueries({ queryKey: ["/api/market/prize-pool"] });
  };

  return (
    <MarketContext.Provider
      value={{
        teams,
        holdings,
        balance,
        prizePool,
        userId,
        isLoading: teamsLoading,
        buyShares,
        getTeam,
        getHolding,
        getTotalInvestment,
        getCurrentValue,
        refetch,
      }}
    >
      {children}
    </MarketContext.Provider>
  );
}

export function useMarket() {
  const context = useContext(MarketContext);
  if (!context) {
    throw new Error("useMarket must be used within a MarketProvider");
  }
  return context;
}
