import { Wallet, TrendingUp, Menu, Plus, Loader2, Briefcase, BarChart3 } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "./ThemeToggle";
import { useMarket } from "@/context/MarketContext";
import { useWallet } from "@/context/WalletContext";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Holding } from "@shared/schema";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { DepositModal } from "./DepositModal";

interface USDCBalanceResponse {
  address: string;
  balance: string;
  asset: string;
}

interface HeaderProps {
  onNavigate?: (section: "market" | "portfolio") => void;
  activeSection?: "market" | "portfolio";
}

export function Header({ onNavigate, activeSection = "market" }: HeaderProps) {
  const { teams, userId } = useMarket();
  const { walletAddress } = useWallet();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);

  const { data: usdcBalance, isLoading: isLoadingBalance } = useQuery<USDCBalanceResponse>({
    queryKey: ["/api/stellar/balance", walletAddress],
    enabled: !!walletAddress,
  });

  const { data: holdings = [] } = useQuery<Holding[]>({
    queryKey: ["/api/users", userId, "holdings"],
    enabled: !!userId,
  });

  const portfolioValue = holdings.reduce((total, holding) => {
    const team = teams.find(t => t.id === holding.teamId);
    return total + (team ? team.price * holding.shares : 0);
  }, 0);

  const navItems = [
    { id: "market" as const, label: "Market" },
    { id: "portfolio" as const, label: "Portfolio" },
  ];
  
  const [location] = useLocation();

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-6">
          <Link href="/">
            <div className="flex items-center gap-2 hover-elevate cursor-pointer rounded-md px-2 py-1" data-testid="link-home">
              <TrendingUp className="h-6 w-6 text-primary" />
              <span className="text-lg font-bold" data-testid="text-logo">F1 Predict</span>
            </div>
          </Link>
          
          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => (
              <Button
                key={item.id}
                variant={activeSection === item.id ? "secondary" : "ghost"}
                size="sm"
                onClick={() => onNavigate?.(item.id)}
                data-testid={`button-nav-${item.id}`}
              >
                {item.label}
              </Button>
            ))}
            <Button
                variant={location === "/markets" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => window.location.href = "/markets"}
                data-testid="button-nav-order-book"
              >
                <BarChart3 className="mr-1 h-4 w-4" />
                Order Book
              </Button>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1 px-3 py-1.5">
            <Briefcase className="h-3.5 w-3.5" />
            <span className="text-xs text-muted-foreground">Portfolio:</span>
            <span className="font-semibold tabular-nums" data-testid="text-portfolio-value">
              ${portfolioValue.toFixed(2)}
            </span>
          </Badge>
          
          {walletAddress && (
            <Badge variant="outline" className="gap-1 px-3 py-1.5">
              {isLoadingBalance ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  <Wallet className="h-3.5 w-3.5" />
                  <span className="text-xs text-muted-foreground">USDC:</span>
                  <span className="font-semibold tabular-nums" data-testid="text-usdc-balance">
                    ${parseFloat(usdcBalance?.balance || "0").toFixed(2)}
                  </span>
                </>
              )}
            </Badge>
          )}
          
          <Button 
            size="sm" 
            variant="outline"
            onClick={() => setDepositOpen(true)}
            data-testid="button-deposit"
          >
            <Plus className="h-4 w-4 mr-1" />
            {walletAddress ? "Add Funds" : "Connect Wallet"}
          </Button>
          
          <ThemeToggle />
          
          <DepositModal open={depositOpen} onOpenChange={setDepositOpen} />

          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button size="icon" variant="ghost" className="md:hidden" data-testid="button-mobile-menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-64">
              <nav className="mt-8 flex flex-col gap-2">
                {navItems.map((item) => (
                  <Button
                    key={item.id}
                    variant={activeSection === item.id ? "secondary" : "ghost"}
                    className="justify-start"
                    onClick={() => {
                      onNavigate?.(item.id);
                      setMobileMenuOpen(false);
                    }}
                    data-testid={`button-mobile-nav-${item.id}`}
                  >
                    {item.label}
                  </Button>
                ))}
                <Button
                    variant={location === "/markets" ? "secondary" : "ghost"}
                    className="justify-start w-full"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      window.location.href = "/markets";
                    }}
                    data-testid="button-mobile-nav-order-book"
                  >
                    <BarChart3 className="mr-2 h-4 w-4" />
                    Order Book
                  </Button>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
