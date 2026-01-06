import { Header } from "@/components/Header";
import { PortfolioSection } from "@/components/PortfolioSection";
import { Footer } from "@/components/Footer";
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
      <Footer />
    </div>
  );
}
