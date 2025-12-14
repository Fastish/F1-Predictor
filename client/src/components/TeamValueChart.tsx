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

interface PoolPriceHistoryRecord {
  id: string;
  poolId: string;
  outcomeId: string;
  participantId: string;
  price: number;
  recordedAt: string;
}

interface PoolOutcome {
  id: string;
  poolId: string;
  participantId: string;
  participantName: string;
  sharesOutstanding: number;
  price: number;
  probability: number;
}

interface ChampionshipPool {
  id: string;
  seasonId: string;
  type: "team" | "driver";
  status: string;
  bParameter: number;
  totalCollateral: number;
  outcomes: PoolOutcome[];
}

interface DriverFromAPI {
  id: string;
  name: string;
  shortName: string;
  teamId: string;
  number: number;
  color: string;
}

interface TeamValueChartProps {
  type?: "teams" | "drivers";
}

export function TeamValueChart({ type = "teams" }: TeamValueChartProps) {
  const { teams } = useMarket();

  // Fetch team pool for teams tab
  const { data: teamPool, isLoading: teamPoolLoading } = useQuery<ChampionshipPool>({
    queryKey: ["/api/pools/type/team"],
    refetchInterval: 5000,
    enabled: type === "teams",
  });

  // Fetch pool price history for teams tab
  const { data: poolPriceHistory = [], isLoading: priceHistoryLoading } = useQuery<PoolPriceHistoryRecord[]>({
    queryKey: ["/api/pools", teamPool?.id, "price-history"],
    refetchInterval: 30000,
    enabled: type === "teams" && !!teamPool?.id,
  });

  // Fetch driver pool for drivers tab
  const { data: driverPool, isLoading: driverPoolLoading } = useQuery<ChampionshipPool>({
    queryKey: ["/api/pools/type/driver"],
    refetchInterval: 5000,
    enabled: type === "drivers",
  });

  // Fetch pool price history for drivers tab
  const { data: driverPriceHistory = [], isLoading: driverHistoryLoading } = useQuery<PoolPriceHistoryRecord[]>({
    queryKey: ["/api/pools", driverPool?.id, "price-history"],
    refetchInterval: 30000,
    enabled: type === "drivers" && !!driverPool?.id,
  });

  const { data: driversFromAPI = [] } = useQuery<DriverFromAPI[]>({
    queryKey: ["/api/drivers"],
    enabled: type === "drivers",
  });

  if (type === "drivers") {
    return (
      <DriverPriceChart 
        driverPool={driverPool} 
        drivers={driversFromAPI} 
        priceHistory={driverPriceHistory}
        isLoading={driverPoolLoading || driverHistoryLoading} 
      />
    );
  }

  const teamLoading = teamPoolLoading || priceHistoryLoading;
  const chartData = processPoolChartData(poolPriceHistory, teams);

  if (teamLoading) {
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
    poolPriceHistory.some((record) => record.participantId === team.id)
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

function DriverPriceChart({ 
  driverPool, 
  drivers,
  priceHistory,
  isLoading 
}: { 
  driverPool?: ChampionshipPool; 
  drivers: DriverFromAPI[];
  priceHistory: PoolPriceHistoryRecord[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Driver Value Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[300px] items-center justify-center text-muted-foreground">
            Loading driver data...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!driverPool || !driverPool.outcomes || driverPool.outcomes.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Driver Value Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[300px] items-center justify-center text-muted-foreground">
            Driver market not yet available. Check back when the admin creates driver markets.
          </div>
        </CardContent>
      </Card>
    );
  }

  // Map drivers to the format expected by processPoolChartData
  const driverMappings = drivers.map((d) => ({
    id: d.id,
    shortName: d.shortName,
    color: d.color,
  }));

  const chartData = processPoolChartData(priceHistory, driverMappings);

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Driver Value Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[300px] items-center justify-center text-muted-foreground">
            No trading activity yet. Prices will appear here as trades occur.
          </div>
        </CardContent>
      </Card>
    );
  }

  // Filter to drivers with history, sorted by current price
  const driversWithHistory = drivers
    .filter((driver) => priceHistory.some((record) => record.participantId === driver.id))
    .map((driver) => {
      const outcome = driverPool.outcomes.find((o) => o.participantId === driver.id);
      return { ...driver, currentPrice: outcome?.price ?? 0 };
    })
    .sort((a, b) => b.currentPrice - a.currentPrice)
    .slice(0, 10); // Show top 10 drivers for readability

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg" data-testid="text-driver-chart-title">Driver Value Over Time</CardTitle>
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
            {driversWithHistory.map((driver) => (
              <Line
                key={driver.id}
                type="monotone"
                dataKey={driver.shortName}
                stroke={driver.color}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          {driversWithHistory.map((driver) => (
            <div key={driver.id} className="flex items-center gap-1.5">
              <div
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: driver.color }}
              />
              <span className="text-xs text-muted-foreground">{driver.shortName}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function processPoolChartData(
  priceHistory: PoolPriceHistoryRecord[],
  teams: { id: string; shortName: string }[]
): Record<string, number | string>[] {
  if (priceHistory.length === 0) return [];

  const teamMap = new Map(teams.map((t) => [t.id, t.shortName]));
  const timeMap = new Map<string, Record<string, number | string>>();

  for (const record of priceHistory) {
    const timeKey = record.recordedAt;
    const shortName = teamMap.get(record.participantId);
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
