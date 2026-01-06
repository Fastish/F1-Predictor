import { useState, useEffect } from "react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Clock, Trophy, Car, User } from "lucide-react";
import { useSEO } from "@/hooks/useSEO";

const CONSTRUCTOR_STANDINGS_2025 = [
  { position: 1, team: "Red Bull Racing", points: 860, color: "#3671C6" },
  { position: 2, team: "Ferrari", points: 584, color: "#E8002D" },
  { position: 3, team: "McLaren", points: 516, color: "#FF8000" },
  { position: 4, team: "Mercedes", points: 468, color: "#27F4D2" },
  { position: 5, team: "Aston Martin", points: 280, color: "#229971" },
  { position: 6, team: "Alpine", points: 120, color: "#0093CC" },
  { position: 7, team: "Williams", points: 28, color: "#64C4FF" },
  { position: 8, team: "RB", points: 28, color: "#6692FF" },
  { position: 9, team: "Sauber", points: 16, color: "#52E252" },
  { position: 10, team: "Haas", points: 12, color: "#B6BABD" },
];

const DRIVER_STANDINGS_2025 = [
  { position: 1, driver: "Max Verstappen", team: "Red Bull Racing", points: 575, color: "#3671C6" },
  { position: 2, driver: "Lando Norris", team: "McLaren", points: 285, color: "#FF8000" },
  { position: 3, driver: "Charles Leclerc", team: "Ferrari", points: 275, color: "#E8002D" },
  { position: 4, driver: "Carlos Sainz", team: "Ferrari", points: 258, color: "#E8002D" },
  { position: 5, driver: "Lewis Hamilton", team: "Mercedes", points: 211, color: "#27F4D2" },
  { position: 6, driver: "Oscar Piastri", team: "McLaren", points: 195, color: "#FF8000" },
  { position: 7, driver: "George Russell", team: "Mercedes", points: 188, color: "#27F4D2" },
  { position: 8, driver: "Sergio Perez", team: "Red Bull Racing", points: 151, color: "#3671C6" },
  { position: 9, driver: "Fernando Alonso", team: "Aston Martin", points: 62, color: "#229971" },
  { position: 10, driver: "Lance Stroll", team: "Aston Martin", points: 24, color: "#229971" },
  { position: 11, driver: "Pierre Gasly", team: "Alpine", points: 20, color: "#0093CC" },
  { position: 12, driver: "Esteban Ocon", team: "Alpine", points: 17, color: "#0093CC" },
  { position: 13, driver: "Daniel Ricciardo", team: "RB", points: 12, color: "#6692FF" },
  { position: 14, driver: "Yuki Tsunoda", team: "RB", points: 10, color: "#6692FF" },
  { position: 15, driver: "Alexander Albon", team: "Williams", points: 6, color: "#64C4FF" },
  { position: 16, driver: "Kevin Magnussen", team: "Haas", points: 5, color: "#B6BABD" },
  { position: 17, driver: "Nico Hulkenberg", team: "Haas", points: 4, color: "#B6BABD" },
  { position: 18, driver: "Valtteri Bottas", team: "Sauber", points: 4, color: "#52E252" },
  { position: 19, driver: "Zhou Guanyu", team: "Sauber", points: 0, color: "#52E252" },
  { position: 20, driver: "Logan Sargeant", team: "Williams", points: 0, color: "#64C4FF" },
];

function CountdownTimer() {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  
  useEffect(() => {
    const seasonStart = new Date("2026-03-15T05:00:00Z");
    
    const updateCountdown = () => {
      const now = new Date();
      const diff = seasonStart.getTime() - now.getTime();
      
      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        return;
      }
      
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      setTimeLeft({ days, hours, minutes, seconds });
    };
    
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    
    return () => clearInterval(interval);
  }, []);
  
  return (
    <Card className="mb-8 border-primary/50 bg-gradient-to-r from-primary/10 to-primary/5">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" />
          <CardTitle>2026 Season Countdown</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-4 gap-4 text-center">
          <div className="p-4 rounded-md bg-background">
            <div className="text-3xl font-bold tabular-nums" data-testid="text-countdown-days">{timeLeft.days}</div>
            <div className="text-sm text-muted-foreground">Days</div>
          </div>
          <div className="p-4 rounded-md bg-background">
            <div className="text-3xl font-bold tabular-nums" data-testid="text-countdown-hours">{timeLeft.hours}</div>
            <div className="text-sm text-muted-foreground">Hours</div>
          </div>
          <div className="p-4 rounded-md bg-background">
            <div className="text-3xl font-bold tabular-nums" data-testid="text-countdown-minutes">{timeLeft.minutes}</div>
            <div className="text-sm text-muted-foreground">Minutes</div>
          </div>
          <div className="p-4 rounded-md bg-background">
            <div className="text-3xl font-bold tabular-nums" data-testid="text-countdown-seconds">{timeLeft.seconds}</div>
            <div className="text-sm text-muted-foreground">Seconds</div>
          </div>
        </div>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Until the 2026 Australian Grand Prix
        </p>
      </CardContent>
    </Card>
  );
}

export default function Standings() {
  useSEO({
    title: "F1 Standings 2025 - Constructor & Driver Rankings | F1 Predict",
    description: "View the current 2025 F1 World Championship standings. See constructor and driver points rankings plus countdown to the 2026 season opener."
  });

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container max-w-6xl mx-auto py-8 px-4">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2" data-testid="text-standings-title">F1 Championship Standings</h1>
          <p className="text-muted-foreground">
            Current standings from the 2025 Formula 1 World Championship
          </p>
        </div>

        <CountdownTimer />

      <Badge variant="secondary" className="mb-4">
        2025 Season Data - 2026 standings will update when the season begins
      </Badge>

      <Tabs defaultValue="constructors" className="mt-6">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="constructors" className="gap-2" data-testid="tab-constructors">
            <Car className="h-4 w-4" />
            Constructors
          </TabsTrigger>
          <TabsTrigger value="drivers" className="gap-2" data-testid="tab-drivers">
            <User className="h-4 w-4" />
            Drivers
          </TabsTrigger>
        </TabsList>

        <TabsContent value="constructors" className="mt-6">
          <div className="grid gap-3">
            {CONSTRUCTOR_STANDINGS_2025.map((team) => (
              <Card key={team.team} data-testid={`card-constructor-${team.position}`}>
                <CardContent className="py-4">
                  <div className="flex items-center gap-4">
                    <div 
                      className="flex items-center justify-center w-10 h-10 rounded-full font-bold text-white"
                      style={{ backgroundColor: team.color }}
                    >
                      {team.position}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span 
                          className="w-1 h-6 rounded-full" 
                          style={{ backgroundColor: team.color }}
                        />
                        <h3 className="font-semibold">{team.team}</h3>
                        {team.position === 1 && (
                          <Trophy className="h-4 w-4 text-yellow-500" />
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-2xl font-bold tabular-nums">{team.points}</span>
                      <span className="text-sm text-muted-foreground ml-1">pts</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="drivers" className="mt-6">
          <div className="grid gap-3">
            {DRIVER_STANDINGS_2025.map((driver) => (
              <Card key={driver.driver} data-testid={`card-driver-${driver.position}`}>
                <CardContent className="py-4">
                  <div className="flex items-center gap-4">
                    <div 
                      className="flex items-center justify-center w-10 h-10 rounded-full font-bold text-white"
                      style={{ backgroundColor: driver.color }}
                    >
                      {driver.position}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span 
                          className="w-1 h-6 rounded-full" 
                          style={{ backgroundColor: driver.color }}
                        />
                        <h3 className="font-semibold">{driver.driver}</h3>
                        {driver.position === 1 && (
                          <Trophy className="h-4 w-4 text-yellow-500" />
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{driver.team}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-2xl font-bold tabular-nums">{driver.points}</span>
                      <span className="text-sm text-muted-foreground ml-1">pts</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
      </div>
      <Footer />
    </div>
  );
}
