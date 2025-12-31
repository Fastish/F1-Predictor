import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/Header";
import { HeroSection } from "@/components/HeroSection";
import { MarketOverview } from "@/components/MarketOverview";
import { PoolBuyModal } from "@/components/PoolBuyModal";
import { HowItWorks } from "@/components/HowItWorks";
import { MarketStats } from "@/components/MarketStats";
import { DepositModal } from "@/components/DepositModal";
import { useWallet } from "@/context/WalletContext";
import { useMarket } from "@/context/MarketContext";
import { useSEO } from "@/hooks/useSEO";
import { AlertCircle, Trophy } from "lucide-react";
import type { F1Team } from "@/context/MarketContext";
import type { Driver } from "@/components/DriverCard";

interface PoolOutcome {
  id: string;
  poolId: string;
  participantId: string;
  participantName: string;
  sharesOutstanding: number;
  price: number;
  probability: number;
}

interface ChampionshipPool {
  id: string;
  seasonId: string;
  type: "team" | "driver";
  status: string;
  bParameter: number;
  totalCollateral: number;
  outcomes: PoolOutcome[];
}

interface SeasonResponse {
  exists: boolean;
  status?: string;
  year?: number;
  winningTeamId?: string | null;
  prizePool?: number;
}

export default function Home() {
  useSEO({
    title: "F1 Prediction Market 2026",
    description: "Trade on the 2026 Formula 1 Championship. Buy shares in F1 teams and drivers using USDC on Polygon. Win from the prize pool when the season ends."
  });

  const { walletAddress } = useWallet();
  const { teams, userId } = useMarket();
  const [selectedTeam, setSelectedTeam] = useState<F1Team | null>(null);
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [selectedPool, setSelectedPool] = useState<ChampionshipPool | null>(null);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [connectWalletModalOpen, setConnectWalletModalOpen] = useState(false);

  const { data: season } = useQuery<SeasonResponse>({
    queryKey: ["/api/season"],
  });

  const { data: teamPool } = useQuery<ChampionshipPool>({
    queryKey: ["/api/pools/type/team"],
    refetchInterval: 5000,
  });

  const { data: driverPool } = useQuery<ChampionshipPool>({
    queryKey: ["/api/pools/type/driver"],
    refetchInterval: 5000,
  });

  const isSeasonConcluded = season?.exists && season.status === "concluded";
  const winningTeam = season?.winningTeamId 
    ? teams.find((t) => t.id === season.winningTeamId) 
    : null;

  const handleBuyTeam = (team: F1Team) => {
    if (isSeasonConcluded) {
      return;
    }
    if (!teamPool) {
      return;
    }
    setSelectedDriver(null);
    setSelectedTeam(team);
    setSelectedPool(teamPool);
    setOrderModalOpen(true);
  };

  const handleBuyDriver = (driver: Driver) => {
    if (isSeasonConcluded) {
      return;
    }
    if (!driverPool) {
      return;
    }
    setSelectedTeam(null);
    setSelectedDriver(driver);
    setSelectedPool(driverPool);
    setOrderModalOpen(true);
  };

  const handleStartTrading = () => {
    const marketSection = document.getElementById("market-section");
    marketSection?.scrollIntoView({ behavior: "smooth" });
  };

  const handleCloseOrderModal = () => {
    setOrderModalOpen(false);
    setSelectedPool(null);
    setSelectedTeam(null);
    setSelectedDriver(null);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      {isSeasonConcluded && (
        <div className="bg-amber-500/10 border-b border-amber-500/20">
          <div className="mx-auto max-w-7xl px-4 py-3">
            <div className="flex items-center justify-center gap-2 text-amber-600 dark:text-amber-400">
              <Trophy className="h-5 w-5" />
              <span className="font-medium">
                Season {season?.year} has concluded! 
                {winningTeam && ` Champion: ${winningTeam.name}.`}
                {season?.prizePool && ` Prize Pool: $${season.prizePool.toFixed(2)}`}
              </span>
              <AlertCircle className="h-4 w-4 ml-2" />
              <span className="text-sm">Trading is locked.</span>
            </div>
          </div>
        </div>
      )}
      
      <HeroSection onStartTrading={handleStartTrading} />
      <div id="market-section">
        <MarketOverview onBuyTeam={handleBuyTeam} onBuyDriver={handleBuyDriver} />
      </div>
      <HowItWorks />
      <MarketStats />

      {selectedPool && (selectedTeam || selectedDriver) && userId && (
        <PoolBuyModal
          open={orderModalOpen}
          onClose={handleCloseOrderModal}
          pool={selectedPool}
          participantId={selectedTeam?.id || selectedDriver?.id || ""}
          participantName={selectedTeam?.name || selectedDriver?.name || ""}
          participantColor={selectedTeam?.color || selectedDriver?.color || "#888"}
          userId={userId}
        />
      )}

      <DepositModal
        open={connectWalletModalOpen}
        onOpenChange={setConnectWalletModalOpen}
      />

      <footer className="border-t py-8">
        <div className="mx-auto max-w-7xl px-4 text-center text-sm text-muted-foreground">
          <p>F1 Predict - Predictive Market Platform</p>
          <p className="mt-1">
            This site is powered by Polymarket.com
          </p>
          <p className="mt-1">All orders are subject to <a href="https://polymarket.com/tos" className="underline">Polymarket terms</a></p>
        </div>
      </footer>
    </div>
  );
}
