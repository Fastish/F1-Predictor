import { Wallet, TrendingUp, Menu, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "./ThemeToggle";
import { useMarket } from "@/context/MarketContext";
import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { DepositModal } from "./DepositModal";

interface HeaderProps {
  onNavigate?: (section: "market" | "portfolio") => void;
  activeSection?: "market" | "portfolio";
}

export function Header({ onNavigate, activeSection = "market" }: HeaderProps) {
  const { balance } = useMarket();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);

  const navItems = [
    { id: "market" as const, label: "Market" },
    { id: "portfolio" as const, label: "Portfolio" },
  ];

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" />
            <span className="text-lg font-bold" data-testid="text-logo">F1 Predict</span>
          </div>
          
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
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1 px-3 py-1.5">
            <Wallet className="h-3.5 w-3.5" />
            <span className="font-semibold tabular-nums" data-testid="text-balance">
              ${balance.toFixed(2)}
            </span>
          </Badge>
          
          <Button 
            size="sm" 
            variant="outline"
            onClick={() => setDepositOpen(true)}
            data-testid="button-deposit"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Funds
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
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
