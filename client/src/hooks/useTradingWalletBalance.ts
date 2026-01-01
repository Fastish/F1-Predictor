import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useWallet } from "@/context/WalletContext";
import { useTradingSession } from "@/hooks/useTradingSession";
import { deriveSafe } from "@polymarket/builder-relayer-client/dist/builder/derive";
import { getContractConfig } from "@polymarket/builder-relayer-client/dist/config";

const POLYGON_RPC = "https://polygon-rpc.com";
const POLYGON_CHAIN_ID = 137;
const USDC_E_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const USDC_ADDRESS = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

export interface TradingWalletInfo {
  tradingWalletAddress: string | null;
  eoaAddress: string | null;
  tradingWalletBalance: number;
  tradingWalletUsdcBalance: number;
  eoaBalance: number;
  eoaUsdcBalance: number;
  isLoadingTradingBalance: boolean;
  isLoadingEoaBalance: boolean;
  isExternalWallet: boolean;
  refetchTradingBalance: () => void;
  refetchEoaBalance: () => void;
}

export function useTradingWalletBalance(): TradingWalletInfo {
  const { walletAddress, walletType } = useWallet();
  const { tradingSession } = useTradingSession();
  
  const isExternalWallet = walletType === "external" || walletType === "walletconnect" || walletType === "phantom";
  
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
  
  const { data: tradingBalances = { usdce: 0, usdc: 0 }, isLoading: isLoadingTradingBalance, refetch: refetchTradingBalance } = useQuery({
    queryKey: ["trading-wallet-balance", tradingWalletAddress],
    queryFn: async () => {
      if (!tradingWalletAddress) return { usdce: 0, usdc: 0 };
      const { ethers } = await import("ethers");
      const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
      const erc20Abi = ["function balanceOf(address) view returns (uint256)"];
      
      const [usdceBalance, usdcBalance] = await Promise.all([
        new ethers.Contract(USDC_E_ADDRESS, erc20Abi, provider).balanceOf(tradingWalletAddress),
        new ethers.Contract(USDC_ADDRESS, erc20Abi, provider).balanceOf(tradingWalletAddress),
      ]);
      
      return {
        usdce: parseFloat(ethers.formatUnits(usdceBalance, 6)),
        usdc: parseFloat(ethers.formatUnits(usdcBalance, 6)),
      };
    },
    enabled: !!tradingWalletAddress,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 30000,
  });
  
  const { data: eoaBalances = { usdce: 0, usdc: 0 }, isLoading: isLoadingEoaBalance, refetch: refetchEoaBalance } = useQuery({
    queryKey: ["eoa-wallet-balance", walletAddress],
    queryFn: async () => {
      if (!walletAddress) return { usdce: 0, usdc: 0 };
      const { ethers } = await import("ethers");
      const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
      const erc20Abi = ["function balanceOf(address) view returns (uint256)"];
      
      const [usdceBalance, usdcBalance] = await Promise.all([
        new ethers.Contract(USDC_E_ADDRESS, erc20Abi, provider).balanceOf(walletAddress),
        new ethers.Contract(USDC_ADDRESS, erc20Abi, provider).balanceOf(walletAddress),
      ]);
      
      return {
        usdce: parseFloat(ethers.formatUnits(usdceBalance, 6)),
        usdc: parseFloat(ethers.formatUnits(usdcBalance, 6)),
      };
    },
    enabled: !!walletAddress && isExternalWallet,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 30000,
  });
  
  return {
    tradingWalletAddress,
    eoaAddress: walletAddress,
    tradingWalletBalance: tradingBalances.usdce,
    tradingWalletUsdcBalance: tradingBalances.usdc,
    eoaBalance: eoaBalances.usdce,
    eoaUsdcBalance: eoaBalances.usdc,
    isLoadingTradingBalance,
    isLoadingEoaBalance,
    isExternalWallet,
    refetchTradingBalance,
    refetchEoaBalance,
  };
}
