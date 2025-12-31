import { Header } from "@/components/Header";
import { PortfolioSection } from "@/components/PortfolioSection";
import { useSEO } from "@/hooks/useSEO";

export default function Positions() {
  useSEO({
    title: "My Positions - F1 Trading Portfolio",
    description: "View and manage your F1 prediction market positions. Track your bets on 2026 Formula 1 Constructors and Drivers Championship outcomes."
  });

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <PortfolioSection />
      <footer className="border-t py-8">
        <div className="mx-auto max-w-7xl px-4 text-center text-sm text-muted-foreground">
          <p>F1 Predict - Predictive Market Platform</p>
          <p className="mt-1">
            This site is powered by Polymarket.com, Copyright 2025
          </p>
        </div>
      </footer>
    </div>
  );
}
