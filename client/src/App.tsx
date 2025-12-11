import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/context/ThemeContext";
import { MarketProvider } from "@/context/MarketContext";
import { WalletProvider } from "@/context/WalletContext";
import Home from "@/pages/Home";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
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
