import { useState } from "react";
import { TrendingUp, TrendingDown, Wallet, PiggyBank, BarChart3, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMarket } from "@/context/MarketContext";
import { useWallet } from "@/context/WalletContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface USDCBalanceResponse {
  address: string;
  balance: string;
  asset: string;
}

interface MarketPositionResponse {
  id: string;
  marketId: string;
  userId: string;
  yesShares: number;
  noShares: number;
  avgYesPrice: number;
  avgNoPrice: number;
  realizedPnl: number;
}

interface Market {
  id: string;
  teamId: string;
  lastPrice: number | null;
}

interface DisplayPosition {
  id: string;
  marketId: string;
  userId: string;
  outcome: "yes" | "no";
  shares: number;
  avgPrice: number;
}

interface SellModalState {
  isOpen: boolean;
  position: DisplayPosition | null;
  teamName: string;
  currentPrice: number;
}

export function PortfolioSection() {
  const { teams, userId } = useMarket();
  const { walletAddress } = useWallet();
  const { toast } = useToast();

  const [sellModal, setSellModal] = useState<SellModalState>({
    isOpen: false,
    position: null,
    teamName: "",
    currentPrice: 0,
  });
  const [sellQuantity, setSellQuantity] = useState("");
  const [sellPrice, setSellPrice] = useState("");

  const { data: usdcBalance, isLoading: isLoadingBalance } = useQuery<USDCBalanceResponse>({
    queryKey: ["/api/stellar/balance", walletAddress],
    enabled: !!walletAddress,
  });

  const { data: rawPositions = [], isLoading: isLoadingPositions } = useQuery<MarketPositionResponse[]>({
    queryKey: ["/api/clob/users", userId, "positions"],
    enabled: !!userId,
  });

  const { data: markets = [] } = useQuery<Market[]>({
    queryKey: ["/api/clob/markets"],
  });

  const sellMutation = useMutation({
    mutationFn: async (data: { marketId: string; userId: string; outcome: "yes" | "no"; price: number; quantity: number }) => {
      return apiRequest("/api/clob/orders", {
        method: "POST",
        body: JSON.stringify({
          ...data,
          side: "sell",
        }),
      });
    },
    onSuccess: () => {
      toast({
        title: "Sell order placed",
        description: "Your sell order has been submitted to the order book.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/clob/users", userId, "positions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clob/markets"] });
      closeSellModal();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to place sell order",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const cashBalance = parseFloat(usdcBalance?.balance || "0");

  const getMarket = (marketId: string) => markets.find((m) => m.id === marketId);
  const getTeamForMarket = (marketId: string) => {
    const market = getMarket(marketId);
    if (!market) return null;
    return teams.find((t) => t.id === market.teamId);
  };

  // Transform raw positions (yesShares/noShares) into display positions (separate YES/NO rows)
  const positions: DisplayPosition[] = rawPositions.flatMap((p) => {
    const result: DisplayPosition[] = [];
    if (p.yesShares > 0) {
      result.push({
        id: `${p.id}-yes`,
        marketId: p.marketId,
        userId: p.userId,
        outcome: "yes",
        shares: p.yesShares,
        avgPrice: p.avgYesPrice,
      });
    }
    if (p.noShares > 0) {
      result.push({
        id: `${p.id}-no`,
        marketId: p.marketId,
        userId: p.userId,
        outcome: "no",
        shares: p.noShares,
        avgPrice: p.avgNoPrice,
      });
    }
    return result;
  });

  const positionsWithDetails = positions
    .map((p) => {
      const team = getTeamForMarket(p.marketId);
      const market = getMarket(p.marketId);
      if (!team || !market) return null;
      const lastPrice = market.lastPrice ?? 0.5;
      // For YES positions, value is based on lastPrice; for NO, it's 1 - lastPrice
      const currentPrice = p.outcome === "yes" ? lastPrice : 1 - lastPrice;
      const value = p.shares * currentPrice;
      const cost = p.shares * p.avgPrice;
      const profit = value - cost;
      return { ...p, team, market, value, cost, profit, currentPrice };
    })
    .filter(Boolean)
    .sort((a, b) => b!.value - a!.value);

  const totalPositionsValue = positionsWithDetails.reduce((sum, p) => sum + (p?.value ?? 0), 0);
  const totalCost = positionsWithDetails.reduce((sum, p) => sum + (p?.cost ?? 0), 0);
  const totalPnl = totalPositionsValue - totalCost;
  const pnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
  const isPositive = totalPnl >= 0;

  const totalPortfolioValue = totalPositionsValue + cashBalance;

  const openSellModal = (position: DisplayPosition, teamName: string, currentPrice: number) => {
    setSellModal({
      isOpen: true,
      position,
      teamName,
      currentPrice,
    });
    setSellQuantity("");
    setSellPrice(currentPrice.toFixed(2));
  };

  const closeSellModal = () => {
    setSellModal({
      isOpen: false,
      position: null,
      teamName: "",
      currentPrice: 0,
    });
    setSellQuantity("");
    setSellPrice("");
  };

  const handleSellSubmit = () => {
    if (!sellModal.position || !userId) return;

    const quantity = parseInt(sellQuantity, 10);
    const price = parseFloat(sellPrice);

    if (isNaN(quantity) || quantity <= 0) {
      toast({
        title: "Invalid quantity",
        description: "Please enter a valid number of shares to sell.",
        variant: "destructive",
      });
      return;
    }

    if (quantity > sellModal.position.shares) {
      toast({
        title: "Not enough shares",
        description: `You only have ${sellModal.position.shares} shares available.`,
        variant: "destructive",
      });
      return;
    }

    if (isNaN(price) || price < 0.01 || price > 0.99) {
      toast({
        title: "Invalid price",
        description: "Price must be between $0.01 and $0.99.",
        variant: "destructive",
      });
      return;
    }

    sellMutation.mutate({
      marketId: sellModal.position.marketId,
      userId,
      outcome: sellModal.position.outcome,
      price,
      quantity,
    });
  };

  return (
    <section className="py-12">
      <div className="mx-auto max-w-7xl px-4">
        <h2 className="mb-6 text-2xl font-bold" data-testid="text-portfolio-title">Your Positions</h2>

        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Value
              </CardTitle>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums" data-testid="text-total-value">
                ${totalPortfolioValue.toFixed(2)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Positions Value
              </CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums" data-testid="text-holdings-value">
                ${totalPositionsValue.toFixed(2)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                USDC Balance
              </CardTitle>
              <PiggyBank className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoadingBalance ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : walletAddress ? (
                <div className="text-2xl font-bold tabular-nums" data-testid="text-cash-balance">
                  ${cashBalance.toFixed(2)}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Connect wallet</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Unrealized P&L
              </CardTitle>
              {isPositive ? (
                <TrendingUp className="h-4 w-4 text-green-500 dark:text-green-400" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-500 dark:text-red-400" />
              )}
            </CardHeader>
            <CardContent>
              <div
                className={`text-2xl font-bold tabular-nums ${
                  isPositive ? "text-green-500 dark:text-green-400" : "text-red-500 dark:text-red-400"
                }`}
                data-testid="text-pnl"
              >
                {isPositive ? "+" : ""}${totalPnl.toFixed(2)} ({pnlPercent.toFixed(1)}%)
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Positions Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingPositions ? (
              <div className="py-8 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : positionsWithDetails.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">
                You don't have any positions yet. Start trading to build your portfolio!
              </p>
            ) : (
              <div className="space-y-4">
                {positionsWithDetails.map((position) => {
                  if (!position) return null;
                  const percentOfPortfolio = totalPositionsValue > 0 ? (position.value / totalPositionsValue) * 100 : 0;
                  const isPositionPositive = position.profit >= 0;

                  return (
                    <div key={position.id} className="space-y-2">
                      <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-3">
                          <div
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: position.team.color }}
                          />
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium" data-testid={`text-position-name-${position.id}`}>
                                {position.team.name}
                              </p>
                              <Badge variant={position.outcome === "yes" ? "default" : "secondary"}>
                                {position.outcome.toUpperCase()}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {position.shares} shares @ ${position.avgPrice.toFixed(4)} entry
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Current: ${position.currentPrice.toFixed(4)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="font-bold tabular-nums" data-testid={`text-position-value-${position.id}`}>
                              ${position.value.toFixed(2)}
                            </p>
                            <p
                              className={`text-sm tabular-nums ${
                                isPositionPositive
                                  ? "text-green-500 dark:text-green-400"
                                  : "text-red-500 dark:text-red-400"
                              }`}
                            >
                              {isPositionPositive ? "+" : ""}${position.profit.toFixed(2)}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openSellModal(position, position.team.name, position.currentPrice)}
                            data-testid={`button-sell-${position.id}`}
                          >
                            Sell
                          </Button>
                        </div>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary transition-all" 
                          style={{ width: `${Math.min(100, percentOfPortfolio)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={sellModal.isOpen} onOpenChange={(open) => !open && closeSellModal()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sell Position</DialogTitle>
            <DialogDescription>
              Sell your {sellModal.position?.outcome.toUpperCase()} shares in {sellModal.teamName}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Available shares:</span>
              <span className="font-medium text-foreground" data-testid="text-available-shares">
                {sellModal.position?.shares ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Current market price:</span>
              <span className="font-medium text-foreground" data-testid="text-current-price">
                ${sellModal.currentPrice.toFixed(4)}
              </span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sell-quantity">Quantity</Label>
              <Input
                id="sell-quantity"
                type="number"
                min="1"
                max={sellModal.position?.shares ?? 1}
                value={sellQuantity}
                onChange={(e) => setSellQuantity(e.target.value)}
                placeholder="Number of shares to sell"
                data-testid="input-sell-quantity"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sell-price">Limit Price ($)</Label>
              <Input
                id="sell-price"
                type="number"
                step="0.01"
                min="0.01"
                max="0.99"
                value={sellPrice}
                onChange={(e) => setSellPrice(e.target.value)}
                placeholder="Price per share (0.01 - 0.99)"
                data-testid="input-sell-price"
              />
              <p className="text-xs text-muted-foreground">
                Your order will be placed in the order book at this price.
              </p>
            </div>
            {sellQuantity && sellPrice && !isNaN(parseFloat(sellPrice)) && !isNaN(parseInt(sellQuantity)) && (
              <div className="rounded-md bg-muted p-3 text-sm" data-testid="text-sell-proceeds">
                <div className="flex justify-between">
                  <span>Total proceeds (if filled):</span>
                  <span className="font-medium">
                    ${(parseFloat(sellPrice) * parseInt(sellQuantity)).toFixed(2)}
                  </span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeSellModal} data-testid="button-cancel-sell">
              Cancel
            </Button>
            <Button
              onClick={handleSellSubmit}
              disabled={sellMutation.isPending}
              data-testid="button-confirm-sell"
            >
              {sellMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Placing Order...
                </>
              ) : (
                "Place Sell Order"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
