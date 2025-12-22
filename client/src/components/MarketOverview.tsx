import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TeamCard } from "./TeamCard";
import { DriverCard, type Driver } from "./DriverCard";
import { TeamValueChart } from "./TeamValueChart";
import { PolymarketBetModal } from "./PolymarketBetModal";
import { useMarket, type F1Team } from "@/context/MarketContext";
import { useWallet } from "@/context/WalletContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Car, User, Trophy, DollarSign, ExternalLink, Loader2 } from "lucide-react";

interface MarketOverviewProps {
  onBuyTeam?: (team: F1Team) => void;
  onBuyDriver?: (driver: Driver) => void;
}

interface PolymarketOutcome {
  id: string;
  name: string;
  tokenId: string;
  yesTokenId?: string;
  noTokenId?: string;
  price: number;
  noPrice?: number;
  volume: string;
  conditionId: string;
  questionId: string;
  image?: string;
}

interface DriverFromAPI {
  id: string;
  name: string;
  shortName: string;
  teamId: string;
  number: number;
  color: string;
}

// Team colors mapping for Polymarket teams
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

// Driver team color mapping
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
  "Liam Lawson": "#1E41FF",
  "Pierre Gasly": "#0090FF",
  "Yuki Tsunoda": "#2B4562",
  "Alex Albon": "#005AFF",
  "Lance Stroll": "#006F62",
  "Nico Hulkenberg": "#FF0000",
  "Esteban Ocon": "#B6BABD",
  "Oliver Bearman": "#B6BABD",
  "Jack Doohan": "#0090FF",
  "Isack Hadjar": "#2B4562",
  "Gabriel Bortoleto": "#FF0000",
};

export function MarketOverview({ onBuyTeam, onBuyDriver }: MarketOverviewProps) {
  const { getHolding } = useMarket();
  const { walletAddress, getUsdcBalance } = useWallet();
  const [activeTab, setActiveTab] = useState<"teams" | "drivers">("teams");
  const [selectedOutcome, setSelectedOutcome] = useState<PolymarketOutcome | null>(null);
  const [betModalOpen, setBetModalOpen] = useState(false);

  // Fetch USDC balance
  const { data: usdcBalance = "0" } = useQuery({
    queryKey: ["usdc-balance", walletAddress],
    queryFn: () => getUsdcBalance(),
    enabled: !!walletAddress,
    refetchInterval: 30000,
  });

  // Fetch Polymarket constructors data
  const { data: constructors = [], isLoading: loadingConstructors } = useQuery<PolymarketOutcome[]>({
    queryKey: ["/api/polymarket/constructors"],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch Polymarket drivers data
  const { data: drivers = [], isLoading: loadingDrivers } = useQuery<PolymarketOutcome[]>({
    queryKey: ["/api/polymarket/drivers"],
    refetchInterval: 30000,
  });

  // Calculate total volume for display
  const constructorVolume = constructors.reduce((sum, c) => sum + parseFloat(c.volume || "0"), 0);
  const driverVolume = drivers.reduce((sum, d) => sum + parseFloat(d.volume || "0"), 0);

  // Map Polymarket outcomes to F1Team format for TeamCard
  const teamsFromPolymarket: F1Team[] = constructors.map((outcome) => ({
    id: outcome.id,
    name: outcome.name,
    shortName: outcome.name.substring(0, 3).toUpperCase(),
    color: teamColors[outcome.name] || "#888888",
    price: outcome.price,
    priceChange: 0, // Would need historical data
    totalShares: 10000,
    availableShares: 10000,
  }));

  // Map Polymarket outcomes to Driver format for DriverCard
  const driversFromPolymarket: Driver[] = drivers.map((outcome, index) => ({
    id: outcome.id,
    name: outcome.name,
    shortName: outcome.name.split(" ").pop()?.substring(0, 3).toUpperCase() || "DRV",
    teamId: "polymarket",
    number: index + 1,
    color: driverTeamColors[outcome.name] || "#888888",
    price: outcome.price,
    priceChange: 0,
  }));

  const sortedTeams = [...teamsFromPolymarket].sort((a, b) => b.price - a.price);
  const sortedDrivers = [...driversFromPolymarket].sort((a, b) => b.price - a.price);

  const handleBuyTeam = (team: F1Team) => {
    const outcome = constructors.find((c) => c.id === team.id);
    if (outcome) {
      setSelectedOutcome(outcome);
      setBetModalOpen(true);
    }
  };

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
    <section className="py-12">
      <div className="mx-auto max-w-7xl px-4">
        <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold" data-testid="text-market-title">F1 2026 Championship</h2>
            <p className="text-muted-foreground">
              Live odds from Polymarket prediction markets
            </p>
          </div>
          <a
            href="https://polymarket.com/event/f1-constructors-champion"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <ExternalLink className="h-4 w-4" />
            View on Polymarket
          </a>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "teams" | "drivers")} className="w-full">
          <TabsList className="mb-6">
            <TabsTrigger value="teams" data-testid="tab-teams" className="gap-2">
              <Car className="h-4 w-4" />
              Constructors
            </TabsTrigger>
            <TabsTrigger value="drivers" data-testid="tab-drivers" className="gap-2">
              <User className="h-4 w-4" />
              Drivers
            </TabsTrigger>
          </TabsList>

          <TabsContent value="teams">
            {/* Market Summary for Constructors */}
            <Card className="mb-6">
              <CardContent className="py-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                      <Trophy className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Constructors Championship</p>
                      <p className="font-semibold" data-testid="text-team-pool-name">Total Volume</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-5 w-5 text-green-500" />
                    <span className="text-2xl font-bold" data-testid="text-team-prize-pool">
                      ${constructorVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {loadingConstructors ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {sortedTeams.map((team) => (
                  <TeamCard
                    key={team.id}
                    team={team}
                    onBuy={handleBuyTeam}
                    owned={getHolding(team.id)?.shares}
                    tradingLocked={false}
                  />
                ))}
              </div>
            )}

            {/* Chart for Teams */}
            <div className="mt-8">
              <TeamValueChart type="teams" />
            </div>
          </TabsContent>

          <TabsContent value="drivers">
            {/* Market Summary for Drivers */}
            <Card className="mb-6">
              <CardContent className="py-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Drivers Championship</p>
                      <p className="font-semibold" data-testid="text-driver-pool-name">Total Volume</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-5 w-5 text-green-500" />
                    <span className="text-2xl font-bold" data-testid="text-driver-prize-pool">
                      ${driverVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {loadingDrivers ? (
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
                  />
                ))}
              </div>
            )}

            {/* Chart for Drivers */}
            <div className="mt-8">
              <TeamValueChart type="drivers" />
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Polymarket Betting Modal */}
      {selectedOutcome && (
        <PolymarketBetModal
          open={betModalOpen}
          onClose={handleCloseModal}
          outcome={selectedOutcome}
          userBalance={parseFloat(usdcBalance || "0")}
        />
      )}
    </section>
  );
}
