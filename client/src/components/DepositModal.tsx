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
import { withdrawFromSafe } from "@/lib/polymarketGasless";

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
  const [approvalStatus, setApprovalStatus] = useState<{ needsApproval: boolean; checked: boolean }>({ needsApproval: false, checked: false });
  const [autoInitAttempted, setAutoInitAttempted] = useState(false);
  const [showWithdrawForm, setShowWithdrawForm] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  // Check approval status when wallet is connected
  // For external wallets, check the Safe proxy address since approvals are done there
  useEffect(() => {
    const checkApproval = async () => {
      if (!walletAddress || !provider) {
        setApprovalStatus({ needsApproval: false, checked: false });
        return;
      }
      try {
        const isMagic = walletType === "magic";
        // For external wallets, check approvals on the Safe address, not EOA
        const addressToCheck = ((walletType === "external" || walletType === "walletconnect") && safeAddress) ? safeAddress : walletAddress;
        const status = await checkDepositRequirements(provider, addressToCheck, isMagic);
        setApprovalStatus({ needsApproval: status.needsApproval, checked: true });
      } catch (error) {
        console.error("Failed to check approval status:", error);
        setApprovalStatus({ needsApproval: false, checked: true });
      }
    };
    if (open && walletAddress) {
      checkApproval();
    }
  }, [open, walletAddress, provider, walletType, safeAddress]);

  // Reset auto-init flag when modal closes or wallet disconnects
  useEffect(() => {
    if (!open || !walletAddress) {
      setAutoInitAttempted(false);
    }
  }, [open, walletAddress]);

  // Auto-initialize trading session for external wallets and WalletConnect when connected
  useEffect(() => {
    const autoInitSession = async () => {
      if ((walletType === "external" || walletType === "walletconnect") && walletAddress && !isTradingSessionComplete && !isInitializing && !autoInitAttempted && open) {
        setAutoInitAttempted(true);
        try {
          await initializeTradingSession();
        } catch (error) {
          console.error("Auto-init session failed:", error);
          toast({
            title: "Session Setup",
            description: "Trading session setup was cancelled or failed. Click 'Initialize Trading Session' to try again.",
          });
        }
      }
    };
    autoInitSession();
  }, [walletType, walletAddress, isTradingSessionComplete, isInitializing, autoInitAttempted, open, initializeTradingSession, toast]);

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
    isLoadingTradingBalance: isLoadingBalance,
    eoaBalance,
    isExternalWallet,
    refetchTradingBalance: refetchBalance,
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
                      {walletType === "magic" ? "Magic" : walletType === "walletconnect" ? "WalletConnect" : "External"}
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

                {isExternalWallet && eoaBalance > 0 && (
                  <div className="p-2 rounded-md bg-background border">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>In Connected Wallet</span>
                      <span className="tabular-nums">${eoaBalance.toFixed(2)} USDC.e</span>
                    </div>
                  </div>
                )}
              </div>

              {(walletType === "external" || walletType === "walletconnect") && (
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
                    <div className="flex items-center gap-2 rounded-md bg-orange-500/10 p-2 text-xs border border-orange-500/20">
                      <AlertCircle className="h-3.5 w-3.5 text-orange-500 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-orange-600 dark:text-orange-400 font-medium">Setup Required</p>
                        <a 
                          href="https://polymarket.com"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-orange-600 dark:text-orange-400 hover:underline"
                        >
                          <ExternalLink className="h-2.5 w-2.5" />
                          Complete on Polymarket
                        </a>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => initializeTradingSession()}
                      disabled={isInitializing}
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

                  {safeAddress && (
                    <div className="rounded-md border p-2 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium">Safe Trading Wallet</span>
                        <Button 
                          size="icon" 
                          variant="ghost"
                          onClick={() => copyToClipboard(safeAddress, "Safe Address")}
                          data-testid="button-copy-safe-address"
                          className="h-6 w-6"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                      <code className="block text-xs bg-background rounded px-2 py-1 truncate font-mono" data-testid="text-safe-address">
                        {safeAddress}
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
                              if (safeAddress) {
                                setWalletManagementConfig({
                                  initialTab: "send",
                                  prefilledAddress: safeAddress,
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
                <div className="rounded-md bg-muted p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <SiPolygon className="h-5 w-5 text-purple-500" />
                    <span className="font-medium">Connect Wallet</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Connect with a browser extension or mobile wallet app.
                  </p>
                </div>
                <div className="space-y-2">
                  <Button
                    onClick={handleWalletConnectConnect}
                    disabled={isConnecting}
                    className="w-full"
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
                    Recommended for mobile. Works with MetaMask, Rainbow, Trust Wallet, and 300+ wallets.
                  </p>
                </div>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">or</span>
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
                      <Wallet className="h-4 w-4 mr-2" />
                      Browser Extension
                    </>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  For desktop with MetaMask, Phantom, or Rabby installed.
                </p>
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
          // For external wallets, check the Safe address since approvals are done there
          if (walletAddress && provider) {
            const isMagic = walletType === "magic";
            const addressToCheck = ((walletType === "external" || walletType === "walletconnect") && safeAddress) ? safeAddress : walletAddress;
            checkDepositRequirements(provider, addressToCheck, isMagic)
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
