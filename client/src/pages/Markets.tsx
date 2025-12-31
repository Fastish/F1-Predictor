import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/Header";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWallet } from "@/context/WalletContext";
import { useSEO } from "@/hooks/useSEO";
import { TrendingUp, Wallet, Car, User } from "lucide-react";
import { DepositModal } from "@/components/DepositModal";
import { PolymarketBetModal } from "@/components/PolymarketBetModal";

interface PolymarketOutcome {
  id: string;
  name: string;
  tokenId: string;
  price: number;
  volume: string;
  conditionId: string;
  questionId: string;
  image?: string;
}

// Team colors for F1 constructors
const teamColors: Record<string, string> = {
  "Red Bull": "#1E41FF",
  "Red Bull Racing": "#1E41FF",
  "Ferrari": "#DC0000",
  "Scuderia Ferrari": "#DC0000",
  "Mercedes": "#00D2BE",
  "Mercedes-AMG": "#00D2BE",
  "McLaren": "#FF8700",
  "McLaren F1": "#FF8700",
  "Aston Martin": "#006F62",
  "Alpine": "#0090FF",
  "Alpine F1": "#0090FF",
  "Williams": "#005AFF",
  "Williams Racing": "#005AFF",
  "RB": "#2B4562",
  "Visa Cash App RB": "#2B4562",
  "Kick Sauber": "#52E252",
  "Sauber": "#52E252",
  "Haas": "#B6BABD",
  "Haas F1 Team": "#B6BABD",
};

// Driver team associations
const driverTeams: Record<string, { team: string; color: string; number: number }> = {
  "Max Verstappen": { team: "Red Bull", color: "#1E41FF", number: 1 },
  "Liam Lawson": { team: "Red Bull", color: "#1E41FF", number: 30 },
  "Charles Leclerc": { team: "Ferrari", color: "#DC0000", number: 16 },
  "Lewis Hamilton": { team: "Ferrari", color: "#DC0000", number: 44 },
  "George Russell": { team: "Mercedes", color: "#00D2BE", number: 63 },
  "Andrea Kimi Antonelli": { team: "Mercedes", color: "#00D2BE", number: 12 },
  "Kimi Antonelli": { team: "Mercedes", color: "#00D2BE", number: 12 },
  "Lando Norris": { team: "McLaren", color: "#FF8700", number: 4 },
  "Oscar Piastri": { team: "McLaren", color: "#FF8700", number: 81 },
  "Fernando Alonso": { team: "Aston Martin", color: "#006F62", number: 14 },
  "Lance Stroll": { team: "Aston Martin", color: "#006F62", number: 18 },
  "Pierre Gasly": { team: "Alpine", color: "#0090FF", number: 10 },
  "Jack Doohan": { team: "Alpine", color: "#0090FF", number: 5 },
  "Alex Albon": { team: "Williams", color: "#005AFF", number: 23 },
  "Carlos Sainz": { team: "Williams", color: "#005AFF", number: 55 },
  "Yuki Tsunoda": { team: "RB", color: "#2B4562", number: 22 },
  "Isack Hadjar": { team: "RB", color: "#2B4562", number: 6 },
  "Nico Hulkenberg": { team: "Sauber", color: "#52E252", number: 27 },
  "Gabriel Bortoleto": { team: "Sauber", color: "#52E252", number: 49 },
  "Esteban Ocon": { team: "Haas", color: "#B6BABD", number: 31 },
  "Oliver Bearman": { team: "Haas", color: "#B6BABD", number: 87 },
};

function getTeamColor(name: string): string {
  for (const [key, color] of Object.entries(teamColors)) {
    if (name.toLowerCase().includes(key.toLowerCase())) {
      return color;
    }
  }
  return "#888888";
}

function getDriverInfo(name: string): { team: string; color: string; number: number } | null {
  for (const [driverName, info] of Object.entries(driverTeams)) {
    if (name.toLowerCase().includes(driverName.toLowerCase())) {
      return info;
    }
  }
  return null;
}

export default function Markets() {
  useSEO({
    title: "All F1 Markets",
    description: "Browse all 2026 Formula 1 prediction markets. Trade on Constructors and Drivers championships with real USDC. Live prices powered by Polymarket."
  });

  const { walletAddress, connectWallet, isConnecting } = useWallet();
  const [activeTab, setActiveTab] = useState<"teams" | "drivers">("teams");
  const [selectedOutcome, setSelectedOutcome] = useState<PolymarketOutcome | null>(null);
  const [betModalOpen, setBetModalOpen] = useState(false);
  const [connectWalletModalOpen, setConnectWalletModalOpen] = useState(false);

  const { data: constructors = [], isLoading: constructorsLoading } = useQuery<PolymarketOutcome[]>({
    queryKey: ["/api/polymarket/constructors"],
    refetchInterval: 30000,
  });

  const { data: drivers = [], isLoading: driversLoading } = useQuery<PolymarketOutcome[]>({
    queryKey: ["/api/polymarket/drivers"],
    refetchInterval: 30000,
  });

  const { data: usdcBalance } = useQuery<string>({
    queryKey: ["polygon-usdc-balance", walletAddress],
    queryFn: async () => {
      if (!walletAddress) return "0";
      const { getUsdcBalance } = await import("@/lib/polygon");
      return await getUsdcBalance(walletAddress);
    },
    enabled: !!walletAddress,
    staleTime: 30000,
  });

  const walletUsdcBalance = parseFloat(usdcBalance || "0");

  const handleBetClick = (outcome: PolymarketOutcome) => {
    if (!walletAddress) {
      setConnectWalletModalOpen(true);
      return;
    }
    setSelectedOutcome(outcome);
    setBetModalOpen(true);
  };

  const renderSkeletonCards = () => (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </CardContent>
        </Card>
      ))}
    </div>
  );

  const sortedConstructors = [...constructors].sort((a, b) => b.price - a.price);
  const sortedDrivers = [...drivers].sort((a, b) => b.price - a.price);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Polymarket F1 Predictions</h1>
            <p className="text-muted-foreground">
              Trade on teams or drivers winning the 2026 F1 Championship via Polymarket
            </p>
          </div>
          
          {walletAddress ? (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1">
                <Wallet className="h-3 w-3" />
                {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
              </Badge>
              <Badge variant="secondary">
                ${walletUsdcBalance.toFixed(2)} USDC
              </Badge>
            </div>
          ) : (
            <Button onClick={() => connectWallet()} disabled={isConnecting} data-testid="button-connect-wallet">
              <Wallet className="mr-2 h-4 w-4" />
              Connect Wallet to Trade
            </Button>
          )}
        </div>

        {constructors.length === 0 && drivers.length === 0 && !constructorsLoading && !driversLoading && (
          <Card className="mb-6 border-amber-500/30 bg-amber-500/5">
            <CardContent className="flex items-center gap-3 py-4">
              <TrendingUp className="h-5 w-5 text-amber-500" />
              <div>
                <p className="font-medium text-amber-600 dark:text-amber-400">
                  Loading Markets from Polymarket
                </p>
                <p className="text-sm text-muted-foreground">
                  Fetching live F1 championship markets from Polymarket...
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "teams" | "drivers")} className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="teams" data-testid="tab-teams" className="gap-2">
              <Car className="h-4 w-4" />
              Constructors ({constructors.length})
            </TabsTrigger>
            <TabsTrigger value="drivers" data-testid="tab-drivers" className="gap-2">
              <User className="h-4 w-4" />
              Drivers ({drivers.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="teams">
            {constructorsLoading ? renderSkeletonCards() : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {sortedConstructors.map((outcome) => {
                  const color = getTeamColor(outcome.name);
                  const pricePercent = (outcome.price * 100).toFixed(1);

                  return (
                    <Card key={outcome.id} className="relative overflow-visible">
                      <div
                        className="absolute left-0 top-0 h-1 w-full rounded-t-lg"
                        style={{ backgroundColor: color }}
                      />
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div
                              className="h-4 w-4 rounded-full"
                              style={{ backgroundColor: color }}
                            />
                            <CardTitle className="text-base">{outcome.name}</CardTitle>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-md bg-green-500/10 p-2 text-center">
                            <p className="text-xs text-muted-foreground mb-1">YES Price</p>
                            <p className="text-lg font-bold text-green-600 dark:text-green-400" data-testid={`text-yes-price-${outcome.id}`}>
                              {pricePercent}c
                            </p>
                          </div>
                          <div className="rounded-md bg-red-500/10 p-2 text-center">
                            <p className="text-xs text-muted-foreground mb-1">NO Price</p>
                            <p className="text-lg font-bold text-red-600 dark:text-red-400" data-testid={`text-no-price-${outcome.id}`}>
                              {(100 - parseFloat(pricePercent)).toFixed(1)}c
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Volume:</span>
                          <span>${parseFloat(outcome.volume || "0").toLocaleString()}</span>
                        </div>

                        <Button
                          onClick={() => handleBetClick(outcome)}
                          className="w-full"
                          data-testid={`button-bet-${outcome.id}`}
                        >
                          Bet
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="drivers">
            {driversLoading ? renderSkeletonCards() : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {sortedDrivers.map((outcome) => {
                  const driverInfo = getDriverInfo(outcome.name);
                  const color = driverInfo?.color || "#888888";
                  const pricePercent = (outcome.price * 100).toFixed(1);

                  return (
                    <Card key={outcome.id} className="relative overflow-visible">
                      <div
                        className="absolute left-0 top-0 h-1 w-full rounded-t-lg"
                        style={{ backgroundColor: color }}
                      />
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div
                              className="h-4 w-4 rounded-full"
                              style={{ backgroundColor: color }}
                            />
                            <CardTitle className="text-base">{outcome.name}</CardTitle>
                          </div>
                          {driverInfo && (
                            <div className="flex items-center gap-1">
                              <Badge variant="outline" className="text-xs">
                                #{driverInfo.number}
                              </Badge>
                              <Badge variant="secondary" className="text-xs">
                                {driverInfo.team}
                              </Badge>
                            </div>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-md bg-green-500/10 p-2 text-center">
                            <p className="text-xs text-muted-foreground mb-1">YES Price</p>
                            <p className="text-lg font-bold text-green-600 dark:text-green-400" data-testid={`text-driver-yes-price-${outcome.id}`}>
                              {pricePercent}c
                            </p>
                          </div>
                          <div className="rounded-md bg-red-500/10 p-2 text-center">
                            <p className="text-xs text-muted-foreground mb-1">NO Price</p>
                            <p className="text-lg font-bold text-red-600 dark:text-red-400" data-testid={`text-driver-no-price-${outcome.id}`}>
                              {(100 - parseFloat(pricePercent)).toFixed(1)}c
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Volume:</span>
                          <span>${parseFloat(outcome.volume || "0").toLocaleString()}</span>
                        </div>

                        <Button
                          onClick={() => handleBetClick(outcome)}
                          className="w-full"
                          data-testid={`button-bet-driver-${outcome.id}`}
                        >
                          Bet
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      {selectedOutcome && (
        <PolymarketBetModal
          open={betModalOpen}
          onClose={() => {
            setBetModalOpen(false);
            setSelectedOutcome(null);
          }}
          outcome={selectedOutcome}
          userBalance={walletUsdcBalance}
        />
      )}

      <DepositModal
        open={connectWalletModalOpen}
        onOpenChange={setConnectWalletModalOpen}
      />
    </div>
  );
}
