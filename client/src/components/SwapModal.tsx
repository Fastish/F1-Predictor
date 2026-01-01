import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useWallet } from "@/context/WalletContext";
import { useTradingSession } from "@/hooks/useTradingSession";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, Loader2, AlertCircle, CheckCircle2, ArrowUpRight, ArrowDownLeft, Wallet, Shield } from "lucide-react";
import { ethers } from "ethers";
import { swapFromSafe, approveTokenFromSafe } from "@/lib/polymarketGasless";

interface SwapModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDirection?: "deposit" | "withdraw";
}

interface SwapQuote {
  liquidityAvailable: boolean;
  sellAmount: number;
  buyAmount: number;
  sellToken: string;
  buyToken: string;
  direction: string;
  allowanceTarget: string;
  transaction: {
    to: string;
    data: string;
    value: string;
    gas: string;
  };
  issues?: {
    allowance?: {
      actual: string;
      spender: string;
    };
    balance?: {
      token: string;
      actual: string;
      expected: string;
    };
  };
}

interface SwapPrice {
  liquidityAvailable: boolean;
  sellAmount: number;
  buyAmount: number;
  direction: string;
  estimatedGas?: string;
}

const USDC_NATIVE = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const USDC_BRIDGED = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
];

export function SwapModal({ open, onOpenChange, initialDirection = "deposit" }: SwapModalProps) {
  const { walletAddress, provider, walletType } = useWallet();
  const { safeAddress, isTradingSessionComplete } = useTradingSession();
  const { toast } = useToast();
  
  const [direction, setDirection] = useState<"deposit" | "withdraw">(initialDirection);
  const [walletSource, setWalletSource] = useState<"eoa" | "safe">("eoa");
  
  const isExternalWallet = walletType === "external" || walletType === "walletconnect" || walletType === "phantom";
  const hasSafeWallet = isExternalWallet && safeAddress && isTradingSessionComplete;
  
  useEffect(() => {
    if (open) {
      setDirection(initialDirection);
      setWalletSource("eoa");
    }
  }, [open, initialDirection]);
  const [amount, setAmount] = useState("");
  const [isSwapping, setIsSwapping] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [needsApproval, setNeedsApproval] = useState(false);
  
  const [eoaUsdcBalance, setEoaUsdcBalance] = useState<number>(0);
  const [eoaUsdceBalance, setEoaUsdceBalance] = useState<number>(0);
  const [safeUsdcBalance, setSafeUsdcBalance] = useState<number>(0);
  const [safeUsdceBalance, setSafeUsdceBalance] = useState<number>(0);
  
  const usdcBalance = walletSource === "safe" ? safeUsdcBalance : eoaUsdcBalance;
  const usdceBalance = walletSource === "safe" ? safeUsdceBalance : eoaUsdceBalance;
  
  const parsedAmount = parseFloat(amount) || 0;
  
  const { data: swapStatus } = useQuery<{ available: boolean; tokens: { usdc: string; usdce: string } }>({
    queryKey: ["/api/swap/status"],
    enabled: open,
  });
  
  const currentActiveAddress = walletSource === "safe" && safeAddress ? safeAddress : walletAddress;
  
  const { data: priceData, isLoading: priceLoading, refetch: refetchPrice } = useQuery<SwapPrice>({
    queryKey: ["/api/swap/price", direction, amount, currentActiveAddress],
    queryFn: async () => {
      if (!currentActiveAddress || parsedAmount <= 0) return null;
      const response = await fetch(`/api/swap/price?direction=${direction}&amount=${parsedAmount}&taker=${currentActiveAddress}`);
      if (!response.ok) throw new Error("Failed to get price");
      return response.json();
    },
    enabled: open && !!currentActiveAddress && parsedAmount > 0,
    refetchInterval: 10000,
  });
  
  useEffect(() => {
    const fetchBalances = async () => {
      if (!walletAddress || !provider) return;
      
      try {
        const usdcContract = new ethers.Contract(USDC_NATIVE, ERC20_ABI, provider);
        const usdceContract = new ethers.Contract(USDC_BRIDGED, ERC20_ABI, provider);
        
        const [eoaUsdcBal, eoaUsdceBal] = await Promise.all([
          usdcContract.balanceOf(walletAddress),
          usdceContract.balanceOf(walletAddress),
        ]);
        
        setEoaUsdcBalance(parseFloat(ethers.formatUnits(eoaUsdcBal, 6)));
        setEoaUsdceBalance(parseFloat(ethers.formatUnits(eoaUsdceBal, 6)));
        
        if (safeAddress) {
          const [safeUsdcBal, safeUsdceBal] = await Promise.all([
            usdcContract.balanceOf(safeAddress),
            usdceContract.balanceOf(safeAddress),
          ]);
          
          setSafeUsdcBalance(parseFloat(ethers.formatUnits(safeUsdcBal, 6)));
          setSafeUsdceBalance(parseFloat(ethers.formatUnits(safeUsdceBal, 6)));
        }
      } catch (error) {
        console.error("Failed to fetch balances:", error);
      }
    };
    
    if (open) {
      fetchBalances();
    }
  }, [open, walletAddress, provider, safeAddress]);
  
  const checkAllowance = async (allowanceTarget: string) => {
    if (!currentActiveAddress || !provider) return false;
    
    const tokenAddress = direction === "deposit" ? USDC_NATIVE : USDC_BRIDGED;
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    
    try {
      const allowance = await tokenContract.allowance(currentActiveAddress, allowanceTarget);
      const requiredAmount = ethers.parseUnits(parsedAmount.toString(), 6);
      return allowance < requiredAmount;
    } catch (error) {
      console.error("Failed to check allowance:", error);
      return true;
    }
  };
  
  const handleApprove = async (allowanceTarget: string) => {
    if (!provider) return;
    
    setIsApproving(true);
    try {
      const tokenAddress = direction === "deposit" ? USDC_NATIVE : USDC_BRIDGED;
      
      if (walletSource === "safe" && safeAddress) {
        toast({
          title: "Approving...",
          description: "Please sign to approve tokens from Safe",
        });
        
        const result = await approveTokenFromSafe(tokenAddress, allowanceTarget);
        if (!result.success) {
          throw new Error(result.error || "Safe approval failed");
        }
      } else {
        const signer = await provider.getSigner();
        const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
        
        const tx = await tokenContract.approve(allowanceTarget, ethers.MaxUint256);
        
        toast({
          title: "Approving...",
          description: "Waiting for transaction confirmation",
        });
        
        await tx.wait();
      }
      
      toast({
        title: "Approved",
        description: "Token approval successful",
      });
      
      setNeedsApproval(false);
    } catch (error) {
      console.error("Approval error:", error);
      toast({
        title: "Approval Failed",
        description: error instanceof Error ? error.message : "Failed to approve tokens",
        variant: "destructive",
      });
    } finally {
      setIsApproving(false);
    }
  };
  
  const refreshBalances = async () => {
    if (!provider || !walletAddress) return;
    
    const usdcContract = new ethers.Contract(USDC_NATIVE, ERC20_ABI, provider);
    const usdceContract = new ethers.Contract(USDC_BRIDGED, ERC20_ABI, provider);
    
    const [eoaUsdcBal, eoaUsdceBal] = await Promise.all([
      usdcContract.balanceOf(walletAddress),
      usdceContract.balanceOf(walletAddress),
    ]);
    
    setEoaUsdcBalance(parseFloat(ethers.formatUnits(eoaUsdcBal, 6)));
    setEoaUsdceBalance(parseFloat(ethers.formatUnits(eoaUsdceBal, 6)));
    
    if (safeAddress) {
      const [safeUsdcBal, safeUsdceBal] = await Promise.all([
        usdcContract.balanceOf(safeAddress),
        usdceContract.balanceOf(safeAddress),
      ]);
      
      setSafeUsdcBalance(parseFloat(ethers.formatUnits(safeUsdcBal, 6)));
      setSafeUsdceBalance(parseFloat(ethers.formatUnits(safeUsdceBal, 6)));
    }
  };
  
  const handleSwap = async () => {
    if (!currentActiveAddress || !provider || parsedAmount <= 0) return;
    
    setIsSwapping(true);
    try {
      const response = await fetch(`/api/swap/quote?direction=${direction}&amount=${parsedAmount}&taker=${currentActiveAddress}`);
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to get quote");
      }
      
      const quote: SwapQuote = await response.json();
      
      if (!quote.liquidityAvailable) {
        throw new Error("No liquidity available for this swap. Try a smaller amount.");
      }
      
      if (!quote.transaction || !quote.transaction.to || !quote.transaction.data) {
        throw new Error("Invalid quote response from 0x API");
      }
      
      if (!quote.allowanceTarget) {
        throw new Error("Missing allowance target from quote");
      }
      
      if (quote.issues?.balance) {
        const expected = parseFloat(quote.issues.balance.expected) / 1e6;
        const actual = parseFloat(quote.issues.balance.actual) / 1e6;
        throw new Error(`Insufficient balance: you have ${actual.toFixed(2)} but need ${expected.toFixed(2)}`);
      }
      
      const needsApprovalCheck = await checkAllowance(quote.allowanceTarget);
      if (needsApprovalCheck) {
        setNeedsApproval(true);
        await handleApprove(quote.allowanceTarget);
        
        const needs = await checkAllowance(quote.allowanceTarget);
        if (needs) {
          throw new Error("Approval failed");
        }
      }
      
      if (walletSource === "safe" && safeAddress) {
        toast({
          title: direction === "deposit" ? "Swapping..." : "Swapping...",
          description: "Please sign to execute swap from Safe",
        });
        
        const result = await swapFromSafe({
          to: quote.transaction.to,
          data: quote.transaction.data,
          value: quote.transaction.value,
        });
        
        if (!result.success) {
          throw new Error(result.error || "Safe swap failed");
        }
      } else {
        const signer = await provider.getSigner();
        
        toast({
          title: direction === "deposit" ? "Swapping..." : "Swapping...",
          description: "Please confirm the transaction in your wallet",
        });
        
        const txParams: { to: string; data: string; value?: string; gasLimit?: bigint } = {
          to: quote.transaction.to,
          data: quote.transaction.data,
        };
        
        if (quote.transaction.value) {
          txParams.value = quote.transaction.value;
        }
        
        if (quote.transaction.gas) {
          try {
            const gasEstimate = BigInt(quote.transaction.gas);
            txParams.gasLimit = gasEstimate + (gasEstimate / BigInt(2));
          } catch (e) {
            console.warn("Could not parse gas estimate, using auto gas");
          }
        }
        
        const tx = await signer.sendTransaction(txParams);
        
        toast({
          title: "Transaction Submitted",
          description: "Waiting for confirmation...",
        });
        
        await tx.wait();
      }
      
      toast({
        title: "Swap Complete",
        description: `Successfully swapped ${parsedAmount.toFixed(2)} ${direction === "deposit" ? "USDC" : "USDC.e"}`,
      });
      
      setAmount("");
      await refreshBalances();
      
    } catch (error) {
      console.error("Swap error:", error);
      toast({
        title: "Swap Failed",
        description: error instanceof Error ? error.message : "Transaction failed",
        variant: "destructive",
      });
    } finally {
      setIsSwapping(false);
    }
  };
  
  const maxAmount = direction === "deposit" ? usdcBalance : usdceBalance;
  const hasInsufficientBalance = parsedAmount > maxAmount;
  
  const canSwap = 
    swapStatus?.available && 
    walletAddress && 
    parsedAmount > 0 && 
    !hasInsufficientBalance && 
    priceData?.liquidityAvailable;
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Swap USDC</DialogTitle>
          <DialogDescription>
            Convert between USDC and USDC.e for trading on Polymarket
          </DialogDescription>
        </DialogHeader>
        
        {!swapStatus?.available ? (
          <div className="flex items-center gap-2 rounded-md bg-orange-500/10 p-3 text-sm">
            <AlertCircle className="h-4 w-4 text-orange-500 flex-shrink-0" />
            <span className="text-orange-600 dark:text-orange-400">Swap feature is not available</span>
          </div>
        ) : !walletAddress ? (
          <div className="flex items-center gap-2 rounded-md bg-orange-500/10 p-3 text-sm">
            <AlertCircle className="h-4 w-4 text-orange-500 flex-shrink-0" />
            <span className="text-orange-600 dark:text-orange-400">Connect your wallet to swap tokens</span>
          </div>
        ) : (
          <div className="space-y-4">
            <Tabs value={direction} onValueChange={(v) => { setDirection(v as "deposit" | "withdraw"); setAmount(""); }}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="deposit" data-testid="tab-deposit">
                  <ArrowDownLeft className="h-4 w-4 mr-2" />
                  Swap USDC to Trade
                </TabsTrigger>
                <TabsTrigger value="withdraw" data-testid="tab-withdraw">
                  <ArrowUpRight className="h-4 w-4 mr-2" />
                  Swap USDC.e for Withdrawal
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="deposit" className="space-y-4 mt-4">
                <div className="rounded-md bg-muted p-3 text-sm">
                  <p className="font-medium">Deposit to Trade</p>
                  <p className="text-muted-foreground text-xs mt-1">
                    Convert your USDC to USDC.e, the token used for Polymarket trading.
                  </p>
                </div>
              </TabsContent>
              
              <TabsContent value="withdraw" className="space-y-4 mt-4">
                <div className="rounded-md bg-muted p-3 text-sm">
                  <p className="font-medium">Withdraw Funds</p>
                  <p className="text-muted-foreground text-xs mt-1">
                    Convert your USDC.e back to USDC for easy transfers to exchanges.
                  </p>
                </div>
              </TabsContent>
            </Tabs>
            
            {hasSafeWallet && (
              <div className="rounded-md border p-3 space-y-2">
                <Label className="text-xs text-muted-foreground">Swap from</Label>
                <RadioGroup
                  value={walletSource}
                  onValueChange={(v) => { setWalletSource(v as "eoa" | "safe"); setAmount(""); }}
                  className="flex gap-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="eoa" id="eoa" data-testid="radio-eoa" />
                    <Label htmlFor="eoa" className="flex items-center gap-1.5 cursor-pointer text-sm">
                      <Wallet className="h-3.5 w-3.5" />
                      Connected Wallet
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="safe" id="safe" data-testid="radio-safe" />
                    <Label htmlFor="safe" className="flex items-center gap-1.5 cursor-pointer text-sm">
                      <Shield className="h-3.5 w-3.5" />
                      Safe Trading Wallet
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            )}
            
            <div className="space-y-3">
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">You pay</Label>
                  <span className="text-xs text-muted-foreground">
                    Balance: {(direction === "deposit" ? usdcBalance : usdceBalance).toFixed(2)} {direction === "deposit" ? "USDC" : "USDC.e"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="border-0 text-lg font-medium focus-visible:ring-0"
                    data-testid="input-swap-amount"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAmount(maxAmount.toFixed(2))}
                    data-testid="button-max-amount"
                  >
                    MAX
                  </Button>
                  <span className="font-medium">{direction === "deposit" ? "USDC" : "USDC.e"}</span>
                </div>
                {hasInsufficientBalance && (
                  <p className="text-xs text-destructive">Insufficient balance</p>
                )}
              </div>
              
              <div className="flex justify-center">
                <div className="rounded-full bg-muted p-2">
                  <ArrowDown className="h-4 w-4" />
                </div>
              </div>
              
              <div className="rounded-md border p-3 space-y-2">
                <Label className="text-xs text-muted-foreground">You receive</Label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 text-lg font-medium">
                    {priceLoading ? (
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    ) : priceData?.buyAmount ? (
                      priceData.buyAmount.toFixed(2)
                    ) : (
                      "0.00"
                    )}
                  </div>
                  <span className="font-medium">{direction === "deposit" ? "USDC.e" : "USDC"}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Balance: {(direction === "deposit" ? usdceBalance : usdcBalance).toFixed(2)}</span>
                  {priceData?.liquidityAvailable && parsedAmount > 0 && (
                    <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                      <CheckCircle2 className="h-3 w-3" />
                      Liquidity available
                    </span>
                  )}
                </div>
              </div>
            </div>
            
            {needsApproval && (
              <div className="flex items-center gap-2 rounded-md bg-yellow-500/10 p-3 text-sm">
                <AlertCircle className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                <span className="text-yellow-600 dark:text-yellow-400">Token approval required before swap</span>
              </div>
            )}
            
            <Button
              onClick={handleSwap}
              disabled={!canSwap || isSwapping || isApproving}
              className="w-full"
              data-testid="button-swap"
            >
              {isSwapping || isApproving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {isApproving ? "Approving..." : direction === "deposit" ? "Depositing..." : "Withdrawing..."}
                </>
              ) : (
                direction === "deposit" ? "Deposit to Polymarket" : "Withdraw from Polymarket"
              )}
            </Button>
            
            <p className="text-xs text-center text-muted-foreground">
              Powered by 0x Protocol. Swaps are executed on Polygon network.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
