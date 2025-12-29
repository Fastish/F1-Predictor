import { Wallet, TrendingUp, Menu, Plus, Loader2, Briefcase, Flag, DollarSign, PieChart, LogOut, Check, ArrowRightLeft, Settings } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "./ThemeToggle";
import { useWallet } from "@/context/WalletContext";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DepositModal } from "./DepositModal";
import { useTradingSession } from "@/hooks/useTradingSession";
import { usePolymarketPositions } from "@/hooks/usePolymarketPositions";
import { deriveSafe } from "@polymarket/builder-relayer-client/dist/builder/derive";
import { getContractConfig } from "@polymarket/builder-relayer-client/dist/config";

const POLYGON_CHAIN_ID = 137;

export function Header() {
  const { walletAddress, walletType, disconnectWallet, getUsdcBalance } = useWallet();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const { tradingSession, isTradingSessionComplete } = useTradingSession();
  const { data: positionsData } = usePolymarketPositions();
  
  const derivedSafeAddress = useMemo(() => {
    if (walletType !== "external" || !walletAddress) return null;
    try {
      const config = getContractConfig(POLYGON_CHAIN_ID);
      return deriveSafe(walletAddress, config.SafeContracts.SafeFactory);
    } catch (e) {
      console.warn("Failed to derive Safe address:", e);
      return null;
    }
  }, [walletAddress, walletType]);
  
  const safeAddress = tradingSession?.safeAddress || derivedSafeAddress;
  
  // For external wallets, show EOA balance (user's wallet) as primary
  // For Magic wallets, show the wallet balance directly
  const { data: eoaBalance, isLoading: isLoadingEoa } = useQuery({
    queryKey: ["polygon-usdc-balance", walletAddress],
    queryFn: async () => {
      if (!walletAddress) return 0;
      const { ethers } = await import("ethers");
      const provider = new ethers.JsonRpcProvider("https://polygon-rpc.com");
      const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
      const contract = new ethers.Contract(USDC_ADDRESS, ["function balanceOf(address) view returns (uint256)"], provider);
      const balance = await contract.balanceOf(walletAddress);
      return parseFloat(ethers.formatUnits(balance, 6));
    },
    enabled: !!walletAddress,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 30000,
  });
  
  // Show EOA balance as the primary "cash" balance
  const cashBalance = eoaBalance || 0;
  const isLoadingCash = isLoadingEoa;

  const portfolioValue = positionsData?.totalValue || 0;

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
            <Link href="/races">
              <Button
                variant={location === "/races" || location.startsWith("/races/") ? "secondary" : "ghost"}
                size="sm"
                data-testid="button-nav-races"
              >
                <Flag className="mr-1 h-4 w-4" />
                Races
              </Button>
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {walletAddress && (
            <div className="hidden sm:flex items-center gap-2">
              <Badge variant="outline" className="gap-1 px-3 py-1.5">
                {isLoadingCash ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <DollarSign className="h-3.5 w-3.5" />
                    <span className="text-xs text-muted-foreground">Cash:</span>
                    <span className="font-semibold tabular-nums" data-testid="text-cash-balance">
                      ${(cashBalance || 0).toFixed(2)}
                    </span>
                  </>
                )}
              </Badge>
              <Link href="/portfolio">
                <Badge 
                  variant="outline" 
                  className="gap-1 px-3 py-1.5 cursor-pointer hover-elevate"
                  data-testid="link-portfolio"
                >
                  <PieChart className="h-3.5 w-3.5" />
                  <span className="text-xs text-muted-foreground">Portfolio:</span>
                  <span className="font-semibold tabular-nums" data-testid="text-portfolio-value">
                    ${portfolioValue.toFixed(2)}
                  </span>
                </Badge>
              </Link>
            </div>
          )}
          
          {walletAddress ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  size="sm" 
                  variant="outline"
                  data-testid="button-connected"
                >
                  <Check className="h-4 w-4 mr-1" />
                  Connected
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem 
                  onClick={() => setDepositOpen(true)}
                  data-testid="button-wallet-settings"
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Wallet Settings
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => disconnectWallet()}
                  data-testid="button-disconnect"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Disconnect
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => setDepositOpen(true)}
              data-testid="button-connect-wallet"
            >
              <Plus className="h-4 w-4 mr-1" />
              Connect Wallet
            </Button>
          )}
          
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
                <Link href="/races">
                  <Button
                    variant={location === "/races" || location.startsWith("/races/") ? "secondary" : "ghost"}
                    className="justify-start w-full"
                    onClick={() => setMobileMenuOpen(false)}
                    data-testid="button-mobile-nav-races"
                  >
                    <Flag className="mr-2 h-4 w-4" />
                    Races
                  </Button>
                </Link>
                <Link href="/portfolio">
                  <Button
                    variant={location === "/portfolio" ? "secondary" : "ghost"}
                    className="justify-start w-full"
                    onClick={() => setMobileMenuOpen(false)}
                    data-testid="button-mobile-nav-portfolio"
                  >
                    <PieChart className="mr-2 h-4 w-4" />
                    Portfolio
                  </Button>
                </Link>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
