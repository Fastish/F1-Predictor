import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
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
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/markets" component={Markets} />
      <Route path="/races" component={Races} />
      <Route path="/races/:id" component={RaceDetail} />
      <Route path="/portfolio" component={Positions} />
      <Route path="/admin" component={Admin} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
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
  );
}

export default App;
