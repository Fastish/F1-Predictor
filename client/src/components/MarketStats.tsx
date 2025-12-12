import { Users, TrendingUp, Clock, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMarket } from "@/context/MarketContext";
import { useQuery } from "@tanstack/react-query";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

interface CLOBMarket {
  id: string;
  teamId: string;
  outstandingPairs: number;
  lockedCollateral: number;
  lastPrice: number | null;
  status: string;
}

export function MarketStats() {
  const { teams } = useMarket();

  const { data: clobMarkets = [] } = useQuery<CLOBMarket[]>({
    queryKey: ["/api/clob/markets"],
    refetchInterval: 10000,
  });

  const totalOutstandingPairs = clobMarkets.reduce((acc, m) => acc + m.outstandingPairs, 0);
  const totalLockedCollateral = clobMarkets.reduce((acc, m) => acc + m.lockedCollateral, 0);
  const activeTeams = clobMarkets.filter((m) => m.outstandingPairs > 0).length;

  const chartData = clobMarkets
    .map((market) => {
      const team = teams.find((t) => t.id === market.teamId);
      return {
        name: team?.shortName || market.teamId,
        value: market.outstandingPairs,
        color: team?.color || "#888888",
      };
    })
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);

  const seasonStart = new Date("2026-03-15");
  const now = new Date();
  const daysUntil = Math.max(0, Math.ceil((seasonStart.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  return (
    <section className="py-12">
      <div className="mx-auto max-w-7xl px-4">
        <h2 className="mb-6 text-2xl font-bold" data-testid="text-stats-title">Market Statistics</h2>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Outstanding Pairs
                </CardTitle>
                <TrendingUp className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tabular-nums" data-testid="text-stats-total-shares">
                  {totalOutstandingPairs.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground">
                  YES/NO share pairs in circulation
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Active Markets
                </CardTitle>
                <Users className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tabular-nums" data-testid="text-stats-active-teams">
                  {activeTeams} / {teams.length}
                </div>
                <p className="text-xs text-muted-foreground">
                  Markets with trading activity
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Collateral Locked
                </CardTitle>
                <Trophy className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tabular-nums" data-testid="text-stats-prize-pool">
                  ${totalLockedCollateral.toFixed(2)}
                </div>
                <p className="text-xs text-muted-foreground">
                  USDC backing all positions
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Season Starts
                </CardTitle>
                <Clock className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tabular-nums" data-testid="text-stats-days-until">
                  {daysUntil} days
                </div>
                <p className="text-xs text-muted-foreground">
                  Until 2026 F1 Championship begins
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Market Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={chartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) => [
                        `${value.toLocaleString()} pairs`,
                        "",
                      ]}
                      labelFormatter={(name) => name}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-[200px] items-center justify-center text-muted-foreground">
                  No trading activity yet
                </div>
              )}
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {chartData.slice(0, 5).map((entry) => (
                  <div key={entry.name} className="flex items-center gap-1.5">
                    <div
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: entry.color }}
                    />
                    <span className="text-xs text-muted-foreground">{entry.name}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
