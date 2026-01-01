import { useQuery } from "@tanstack/react-query";
import { useTradingSession } from "./useTradingSession";
import { useWallet } from "@/context/WalletContext";

export interface PolymarketPosition {
  tokenId: string;
  outcome: string;
  size: number;
  averagePrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  value: number;
  conditionId?: string;
  marketSlug?: string;
  side?: "YES" | "NO";
  title?: string;
  icon?: string;
  eventSlug?: string;
}

export interface PositionsResponse {
  positions: PolymarketPosition[];
  totalValue: number;
  totalPnl: number;
  error?: string;
}

export function usePolymarketPositions() {
  const { walletAddress } = useWallet();
  const { tradingSession, clobClient, isTradingSessionComplete } = useTradingSession();
  
  const safeAddress = tradingSession?.safeAddress;

  return useQuery<PositionsResponse>({
    queryKey: ["polymarket-positions", safeAddress],
    queryFn: async () => {
      if (!clobClient || !safeAddress) {
        return { positions: [], totalValue: 0, totalPnl: 0 };
      }

      const response = await fetch(`/api/polymarket/positions/${safeAddress}`);
      if (!response.ok) {
        const errorText = await response.text();
        console.error("Failed to fetch positions:", errorText);
        throw new Error(`Failed to fetch positions: ${response.status}`);
      }
      
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }
      return data as PositionsResponse;
    },
    enabled: !!safeAddress && !!clobClient && isTradingSessionComplete,
    refetchInterval: 30000,
    retry: 1,
  });
}
