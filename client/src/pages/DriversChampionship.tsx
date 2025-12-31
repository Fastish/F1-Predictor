import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/Header";
import { DriverCard, type Driver } from "@/components/DriverCard";
import { PolymarketPriceChart } from "@/components/PolymarketPriceChart";
import { PolymarketBetModal } from "@/components/PolymarketBetModal";
import { CommentsSection } from "@/components/CommentsSection";
import { ArbitrageSummary, type ArbitrageOpportunity } from "@/components/ArbitrageValueBadge";
import { useWallet } from "@/context/WalletContext";
import { useSEO } from "@/hooks/useSEO";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { User, Loader2, TrendingUp, Users, DollarSign, Info } from "lucide-react";

interface PolymarketOutcome {
  id: string;
  name: string;
  tokenId: string;
  yesTokenId?: string;
  noTokenId?: string;
  price: number;
  noPrice?: number;
  volume: string;
  liquidity?: string;
  conditionId: string;
  questionId: string;
  image?: string;
  priceChange?: number;
}

const driverTeamColors: Record<string, string> = {
  "Max Verstappen": "#1E41FF",
  "Lando Norris": "#FF8700",
  "Lewis Hamilton": "#DC0000",
  "George Russell": "#00D2BE",
  "Charles Leclerc": "#DC0000",
  "Oscar Piastri": "#FF8700",
  "Kimi Antonelli": "#00D2BE",
  "Fernando Alonso": "#006F62",
  "Carlos Sainz": "#005AFF",
  "Carlos Sainz Jr.": "#005AFF",
  "Liam Lawson": "#1E41FF",
  "Pierre Gasly": "#0090FF",
  "Yuki Tsunoda": "#2B4562",
  "Alex Albon": "#005AFF",
  "Alexander Albon": "#005AFF",
  "Lance Stroll": "#006F62",
  "Nico Hulkenberg": "#FF0000",
  "Nico Hülkenberg": "#FF0000",
  "Esteban Ocon": "#B6BABD",
  "Oliver Bearman": "#B6BABD",
  "Jack Doohan": "#0090FF",
  "Isack Hadjar": "#2B4562",
  "Gabriel Bortoleto": "#FF0000",
  "Franco Colapinto": "#005AFF",
  "Valtteri Bottas": "#FF0000",
  "Sergio Pérez": "#1E41FF",
  "Arvid Lindblad": "#1E41FF",
};

export default function DriversChampionship() {
  useSEO({
    title: "2026 Drivers Championship",
    description: "Bet on who will win the 2026 F1 World Drivers Championship. Trade Verstappen, Norris, Hamilton, Leclerc and more with real USDC on Polymarket."
  });

  const { walletAddress, getUsdcBalance } = useWallet();
  const [selectedOutcome, setSelectedOutcome] = useState<PolymarketOutcome | null>(null);
  const [betModalOpen, setBetModalOpen] = useState(false);

  const { data: usdcBalance = "0" } = useQuery({
    queryKey: ["usdc-balance", walletAddress],
    queryFn: () => getUsdcBalance(),
    enabled: !!walletAddress,
    refetchInterval: 30000,
  });

  const { data: drivers = [], isLoading } = useQuery<PolymarketOutcome[]>({
    queryKey: ["/api/polymarket/drivers"],
    refetchInterval: 30000,
  });

  const { data: arbitrageData } = useQuery<{
    constructors: ArbitrageOpportunity[];
    drivers: ArbitrageOpportunity[];
    lastUpdated: string | null;
    hasLiveOdds: boolean;
    dataSource: string;
  }>({
    queryKey: ["/api/arbitrage/opportunities"],
    refetchInterval: 60000,
  });

  const driverOpportunities = arbitrageData?.drivers || [];
  const getArbitrageOpportunity = (driverName: string) => 
    driverOpportunities.find(o => o.outcomeName === driverName);

  const totalVolume = drivers.reduce((sum, d) => sum + parseFloat(d.volume || "0"), 0);
  const totalLiquidity = drivers.reduce((sum, d) => sum + parseFloat(d.liquidity || "0"), 0);
  const participantCount = drivers.filter(d => parseFloat(d.volume || "0") > 0).length;

  const isValidDriverName = (name: string): boolean => {
    const trimmed = name.trim();
    const words = trimmed.split(/\s+/);
    if (words.length < 2) return false;
    const invalidNames = ["other", "field", "none", "n/a", "tbd", "unknown"];
    if (invalidNames.some(invalid => trimmed.toLowerCase().includes(invalid))) return false;
    if (/^driver\s+[a-z]$/i.test(trimmed)) return false;
    return true;
  };

  const driversFromPolymarket: Driver[] = drivers
    .filter((outcome) => isValidDriverName(outcome.name))
    .map((outcome, index) => ({
      id: outcome.id,
      name: outcome.name,
      shortName: outcome.name.split(" ").pop()?.substring(0, 3).toUpperCase() || "DRV",
      teamId: "polymarket",
      number: index + 1,
      color: driverTeamColors[outcome.name] || "#888888",
      price: outcome.price,
      priceChange: outcome.priceChange || 0,
    }));

  const sortedDrivers = [...driversFromPolymarket].sort((a, b) => b.price - a.price);

  const handleBuyDriver = (driver: Driver) => {
    const outcome = drivers.find((d) => d.id === driver.id);
    if (outcome) {
      setSelectedOutcome(outcome);
      setBetModalOpen(true);
    }
  };

  const handleCloseModal = () => {
    setBetModalOpen(false);
    setSelectedOutcome(null);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <User className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold" data-testid="text-drivers-title">
              Drivers Championship
            </h1>
          </div>
          <p className="text-muted-foreground text-lg">
            F1 2026 World Drivers' Championship predictions powered by Polymarket
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3 mb-8">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-primary/10">
                  <DollarSign className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <p className="text-sm text-muted-foreground flex items-center gap-1 cursor-help">
                        Total Volume
                        <Info className="h-3 w-3" />
                      </p>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <p className="text-sm">Total USDC traded across all driver markets since launch.</p>
                    </TooltipContent>
                  </Tooltip>
                  <p className="text-xl font-bold tabular-nums" data-testid="text-drivers-volume">
                    ${totalVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-primary/10">
                  <TrendingUp className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <p className="text-sm text-muted-foreground flex items-center gap-1 cursor-help">
                        Market Depth
                        <Info className="h-3 w-3" />
                      </p>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <p className="text-sm">Current USDC available in market pools. Higher depth means less slippage on trades.</p>
                    </TooltipContent>
                  </Tooltip>
                  <p className="text-xl font-bold tabular-nums" data-testid="text-drivers-liquidity">
                    ${totalLiquidity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-primary/10">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Active Markets</p>
                  <p className="text-xl font-bold tabular-nums" data-testid="text-drivers-markets">
                    {participantCount}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <PolymarketPriceChart 
          outcomes={drivers}
          type="drivers"
          selectedOutcome={selectedOutcome}
          onSelectOutcome={(outcome) => {
            setSelectedOutcome(outcome);
            setBetModalOpen(true);
          }}
        />

        {driverOpportunities.length > 0 && (
          <ArbitrageSummary 
            opportunities={driverOpportunities}
            dataSource={arbitrageData?.dataSource || "Unknown"}
            hasLiveOdds={arbitrageData?.hasLiveOdds || false}
          />
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : sortedDrivers.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <User className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Driver markets are not yet available on Polymarket.</p>
            <p className="text-sm mt-2">
              <a
                href="https://polymarket.com/event/2026-f1-drivers-champion"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Check Polymarket for updates
              </a>
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sortedDrivers.map((driver) => (
              <DriverCard
                key={driver.id}
                driver={driver}
                onBuy={handleBuyDriver}
                tradingLocked={false}
                arbitrageOpportunity={getArbitrageOpportunity(driver.name)}
              />
            ))}
          </div>
        )}

        <CommentsSection 
          marketType="driver"
          marketId="f1-2026-drivers"
          marketName="2026 Drivers Championship"
        />
      </main>

      {selectedOutcome && (
        <PolymarketBetModal
          open={betModalOpen}
          onClose={handleCloseModal}
          outcome={selectedOutcome}
          userBalance={parseFloat(usdcBalance || "0")}
        />
      )}
    </div>
  );
}
