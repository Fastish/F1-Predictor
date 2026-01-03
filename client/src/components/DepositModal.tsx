import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMarket } from "@/context/MarketContext";
import { useWallet } from "@/context/WalletContext";
import { useTradingSession } from "@/hooks/useTradingSession";
import { useToast } from "@/hooks/use-toast";
import { Copy, Wallet, AlertCircle, Loader2, LogOut, Mail, ExternalLink, RotateCcw, Key, CheckCircle2, ArrowRightLeft, ArrowUpRight, ArrowDownLeft, Send } from "lucide-react";
import { SiPolygon } from "react-icons/si";
import { PolymarketDepositWizard } from "./PolymarketDepositWizard";
import { SwapModal } from "./SwapModal";
import { WalletManagementModal } from "./WalletManagementModal";
import { checkDepositRequirements } from "@/lib/polymarketDeposit";
import { useTradingWalletBalance } from "@/hooks/useTradingWalletBalance";
import { withdrawFromSafe, deriveSafeAddressFromEoa } from "@/lib/polymarketGasless";

// Helper to detect mobile devices - for UI simplification
const isMobileDevice = () => {
  if (typeof window === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

const PhantomIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 128 128" className={className} fill="currentColor">
    <path d="M64 0C28.7 0 0 28.7 0 64s28.7 64 64 64 64-28.7 64-64S99.3 0 64 0zm35.3 85.3c-2.4 6.5-7.1 11.2-13.6 13.6-6.5 2.4-13.3 2.4-19.8 0-6.5-2.4-11.2-7.1-13.6-13.6-2.4-6.5-2.4-13.3 0-19.8 2.4-6.5 7.1-11.2 13.6-13.6 6.5-2.4 13.3-2.4 19.8 0 6.5 2.4 11.2 7.1 13.6 13.6 2.4 6.5 2.4 13.3 0 19.8z"/>
  </svg>
);

const MetaMaskIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 318.6 318.6" className={className}>
    <path fill="#E2761B" d="M274.1 35.5l-99.5 73.9L193 65.8z"/>
    <path fill="#E4761B" d="M44.4 35.5l98.7 74.6-17.5-44.3zm193.9 171.3l-26.5 40.6 56.7 15.6 16.3-55.3zm-204.4.9L50.1 263l56.7-15.6-26.5-40.6z"/>
    <path fill="#D7C1B3" d="M103.6 138.2l-15.8 23.9 56.3 2.5-2-60.5zm111.3 0l-39-34.8-1.3 61.2 56.2-2.5zM106.8 247.4l33.8-16.5-29.2-22.8zm71.1-16.5l33.9 16.5-4.7-39.3z"/>
    <path fill="#233447" d="M211.8 247.4l-33.9-16.5 2.7 22.1-.3 9.3zm-105 0l31.5 14.9-.2-9.3 2.5-22.1z"/>
    <path fill="#CD6116" d="M138.8 193.5l-28.2-8.3 19.9-9.1zm40.9 0l8.3-17.4 20 9.1z"/>
    <path fill="#E4751F" d="M106.8 247.4l4.8-40.6-31.3.9zM207 206.8l4.8 40.6 26.5-39.7zm23.8-44.7l-56.2 2.5 5.2 28.9 8.3-17.4 20 9.1zm-120.2 23.1l20-9.1 8.2 17.4 5.3-28.9-56.3-2.5z"/>
    <path fill="#F6851B" d="M87.8 162.1l23.6 46-.8-22.9zm120.3 23.1l-1 22.9 23.7-46zm-64-20.6l-5.3 28.9 6.6 34.1 1.5-44.9zm30.5 0l-2.7 18 1.2 45 6.7-34.1z"/>
  </svg>
);

interface DepositModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DepositModal({ open, onOpenChange }: DepositModalProps) {
  const { userId, resetUser } = useMarket();
  const { 
    walletAddress, 
    walletType,
    isConnecting, 
    userEmail,
    connectWithMagic,
    connectExternalWallet,
    connectWalletConnect,
    connectPhantomWallet,
    isPhantomInstalled,
    disconnectWallet,
    provider,
  } = useWallet();
  const { 
    endTradingSession, 
    isTradingSessionComplete,
    initializeTradingSession,
    isInitializing,
    currentStep,
    sessionError,
    safeAddress,
    signerAvailable,
  } = useTradingSession();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [showDepositWizard, setShowDepositWizard] = useState(false);
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [showWalletManagement, setShowWalletManagement] = useState(false);
  const [walletManagementConfig, setWalletManagementConfig] = useState<{
    initialTab: "receive" | "send";
    prefilledAddress: string;
    title: string;
    sendLabel?: string;
  }>({ initialTab: "receive", prefilledAddress: "", title: "Wallet Management" });
  const [approvalStatus, setApprovalStatus] = useState<{ needsApproval: boolean; needsCTFApproval: boolean; checked: boolean }>({ needsApproval: false, needsCTFApproval: false, checked: false });
  const [autoInitAttempted, setAutoInitAttempted] = useState(false);
  const [showWithdrawForm, setShowWithdrawForm] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  // For WalletConnect/external/phantom users, derive Safe address immediately even if trading session isn't initialized
  // This allows users to see their deposit address right away
  // IMPORTANT: Always derive fresh from walletAddress to avoid stale/wrong session data
  const derivedSafeAddress = (walletType === "external" || walletType === "walletconnect" || walletType === "phantom") && walletAddress
    ? deriveSafeAddressFromEoa(walletAddress)
    : null;
  
  // For external wallet types, ALWAYS prefer the freshly derived address over session's safeAddress
  // This prevents stale session data (from a different wallet type) from being used
  // The session's safeAddress might be wrong if window.ethereum was used to derive it when connected via WalletConnect
  const displaySafeAddress = (walletType === "external" || walletType === "walletconnect" || walletType === "phantom")
    ? (derivedSafeAddress || safeAddress)  // Prefer derived, fallback to session
    : (safeAddress || derivedSafeAddress); // For magic/other, use session first

  // Check approval status when wallet is connected
  // For external wallets, check the Safe proxy address since approvals are done there
  useEffect(() => {
    const checkApproval = async () => {
      if (!walletAddress || !provider) {
        setApprovalStatus({ needsApproval: false, needsCTFApproval: false, checked: false });
        return;
      }
      try {
        const isMagic = walletType === "magic";
        const isExternalType = walletType === "external" || walletType === "walletconnect" || walletType === "phantom";
        const safeAddrToCheck = isExternalType ? displaySafeAddress : null;
        
        console.log("[DepositModal] Checking approvals:", {
          walletType,
          walletAddress,
          isExternalType,
          displaySafeAddress,
          safeAddrToCheck,
        });
        
        // Pass Safe address as 4th parameter for external wallets
        const status = await checkDepositRequirements(
          provider, 
          walletAddress, 
          isMagic, 
          safeAddrToCheck
        );
        
        console.log("[DepositModal] Approval check result:", {
          needsApproval: status.needsApproval,
          needsCTFApproval: status.needsCTFApproval,
          ctfExchangeAllowance: status.ctfExchangeAllowance,
          negRiskExchangeAllowance: status.negRiskExchangeAllowance,
          safeAddress: status.safeAddress,
          safeBalance: status.safeBalance,
        });
        
        setApprovalStatus({ needsApproval: status.needsApproval, needsCTFApproval: status.needsCTFApproval, checked: true });
      } catch (error) {
        console.error("Failed to check approval status:", error);
        setApprovalStatus({ needsApproval: false, needsCTFApproval: false, checked: true });
      }
    };
    if (open && walletAddress) {
      checkApproval();
    }
  }, [open, walletAddress, provider, walletType, displaySafeAddress]);

  // Reset auto-init flag when modal closes or wallet disconnects
  useEffect(() => {
    if (!open || !walletAddress) {
      setAutoInitAttempted(false);
    }
  }, [open, walletAddress]);

  // Auto-initialize trading session for external wallets and WalletConnect when connected
  useEffect(() => {
    const autoInitSession = async () => {
      // Must have wallet connected, signer available, modal open, and session not yet complete
      const canAutoInit = (walletType === "external" || walletType === "walletconnect" || walletType === "phantom") 
        && walletAddress 
        && signerAvailable 
        && !isTradingSessionComplete 
        && !isInitializing 
        && !autoInitAttempted 
        && open;
      
      console.log("[DepositModal] Auto-init check:", { walletType, walletAddress: !!walletAddress, signerAvailable, isTradingSessionComplete, isInitializing, autoInitAttempted, open, canAutoInit });
      
      if (canAutoInit) {
        setAutoInitAttempted(true);
        try {
          console.log("[DepositModal] Starting auto-init trading session...");
          await initializeTradingSession();
          console.log("[DepositModal] Auto-init completed successfully");
        } catch (error) {
          console.error("[DepositModal] Auto-init session failed:", error);
          toast({
            title: "Session Setup",
            description: "Trading session setup was cancelled or failed. Click 'Initialize Trading Session' to try again.",
          });
        }
      }
    };
    autoInitSession();
  }, [walletType, walletAddress, signerAvailable, isTradingSessionComplete, isInitializing, autoInitAttempted, open, initializeTradingSession, toast]);

  // Auto-launch approval wizard after trading session completes (if approvals are needed)
  const [approvalWizardAutoOpened, setApprovalWizardAutoOpened] = useState(false);
  const approvalChecked = approvalStatus.checked;
  const approvalNeeded = approvalStatus.needsApproval;
  useEffect(() => {
    // When session completes and approvals are needed, auto-open the deposit wizard ONCE
    if (isTradingSessionComplete && approvalChecked && approvalNeeded && !showDepositWizard && !approvalWizardAutoOpened) {
      console.log("[DepositModal] Session complete but approval needed - auto-opening deposit wizard");
      setApprovalWizardAutoOpened(true);
      setShowDepositWizard(true);
    }
  }, [isTradingSessionComplete, approvalChecked, approvalNeeded, showDepositWizard, approvalWizardAutoOpened]);
  
  // Reset approval wizard auto-open flag when modal closes
  useEffect(() => {
    if (!open) {
      setApprovalWizardAutoOpened(false);
    }
  }, [open]);

  const handleResetSession = () => {
    endTradingSession();
    toast({
      title: "Trading Session Reset",
      description: "API credentials have been cleared. You'll need to set up trading again when placing your next order.",
    });
  };

  const handleWithdrawFromSafe = async () => {
    if (!walletAddress || !safeAddress) return;
    
    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid amount to withdraw",
        variant: "destructive",
      });
      return;
    }
    
    if (amount > tradingWalletBalance) {
      toast({
        title: "Insufficient Balance",
        description: `Safe balance is only $${tradingWalletBalance.toFixed(2)}`,
        variant: "destructive",
      });
      return;
    }
    
    setIsWithdrawing(true);
    try {
      toast({
        title: "Withdrawal Processing",
        description: "Please sign the transaction in your wallet...",
      });
      
      const amountInWei = BigInt(Math.floor(amount * 1e6));
      const result = await withdrawFromSafe(walletAddress, amountInWei);
      
      if (result.success) {
        toast({
          title: "Withdrawal Complete",
          description: `$${amount.toFixed(2)} USDC.e sent to your wallet`,
        });
        setWithdrawAmount("");
        setShowWithdrawForm(false);
        refetchBalance();
      } else {
        throw new Error(result.error || "Withdrawal failed");
      }
    } catch (error: any) {
      console.error("Withdraw failed:", error);
      toast({
        title: "Withdrawal Failed",
        description: error.message || "Failed to withdraw from Safe",
        variant: "destructive",
      });
    } finally {
      setIsWithdrawing(false);
    }
  };

  const { 
    tradingWalletBalance, 
    tradingWalletUsdcBalance,
    isLoadingTradingBalance: isLoadingBalance,
    eoaBalance,
    eoaUsdcBalance,
    isLoadingEoaBalance,
    isExternalWallet,
    refetchTradingBalance: refetchBalance,
    refetchEoaBalance,
  } = useTradingWalletBalance();
  
  const usdcBalance = tradingWalletBalance.toFixed(6);

  const handleDisconnect = async () => {
    await disconnectWallet();
    toast({
      title: "Wallet Disconnected",
      description: "Your Polygon wallet has been disconnected.",
    });
  };

  const handleMagicLogin = async () => {
    console.log("[DepositModal Debug] handleMagicLogin called");
    console.log("[DepositModal Debug] email:", email);
    
    if (!email) {
      console.log("[DepositModal Debug] No email provided, showing toast");
      toast({
        title: "Email Required",
        description: "Please enter your email address.",
        variant: "destructive",
      });
      return;
    }

    console.log("[DepositModal Debug] About to call connectWithMagic with email:", email);
    const success = await connectWithMagic(email);
    console.log("[DepositModal Debug] connectWithMagic returned:", success);
    if (success) {
      if (userId) {
        try {
          const res = await fetch(`/api/users/${userId}/link-wallet`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ walletAddress }),
          });
          if (!res.ok) {
            const error = await res.json();
            if (res.status === 404 && error.error === "User not found") {
              resetUser();
              onOpenChange(false);
              toast({
                title: "Session Reset",
                description: "Your session was reset. Please try connecting again.",
              });
              return;
            }
          }
        } catch (e) {
          console.error("Failed to link wallet:", e);
        }
      }
      toast({
        title: "Wallet Connected",
        description: "Your Magic wallet has been connected.",
      });
      refetchBalance();
    } else {
      toast({
        title: "Connection Failed",
        description: "Failed to connect with Magic. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleExternalWalletConnect = async () => {
    try {
      const success = await connectExternalWallet();
      if (success) {
        if (userId) {
          try {
            const res = await fetch(`/api/users/${userId}/link-wallet`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ walletAddress }),
            });
            if (!res.ok) {
              const error = await res.json();
              if (res.status === 404 && error.error === "User not found") {
                resetUser();
                onOpenChange(false);
                toast({
                  title: "Session Reset",
                  description: "Your session was reset. Please try connecting again.",
                });
                return;
              }
            }
          } catch (e) {
            console.error("Failed to link wallet:", e);
          }
        }
        toast({
          title: "Wallet Connected",
          description: "Your external wallet has been connected to Polygon.",
        });
        refetchBalance();
      } else {
        toast({
          title: "Connection Failed",
          description: "Wallet connection was cancelled or failed. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error("Wallet connection error:", error);
      toast({
        title: "Connection Failed",
        description: error.message || "No compatible wallet found. Please install MetaMask or Phantom and refresh the page.",
        variant: "destructive",
      });
    }
  };

  const handleWalletConnectConnect = async () => {
    try {
      const success = await connectWalletConnect();
      if (success) {
        if (userId) {
          try {
            const res = await fetch(`/api/users/${userId}/link-wallet`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ walletAddress }),
            });
            if (!res.ok) {
              const error = await res.json();
              if (res.status === 404 && error.error === "User not found") {
                resetUser();
                onOpenChange(false);
                toast({
                  title: "Session Reset",
                  description: "Your session was reset. Please try connecting again.",
                });
                return;
              }
            }
          } catch (e) {
            console.error("Failed to link wallet:", e);
          }
        }
        toast({
          title: "Wallet Connected",
          description: "Your wallet has been connected via WalletConnect.",
        });
        refetchBalance();
        refetchEoaBalance();
      } else {
        toast({
          title: "Connection Failed",
          description: "WalletConnect connection was cancelled or failed. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error("WalletConnect connection error:", error);
      toast({
        title: "Connection Failed",
        description: error.message || "Failed to connect via WalletConnect. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handlePhantomConnect = async () => {
    try {
      const success = await connectPhantomWallet();
      if (success) {
        if (userId) {
          try {
            const res = await fetch(`/api/users/${userId}/link-wallet`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ walletAddress }),
            });
            if (!res.ok) {
              const error = await res.json();
              if (res.status === 404 && error.error === "User not found") {
                resetUser();
                onOpenChange(false);
                toast({
                  title: "Session Reset",
                  description: "Your session was reset. Please try connecting again.",
                });
                return;
              }
            }
          } catch (e) {
            console.error("Failed to link wallet:", e);
          }
        }
        toast({
          title: "Wallet Connected",
          description: "Your Phantom wallet has been connected to Polygon.",
        });
        refetchBalance();
      } else {
        toast({
          title: "Connection Failed",
          description: "Phantom wallet connection was cancelled or failed. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error("Phantom connection error:", error);
      toast({
        title: "Connection Failed",
        description: error.message || "Phantom wallet not detected. Please install the extension and refresh the page.",
        variant: "destructive",
      });
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: `${label} copied to clipboard`,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Connect Wallet
          </DialogTitle>
          <DialogDescription>
            Connect your Polygon wallet to trade on prediction markets.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[70vh] overflow-y-auto">
          {walletAddress ? (
            <div className="space-y-3">
              <div className="rounded-md bg-muted p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <SiPolygon className="h-4 w-4 text-purple-500" />
                    <span className="font-medium text-sm">Polygon Wallet</span>
                    <Badge variant="outline" className="text-xs">
                      {walletType === "magic" ? "Magic" : walletType === "walletconnect" ? "WalletConnect" : walletType === "phantom" ? "Phantom" : "External"}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleDisconnect}
                    data-testid="button-disconnect-wallet"
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex items-center gap-2 mb-2">
                  <code className="flex-1 text-xs bg-background rounded px-2 py-1 truncate" data-testid="text-wallet-address">
                    {walletAddress}
                  </code>
                  <Button 
                    size="icon" 
                    variant="ghost"
                    onClick={() => copyToClipboard(walletAddress, "Address")}
                    data-testid="button-copy-address"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>

                {userEmail && (
                  <p className="text-xs text-muted-foreground mb-2">{userEmail}</p>
                )}

                {walletType === "magic" && (
                  <div className="p-2 rounded-md bg-background border">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs text-muted-foreground">Cash Available</p>
                        {isLoadingBalance ? (
                          <p className="font-bold text-base">Loading...</p>
                        ) : (
                          <p className="font-bold text-base tabular-nums" data-testid="text-usdc-balance">
                            ${parseFloat(usdcBalance || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs font-normal text-muted-foreground">USDC.e</span>
                          </p>
                        )}
                      </div>
                      <SiPolygon className="h-6 w-6 text-purple-500/30" />
                    </div>
                  </div>
                )}

                {isExternalWallet && (
                  <div className="p-2 rounded-md bg-background border space-y-1">
                    <div className="text-xs text-muted-foreground font-medium">In Connected Wallet (EOA)</div>
                    {isLoadingEoaBalance ? (
                      <div className="text-xs tabular-nums">Loading...</div>
                    ) : (
                      <div className="space-y-0.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">USDC.e</span>
                          <span className="tabular-nums" data-testid="text-eoa-balance">${eoaBalance.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">USDC</span>
                          <span className="tabular-nums" data-testid="text-eoa-usdc-balance">${eoaUsdcBalance.toFixed(2)}</span>
                        </div>
                      </div>
                    )}
                    {(eoaBalance > 0 || eoaUsdcBalance > 0) && (
                      <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                        Deposit to your Safe wallet to trade
                      </p>
                    )}
                  </div>
                )}
              </div>

              {(walletType === "external" || walletType === "walletconnect" || walletType === "phantom") && (
                <div className="space-y-2 pt-2 border-t">
                  {isInitializing ? (
                    <div className="flex items-center gap-2 rounded-md bg-blue-500/10 p-2 text-sm">
                      <Loader2 className="h-4 w-4 text-blue-500 animate-spin flex-shrink-0" />
                      <div>
                        <p className="text-blue-600 dark:text-blue-400 text-xs font-medium">
                          {currentStep === "credentials" ? "Deriving credentials..." : "Initializing session..."}
                        </p>
                        <p className="text-muted-foreground text-xs">Sign in your wallet</p>
                      </div>
                    </div>
                  ) : isTradingSessionComplete ? (
                    <div className="flex items-center gap-2 rounded-md bg-green-500/10 p-2 text-xs">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                      <span className="text-green-600 dark:text-green-400 flex-1">Trading Active</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleResetSession}
                        data-testid="button-reset-session"
                        className="h-6 w-6"
                      >
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : sessionError ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 rounded-md bg-orange-500/10 p-2 text-xs border border-orange-500/20">
                        <AlertCircle className="h-3.5 w-3.5 text-orange-500 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-orange-600 dark:text-orange-400 font-medium">Setup Required</p>
                          <p className="text-muted-foreground text-xs mt-0.5">
                            First time? Complete setup on Polymarket, then try again.
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            console.log("[DepositModal] Retry Setup clicked");
                            initializeTradingSession().catch(err => {
                              console.error("[DepositModal] Retry Setup failed:", err);
                            });
                          }}
                          disabled={isInitializing || !signerAvailable}
                          className="flex-1"
                          data-testid="button-retry-init-session"
                        >
                          <Key className="h-3 w-3 mr-1" />
                          Retry Setup
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowDepositWizard(true)}
                          className="flex-1"
                          data-testid="button-deposit-wizard-error"
                        >
                          <ArrowDownLeft className="h-3 w-3 mr-1" />
                          Deposit
                        </Button>
                      </div>
                      <a 
                        href="https://polymarket.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
                      >
                        <ExternalLink className="h-2.5 w-2.5" />
                        Set up on Polymarket first
                      </a>
                    </div>
                  ) : !signerAvailable ? (
                    <div className="flex items-center gap-2 rounded-md bg-yellow-500/10 p-2 text-xs border border-yellow-500/20">
                      <Loader2 className="h-3.5 w-3.5 text-yellow-500 animate-spin flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-yellow-600 dark:text-yellow-400 font-medium">Waiting for wallet...</p>
                        <p className="text-muted-foreground">Approve connection in your wallet app</p>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        console.log("[DepositModal] Initialize Trading clicked");
                        initializeTradingSession().catch(err => {
                          console.error("[DepositModal] Initialize Trading failed:", err);
                        });
                      }}
                      disabled={isInitializing || !signerAvailable}
                      className="w-full"
                      data-testid="button-init-session"
                    >
                      <Key className="h-3.5 w-3.5 mr-1.5" />
                      Initialize Trading
                    </Button>
                  )}

                  {approvalStatus.checked && approvalStatus.needsApproval && (
                    <div 
                      className="flex items-center gap-2 rounded-md bg-yellow-500/10 p-2 text-xs border border-yellow-500/20"
                      data-testid="banner-approval-needed"
                    >
                      <AlertCircle className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0" />
                      <span className="text-yellow-600 dark:text-yellow-400 flex-1">USDC Approval Required</span>
                      <Button
                        size="sm"
                        onClick={() => setShowDepositWizard(true)}
                        data-testid="button-approve-now"
                      >
                        Approve
                      </Button>
                    </div>
                  )}

                  {approvalStatus.checked && !approvalStatus.needsApproval && isTradingSessionComplete && (
                    <div className="flex items-center gap-1.5 rounded-md bg-green-500/10 p-1.5 text-xs">
                      <CheckCircle2 className="h-3 w-3 text-green-500 flex-shrink-0" />
                      <span className="text-green-600 dark:text-green-400">USDC approved</span>
                    </div>
                  )}

                  {approvalStatus.checked && approvalStatus.needsCTFApproval && isTradingSessionComplete && (
                    <div 
                      className="flex items-center gap-2 rounded-md bg-yellow-500/10 p-2 text-xs border border-yellow-500/20"
                      data-testid="banner-ctf-approval-needed"
                    >
                      <AlertCircle className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0" />
                      <span className="text-yellow-600 dark:text-yellow-400 flex-1">Token approval update needed for selling</span>
                      <Button
                        size="sm"
                        onClick={() => setShowDepositWizard(true)}
                        data-testid="button-fix-approvals"
                      >
                        Fix Approvals
                      </Button>
                    </div>
                  )}

                  {displaySafeAddress && (
                    <div className="rounded-md border p-2 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium">Safe Trading Wallet</span>
                        <Button 
                          size="icon" 
                          variant="ghost"
                          onClick={() => copyToClipboard(displaySafeAddress, "Safe Address")}
                          data-testid="button-copy-safe-address"
                          className="h-6 w-6"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                      <code className="block text-xs bg-background rounded px-2 py-1 truncate font-mono" data-testid="text-safe-address">
                        {displaySafeAddress}
                      </code>
                      <div className="p-2 rounded-md bg-background border mt-2">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-xs text-muted-foreground">Cash Available</p>
                            {isLoadingBalance ? (
                              <p className="font-bold text-base">Loading...</p>
                            ) : (
                              <p className="font-bold text-base tabular-nums" data-testid="text-usdc-balance">
                                ${parseFloat(usdcBalance || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs font-normal text-muted-foreground">USDC.e</span>
                              </p>
                            )}
                          </div>
                          <SiPolygon className="h-6 w-6 text-purple-500/30" />
                        </div>
                      </div>
                      {!showWithdrawForm ? (
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1"
                            onClick={() => {
                              if (displaySafeAddress) {
                                setWalletManagementConfig({
                                  initialTab: "send",
                                  prefilledAddress: displaySafeAddress,
                                  title: "Deposit to Safe",
                                  sendLabel: "Deposit"
                                });
                                setShowWalletManagement(true);
                              }
                            }}
                            data-testid="button-deposit-to-safe"
                          >
                            <ArrowDownLeft className="h-3.5 w-3.5 mr-1" />
                            Deposit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1"
                            onClick={() => setShowWithdrawForm(true)}
                            data-testid="button-withdraw-from-safe"
                          >
                            <ArrowUpRight className="h-3.5 w-3.5 mr-1" />
                            Withdraw
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2 pt-1 border-t">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs">Withdraw to connected wallet</Label>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs"
                              onClick={() => {
                                setShowWithdrawForm(false);
                                setWithdrawAmount("");
                              }}
                              data-testid="button-cancel-withdraw"
                            >
                              Cancel
                            </Button>
                          </div>
                          <div className="flex gap-2">
                            <div className="relative flex-1">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                              <Input
                                type="number"
                                placeholder="0.00"
                                value={withdrawAmount}
                                onChange={(e) => setWithdrawAmount(e.target.value)}
                                className="pl-5 h-8 text-sm"
                                min="0"
                                step="0.01"
                                data-testid="input-withdraw-amount"
                              />
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-xs"
                              onClick={() => setWithdrawAmount(tradingWalletBalance.toFixed(2))}
                              data-testid="button-max-withdraw"
                            >
                              Max
                            </Button>
                          </div>
                          <Button
                            size="sm"
                            className="w-full"
                            onClick={handleWithdrawFromSafe}
                            disabled={isWithdrawing || !withdrawAmount || parseFloat(withdrawAmount) <= 0}
                            data-testid="button-confirm-withdraw"
                          >
                            {isWithdrawing ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                Withdrawing...
                              </>
                            ) : (
                              <>
                                <ArrowUpRight className="h-3.5 w-3.5 mr-1" />
                                Withdraw ${withdrawAmount || "0.00"}
                              </>
                            )}
                          </Button>
                        </div>
                      )}
                      {eoaBalance > 0 && tradingWalletBalance < 1 && (
                        <p className="text-xs text-blue-600 dark:text-blue-400">
                          ${eoaBalance.toFixed(2)} USDC.e in EOA - deposit to trade
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="pt-2 border-t space-y-2">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setShowSwapModal(true)}
                    data-testid="button-swap"
                  >
                    <ArrowRightLeft className="h-4 w-4 mr-2" />
                    Swap
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setWalletManagementConfig({
                        initialTab: "receive",
                        prefilledAddress: "",
                        title: "Send / Receive USDC"
                      });
                      setShowWalletManagement(true);
                    }}
                    data-testid="button-send-receive"
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Send / Receive
                  </Button>
                </div>
                
                <p className="text-xs text-muted-foreground text-center">
                  Swap converts USDC to USDC.e (1:1 ratio)
                </p>
              </div>
            </div>
          ) : (
            <Tabs defaultValue="magic" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="magic" data-testid="tab-magic">
                  <Mail className="h-4 w-4 mr-2" />
                  Email
                </TabsTrigger>
                <TabsTrigger value="external" data-testid="tab-external">
                  <Wallet className="h-4 w-4 mr-2" />
                  Wallet
                </TabsTrigger>
              </TabsList>

              <TabsContent value="magic" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    data-testid="input-email"
                  />
                </div>
                <Button
                  onClick={handleMagicLogin}
                  disabled={isConnecting || !email}
                  className="w-full"
                  data-testid="button-magic-login"
                >
                  {isConnecting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <Mail className="h-4 w-4 mr-2" />
                      Continue with Email
                    </>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  A secure wallet will be created for your email address using Magic.
                </p>
              </TabsContent>

              <TabsContent value="external" className="space-y-4 mt-4">
                {/* Show Phantom connect prominently when inside Phantom's browser */}
                {isPhantomInstalled() && (
                  <>
                    <div className="rounded-md bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/20 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <PhantomIcon className="h-5 w-5" />
                        <span className="font-medium">Phantom Detected</span>
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">
                        Connect your Phantom wallet to start trading.
                      </p>
                      <Button
                        onClick={handlePhantomConnect}
                        disabled={isConnecting}
                        className="w-full"
                        data-testid="button-connect-phantom"
                      >
                        {isConnecting ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Connecting...
                          </>
                        ) : (
                          <>
                            <PhantomIcon className="h-4 w-4 mr-2" />
                            Connect Phantom
                          </>
                        )}
                      </Button>
                    </div>
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-background px-2 text-muted-foreground">Or use another wallet</span>
                      </div>
                    </div>
                  </>
                )}

                {/* Standard wallet connect options */}
                {!isPhantomInstalled() && (
                  <div className="rounded-md bg-muted p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <SiPolygon className="h-5 w-5 text-purple-500" />
                      <span className="font-medium">Connect Wallet</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Connect with a browser extension or mobile wallet app.
                    </p>
                  </div>
                )}
                
                <div className="space-y-2">
                  <Button
                    onClick={handleWalletConnectConnect}
                    disabled={isConnecting}
                    className="w-full"
                    variant={isPhantomInstalled() ? "outline" : "default"}
                    data-testid="button-connect-walletconnect"
                  >
                    {isConnecting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <Wallet className="h-4 w-4 mr-2" />
                        WalletConnect
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-muted-foreground text-center">
                    Works with MetaMask, Rainbow, Trust Wallet, and 300+ wallets.
                  </p>
                </div>

                {/* Desktop-only: Open wallet app deep links - hidden on mobile since WalletConnect is preferred */}
                {!isPhantomInstalled() && !isMobileDevice() && (
                  <>
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-background px-2 text-muted-foreground">Open Wallet App</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1"
                        data-testid="button-open-phantom-app"
                        onClick={() => {
                          window.location.href = `https://phantom.app/ul/browse/${encodeURIComponent(window.location.href)}?ref=${encodeURIComponent(window.location.origin)}`;
                        }}
                      >
                        <PhantomIcon className="h-4 w-4 mr-2" />
                        Phantom
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1"
                        data-testid="button-open-metamask-app"
                        onClick={() => {
                          window.location.href = `https://metamask.app.link/dapp/${window.location.host}${window.location.pathname}`;
                        }}
                      >
                        <MetaMaskIcon className="h-4 w-4 mr-2" />
                        MetaMask
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground text-center">
                      Opens this site in the wallet's built-in browser for mobile connection.
                    </p>
                  </>
                )}

                {/* MetaMask/other browser extension - show when Phantom detected (for users who have both) */}
                {isPhantomInstalled() && (
                  <Button
                    onClick={handleExternalWalletConnect}
                    disabled={isConnecting}
                    className="w-full"
                    variant="outline"
                    data-testid="button-connect-external"
                  >
                    {isConnecting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <MetaMaskIcon className="h-4 w-4 mr-2" />
                        MetaMask / Other
                      </>
                    )}
                  </Button>
                )}

                {/* Desktop extensions - only show when no wallet detected */}
                {!isPhantomInstalled() && (
                  <>
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-background px-2 text-muted-foreground">Desktop Extensions</span>
                      </div>
                    </div>
                    <Button
                      onClick={handleExternalWalletConnect}
                      disabled={isConnecting}
                      className="w-full"
                      variant="outline"
                      data-testid="button-connect-external"
                    >
                      {isConnecting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Connecting...
                        </>
                      ) : (
                        <>
                          <MetaMaskIcon className="h-4 w-4 mr-2" />
                          Browser Extension
                        </>
                      )}
                    </Button>
                    <p className="text-xs text-muted-foreground text-center">
                      For desktop with MetaMask, Phantom, or Rabby installed.
                    </p>
                  </>
                )}
              </TabsContent>
            </Tabs>
          )}
        </div>
      </DialogContent>

      <PolymarketDepositWizard
        open={showDepositWizard}
        onClose={() => {
          setShowDepositWizard(false);
          // Recheck approval status after wizard closes
          // For external wallets, pass the Safe address as 4th parameter
          if (walletAddress && provider) {
            const isMagic = walletType === "magic";
            const isExternalType = walletType === "external" || walletType === "walletconnect" || walletType === "phantom";
            checkDepositRequirements(
              provider, 
              walletAddress, 
              isMagic, 
              isExternalType ? displaySafeAddress : null
            )
              .then(status => setApprovalStatus({ needsApproval: status.needsApproval, checked: true }))
              .catch(() => {});
          }
        }}
      />
      
      <SwapModal
        open={showSwapModal}
        onOpenChange={setShowSwapModal}
      />

      <WalletManagementModal
        open={showWalletManagement}
        onOpenChange={setShowWalletManagement}
        initialTab={walletManagementConfig.initialTab}
        prefilledAddress={walletManagementConfig.prefilledAddress}
        title={walletManagementConfig.title}
        sendLabel={walletManagementConfig.sendLabel}
      />
    </Dialog>
  );
}
