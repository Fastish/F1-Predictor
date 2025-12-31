import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/Header";
import { TeamCard } from "@/components/TeamCard";
import { PolymarketPriceChart } from "@/components/PolymarketPriceChart";
import { PolymarketBetModal } from "@/components/PolymarketBetModal";
import { CommentsSection } from "@/components/CommentsSection";
import { ArbitrageSummary, type ArbitrageOpportunity } from "@/components/ArbitrageValueBadge";
import { useMarket, type F1Team } from "@/context/MarketContext";
import { useWallet } from "@/context/WalletContext";
import { useSEO } from "@/hooks/useSEO";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Car, Loader2, TrendingUp, Users, DollarSign, Info } from "lucide-react";

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

const teamColors: Record<string, string> = {
  "McLaren": "#FF8700",
  "Red Bull Racing": "#1E41FF",
  "Ferrari": "#DC0000",
  "Mercedes": "#00D2BE",
  "Aston Martin": "#006F62",
  "Williams": "#005AFF",
  "Audi": "#FF0000",
  "Alpine": "#0090FF",
  "Cadillac": "#C4A747",
  "Haas": "#B6BABD",
  "Racing Bulls": "#2B4562",
  "Other": "#888888",
};

export default function ConstructorsChampionship() {
  useSEO({
    title: "2026 Constructors Championship",
    description: "Bet on which F1 team will win the 2026 Constructors Championship. Trade McLaren, Ferrari, Red Bull, Mercedes and more with real USDC on Polymarket."
  });

  const { getHolding } = useMarket();
  const { walletAddress, getUsdcBalance } = useWallet();
  const [selectedOutcome, setSelectedOutcome] = useState<PolymarketOutcome | null>(null);
  const [betModalOpen, setBetModalOpen] = useState(false);
  const [arbFilter, setArbFilter] = useState<"all" | "buy_yes" | "buy_no">("all");

  const { data: usdcBalance = "0" } = useQuery({
    queryKey: ["usdc-balance", walletAddress],
    queryFn: () => getUsdcBalance(),
    enabled: !!walletAddress,
    refetchInterval: 30000,
  });

  const { data: constructors = [], isLoading } = useQuery<PolymarketOutcome[]>({
    queryKey: ["/api/polymarket/constructors"],
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

  const constructorOpportunities = arbitrageData?.constructors || [];
  const getArbitrageOpportunity = (teamName: string) => 
    constructorOpportunities.find(o => o.outcomeName === teamName);

  const totalVolume = constructors.reduce((sum, c) => sum + parseFloat(c.volume || "0"), 0);
  const totalLiquidity = constructors.reduce((sum, c) => sum + parseFloat(c.liquidity || "0"), 0);
  const participantCount = constructors.filter(c => parseFloat(c.volume || "0") > 0).length;

  const teamsFromPolymarket: F1Team[] = constructors.map((outcome) => ({
    id: outcome.id,
    name: outcome.name,
    shortName: outcome.name.substring(0, 3).toUpperCase(),
    color: teamColors[outcome.name] || "#888888",
    price: outcome.price,
    priceChange: outcome.priceChange || 0,
    totalShares: 10000,
    availableShares: 10000,
  }));

  const sortedTeams = [...teamsFromPolymarket].sort((a, b) => b.price - a.price);

  const handleBuyTeam = (team: F1Team) => {
    const outcome = constructors.find((c) => c.id === team.id);
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
            <Car className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold" data-testid="text-constructors-title">
              Constructors Championship
            </h1>
          </div>
          <p className="text-muted-foreground text-lg">
            F1 2026 World Constructors' Championship predictions powered by Polymarket
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
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="text-sm text-muted-foreground flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors">
                        Total Volume
                        <Info className="h-3 w-3" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="top" className="max-w-xs">
                      <p className="text-sm">Total USDC traded across all constructor markets since launch.</p>
                    </PopoverContent>
                  </Popover>
                  <p className="text-xl font-bold tabular-nums" data-testid="text-constructors-volume">
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
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="text-sm text-muted-foreground flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors">
                        Market Depth
                        <Info className="h-3 w-3" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="top" className="max-w-xs">
                      <p className="text-sm">Current USDC available in market pools. Higher depth means less slippage on trades.</p>
                    </PopoverContent>
                  </Popover>
                  <p className="text-xl font-bold tabular-nums" data-testid="text-constructors-liquidity">
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
                  <p className="text-xl font-bold tabular-nums" data-testid="text-constructors-markets">
                    {participantCount}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <PolymarketPriceChart 
          outcomes={constructors}
          type="constructors"
          selectedOutcome={selectedOutcome}
          onSelectOutcome={(outcome) => {
            setSelectedOutcome(outcome);
            setBetModalOpen(true);
          }}
        />

        {constructorOpportunities.length > 0 && (
          <ArbitrageSummary 
            opportunities={constructorOpportunities}
            dataSource={arbitrageData?.dataSource || "Unknown"}
            hasLiveOdds={arbitrageData?.hasLiveOdds || false}
            onFilterChange={setArbFilter}
            activeFilter={arbFilter}
          />
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sortedTeams
              .filter((team) => {
                if (arbFilter === "all") return true;
                const opportunity = getArbitrageOpportunity(team.name);
                if (!opportunity) return false;
                if (arbFilter === "buy_yes") return opportunity.recommendation === "BUY_YES";
                if (arbFilter === "buy_no") return opportunity.recommendation === "BUY_NO";
                return true;
              })
              .map((team) => (
              <TeamCard
                key={team.id}
                team={team}
                onBuy={handleBuyTeam}
                owned={getHolding(team.id)?.shares}
                tradingLocked={false}
                arbitrageOpportunity={getArbitrageOpportunity(team.name)}
              />
            ))}
          </div>
        )}

        <CommentsSection 
          marketType="constructor"
          marketId="f1-2026-constructors"
          marketName="2026 Constructors Championship"
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
