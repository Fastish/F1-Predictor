import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMarket } from "@/context/MarketContext";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";

interface PriceHistoryRecord {
  id: string;
  teamId: string;
  price: number;
  recordedAt: string;
}

export function TeamValueChart() {
  const { teams } = useMarket();

  const { data: priceHistory = [], isLoading } = useQuery<PriceHistoryRecord[]>({
    queryKey: ["/api/market/price-history"],
    refetchInterval: 30000,
  });

  const chartData = processChartData(priceHistory, teams);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Team Value Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[300px] items-center justify-center text-muted-foreground">
            Loading chart data...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Team Value Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[300px] items-center justify-center text-muted-foreground">
            No trading activity yet. Prices will appear here as trades occur.
          </div>
        </CardContent>
      </Card>
    );
  }

  const teamsWithHistory = teams.filter((team) =>
    priceHistory.some((record) => record.teamId === team.id)
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg" data-testid="text-chart-title">Team Value Over Time</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 12 }}
              tickFormatter={(value) => format(new Date(value), "HH:mm")}
              className="text-muted-foreground"
            />
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(value) => `$${value.toFixed(2)}`}
              domain={["auto", "auto"]}
              className="text-muted-foreground"
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "6px",
              }}
              labelFormatter={(value) => format(new Date(value), "MMM d, HH:mm:ss")}
              formatter={(value: number, name: string) => [`$${value.toFixed(6)}`, name]}
            />
            <Legend />
            {teamsWithHistory.map((team) => (
              <Line
                key={team.id}
                type="monotone"
                dataKey={team.shortName}
                stroke={team.color}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          {teamsWithHistory.map((team) => (
            <div key={team.id} className="flex items-center gap-1.5">
              <div
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: team.color }}
              />
              <span className="text-xs text-muted-foreground">{team.shortName}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function processChartData(
  priceHistory: PriceHistoryRecord[],
  teams: { id: string; shortName: string }[]
): Record<string, number | string>[] {
  if (priceHistory.length === 0) return [];

  const teamMap = new Map(teams.map((t) => [t.id, t.shortName]));
  const timeMap = new Map<string, Record<string, number | string>>();

  for (const record of priceHistory) {
    const timeKey = record.recordedAt;
    const shortName = teamMap.get(record.teamId);
    if (!shortName) continue;

    if (!timeMap.has(timeKey)) {
      timeMap.set(timeKey, { time: timeKey });
    }
    const dataPoint = timeMap.get(timeKey)!;
    dataPoint[shortName] = record.price;
  }

  const result = Array.from(timeMap.values()).sort(
    (a, b) => new Date(a.time as string).getTime() - new Date(b.time as string).getTime()
  );

  let lastValues: Record<string, number> = {};
  for (const team of teams) {
    lastValues[team.shortName] = 0.1;
  }

  for (const dataPoint of result) {
    for (const team of teams) {
      if (dataPoint[team.shortName] !== undefined) {
        lastValues[team.shortName] = dataPoint[team.shortName] as number;
      } else {
        dataPoint[team.shortName] = lastValues[team.shortName];
      }
    }
  }

  return result;
}
