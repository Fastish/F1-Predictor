import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/Header";
import { OrderBook } from "@/components/OrderBook";
import { PlaceOrderModal } from "@/components/PlaceOrderModal";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useMarket } from "@/context/MarketContext";
import { useWallet } from "@/context/WalletContext";
import { AlertCircle, TrendingUp, Wallet, ArrowRightLeft, Layers } from "lucide-react";
import { DepositModal } from "@/components/DepositModal";

interface Market {
  id: string;
  seasonId: string;
  teamId: string;
  outstandingPairs: number;
  lockedCollateral: number;
  lastPrice: number | null;
  status: string;
}

interface USDCBalanceResponse {
  address: string;
  balance: string;
  asset: string;
}

interface Position {
  id: number;
  marketId: string;
  userId: string;
  yesShares: number;
  noShares: number;
  avgYesCost: number | null;
  avgNoCost: number | null;
}

export default function Markets() {
  const { teams, userId } = useMarket();
  const { walletAddress, connectWallet, isConnecting } = useWallet();
  const [activeSection, setActiveSection] = useState<"market" | "portfolio">("market");
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [connectWalletModalOpen, setConnectWalletModalOpen] = useState(false);

  const { data: markets = [], isLoading: marketsLoading } = useQuery<Market[]>({
    queryKey: ["/api/clob/markets"],
  });

  const { data: usdcBalance } = useQuery<USDCBalanceResponse>({
    queryKey: ["/api/stellar/balance", walletAddress],
    enabled: !!walletAddress,
  });

  const walletUsdcBalance = parseFloat(usdcBalance?.balance || "0");

  const { data: positions = [] } = useQuery<Position[]>({
    queryKey: ["/api/clob/users", userId, "positions"],
    enabled: !!userId,
  });

  const { data: season } = useQuery<{ exists: boolean; status?: string }>({
    queryKey: ["/api/season"],
  });

  const getPositionForMarket = (marketId: string) => {
    return positions.find((p) => p.marketId === marketId);
  };

  const isSeasonActive = season?.exists && season.status === "active";
  const hasMarkets = markets.length > 0;

  const handleTradeClick = (market: Market) => {
    if (!walletAddress) {
      setConnectWalletModalOpen(true);
      return;
    }
    setSelectedMarket(market);
    setOrderModalOpen(true);
  };

  const getTeamForMarket = (market: Market) => {
    return teams.find((t) => t.id === market.teamId);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header onNavigate={setActiveSection} activeSection={activeSection} />

      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Prediction Markets</h1>
            <p className="text-muted-foreground">
              Trade YES/NO shares on which team will win the 2026 F1 Championship
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

        {!isSeasonActive && (
          <Card className="mb-6 border-amber-500/30 bg-amber-500/5">
            <CardContent className="flex items-center gap-3 py-4">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              <div>
                <p className="font-medium text-amber-600 dark:text-amber-400">
                  No Active Season
                </p>
                <p className="text-sm text-muted-foreground">
                  Markets will be available once an admin creates a new season.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {!hasMarkets && isSeasonActive && (
          <Card className="mb-6 border-blue-500/30 bg-blue-500/5">
            <CardContent className="flex items-center gap-3 py-4">
              <TrendingUp className="h-5 w-5 text-blue-500" />
              <div>
                <p className="font-medium text-blue-600 dark:text-blue-400">
                  Markets Being Initialized
                </p>
                <p className="text-sm text-muted-foreground">
                  Order book markets are being set up. Check back shortly.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {marketsLoading ? (
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
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {markets.map((market) => {
              const team = getTeamForMarket(market);
              if (!team) return null;

              return (
                <Card key={market.id} className="relative overflow-visible">
                  <div
                    className="absolute left-0 top-0 h-1 w-full rounded-t-lg"
                    style={{ backgroundColor: team.color }}
                  />
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div
                          className="h-4 w-4 rounded-full"
                          style={{ backgroundColor: team.color }}
                        />
                        <CardTitle className="text-base">{team.name}</CardTitle>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {team.shortName}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Last Price:</span>
                      <span className="font-medium">
                        ${(market.lastPrice || 0.5).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Open Interest:</span>
                      <span>{market.outstandingPairs} pairs</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Locked Collateral:</span>
                      <span>${(market.lockedCollateral || 0).toFixed(2)}</span>
                    </div>

                    <OrderBook
                      marketId={market.id}
                      teamName={team.name}
                      teamColor={team.color}
                    />

                    {(() => {
                      const position = getPositionForMarket(market.id);
                      if (position && (position.yesShares > 0 || position.noShares > 0)) {
                        return (
                          <div className="rounded-md bg-muted/50 p-2 text-sm">
                            <div className="flex items-center gap-1 text-muted-foreground mb-1">
                              <Layers className="h-3 w-3" />
                              <span>Your Position</span>
                            </div>
                            <div className="flex justify-between gap-4">
                              {position.yesShares > 0 && (
                                <div className="flex items-center gap-1">
                                  <span className="font-medium text-green-600 dark:text-green-400">YES:</span>
                                  <span>{position.yesShares}</span>
                                </div>
                              )}
                              {position.noShares > 0 && (
                                <div className="flex items-center gap-1">
                                  <span className="font-medium text-red-600 dark:text-red-400">NO:</span>
                                  <span>{position.noShares}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })()}

                    <Button
                      onClick={() => handleTradeClick(market)}
                      className="w-full"
                      disabled={market.status !== "active"}
                      data-testid={`button-trade-${team.id}`}
                    >
                      <ArrowRightLeft className="mr-2 h-4 w-4" />
                      Trade
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      {selectedMarket && (
        <PlaceOrderModal
          open={orderModalOpen}
          onClose={() => {
            setOrderModalOpen(false);
            setSelectedMarket(null);
          }}
          market={selectedMarket}
          teamName={getTeamForMarket(selectedMarket)?.name || ""}
          teamColor={getTeamForMarket(selectedMarket)?.color || "#888"}
          userId={userId || ""}
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
