import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Header } from "@/components/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PolymarketBetModal } from "@/components/PolymarketBetModal";
import { CommentsSection } from "@/components/CommentsSection";
import { useWallet } from "@/context/WalletContext";
import { Flag, MapPin, Calendar, ArrowLeft, Trophy, User, TrendingUp } from "lucide-react";
import type { RaceMarket, RaceMarketOutcome, Driver } from "@shared/schema";

interface EnrichedOutcome extends RaceMarketOutcome {
  driver?: Driver | null;
}

interface RaceWithOutcomes extends RaceMarket {
  outcomes: EnrichedOutcome[];
}

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

export default function RaceDetail() {
  const [, params] = useRoute("/races/:id");
  const raceId = params?.id;
  const [selectedOutcome, setSelectedOutcome] = useState<PolymarketOutcome | null>(null);
  const [betModalOpen, setBetModalOpen] = useState(false);
  const { walletAddress, getUsdcBalance } = useWallet();

  const { data: usdcBalance = "0" } = useQuery({
    queryKey: ["usdc-balance", walletAddress],
    queryFn: () => getUsdcBalance(),
    enabled: !!walletAddress,
    refetchInterval: 30000,
  });

  const { data: race, isLoading } = useQuery<RaceWithOutcomes>({
    queryKey: ["/api/race-markets", raceId],
    enabled: !!raceId,
  });

  const { data: drivers = [] } = useQuery<Driver[]>({
    queryKey: ["/api/drivers"],
  });

  const getDriverById = (id: string) => drivers.find(d => d.id === id);

  const handleBetClick = (outcome: RaceMarketOutcome) => {
    const driver = getDriverById(outcome.driverId);
    const polymarketOutcome: PolymarketOutcome = {
      id: outcome.id,
      name: driver?.name || outcome.driverId,
      tokenId: outcome.polymarketTokenId,
      yesTokenId: outcome.polymarketTokenId,
      price: outcome.currentPrice,
      volume: "0",
      conditionId: race?.polymarketConditionId || "",
      questionId: race?.polymarketSlug || "",
    };
    setSelectedOutcome(polymarketOutcome);
    setBetModalOpen(true);
  };

  const handleCloseModal = () => {
    setBetModalOpen(false);
    setSelectedOutcome(null);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-8 max-w-4xl">
          <Skeleton className="h-8 w-64 mb-4" />
          <Skeleton className="h-4 w-48 mb-8" />
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </main>
      </div>
    );
  }

  if (!race) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-8 max-w-4xl text-center">
          <h1 className="text-2xl font-bold mb-4">Race Not Found</h1>
          <Link href="/races">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Races
            </Button>
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <Link href="/races">
          <Button variant="ghost" className="mb-4" data-testid="button-back-races">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Races
          </Button>
        </Link>

        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <Flag className="h-6 w-6 text-muted-foreground" />
            <h1 className="text-3xl font-bold" data-testid="text-race-title">{race.name}</h1>
            <Badge variant={race.status === "active" ? "default" : race.status === "completed" ? "secondary" : "outline"}>
              {race.status}
            </Badge>
          </div>
          <div className="flex items-center gap-6 text-muted-foreground flex-wrap">
            <span className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              {race.location}
            </span>
            <span className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              {new Date(race.raceDate).toLocaleDateString("en-US", { 
                weekday: "long", 
                month: "long", 
                day: "numeric",
                year: "numeric"
              })}
            </span>
          </div>
        </div>

        {race.outcomes && race.outcomes.length > 0 ? (
          <div className="space-y-3">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <User className="h-5 w-5" />
              Driver Odds
            </h2>
            <div className="grid gap-3">
              {race.outcomes.map((outcome) => {
                const driver = outcome.driver || getDriverById(outcome.driverId);
                return (
                  <Card key={outcome.id} className="hover-elevate" data-testid={`card-outcome-${outcome.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div 
                            className="w-2 h-8 rounded"
                            style={{ backgroundColor: driver?.color || "#888" }}
                          />
                          <div>
                            <p className="font-medium">{driver?.name || outcome.driverId}</p>
                            <p className="text-sm text-muted-foreground">
                              {driver?.shortName || ""}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className="flex items-center gap-1">
                              <TrendingUp className="h-4 w-4 text-muted-foreground" />
                              <span className="font-semibold">
                                {(outcome.currentPrice * 100).toFixed(0)}%
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              ${(1 / outcome.currentPrice).toFixed(2)} implied
                            </p>
                          </div>
                          <Button
                            onClick={() => handleBetClick(outcome)}
                            disabled={race.status === "completed" || !outcome.polymarketTokenId}
                            title={!outcome.polymarketTokenId ? "Betting not yet configured for this driver" : "Place a bet"}
                            data-testid={`button-bet-${outcome.id}`}
                          >
                            {outcome.polymarketTokenId ? "Bet" : "Coming Soon"}
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        ) : (
          <Card>
            <CardContent className="p-8 text-center">
              <User className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium mb-2">No Betting Outcomes Available</h3>
              <p className="text-muted-foreground">
                Driver outcomes for this race have not been configured yet.
              </p>
            </CardContent>
          </Card>
        )}

        {race.winnerDriverId && (
          <Card className="mt-6 border-yellow-500/50">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Trophy className="h-6 w-6 text-yellow-500" />
                <div>
                  <p className="font-medium">Race Winner</p>
                  <p className="text-muted-foreground">
                    {getDriverById(race.winnerDriverId)?.name || race.winnerDriverId}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {raceId && (
          <CommentsSection 
            marketType="race"
            marketId={raceId}
            marketName={race.name}
          />
        )}
      </main>

      {selectedOutcome && (
        <PolymarketBetModal
          open={betModalOpen}
          onClose={handleCloseModal}
          outcome={selectedOutcome}
          userBalance={usdcBalance}
        />
      )}
    </div>
  );
}
