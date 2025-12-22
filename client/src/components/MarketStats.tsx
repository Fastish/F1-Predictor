import { TrendingUp, Clock, Trophy, Car, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";

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

export function MarketStats() {
  const { data: constructorsData } = useQuery<PolymarketOutcome[]>({
    queryKey: ["/api/polymarket/constructors"],
    refetchInterval: 30000,
  });

  const { data: driversData } = useQuery<PolymarketOutcome[]>({
    queryKey: ["/api/polymarket/drivers"],
    refetchInterval: 30000,
  });

  const constructors = constructorsData ?? [];
  const drivers = driversData ?? [];

  const constructorsVolume = constructors.reduce((acc, o) => acc + parseFloat(o.volume || "0"), 0);
  const driversVolume = drivers.reduce((acc, o) => acc + parseFloat(o.volume || "0"), 0);
  const totalVolume = constructorsVolume + driversVolume;

  const constructorsCount = constructors.length;
  const driversCount = drivers.length;
  const totalOutcomes = constructorsCount + driversCount;

  const seasonStart = new Date("2026-03-15");
  const now = new Date();
  const daysUntil = Math.max(0, Math.ceil((seasonStart.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  const formatVolume = (vol: number) => {
    if (vol >= 1000000) {
      return `$${(vol / 1000000).toFixed(2)}M`;
    } else if (vol >= 1000) {
      return `$${(vol / 1000).toFixed(1)}K`;
    }
    return `$${vol.toFixed(0)}`;
  };

  return (
    <section className="py-12">
      <div className="mx-auto max-w-7xl px-4">
        <h2 className="mb-6 text-2xl font-bold" data-testid="text-stats-title">Market Statistics</h2>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Prize Pool
              </CardTitle>
              <Trophy className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tabular-nums" data-testid="text-stats-prize-pool">
                {formatVolume(totalVolume)}
              </div>
              <p className="text-xs text-muted-foreground">
                Total market volume
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Car className="h-3 w-3" /> Teams: {formatVolume(constructorsVolume)}
                </span>
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" /> Drivers: {formatVolume(driversVolume)}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Shares
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tabular-nums" data-testid="text-stats-total-shares">
                {totalOutcomes}
              </div>
              <p className="text-xs text-muted-foreground">
                Tradeable outcomes
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Car className="h-3 w-3" /> Teams: {constructorsCount}
                </span>
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" /> Drivers: {driversCount}
                </span>
              </div>
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
      </div>
    </section>
  );
}
