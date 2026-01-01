import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useWallet } from "@/context/WalletContext";
import { useTradingSession } from "@/hooks/useTradingSession";
import { deriveSafe } from "@polymarket/builder-relayer-client/dist/builder/derive";
import { getContractConfig } from "@polymarket/builder-relayer-client/dist/config";

const POLYGON_RPC = "https://polygon-rpc.com";
const POLYGON_CHAIN_ID = 137;
const USDC_E_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";

export interface TradingWalletInfo {
  tradingWalletAddress: string | null;
  eoaAddress: string | null;
  tradingWalletBalance: number;
  eoaBalance: number;
  isLoadingTradingBalance: boolean;
  isLoadingEoaBalance: boolean;
  isExternalWallet: boolean;
  refetchTradingBalance: () => void;
  refetchEoaBalance: () => void;
}

export function useTradingWalletBalance(): TradingWalletInfo {
  const { walletAddress, walletType } = useWallet();
  const { tradingSession } = useTradingSession();
  
  const isExternalWallet = walletType === "external" || walletType === "walletconnect";
  
  const tradingWalletAddress = useMemo(() => {
    if (!walletAddress) return null;
    
    if (isExternalWallet) {
      if (tradingSession?.safeAddress) {
        return tradingSession.safeAddress;
      }
      try {
        const config = getContractConfig(POLYGON_CHAIN_ID);
        return deriveSafe(walletAddress, config.SafeContracts.SafeFactory);
      } catch (e) {
        console.warn("Failed to derive Safe address:", e);
        return null;
      }
    }
    
    return walletAddress;
  }, [walletAddress, walletType, tradingSession?.safeAddress, isExternalWallet]);
  
  const { data: tradingBalance = 0, isLoading: isLoadingTradingBalance, refetch: refetchTradingBalance } = useQuery({
    queryKey: ["trading-wallet-balance", tradingWalletAddress],
    queryFn: async () => {
      if (!tradingWalletAddress) return 0;
      const { ethers } = await import("ethers");
      const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
      const contract = new ethers.Contract(
        USDC_E_ADDRESS, 
        ["function balanceOf(address) view returns (uint256)"], 
        provider
      );
      const balance = await contract.balanceOf(tradingWalletAddress);
      return parseFloat(ethers.formatUnits(balance, 6));
    },
    enabled: !!tradingWalletAddress,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 30000,
  });
  
  const { data: eoaBalance = 0, isLoading: isLoadingEoaBalance, refetch: refetchEoaBalance } = useQuery({
    queryKey: ["eoa-wallet-balance", walletAddress],
    queryFn: async () => {
      if (!walletAddress) return 0;
      const { ethers } = await import("ethers");
      const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
      const contract = new ethers.Contract(
        USDC_E_ADDRESS, 
        ["function balanceOf(address) view returns (uint256)"], 
        provider
      );
      const balance = await contract.balanceOf(walletAddress);
      return parseFloat(ethers.formatUnits(balance, 6));
    },
    enabled: !!walletAddress && isExternalWallet,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 30000,
  });
  
  return {
    tradingWalletAddress,
    eoaAddress: walletAddress,
    tradingWalletBalance: tradingBalance,
    eoaBalance: eoaBalance,
    isLoadingTradingBalance,
    isLoadingEoaBalance,
    isExternalWallet,
    refetchTradingBalance,
    refetchEoaBalance,
  };
}
