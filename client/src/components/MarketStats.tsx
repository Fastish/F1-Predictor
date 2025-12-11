import { Users, TrendingUp, Clock, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMarket } from "@/context/MarketContext";
import { useQuery } from "@tanstack/react-query";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

export function MarketStats() {
  const { teams } = useMarket();

  const { data: sharesByTeam = {} } = useQuery<Record<string, number>>({
    queryKey: ["/api/market/shares-by-team"],
    refetchInterval: 10000,
  });

  const { data: prizePoolData } = useQuery<{ prizePool: number }>({
    queryKey: ["/api/market/prize-pool"],
    refetchInterval: 10000,
  });

  const prizePool = prizePoolData?.prizePool ?? 0;

  const chartData = teams
    .map((team) => ({
      name: team.shortName,
      value: sharesByTeam[team.id] || 0,
      color: team.color,
    }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);

  const totalShares = chartData.reduce((acc, d) => acc + d.value, 0);
  const activeTeams = chartData.length;

  // todo: remove mock functionality - simulated time left
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
                  Total Shares Sold
                </CardTitle>
                <TrendingUp className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tabular-nums" data-testid="text-stats-total-shares">
                  {totalShares.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground">
                  Across all {activeTeams} active teams
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Active Teams
                </CardTitle>
                <Users className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tabular-nums" data-testid="text-stats-active-teams">
                  {activeTeams} / {teams.length}
                </div>
                <p className="text-xs text-muted-foreground">
                  Teams with shares purchased
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Prize Pool
                </CardTitle>
                <Trophy className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tabular-nums" data-testid="text-stats-prize-pool">
                  ${prizePool.toFixed(2)}
                </div>
                <p className="text-xs text-muted-foreground">
                  Total wagered across all teams
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
                Share Distribution
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
                        `${value.toLocaleString()} shares`,
                        "",
                      ]}
                      labelFormatter={(name) => name}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-[200px] items-center justify-center text-muted-foreground">
                  No shares purchased yet
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
