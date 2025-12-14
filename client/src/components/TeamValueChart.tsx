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
  BarChart,
  Bar,
  Cell,
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

  const { data: driversFromAPI = [] } = useQuery<DriverFromAPI[]>({
    queryKey: ["/api/drivers"],
    enabled: type === "drivers",
  });

  if (type === "drivers") {
    return <DriverPriceChart driverPool={driverPool} drivers={driversFromAPI} isLoading={driverPoolLoading} />;
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
  isLoading 
}: { 
  driverPool?: ChampionshipPool; 
  drivers: DriverFromAPI[]; 
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Driver Championship Odds</CardTitle>
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
          <CardTitle className="text-lg">Driver Championship Odds</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[300px] items-center justify-center text-muted-foreground">
            Driver market not yet available. Check back when the admin creates driver markets.
          </div>
        </CardContent>
      </Card>
    );
  }

  // Create chart data from driver pool outcomes
  const chartData = driverPool.outcomes
    .map((outcome) => {
      const driver = drivers.find((d) => d.id === outcome.participantId);
      return {
        name: driver?.shortName || outcome.participantName.split(" ").pop() || outcome.participantName,
        price: outcome.price,
        probability: outcome.probability * 100,
        color: driver?.color || "#888888",
        fullName: outcome.participantName,
      };
    })
    .sort((a, b) => b.price - a.price)
    .slice(0, 10); // Show top 10 drivers

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg" data-testid="text-driver-chart-title">Driver Championship Odds (Top 10)</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 60, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 12 }}
              tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
              domain={[0, "auto"]}
              className="text-muted-foreground"
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 12 }}
              width={55}
              className="text-muted-foreground"
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "6px",
              }}
              formatter={(value: number) => [`${(value * 100).toFixed(1)}%`, "Win Probability"]}
              labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName || ""}
            />
            <Bar dataKey="price" radius={[0, 4, 4, 0]}>
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          {chartData.slice(0, 5).map((driver) => (
            <div key={driver.name} className="flex items-center gap-1.5">
              <div
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: driver.color }}
              />
              <span className="text-xs text-muted-foreground">
                {driver.name}: {(driver.price * 100).toFixed(1)}%
              </span>
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
