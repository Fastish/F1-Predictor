import { useState, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import { Loader2, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PolymarketOutcome {
  id: string;
  name: string;
  tokenId: string;
  yesTokenId?: string;
  noTokenId?: string;
  price: number;
  noPrice?: number;
  volume: string;
  conditionId: string;
  questionId: string;
  image?: string;
}

interface PriceHistoryResponse {
  history: Array<{ t: number; p: number }>;
}

interface PolymarketPriceChartProps {
  outcomes: PolymarketOutcome[];
  type: "constructors" | "drivers";
  selectedOutcome?: PolymarketOutcome | null;
  onSelectOutcome?: (outcome: PolymarketOutcome) => void;
}

const teamColors: Record<string, string> = {
  "McLaren": "#FF8700",
  "Red Bull Racing": "#1E41FF",
  "Ferrari": "#DC0000",
  "Mercedes": "#00D2BE",
  "Aston Martin": "#006F62",
  "Williams": "#005AFF",
  "Audi": "#FF0000",
  "Alpine": "#0090FF",
  "Cadillac": "#C4A747",
  "Haas": "#B6BABD",
  "Racing Bulls": "#2B4562",
  "Other": "#888888",
};

const driverColors: Record<string, string> = {
  "Max Verstappen": "#1E41FF",
  "Lando Norris": "#FF8700",
  "George Russell": "#00D2BE",
  "Oscar Piastri": "#FF8700",
  "Charles Leclerc": "#DC0000",
  "Lewis Hamilton": "#DC0000",
  "Kimi Antonelli": "#00D2BE",
  "Fernando Alonso": "#006F62",
};

type TimeRange = "1D" | "1W" | "1M" | "ALL";

const timeRanges: { key: TimeRange; label: string; interval: string; fidelity: string }[] = [
  { key: "1D", label: "1D", interval: "1d", fidelity: "5" },
  { key: "1W", label: "1W", interval: "1w", fidelity: "60" },
  { key: "1M", label: "1M", interval: "1m", fidelity: "60" },
  { key: "ALL", label: "All", interval: "all", fidelity: "60" },
];

export function PolymarketPriceChart({ 
  outcomes, 
  type,
  onSelectOutcome 
}: PolymarketPriceChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("1W");
  const [isDownloading, setIsDownloading] = useState(false);
  const { toast } = useToast();
  const colorKey = type === "constructors" ? teamColors : driverColors;

  const handleDownloadShareImage = async () => {
    setIsDownloading(true);
    try {
      const response = await fetch(`/api/markets/${type}/share-image`);
      if (!response.ok) {
        throw new Error("Failed to generate image");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `f1-predict-${type}-odds.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({
        title: "Image downloaded",
        description: "Share it on social media!",
      });
    } catch (error) {
      toast({
        title: "Download failed",
        description: "Could not generate the share image. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const isValidName = (name: string): boolean => {
    const trimmed = name.trim();
    const words = trimmed.split(/\s+/);
    if (words.length < 2) return false;
    const invalidNames = ["other", "field", "none", "n/a", "tbd", "unknown"];
    if (invalidNames.some(invalid => trimmed.toLowerCase().includes(invalid))) return false;
    if (/^driver\s+[a-z]$/i.test(trimmed)) return false;
    return true;
  };

  const topOutcomes = useMemo(() => 
    [...outcomes]
      .filter(o => type === "drivers" ? isValidName(o.name) : o.name !== "Other")
      .sort((a, b) => b.price - a.price)
      .slice(0, 5),
    [outcomes, type]
  );

  const rangeConfig = timeRanges.find(r => r.key === timeRange) || timeRanges[1];

  const priceHistoryQueries = useQueries({
    queries: topOutcomes.map(outcome => ({
      queryKey: ["/api/polymarket/price-history", outcome.yesTokenId || outcome.tokenId, rangeConfig.interval],
      queryFn: async (): Promise<{ name: string; history: PriceHistoryResponse["history"] }> => {
        const tokenId = outcome.yesTokenId || outcome.tokenId;
        const res = await fetch(
          `/api/polymarket/price-history/${tokenId}?interval=${rangeConfig.interval}&fidelity=${rangeConfig.fidelity}`
        );
        if (!res.ok) throw new Error("Failed to fetch price history");
        const data: PriceHistoryResponse = await res.json();
        return { name: outcome.name, history: data.history || [] };
      },
      enabled: !!outcome.yesTokenId || !!outcome.tokenId,
      refetchInterval: 60000,
      staleTime: 30000,
    })),
  });

  const isLoading = priceHistoryQueries.some(q => q.isLoading);
  const hasData = priceHistoryQueries.some(q => q.data?.history?.length);

  const chartData = useMemo(() => {
    const timestampMap = new Map<number, Record<string, number>>();

    priceHistoryQueries.forEach(query => {
      if (query.data?.history) {
        query.data.history.forEach(point => {
          const existing = timestampMap.get(point.t) || { timestamp: point.t * 1000 };
          existing[query.data!.name] = point.p * 100;
          timestampMap.set(point.t, existing);
        });
      }
    });

    return Array.from(timestampMap.values())
      .sort((a, b) => (a.timestamp as number) - (b.timestamp as number));
  }, [priceHistoryQueries]);

  const formatXAxis = (timestamp: number) => {
    if (timeRange === "1D") {
      return format(new Date(timestamp), "HH:mm");
    } else if (timeRange === "1W") {
      return format(new Date(timestamp), "EEE");
    } else {
      return format(new Date(timestamp), "MMM d");
    }
  };

  const CustomTooltip = ({ active, payload, label }: { 
    active?: boolean; 
    payload?: Array<{ name: string; value: number; color: string }>; 
    label?: number 
  }) => {
    if (active && payload && payload.length && label) {
      return (
        <div className="bg-popover border rounded-md px-3 py-2 shadow-lg">
          <p className="text-xs text-muted-foreground mb-1">
            {format(new Date(label), "MMM d, yyyy HH:mm")}
          </p>
          <div className="space-y-1">
            {payload
              .sort((a, b) => b.value - a.value)
              .map(entry => (
                <div key={entry.name} className="flex items-center justify-between gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-2 h-2 rounded-full" 
                      style={{ backgroundColor: entry.color }}
                    />
                    <span>{entry.name}</span>
                  </div>
                  <span className="font-medium">{entry.value.toFixed(1)}%</span>
                </div>
              ))}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <Card className="mb-6">
      <CardContent className="pt-4">
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <h3 className="font-semibold text-lg">
            {type === "constructors" ? "Constructors" : "Drivers"} Championship Odds
          </h3>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {timeRanges.map(range => (
                <Button
                  key={range.key}
                  variant={timeRange === range.key ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setTimeRange(range.key)}
                  data-testid={`button-range-${range.key.toLowerCase()}`}
                >
                  {range.label}
                </Button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadShareImage}
              disabled={isDownloading}
              data-testid="button-download-share-image"
            >
              {isDownloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Download className="h-4 w-4 mr-1" />
                  Share
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="h-[250px]">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !hasData ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              No price history available
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                <XAxis 
                  dataKey="timestamp" 
                  tickFormatter={formatXAxis}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={40}
                />
                <YAxis 
                  domain={[0, 'auto']}
                  tickFormatter={(v) => `${v.toFixed(0)}%`}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={45}
                />
                <Tooltip content={<CustomTooltip />} />
                {topOutcomes.map(outcome => (
                  <Line 
                    key={outcome.id}
                    type="monotone" 
                    dataKey={outcome.name}
                    stroke={colorKey[outcome.name] || "#888"}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-3 justify-center">
          {topOutcomes.map(outcome => {
            const color = colorKey[outcome.name] || "#888";
            return (
              <button
                key={outcome.id}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm hover-elevate"
                onClick={() => onSelectOutcome?.(outcome)}
                data-testid={`chart-select-${outcome.id}`}
              >
                <div 
                  className="w-3 h-3 rounded-full" 
                  style={{ backgroundColor: color }}
                />
                <span className="font-medium">{outcome.name}</span>
                <span className="text-muted-foreground">{(outcome.price * 100).toFixed(1)}c</span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
