import { Wallet, TrendingUp, Menu, Plus, Loader2, Briefcase, Flag, DollarSign, PieChart, LogOut, Check, ArrowRightLeft, Settings, ArrowUpRight, ArrowDownLeft, Car, User, HelpCircle, RefreshCw, Pencil, Newspaper, CreditCard, ChevronDown, Calendar, Trophy } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "./ThemeToggle";
import { useWallet } from "@/context/WalletContext";
import { useState } from "react";
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
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { DepositModal } from "./DepositModal";
import { SwapModal } from "./SwapModal";
import { WalletManagementModal } from "./WalletManagementModal";
import { useTradingSession } from "@/hooks/useTradingSession";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { usePolymarketPositions } from "@/hooks/usePolymarketPositions";
import { useTradingWalletBalance } from "@/hooks/useTradingWalletBalance";
import { UsernameModal } from "./UsernameModal";
import { MeldFundingModal } from "./MeldFundingModal";
import f1PredictLogo from "@assets/Predict_(1)_1767657713719.png";

import F1_Predict_Logo from "@assets/F1 Predict Logo.png";

export function Header() {
  const { walletAddress, walletType, disconnectWallet } = useWallet();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapDirection, setSwapDirection] = useState<"deposit" | "withdraw">("deposit");
  const [walletManagementOpen, setWalletManagementOpen] = useState(false);
  const [usernameOpen, setUsernameOpen] = useState(false);
  const [meldOpen, setMeldOpen] = useState(false);
  const { tradingSession, isTradingSessionComplete } = useTradingSession();
  const { data: positionsData } = usePolymarketPositions();
  
  const { 
    tradingWalletBalance, 
    isLoadingTradingBalance,
    tradingWalletAddress: safeAddress,
  } = useTradingWalletBalance();
  
  const cashBalance = tradingWalletBalance;
  const isLoadingCash = isLoadingTradingBalance;

  const portfolioValue = typeof positionsData?.totalValue === 'number' ? positionsData.totalValue : 0;

  const [location] = useLocation();

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-6">
          <Link href="/">
            <div className="flex items-center hover-elevate cursor-pointer rounded-md px-2 py-1" data-testid="link-home">
              <img 
                src={F1_Predict_Logo} 
                alt="F1 Predict" 
                className="h-8 w-auto"
                data-testid="img-logo"
              />
            </div>
          </Link>
          
          <nav className="hidden items-center gap-1 md:flex">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={["/constructors", "/drivers", "/races", "/how-to-use"].some(p => 
                    location === p || (p === "/races" && location.startsWith("/races/"))
                  ) ? "secondary" : "ghost"}
                  size="sm"
                  data-testid="button-nav-markets"
                >
                  <TrendingUp className="mr-1 h-4 w-4" />
                  Predictive Markets
                  <ChevronDown className="ml-1 h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <Link href="/constructors">
                  <DropdownMenuItem className="cursor-pointer" data-testid="menu-item-constructors">
                    <Car className="mr-2 h-4 w-4" />
                    Constructors
                  </DropdownMenuItem>
                </Link>
                <Link href="/drivers">
                  <DropdownMenuItem className="cursor-pointer" data-testid="menu-item-drivers">
                    <User className="mr-2 h-4 w-4" />
                    Drivers
                  </DropdownMenuItem>
                </Link>
                <Link href="/races">
                  <DropdownMenuItem className="cursor-pointer" data-testid="menu-item-races">
                    <Flag className="mr-2 h-4 w-4" />
                    Races
                  </DropdownMenuItem>
                </Link>
                <DropdownMenuSeparator />
                <Link href="/how-to-use">
                  <DropdownMenuItem className="cursor-pointer" data-testid="menu-item-guide">
                    <HelpCircle className="mr-2 h-4 w-4" />
                    Guide
                  </DropdownMenuItem>
                </Link>
              </DropdownMenuContent>
            </DropdownMenu>
            <Link href="/schedule">
              <Button
                variant={location === "/schedule" ? "secondary" : "ghost"}
                size="sm"
                data-testid="button-nav-schedule"
              >
                <Calendar className="mr-1 h-4 w-4" />
                Schedule
              </Button>
            </Link>
            <Link href="/standings">
              <Button
                variant={location === "/standings" ? "secondary" : "ghost"}
                size="sm"
                data-testid="button-nav-standings"
              >
                <Trophy className="mr-1 h-4 w-4" />
                Standings
              </Button>
            </Link>
            <Link href="/news">
              <Button
                variant={location === "/news" || location.startsWith("/news/") ? "secondary" : "ghost"}
                size="sm"
                data-testid="button-nav-news"
              >
                <Newspaper className="mr-1 h-4 w-4" />
                News
              </Button>
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {walletAddress && (
            <div className="hidden sm:flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md">
                    <Badge variant="outline" className="gap-1 px-3 py-1.5 cursor-pointer hover-elevate" data-testid="badge-cash-balance">
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
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-52 p-2" align="center">
                  <div className="flex flex-col gap-1">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="justify-start"
                      onClick={() => setSwapOpen(true)}
                      data-testid="button-header-deposit-withdraw"
                    >
                      <ArrowDownLeft className="h-4 w-4 mr-2" />
                      Deposit / Withdraw
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="justify-start"
                      onClick={() => setMeldOpen(true)}
                      data-testid="button-header-add-funds"
                    >
                      <CreditCard className="h-4 w-4 mr-2" />
                      Add External Funds
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
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
                  onClick={() => setUsernameOpen(true)}
                  data-testid="button-set-username"
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Set Username
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {walletType === "magic" && (
                  <DropdownMenuItem 
                    onClick={() => setWalletManagementOpen(true)}
                    data-testid="button-manage-wallet"
                  >
                    <Wallet className="h-4 w-4 mr-2" />
                    Send / Receive
                  </DropdownMenuItem>
                )}
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
          <SwapModal open={swapOpen} onOpenChange={setSwapOpen} initialDirection={swapDirection} />
          <WalletManagementModal open={walletManagementOpen} onOpenChange={setWalletManagementOpen} />
          <UsernameModal open={usernameOpen} onOpenChange={setUsernameOpen} />
          <MeldFundingModal open={meldOpen} onOpenChange={setMeldOpen} />

          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button size="icon" variant="ghost" className="md:hidden" data-testid="button-mobile-menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-64">
              {/* Mobile wallet balance section */}
              {walletAddress && (
                <div className="mt-6 mb-4 p-3 rounded-md bg-muted space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Cash Balance</span>
                    {isLoadingCash ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <span className="font-semibold tabular-nums" data-testid="text-mobile-cash-balance">
                        ${(cashBalance || 0).toFixed(2)}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {walletType === "magic" ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setMobileMenuOpen(false);
                            setTimeout(() => setWalletManagementOpen(true), 100);
                          }}
                          data-testid="button-mobile-wallet"
                        >
                          <Wallet className="h-3.5 w-3.5 mr-1" />
                          Send/Receive
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setMobileMenuOpen(false);
                            setTimeout(() => setSwapOpen(true), 100);
                          }}
                          data-testid="button-mobile-swap"
                        >
                          <RefreshCw className="h-3.5 w-3.5 mr-1" />
                          Swap
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setMobileMenuOpen(false);
                          setTimeout(() => setDepositOpen(true), 100);
                        }}
                        data-testid="button-mobile-wallet-settings"
                      >
                        <Settings className="h-3.5 w-3.5 mr-1" />
                        Wallet Settings
                      </Button>
                    )}
                  </div>
                </div>
              )}
              
              {!walletAddress && (
                <div className="mt-6 mb-4">
                  <Button
                    className="w-full"
                    onClick={() => {
                      setDepositOpen(true);
                      setMobileMenuOpen(false);
                    }}
                    data-testid="button-mobile-connect"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Connect Wallet
                  </Button>
                </div>
              )}
              
              <nav className="flex flex-col gap-2">
                <div className="text-xs font-medium text-muted-foreground px-3 pt-2">Predictive Markets</div>
                <Link href="/constructors">
                  <Button
                    variant={location === "/constructors" ? "secondary" : "ghost"}
                    className="justify-start w-full"
                    onClick={() => setMobileMenuOpen(false)}
                    data-testid="button-mobile-nav-constructors"
                  >
                    <Car className="mr-2 h-4 w-4" />
                    Constructors
                  </Button>
                </Link>
                <Link href="/drivers">
                  <Button
                    variant={location === "/drivers" ? "secondary" : "ghost"}
                    className="justify-start w-full"
                    onClick={() => setMobileMenuOpen(false)}
                    data-testid="button-mobile-nav-drivers"
                  >
                    <User className="mr-2 h-4 w-4" />
                    Drivers
                  </Button>
                </Link>
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
                <Link href="/how-to-use">
                  <Button
                    variant={location === "/how-to-use" ? "secondary" : "ghost"}
                    className="justify-start w-full"
                    onClick={() => setMobileMenuOpen(false)}
                    data-testid="button-mobile-nav-guide"
                  >
                    <HelpCircle className="mr-2 h-4 w-4" />
                    Guide
                  </Button>
                </Link>
                
                <div className="h-px bg-border my-2" />
                
                <Link href="/schedule">
                  <Button
                    variant={location === "/schedule" ? "secondary" : "ghost"}
                    className="justify-start w-full"
                    onClick={() => setMobileMenuOpen(false)}
                    data-testid="button-mobile-nav-schedule"
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    F1 Schedule
                  </Button>
                </Link>
                <Link href="/standings">
                  <Button
                    variant={location === "/standings" ? "secondary" : "ghost"}
                    className="justify-start w-full"
                    onClick={() => setMobileMenuOpen(false)}
                    data-testid="button-mobile-nav-standings"
                  >
                    <Trophy className="mr-2 h-4 w-4" />
                    F1 Standings
                  </Button>
                </Link>
                <Link href="/news">
                  <Button
                    variant={location === "/news" || location.startsWith("/news/") ? "secondary" : "ghost"}
                    className="justify-start w-full"
                    onClick={() => setMobileMenuOpen(false)}
                    data-testid="button-mobile-nav-news"
                  >
                    <Newspaper className="mr-2 h-4 w-4" />
                    News
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
