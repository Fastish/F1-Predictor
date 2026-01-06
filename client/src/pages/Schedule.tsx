import { Header } from "@/components/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, MapPin, Clock, Flag } from "lucide-react";
import { useSEO } from "@/hooks/useSEO";

const F1_2026_RACES = [
  { round: 1, name: "Australian Grand Prix", location: "Melbourne, Australia", circuit: "Albert Park Circuit", date: "March 15, 2026", time: "05:00 GMT" },
  { round: 2, name: "Chinese Grand Prix", location: "Shanghai, China", circuit: "Shanghai International Circuit", date: "March 22, 2026", time: "07:00 GMT" },
  { round: 3, name: "Japanese Grand Prix", location: "Suzuka, Japan", circuit: "Suzuka Circuit", date: "April 5, 2026", time: "06:00 GMT" },
  { round: 4, name: "Bahrain Grand Prix", location: "Sakhir, Bahrain", circuit: "Bahrain International Circuit", date: "April 12, 2026", time: "15:00 GMT" },
  { round: 5, name: "Saudi Arabian Grand Prix", location: "Jeddah, Saudi Arabia", circuit: "Jeddah Corniche Circuit", date: "April 19, 2026", time: "17:00 GMT" },
  { round: 6, name: "Miami Grand Prix", location: "Miami, USA", circuit: "Miami International Autodrome", date: "May 3, 2026", time: "19:30 GMT" },
  { round: 7, name: "Emilia Romagna Grand Prix", location: "Imola, Italy", circuit: "Autodromo Enzo e Dino Ferrari", date: "May 17, 2026", time: "13:00 GMT" },
  { round: 8, name: "Monaco Grand Prix", location: "Monte Carlo, Monaco", circuit: "Circuit de Monaco", date: "May 24, 2026", time: "13:00 GMT" },
  { round: 9, name: "Spanish Grand Prix", location: "Barcelona, Spain", circuit: "Circuit de Barcelona-Catalunya", date: "June 7, 2026", time: "13:00 GMT" },
  { round: 10, name: "Canadian Grand Prix", location: "Montreal, Canada", circuit: "Circuit Gilles Villeneuve", date: "June 14, 2026", time: "18:00 GMT" },
  { round: 11, name: "Austrian Grand Prix", location: "Spielberg, Austria", circuit: "Red Bull Ring", date: "June 28, 2026", time: "13:00 GMT" },
  { round: 12, name: "British Grand Prix", location: "Silverstone, UK", circuit: "Silverstone Circuit", date: "July 5, 2026", time: "14:00 GMT" },
  { round: 13, name: "Belgian Grand Prix", location: "Spa, Belgium", circuit: "Circuit de Spa-Francorchamps", date: "July 26, 2026", time: "13:00 GMT" },
  { round: 14, name: "Hungarian Grand Prix", location: "Budapest, Hungary", circuit: "Hungaroring", date: "August 2, 2026", time: "13:00 GMT" },
  { round: 15, name: "Dutch Grand Prix", location: "Zandvoort, Netherlands", circuit: "Circuit Zandvoort", date: "August 30, 2026", time: "13:00 GMT" },
  { round: 16, name: "Italian Grand Prix", location: "Monza, Italy", circuit: "Autodromo Nazionale Monza", date: "September 6, 2026", time: "13:00 GMT" },
  { round: 17, name: "Azerbaijan Grand Prix", location: "Baku, Azerbaijan", circuit: "Baku City Circuit", date: "September 20, 2026", time: "11:00 GMT" },
  { round: 18, name: "Singapore Grand Prix", location: "Singapore", circuit: "Marina Bay Street Circuit", date: "October 4, 2026", time: "12:00 GMT" },
  { round: 19, name: "United States Grand Prix", location: "Austin, USA", circuit: "Circuit of The Americas", date: "October 18, 2026", time: "19:00 GMT" },
  { round: 20, name: "Mexico City Grand Prix", location: "Mexico City, Mexico", circuit: "Autodromo Hermanos Rodriguez", date: "October 25, 2026", time: "20:00 GMT" },
  { round: 21, name: "Brazilian Grand Prix", location: "Sao Paulo, Brazil", circuit: "Autodromo Jose Carlos Pace", date: "November 8, 2026", time: "17:00 GMT" },
  { round: 22, name: "Las Vegas Grand Prix", location: "Las Vegas, USA", circuit: "Las Vegas Strip Circuit", date: "November 21, 2026", time: "06:00 GMT" },
  { round: 23, name: "Qatar Grand Prix", location: "Lusail, Qatar", circuit: "Lusail International Circuit", date: "November 29, 2026", time: "14:00 GMT" },
  { round: 24, name: "Abu Dhabi Grand Prix", location: "Abu Dhabi, UAE", circuit: "Yas Marina Circuit", date: "December 6, 2026", time: "13:00 GMT" },
];

function getRaceStatus(dateStr: string): "upcoming" | "next" | "past" {
  const raceDate = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.ceil((raceDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) return "past";
  if (diffDays <= 14) return "next";
  return "upcoming";
}

export default function Schedule() {
  useSEO({
    title: "2026 F1 Race Calendar | F1 Predict",
    description: "Complete schedule for the 2026 Formula 1 World Championship season. View all 24 race dates, locations, circuits, and start times."
  });
  
  const nextRace = F1_2026_RACES.find(race => getRaceStatus(race.date) !== "past");
  
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container max-w-6xl mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2" data-testid="text-schedule-title">2026 F1 Race Calendar</h1>
        <p className="text-muted-foreground">
          Complete schedule for the 2026 Formula 1 World Championship season
        </p>
      </div>

      {nextRace && (
        <Card className="mb-8 border-primary/50 bg-primary/5">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Badge variant="default">Next Race</Badge>
              <CardTitle className="text-xl">{nextRace.name}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span>{nextRace.location}</span>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span>{nextRace.date}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>{nextRace.time}</span>
              </div>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{nextRace.circuit}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {F1_2026_RACES.map((race) => {
          const status = getRaceStatus(race.date);
          return (
            <Card 
              key={race.round} 
              className={status === "past" ? "opacity-60" : ""}
              data-testid={`card-race-${race.round}`}
            >
              <CardContent className="py-4">
                <div className="flex flex-col md:flex-row md:items-center gap-4">
                  <div className="flex items-center gap-4 flex-1">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-muted font-bold">
                      {race.round}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold">{race.name}</h3>
                        {status === "next" && (
                          <Badge variant="default" className="text-xs">Upcoming</Badge>
                        )}
                        {status === "past" && (
                          <Badge variant="secondary" className="text-xs">Completed</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{race.circuit}</p>
                    </div>
                  </div>
                  <div className="flex flex-col md:flex-row items-start md:items-center gap-2 md:gap-6 text-sm">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <span>{race.location}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span>{race.date}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span>{race.time}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      </div>
    </div>
  );
}
