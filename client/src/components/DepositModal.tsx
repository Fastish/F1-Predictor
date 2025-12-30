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
import { useQuery } from "@tanstack/react-query";
import { Copy, Wallet, AlertCircle, Loader2, LogOut, Mail, ExternalLink, RotateCcw, Key, CheckCircle2, ArrowRightLeft, ArrowUpRight, ArrowDownLeft, Send, QrCode } from "lucide-react";
import { SiPolygon } from "react-icons/si";
import { PolymarketDepositWizard } from "./PolymarketDepositWizard";
import { SwapModal } from "./SwapModal";
import { WalletManagementModal } from "./WalletManagementModal";
import { checkDepositRequirements } from "@/lib/polymarketDeposit";

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
    disconnectWallet,
    getUsdcBalance,
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
  const [swapDirection, setSwapDirection] = useState<"deposit" | "withdraw">("deposit");
  const [showWalletManagement, setShowWalletManagement] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState<{ needsApproval: boolean; checked: boolean }>({ needsApproval: false, checked: false });
  const [autoInitAttempted, setAutoInitAttempted] = useState(false);

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
        const addressToCheck = (walletType === "external" && safeAddress) ? safeAddress : walletAddress;
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

  // Auto-initialize trading session for external wallets when connected
  useEffect(() => {
    const autoInitSession = async () => {
      if (walletType === "external" && walletAddress && !isTradingSessionComplete && !isInitializing && !autoInitAttempted && open) {
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

  const { data: usdcBalance, isLoading: isLoadingBalance, refetch: refetchBalance } = useQuery({
    queryKey: ["polygon-usdc-balance", walletAddress],
    queryFn: async () => {
      if (!walletAddress) return "0";
      return await getUsdcBalance();
    },
    enabled: !!walletAddress && open,
  });

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

        <div className="space-y-6">
          {walletAddress ? (
            <div className="space-y-4">
              <div className="rounded-md bg-muted p-4">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <SiPolygon className="h-5 w-5 text-purple-500" />
                    <span className="font-medium">Polygon Wallet</span>
                    <Badge variant="outline">
                      {walletType === "magic" ? "Magic" : "External"}
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

                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Connected Address</label>
                    <div className="flex items-center gap-2 mt-1">
                      <code className="flex-1 text-xs bg-background rounded px-2 py-1.5 truncate" data-testid="text-wallet-address">
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
                  </div>

                  {userEmail && (
                    <div>
                      <label className="text-xs text-muted-foreground">Email</label>
                      <p className="text-sm mt-1">{userEmail}</p>
                    </div>
                  )}

                  <div className="p-3 rounded-md bg-background border">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm">
                        <p className="text-muted-foreground">Cash Available</p>
                        {isLoadingBalance ? (
                          <p className="font-bold text-lg">Loading...</p>
                        ) : (
                          <p className="font-bold text-lg tabular-nums" data-testid="text-usdc-balance">
                            ${parseFloat(usdcBalance || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs font-normal text-muted-foreground">USDC.e</span>
                          </p>
                        )}
                      </div>
                      <SiPolygon className="h-8 w-8 text-purple-500/30" />
                    </div>
                  </div>
                </div>
              </div>

              {walletType === "external" && (
                <div className="space-y-3 pt-2 border-t">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Trading Setup</p>
                  
                  {isInitializing ? (
                    <div className="flex items-center gap-2 rounded-md bg-blue-500/10 p-3 text-sm">
                      <Loader2 className="h-4 w-4 text-blue-500 animate-spin flex-shrink-0" />
                      <div>
                        <p className="text-blue-600 dark:text-blue-400 font-medium">
                          {currentStep === "credentials" ? "Deriving API Credentials..." : "Initializing Trading Session..."}
                        </p>
                        <p className="text-muted-foreground text-xs mt-0.5">Please sign the message in your wallet</p>
                      </div>
                    </div>
                  ) : isTradingSessionComplete ? (
                    <div className="flex items-center gap-2 rounded-md bg-green-500/10 p-3 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-green-600 dark:text-green-400 font-medium">Trading Session Active</p>
                        {safeAddress && (
                          <p className="text-muted-foreground text-xs mt-0.5">
                            Safe: {safeAddress.slice(0, 6)}...{safeAddress.slice(-4)}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleResetSession}
                        data-testid="button-reset-session"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : sessionError ? (
                    <div className="flex items-start gap-2 rounded-md bg-orange-500/10 p-3 text-sm border border-orange-500/20">
                      <AlertCircle className="h-4 w-4 text-orange-500 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-orange-600 dark:text-orange-400 font-medium">Setup Required</p>
                        <p className="text-muted-foreground text-xs mt-1">{sessionError}</p>
                        <a 
                          href="https://polymarket.com"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400 hover:underline mt-2"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Complete setup on Polymarket
                        </a>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => initializeTradingSession()}
                      disabled={isInitializing}
                      className="w-full"
                      data-testid="button-init-session"
                    >
                      <Key className="h-4 w-4 mr-2" />
                      Initialize Trading Session
                    </Button>
                  )}

                  {approvalStatus.checked && approvalStatus.needsApproval && (
                    <div 
                      className="flex items-center gap-2 rounded-md bg-yellow-500/10 p-3 text-sm border border-yellow-500/20"
                      data-testid="banner-approval-needed"
                    >
                      <AlertCircle className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                      <div className="flex-1">
                        <span className="text-yellow-600 dark:text-yellow-400 font-medium">USDC Approval Required</span>
                        <p className="text-muted-foreground text-xs mt-0.5">Approve USDC spending to start trading</p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => setShowDepositWizard(true)}
                        data-testid="button-approve-now"
                      >
                        Approve
                      </Button>
                    </div>
                  )}

                  {approvalStatus.checked && !approvalStatus.needsApproval && (
                    <div className="flex items-center gap-2 rounded-md bg-green-500/10 p-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                      <span className="text-green-600 dark:text-green-400 text-xs">USDC approved for trading</span>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-2 border-t space-y-3">
                <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                  <p>This exchange uses USDC.e which is displayed as the cash available to bet on your account. You may swap back to USDC at a 1:1 ratio at any time.</p>
                </div>
                
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => { setSwapDirection("deposit"); setShowSwapModal(true); }}
                    data-testid="button-deposit-cash"
                  >
                    <ArrowDownLeft className="h-4 w-4 mr-2" />
                    Deposit Cash
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => { setSwapDirection("withdraw"); setShowSwapModal(true); }}
                    data-testid="button-withdraw-cash"
                  >
                    <ArrowUpRight className="h-4 w-4 mr-2" />
                    Withdraw Cash
                  </Button>
                </div>
                
                <div className="text-xs text-muted-foreground text-center">
                  Deposit converts USDC to USDC.e. Withdraw converts back to USDC.
                </div>

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setShowWalletManagement(true)}
                  data-testid="button-send-receive"
                >
                  <Send className="h-4 w-4 mr-2" />
                  Send / Receive USDC
                </Button>
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
                    <span className="font-medium">Connect External Wallet</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Connect MetaMask, Rainbow, or any Polygon-compatible wallet.
                  </p>
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
                      Connect Wallet
                    </>
                  )}
                </Button>
                <div className="flex justify-center gap-4 text-xs text-muted-foreground">
                  <a 
                    href="https://metamask.io" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="hover:text-foreground inline-flex items-center gap-1"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Get MetaMask
                  </a>
                </div>
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
            const addressToCheck = (walletType === "external" && safeAddress) ? safeAddress : walletAddress;
            checkDepositRequirements(provider, addressToCheck, isMagic)
              .then(status => setApprovalStatus({ needsApproval: status.needsApproval, checked: true }))
              .catch(() => {});
          }
        }}
      />
      
      <SwapModal
        open={showSwapModal}
        onOpenChange={setShowSwapModal}
        initialDirection={swapDirection}
      />

      <WalletManagementModal
        open={showWalletManagement}
        onOpenChange={setShowWalletManagement}
      />
    </Dialog>
  );
}
