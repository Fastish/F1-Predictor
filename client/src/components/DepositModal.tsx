import { useState } from "react";
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
import { Copy, Wallet, AlertCircle, Loader2, LogOut, Mail, ExternalLink, RotateCcw } from "lucide-react";
import { SiPolygon } from "react-icons/si";

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
  } = useWallet();
  const { tradingSession, endTradingSession, isTradingSessionComplete } = useTradingSession();
  const { toast } = useToast();
  const [email, setEmail] = useState("");

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

              {isTradingSessionComplete && (
                <div className="rounded-md border border-dashed p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm">
                      <p className="font-medium">Trading Session Active</p>
                      <p className="text-xs text-muted-foreground">
                        API credentials stored for this wallet
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleResetSession}
                      data-testid="button-reset-session"
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1" />
                      Reset
                    </Button>
                  </div>
                </div>
              )}

              <div className="text-sm text-muted-foreground">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <span>
                      To add funds, send USDC on Polygon network to your connected wallet address.
                    </span>
                    {!isTradingSessionComplete && (
                      <p className="text-xs">
                        Having trouble trading? Try connecting your wallet again or resetting the session.
                      </p>
                    )}
                  </div>
                </div>
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
    </Dialog>
  );
}
