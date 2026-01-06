import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useSEO } from "@/hooks/useSEO";
import { Flag, MapPin, Calendar, ChevronRight, Trophy } from "lucide-react";
import type { RaceMarket } from "@shared/schema";

export default function Races() {
  useSEO({
    title: "2026 F1 Race Calendar",
    description: "View all 2026 Formula 1 races and Grand Prix events. Bet on individual race winners with real USDC. See upcoming and completed race markets."
  });

  const { data: races = [], isLoading } = useQuery<RaceMarket[]>({
    queryKey: ["/api/race-markets"],
  });

  const upcomingRaces = races.filter(r => r.status === "upcoming" || r.status === "active");
  const completedRaces = races.filter(r => r.status === "completed");

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "default";
      case "completed": return "secondary";
      default: return "outline";
    }
  };

  const renderRaceCard = (race: RaceMarket) => (
    <Card key={race.id} className="hover-elevate" data-testid={`card-race-${race.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <Flag className="h-4 w-4 text-muted-foreground shrink-0" />
              <h3 className="font-semibold truncate">{race.name}</h3>
              <Badge variant={getStatusColor(race.status)}>{race.status}</Badge>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {race.location}
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(race.raceDate).toLocaleDateString("en-US", { 
                  weekday: "short", 
                  month: "short", 
                  day: "numeric",
                  year: "numeric"
                })}
              </span>
            </div>
            {race.winnerDriverId && (
              <div className="flex items-center gap-1 mt-2 text-sm">
                <Trophy className="h-3 w-3 text-yellow-500" />
                <span className="text-muted-foreground">Winner declared</span>
              </div>
            )}
          </div>
          <Link href={`/races/${race.id}`}>
            <Button size="sm" variant="outline" data-testid={`button-view-race-${race.id}`}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );

  const renderSkeletonCards = () => (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <Card key={i}>
          <CardContent className="p-4">
            <Skeleton className="h-5 w-48 mb-2" />
            <Skeleton className="h-4 w-32" />
          </CardContent>
        </Card>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2" data-testid="text-races-title">F1 2026 Races</h1>
          <p className="text-muted-foreground">
            Bet on individual race winners throughout the season
          </p>
        </div>

        {isLoading ? (
          renderSkeletonCards()
        ) : races.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Flag className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium mb-2">No Races Available</h3>
              <p className="text-muted-foreground">
                Race markets will appear here once they are created by the admin.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {upcomingRaces.length > 0 && (
              <section>
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <Flag className="h-5 w-5" />
                  Upcoming & Active Races
                </h2>
                <div className="space-y-3">
                  {upcomingRaces.map(renderRaceCard)}
                </div>
              </section>
            )}

            {completedRaces.length > 0 && (
              <section>
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2 text-muted-foreground">
                  <Trophy className="h-5 w-5" />
                  Completed Races
                </h2>
                <div className="space-y-3">
                  {completedRaces.map(renderRaceCard)}
                </div>
              </section>
            )}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
