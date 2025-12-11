import { useState } from "react";
import { TrendingUp, TrendingDown, Wallet, PiggyBank, BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useMarket } from "@/context/MarketContext";
import { SellSharesModal } from "./SellSharesModal";
import type { Team, Holding } from "@shared/schema";

export function PortfolioSection() {
  const { holdings, balance, getTeam, getTotalInvestment, getCurrentValue } = useMarket();
  const [sellModalOpen, setSellModalOpen] = useState(false);
  const [selectedHolding, setSelectedHolding] = useState<{ team: Team; holding: Holding } | null>(null);

  const totalInvestment = getTotalInvestment();
  const currentValue = getCurrentValue();
  const pnl = currentValue - totalInvestment;
  const pnlPercent = totalInvestment > 0 ? (pnl / totalInvestment) * 100 : 0;
  const isPositive = pnl >= 0;

  const holdingsWithDetails = holdings
    .map((h) => {
      const team = getTeam(h.teamId);
      if (!team) return null;
      const value = h.shares * team.price;
      const cost = h.shares * h.avgPrice;
      const profit = value - cost;
      return { ...h, team, value, cost, profit };
    })
    .filter(Boolean)
    .sort((a, b) => b!.value - a!.value);

  const totalPortfolioValue = currentValue + balance;

  const handleSellClick = (team: Team, holding: Holding) => {
    setSelectedHolding({ team, holding });
    setSellModalOpen(true);
  };

  return (
    <section className="py-12">
      <div className="mx-auto max-w-7xl px-4">
        <h2 className="mb-6 text-2xl font-bold" data-testid="text-portfolio-title">Your Portfolio</h2>

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
                Holdings Value
              </CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums" data-testid="text-holdings-value">
                ${currentValue.toFixed(2)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Cash Balance
              </CardTitle>
              <PiggyBank className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums" data-testid="text-cash-balance">
                ${balance.toFixed(2)}
              </div>
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
                {isPositive ? "+" : ""}${pnl.toFixed(2)} ({pnlPercent.toFixed(1)}%)
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Holdings Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {holdingsWithDetails.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">
                You don't own any shares yet. Start trading to build your portfolio!
              </p>
            ) : (
              <div className="space-y-4">
                {holdingsWithDetails.map((holding) => {
                  if (!holding) return null;
                  const percentOfPortfolio = currentValue > 0 ? (holding.value / currentValue) * 100 : 0;
                  const isHoldingPositive = holding.profit >= 0;

                  return (
                    <div key={holding.teamId} className="space-y-2">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: holding.team.color }}
                          />
                          <div>
                            <p className="font-medium" data-testid={`text-holding-name-${holding.teamId}`}>
                              {holding.team.name}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {holding.shares} shares @ ${holding.avgPrice.toFixed(4)} entry
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Current: ${holding.team.price.toFixed(4)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="font-bold tabular-nums" data-testid={`text-holding-value-${holding.teamId}`}>
                              ${holding.value.toFixed(2)}
                            </p>
                            <p
                              className={`text-sm tabular-nums ${
                                isHoldingPositive
                                  ? "text-green-500 dark:text-green-400"
                                  : "text-red-500 dark:text-red-400"
                              }`}
                            >
                              {isHoldingPositive ? "+" : ""}${holding.profit.toFixed(2)}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSellClick(holding.team, holding)}
                            data-testid={`button-sell-${holding.teamId}`}
                          >
                            Sell
                          </Button>
                        </div>
                      </div>
                      <Progress value={percentOfPortfolio} className="h-2" />
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {selectedHolding && (
        <SellSharesModal
          open={sellModalOpen}
          onOpenChange={setSellModalOpen}
          team={selectedHolding.team}
          holding={selectedHolding.holding}
        />
      )}
    </section>
  );
}
