import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWallet } from "@/context/WalletContext";
import { useTradingSession } from "@/hooks/useTradingSession";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, Loader2, AlertCircle, CheckCircle2, ArrowDownLeft, ArrowUpRight, Wallet, Shield } from "lucide-react";
import { ethers } from "ethers";
import { swapFromSafe, approveTokenFromSafe, transferTokenFromSafe } from "@/lib/polymarketGasless";
import { getReadOnlyPolygonProvider } from "@/lib/polymarketDeposit";

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
  "function transfer(address to, uint256 amount) returns (bool)",
];

export function SwapModal({ open, onOpenChange, initialDirection = "deposit" }: SwapModalProps) {
  const { walletAddress, provider, walletType } = useWallet();
  const { safeAddress, isTradingSessionComplete } = useTradingSession();
  const { toast } = useToast();
  
  const [direction, setDirection] = useState<"deposit" | "withdraw">(initialDirection);
  
  const isExternalWallet = walletType === "external" || walletType === "walletconnect" || walletType === "phantom";
  const hasSafeWallet = isExternalWallet && safeAddress && isTradingSessionComplete;
  
  useEffect(() => {
    if (open) {
      setDirection(initialDirection);
      setAmount("");
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
  
  const parsedAmount = parseFloat(amount) || 0;
  
  // For simplified flow:
  // Deposit: source is always EOA (USDC balance), destination is Safe
  // Withdraw: source is always Safe (USDC.e balance), destination is EOA
  const sourceBalance = direction === "deposit" ? eoaUsdcBalance : safeUsdceBalance;
  const destinationBalance = direction === "deposit" ? safeUsdceBalance : eoaUsdcBalance;
  
  // The active address for the swap depends on direction
  // Deposit: swap happens from EOA, then transfer to Safe
  // Withdraw: swap happens from Safe, then transfer to EOA
  const currentActiveAddress = direction === "deposit" ? walletAddress : safeAddress;
  
  const { data: swapStatus } = useQuery<{ available: boolean; tokens: { usdc: string; usdce: string } }>({
    queryKey: ["/api/swap/status"],
    enabled: open,
  });
  
  const { data: priceData, isLoading: priceLoading } = useQuery<SwapPrice>({
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
      if (!walletAddress) return;
      
      try {
        const readOnlyProvider = getReadOnlyPolygonProvider();
        const usdcContract = new ethers.Contract(USDC_NATIVE, ERC20_ABI, readOnlyProvider);
        const usdceContract = new ethers.Contract(USDC_BRIDGED, ERC20_ABI, readOnlyProvider);
        
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
  }, [open, walletAddress, safeAddress]);
  
  const refreshBalances = async () => {
    if (!walletAddress) return;
    
    try {
      const readOnlyProvider = getReadOnlyPolygonProvider();
      const usdcContract = new ethers.Contract(USDC_NATIVE, ERC20_ABI, readOnlyProvider);
      const usdceContract = new ethers.Contract(USDC_BRIDGED, ERC20_ABI, readOnlyProvider);
      
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
      console.error("Failed to refresh balances:", error);
    }
  };
  
  const checkAllowance = async (allowanceTarget: string, fromAddress: string) => {
    if (!fromAddress) return false;
    
    const tokenAddress = direction === "deposit" ? USDC_NATIVE : USDC_BRIDGED;
    const readOnlyProvider = getReadOnlyPolygonProvider();
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, readOnlyProvider);
    
    try {
      const allowance = await tokenContract.allowance(fromAddress, allowanceTarget);
      const requiredAmount = ethers.parseUnits(parsedAmount.toString(), 6);
      return allowance < requiredAmount;
    } catch (error) {
      console.error("Failed to check allowance:", error);
      return true;
    }
  };
  
  const handleApproveFromEOA = async (allowanceTarget: string) => {
    if (!provider || !walletAddress) return;
    
    setIsApproving(true);
    try {
      const tokenAddress = direction === "deposit" ? USDC_NATIVE : USDC_BRIDGED;
      const signer = await provider.getSigner();
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
      
      toast({
        title: "Approval Required",
        description: "Please confirm the approval in your wallet",
      });
      
      const tx = await tokenContract.approve(allowanceTarget, ethers.MaxUint256);
      
      toast({
        title: "Approval Submitted",
        description: "Waiting for confirmation...",
      });
      
      await tx.wait();
      
      toast({
        title: "Approval Complete",
        description: "You can now proceed with the swap",
      });
      
      setNeedsApproval(false);
    } catch (error) {
      console.error("Approval error:", error);
      toast({
        title: "Approval Failed",
        description: error instanceof Error ? error.message : "Failed to approve token",
        variant: "destructive",
      });
      throw error;
    } finally {
      setIsApproving(false);
    }
  };
  
  const handleApproveFromSafe = async (allowanceTarget: string) => {
    setIsApproving(true);
    try {
      const tokenAddress = direction === "deposit" ? USDC_NATIVE : USDC_BRIDGED;
      
      toast({
        title: "Approval Required",
        description: "Please sign to approve token spending from Safe",
      });
      
      const result = await approveTokenFromSafe(tokenAddress, allowanceTarget);
      
      if (!result.success) {
        throw new Error(result.error || "Safe approval failed");
      }
      
      toast({
        title: "Approval Complete",
        description: "You can now proceed with the swap",
      });
      
      setNeedsApproval(false);
    } catch (error) {
      console.error("Safe approval error:", error);
      toast({
        title: "Approval Failed",
        description: error instanceof Error ? error.message : "Failed to approve token",
        variant: "destructive",
      });
      throw error;
    } finally {
      setIsApproving(false);
    }
  };
  
  // Simplified deposit flow: EOA USDC -> swap to USDC.e -> transfer to Safe
  const handleDeposit = async () => {
    if (!walletAddress || !provider || !safeAddress || parsedAmount <= 0) return;
    
    setIsSwapping(true);
    try {
      // Get quote for swapping USDC to USDC.e (from EOA perspective)
      const response = await fetch(`/api/swap/quote?direction=deposit&amount=${parsedAmount}&taker=${walletAddress}`);
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to get quote");
      }
      
      const quote: SwapQuote = await response.json();
      
      if (!quote.liquidityAvailable) {
        throw new Error("No liquidity available. Try a smaller amount.");
      }
      
      if (!quote.transaction || !quote.transaction.to || !quote.transaction.data) {
        throw new Error("Invalid quote response");
      }
      
      if (quote.issues?.balance) {
        const expected = parseFloat(quote.issues.balance.expected) / 1e6;
        const actual = parseFloat(quote.issues.balance.actual) / 1e6;
        throw new Error(`Insufficient balance: you have ${actual.toFixed(2)} but need ${expected.toFixed(2)}`);
      }
      
      // Check and handle approval if needed
      const needsApprovalCheck = await checkAllowance(quote.allowanceTarget, walletAddress);
      if (needsApprovalCheck) {
        setNeedsApproval(true);
        await handleApproveFromEOA(quote.allowanceTarget);
        
        const stillNeeds = await checkAllowance(quote.allowanceTarget, walletAddress);
        if (stillNeeds) {
          throw new Error("Approval failed");
        }
      }
      
      // Step 1: Execute the swap (USDC -> USDC.e in EOA)
      toast({
        title: "Swapping USDC to USDC.e...",
        description: "Please confirm the transaction in your wallet",
      });
      
      const signer = await provider.getSigner();
      
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
          console.warn("Could not parse gas estimate");
        }
      }
      
      const tx = await signer.sendTransaction(txParams);
      
      toast({
        title: "Swap Submitted",
        description: "Waiting for confirmation...",
      });
      
      await tx.wait();
      
      // Step 2: Transfer the USDC.e to Safe
      toast({
        title: "Transferring to Safe...",
        description: "Please sign to deposit USDC.e to your trading wallet",
      });
      
      const usdceContract = new ethers.Contract(USDC_BRIDGED, ERC20_ABI, signer);
      // Use the buyAmount from the quote (not priceData) since we have the exact amount from the swap
      const receivedAmount = quote.buyAmount || parsedAmount;
      const transferAmount = ethers.parseUnits(receivedAmount.toString(), 6);
      
      const transferTx = await usdceContract.transfer(safeAddress, transferAmount);
      
      toast({
        title: "Transfer Submitted",
        description: "Waiting for confirmation...",
      });
      
      await transferTx.wait();
      
      toast({
        title: "Deposit Complete",
        description: `Deposited ${receivedAmount.toFixed(2)} USDC.e to your Safe Trading Wallet`,
      });
      
      setAmount("");
      await refreshBalances();
      
    } catch (error) {
      console.error("Deposit error:", error);
      toast({
        title: "Deposit Failed",
        description: error instanceof Error ? error.message : "Transaction failed",
        variant: "destructive",
      });
    } finally {
      setIsSwapping(false);
    }
  };
  
  // Simplified withdrawal flow: Safe USDC.e -> swap to USDC -> transfer to EOA
  const handleWithdraw = async () => {
    if (!walletAddress || !safeAddress || parsedAmount <= 0) return;
    
    setIsSwapping(true);
    try {
      // Get quote for swapping USDC.e to USDC (from Safe perspective)
      const response = await fetch(`/api/swap/quote?direction=withdraw&amount=${parsedAmount}&taker=${safeAddress}`);
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to get quote");
      }
      
      const quote: SwapQuote = await response.json();
      
      if (!quote.liquidityAvailable) {
        throw new Error("No liquidity available. Try a smaller amount.");
      }
      
      if (!quote.transaction || !quote.transaction.to || !quote.transaction.data) {
        throw new Error("Invalid quote response");
      }
      
      if (quote.issues?.balance) {
        const expected = parseFloat(quote.issues.balance.expected) / 1e6;
        const actual = parseFloat(quote.issues.balance.actual) / 1e6;
        throw new Error(`Insufficient balance: you have ${actual.toFixed(2)} but need ${expected.toFixed(2)}`);
      }
      
      // Check and handle approval if needed
      const needsApprovalCheck = await checkAllowance(quote.allowanceTarget, safeAddress);
      if (needsApprovalCheck) {
        setNeedsApproval(true);
        await handleApproveFromSafe(quote.allowanceTarget);
        
        const stillNeeds = await checkAllowance(quote.allowanceTarget, safeAddress);
        if (stillNeeds) {
          throw new Error("Approval failed");
        }
      }
      
      // Step 1: Execute the swap from Safe (USDC.e -> USDC)
      toast({
        title: "Swapping USDC.e to USDC...",
        description: "Please sign to execute the swap from your Safe",
      });
      
      const swapResult = await swapFromSafe({
        to: quote.transaction.to,
        data: quote.transaction.data,
        value: quote.transaction.value,
      });
      
      if (!swapResult.success) {
        throw new Error(swapResult.error || "Swap failed");
      }
      
      // Step 2: Transfer the swapped USDC to EOA
      toast({
        title: "Transferring to Wallet...",
        description: "Please sign to transfer USDC to your connected wallet",
      });
      
      // Use the buyAmount from the quote (not priceData) since we have the exact amount from the swap
      const receivedAmount = quote.buyAmount || parsedAmount;
      const transferAmount = ethers.parseUnits(receivedAmount.toString(), 6);
      const transferResult = await transferTokenFromSafe(
        USDC_NATIVE,
        walletAddress,
        transferAmount
      );
      
      if (!transferResult.success) {
        throw new Error(transferResult.error || "Transfer failed");
      }
      
      toast({
        title: "Withdrawal Complete",
        description: `Withdrew ${receivedAmount.toFixed(2)} USDC to your connected wallet`,
      });
      
      setAmount("");
      await refreshBalances();
      
    } catch (error) {
      console.error("Withdrawal error:", error);
      toast({
        title: "Withdrawal Failed",
        description: error instanceof Error ? error.message : "Transaction failed",
        variant: "destructive",
      });
    } finally {
      setIsSwapping(false);
    }
  };
  
  // For non-Safe wallets (Magic), use original swap logic
  const handleSimpleSwap = async () => {
    if (!walletAddress || !provider || parsedAmount <= 0) return;
    
    setIsSwapping(true);
    try {
      const response = await fetch(`/api/swap/quote?direction=${direction}&amount=${parsedAmount}&taker=${walletAddress}`);
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to get quote");
      }
      
      const quote: SwapQuote = await response.json();
      
      if (!quote.liquidityAvailable) {
        throw new Error("No liquidity available. Try a smaller amount.");
      }
      
      if (!quote.transaction || !quote.transaction.to || !quote.transaction.data) {
        throw new Error("Invalid quote response");
      }
      
      const needsApprovalCheck = await checkAllowance(quote.allowanceTarget, walletAddress);
      if (needsApprovalCheck) {
        setNeedsApproval(true);
        await handleApproveFromEOA(quote.allowanceTarget);
      }
      
      toast({
        title: "Swapping...",
        description: "Please confirm the transaction in your wallet",
      });
      
      const signer = await provider.getSigner();
      
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
          console.warn("Could not parse gas estimate");
        }
      }
      
      const tx = await signer.sendTransaction(txParams);
      await tx.wait();
      
      toast({
        title: "Swap Complete",
        description: `Swapped ${parsedAmount.toFixed(2)} ${direction === "deposit" ? "USDC to USDC.e" : "USDC.e to USDC"}`,
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
  
  const handleAction = () => {
    if (hasSafeWallet) {
      if (direction === "deposit") {
        handleDeposit();
      } else {
        handleWithdraw();
      }
    } else {
      handleSimpleSwap();
    }
  };
  
  const maxAmount = sourceBalance;
  const hasInsufficientBalance = parsedAmount > maxAmount;
  
  const canSwap = 
    swapStatus?.available && 
    walletAddress && 
    parsedAmount > 0 && 
    !hasInsufficientBalance && 
    priceData?.liquidityAvailable &&
    (hasSafeWallet ? !!safeAddress : true);
  
  const getButtonText = () => {
    if (isApproving) return "Approving...";
    if (isSwapping) {
      if (hasSafeWallet) {
        return direction === "deposit" ? "Depositing..." : "Withdrawing...";
      }
      return "Swapping...";
    }
    if (hasSafeWallet) {
      return direction === "deposit" ? "Deposit to Safe" : "Withdraw to Wallet";
    }
    return "Swap";
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {hasSafeWallet ? (direction === "deposit" ? "Deposit" : "Withdraw") : "Swap USDC"}
          </DialogTitle>
          <DialogDescription>
            {hasSafeWallet 
              ? (direction === "deposit" 
                  ? "Convert USDC and deposit to your Safe Trading Wallet" 
                  : "Withdraw from your Safe Trading Wallet to your connected wallet")
              : "Convert between USDC and USDC.e for trading"
            }
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
            <span className="text-orange-600 dark:text-orange-400">Connect your wallet to continue</span>
          </div>
        ) : (
          <div className="space-y-4">
            <Tabs value={direction} onValueChange={(v) => { setDirection(v as "deposit" | "withdraw"); setAmount(""); }}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="deposit" data-testid="tab-deposit">
                  <ArrowDownLeft className="h-4 w-4 mr-2" />
                  {hasSafeWallet ? "Deposit" : "USDC to USDC.e"}
                </TabsTrigger>
                <TabsTrigger value="withdraw" data-testid="tab-withdraw">
                  <ArrowUpRight className="h-4 w-4 mr-2" />
                  {hasSafeWallet ? "Withdraw" : "USDC.e to USDC"}
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="deposit" className="space-y-4 mt-4">
                <div className="rounded-md bg-muted p-3 text-sm">
                  {hasSafeWallet ? (
                    <>
                      <div className="flex items-center gap-2 mb-1">
                        <Wallet className="h-4 w-4" />
                        <ArrowDown className="h-3 w-3" />
                        <Shield className="h-4 w-4" />
                      </div>
                      <p className="font-medium">Deposit to Safe Trading Wallet</p>
                      <p className="text-muted-foreground text-xs mt-1">
                        Your USDC will be converted to USDC.e and deposited to your Safe for trading.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium">Convert to USDC.e</p>
                      <p className="text-muted-foreground text-xs mt-1">
                        Convert your USDC to USDC.e, the token used for Polymarket trading.
                      </p>
                    </>
                  )}
                </div>
              </TabsContent>
              
              <TabsContent value="withdraw" className="space-y-4 mt-4">
                <div className="rounded-md bg-muted p-3 text-sm">
                  {hasSafeWallet ? (
                    <>
                      <div className="flex items-center gap-2 mb-1">
                        <Shield className="h-4 w-4" />
                        <ArrowDown className="h-3 w-3" />
                        <Wallet className="h-4 w-4" />
                      </div>
                      <p className="font-medium">Withdraw to Connected Wallet</p>
                      <p className="text-muted-foreground text-xs mt-1">
                        Your USDC.e will be converted to USDC and sent to your connected wallet.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium">Convert to USDC</p>
                      <p className="text-muted-foreground text-xs mt-1">
                        Convert your USDC.e back to USDC for easy transfers to exchanges.
                      </p>
                    </>
                  )}
                </div>
              </TabsContent>
            </Tabs>
            
            {/* Wallet info display for Safe users */}
            {hasSafeWallet && (
              <div className="flex items-center justify-between rounded-md border p-3 text-xs">
                <div className="flex items-center gap-2">
                  {direction === "deposit" ? (
                    <>
                      <Wallet className="h-4 w-4 text-muted-foreground" />
                      <span>From: Connected Wallet</span>
                    </>
                  ) : (
                    <>
                      <Shield className="h-4 w-4 text-muted-foreground" />
                      <span>From: Safe Trading Wallet</span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <ArrowDown className="h-3 w-3" />
                  {direction === "deposit" ? (
                    <>
                      <Shield className="h-4 w-4" />
                      <span>To: Safe</span>
                    </>
                  ) : (
                    <>
                      <Wallet className="h-4 w-4" />
                      <span>To: Wallet</span>
                    </>
                  )}
                </div>
              </div>
            )}
            
            <div className="space-y-3">
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">You pay</Label>
                  <span className="text-xs text-muted-foreground">
                    Balance: {sourceBalance.toFixed(2)} {direction === "deposit" ? "USDC" : "USDC.e"}
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
                  <span>
                    {hasSafeWallet 
                      ? `${direction === "deposit" ? "Safe" : "Wallet"} balance: ${destinationBalance.toFixed(2)}`
                      : `Balance: ${destinationBalance.toFixed(2)}`
                    }
                  </span>
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
              onClick={handleAction}
              disabled={!canSwap || isSwapping || isApproving}
              className="w-full"
              data-testid="button-swap"
            >
              {isSwapping || isApproving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {getButtonText()}
                </>
              ) : (
                getButtonText()
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
