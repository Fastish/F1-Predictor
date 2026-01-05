import { Switch, Route } from "wouter";
import { useState, useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, type Config } from "wagmi";
import { getWagmiConfig } from "./lib/wagmi";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/context/ThemeContext";
import { MarketProvider } from "@/context/MarketContext";
import { WalletProvider } from "@/context/WalletContext";
import Home from "@/pages/Home";
import Admin from "@/pages/Admin";
import Markets from "@/pages/Markets";
import Positions from "@/pages/Positions";
import Races from "@/pages/Races";
import RaceDetail from "@/pages/RaceDetail";
import ConstructorsChampionship from "@/pages/ConstructorsChampionship";
import DriversChampionship from "@/pages/DriversChampionship";
import NotFound from "@/pages/not-found";
import HowToUse from "@/pages/HowToUse";
import News from "@/pages/News";
import NewsArticle from "@/pages/NewsArticle";
import Schedule from "@/pages/Schedule";
import Standings from "@/pages/Standings";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/markets" component={Markets} />
      <Route path="/constructors" component={ConstructorsChampionship} />
      <Route path="/drivers" component={DriversChampionship} />
      <Route path="/races" component={Races} />
      <Route path="/races/:id" component={RaceDetail} />
      <Route path="/portfolio" component={Positions} />
      <Route path="/news" component={News} />
      <Route path="/news/:slug" component={NewsArticle} />
      <Route path="/schedule" component={Schedule} />
      <Route path="/standings" component={Standings} />
      <Route path="/admin" component={Admin} />
      <Route path="/how-to-use" component={HowToUse} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const [wagmiConfig, setWagmiConfig] = useState<Config | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getWagmiConfig()
      .then(config => {
        setWagmiConfig(config);
        setIsLoading(false);
      })
      .catch(err => {
        console.error("[App] Failed to initialize wagmi config:", err);
        setIsLoading(false);
      });
  }, []);

  if (isLoading || !wagmiConfig) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <MarketProvider>
            <WalletProvider>
              <TooltipProvider>
                <Toaster />
                <Router />
              </TooltipProvider>
            </WalletProvider>
          </MarketProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default App;
