import { useState } from "react";
import { TrendingUp, TrendingDown, Wallet, PiggyBank, BarChart3, Loader2, Car, User, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/context/WalletContext";
import { useQuery } from "@tanstack/react-query";

interface PolymarketOutcome {
  id: string;
  name: string;
  tokenId: string;
  price: number;
  volume: string;
  conditionId: string;
  questionId: string;
}

// Team colors for F1 constructors
const teamColors: Record<string, string> = {
  "Mercedes": "#00D2BE",
  "McLaren": "#FF8700",
  "Red Bull Racing": "#1E41FF",
  "Ferrari": "#DC0000",
  "Aston Martin": "#006F62",
  "Williams": "#005AFF",
  "Audi": "#FF0000",
  "Alpine": "#0090FF",
  "Cadillac": "#C4A747",
  "Haas": "#B6BABD",
  "Racing Bulls": "#2B4562",
};

// Driver team associations
const driverInfo: Record<string, { team: string; color: string }> = {
  "Max Verstappen": { team: "Red Bull", color: "#1E41FF" },
  "Lando Norris": { team: "McLaren", color: "#FF8700" },
  "Lewis Hamilton": { team: "Ferrari", color: "#DC0000" },
  "George Russell": { team: "Mercedes", color: "#00D2BE" },
  "Charles Leclerc": { team: "Ferrari", color: "#DC0000" },
  "Oscar Piastri": { team: "McLaren", color: "#FF8700" },
  "Kimi Antonelli": { team: "Mercedes", color: "#00D2BE" },
  "Fernando Alonso": { team: "Aston Martin", color: "#006F62" },
  "Carlos Sainz": { team: "Williams", color: "#005AFF" },
  "Liam Lawson": { team: "Red Bull", color: "#1E41FF" },
};

function getColor(name: string, type: "team" | "driver"): string {
  if (type === "team") {
    return teamColors[name] || "#888888";
  }
  return driverInfo[name]?.color || "#888888";
}

export function PortfolioSection() {
  const { walletAddress, connectWallet, isConnecting } = useWallet();

  const { data: usdcBalance, isLoading: isLoadingBalance } = useQuery<string>({
    queryKey: ["polygon-usdc-balance", walletAddress],
    queryFn: async () => {
      if (!walletAddress) return "0";
      const { getUsdcBalance } = await import("@/lib/polygon");
      return getUsdcBalance(walletAddress);
    },
    enabled: !!walletAddress,
  });

  const { data: constructors = [] } = useQuery<PolymarketOutcome[]>({
    queryKey: ["/api/polymarket/constructors"],
  });

  const { data: drivers = [] } = useQuery<PolymarketOutcome[]>({
    queryKey: ["/api/polymarket/drivers"],
  });

  const cashBalance = parseFloat(usdcBalance || "0");

  // For now, show available markets instead of positions
  // Real positions would require querying Polymarket CLOB API with wallet address
  const hasWallet = !!walletAddress;

  return (
    <section className="py-12">
      <div className="mx-auto max-w-7xl px-4">
        <h2 className="mb-6 text-2xl font-bold" data-testid="text-portfolio-title">Your Portfolio</h2>

        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                USDC Balance
              </CardTitle>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoadingBalance ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : walletAddress ? (
                <div className="text-2xl font-bold tabular-nums" data-testid="text-cash-balance">
                  ${cashBalance.toFixed(2)}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Connect wallet to view balance</p>
                  <Button size="sm" onClick={() => connectWallet()} disabled={isConnecting}>
                    Connect Wallet
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Constructor Markets
              </CardTitle>
              <Car className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">
                {constructors.length}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Teams available to trade
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Driver Markets
              </CardTitle>
              <User className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">
                {drivers.length}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Drivers available to trade
              </p>
            </CardContent>
          </Card>
        </div>

        {!hasWallet ? (
          <Card>
            <CardContent className="py-12 text-center">
              <PiggyBank className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Connect Your Wallet</h3>
              <p className="text-muted-foreground mb-4">
                Connect your wallet to view your Polymarket positions and start trading
              </p>
              <Button onClick={() => connectWallet()} disabled={isConnecting}>
                <Wallet className="mr-2 h-4 w-4" />
                Connect Wallet
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Your Positions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-md bg-muted/50 p-6 text-center">
                  <p className="text-muted-foreground mb-4">
                    Your Polymarket positions will appear here after placing bets.
                    Positions are tracked on the Polygon blockchain.
                  </p>
                  <a
                    href="https://polymarket.com/portfolio"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <ExternalLink className="h-4 w-4" />
                    View on Polymarket
                  </a>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Car className="h-5 w-5" />
                    Top Constructor Odds
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {constructors.slice(0, 5).map((team) => (
                      <div key={team.id} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: getColor(team.name, "team") }}
                          />
                          <span className="font-medium">{team.name}</span>
                        </div>
                        <Badge variant="outline">
                          {(team.price * 100).toFixed(0)}%
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="h-5 w-5" />
                    Top Driver Odds
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {drivers.slice(0, 5).map((driver) => (
                      <div key={driver.id} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: getColor(driver.name, "driver") }}
                          />
                          <span className="font-medium">{driver.name}</span>
                        </div>
                        <Badge variant="outline">
                          {(driver.price * 100).toFixed(0)}%
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
