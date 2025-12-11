import { useState } from "react";
import { Header } from "@/components/Header";
import { HeroSection } from "@/components/HeroSection";
import { MarketOverview } from "@/components/MarketOverview";
import { BuySharesModal } from "@/components/BuySharesModal";
import { PortfolioSection } from "@/components/PortfolioSection";
import { HowItWorks } from "@/components/HowItWorks";
import { MarketStats } from "@/components/MarketStats";
import { TeamValueChart } from "@/components/TeamValueChart";
import { DepositModal } from "@/components/DepositModal";
import { useWallet } from "@/context/WalletContext";
import type { F1Team } from "@/context/MarketContext";

export default function Home() {
  const { walletAddress } = useWallet();
  const [activeSection, setActiveSection] = useState<"market" | "portfolio">("market");
  const [selectedTeam, setSelectedTeam] = useState<F1Team | null>(null);
  const [buyModalOpen, setBuyModalOpen] = useState(false);
  const [connectWalletModalOpen, setConnectWalletModalOpen] = useState(false);

  const handleBuyTeam = (team: F1Team) => {
    if (!walletAddress) {
      setConnectWalletModalOpen(true);
      return;
    }
    setSelectedTeam(team);
    setBuyModalOpen(true);
  };

  const handleStartTrading = () => {
    setActiveSection("market");
    const marketSection = document.getElementById("market-section");
    marketSection?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-background">
      <Header onNavigate={setActiveSection} activeSection={activeSection} />
      
      {activeSection === "market" ? (
        <>
          <HeroSection onStartTrading={handleStartTrading} />
          <div id="market-section">
            <MarketOverview onBuyTeam={handleBuyTeam} />
          </div>
          <section className="py-8">
            <div className="mx-auto max-w-7xl px-4">
              <TeamValueChart />
            </div>
          </section>
          <HowItWorks />
          <MarketStats />
        </>
      ) : (
        <PortfolioSection />
      )}

      <BuySharesModal
        team={selectedTeam}
        open={buyModalOpen}
        onOpenChange={setBuyModalOpen}
      />

      <DepositModal
        open={connectWalletModalOpen}
        onOpenChange={setConnectWalletModalOpen}
      />

      <footer className="border-t py-8">
        <div className="mx-auto max-w-7xl px-4 text-center text-sm text-muted-foreground">
          <p>F1 Predict - Predictive Market Platform</p>
          <p className="mt-1">
            This is a demo application using virtual currency.
            Not affiliated with Formula 1 or FIA.
          </p>
        </div>
      </footer>
    </div>
  );
}
