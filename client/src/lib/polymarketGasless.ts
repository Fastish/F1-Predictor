import { RelayClient, type Transaction, RelayerTxType } from "@polymarket/builder-relayer-client";
import { deriveSafe } from "@polymarket/builder-relayer-client/dist/builder/derive";
import { getContractConfig } from "@polymarket/builder-relayer-client/dist/config";
import { BuilderConfig } from "@polymarket/builder-signing-sdk";
import { Web3Provider } from "@ethersproject/providers";
import { encodeFunctionData, maxUint256 } from "viem";

export const POLYMARKET_CONTRACTS = {
  USDC: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const,
  CTF: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045" as const,
  CTF_EXCHANGE: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E" as const,
  NEG_RISK_CTF_EXCHANGE: "0xC5d563A36AE78145C45a50134d48A1215220f80a" as const,
};

const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const ERC1155_ABI = [
  {
    name: "setApprovalForAll",
    type: "function",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
] as const;

interface GaslessResult {
  success: boolean;
  transactionHash?: string;
  error?: string;
}

const RELAYER_URL = "https://relayer-v2.polymarket.com";
const POLYGON_CHAIN_ID = 137;

export async function checkGaslessAvailable(): Promise<boolean> {
  try {
    // Check if Builder credentials are configured on server
    const response = await fetch("/api/polymarket/relayer-status");
    if (!response.ok) return false;
    const data = await response.json();
    if (!data.available) return false;
    
    // Gasless only works with external wallets (window.ethereum)
    // Magic wallets require a different flow
    const ethereum = (window as any).ethereum;
    if (!ethereum) return false;
    
    return true;
  } catch {
    return false;
  }
}

export function isExternalWalletAvailable(): boolean {
  return !!(window as any).ethereum;
}

function createBuilderConfig(): BuilderConfig {
  const origin = window.location.origin;
  return new BuilderConfig({
    remoteBuilderConfig: {
      url: `${origin}/api/polymarket/builder-sign`,
    },
  });
}

async function getEthersV5Signer() {
  const ethereum = (window as any).ethereum;
  if (!ethereum) return null;
  
  const provider = new Web3Provider(ethereum);
  
  // Check if connected to Polygon
  const network = await provider.getNetwork();
  if (network.chainId !== POLYGON_CHAIN_ID) {
    throw new Error(`Please switch to Polygon network. Current: ${network.chainId}, Required: ${POLYGON_CHAIN_ID}`);
  }
  
  return provider.getSigner();
}

async function createRelayClient(): Promise<RelayClient> {
  const signer = await getEthersV5Signer();
  if (!signer) {
    throw new Error("No wallet connected. Please connect an external wallet (MetaMask, Rainbow, etc.)");
  }
  
  const builderConfig = createBuilderConfig();
  
  return new RelayClient(
    RELAYER_URL,
    POLYGON_CHAIN_ID,
    signer as any,
    builderConfig,
    RelayerTxType.PROXY
  );
}

export interface SafeAddressResult {
  safeAddress: string | null;
  proxyDeployed: boolean;
  eoaAddress: string;
}

export async function getSafeAddress(): Promise<SafeAddressResult> {
  try {
    const signer = await getEthersV5Signer();
    if (!signer) {
      throw new Error("No wallet connected");
    }
    
    const client = await createRelayClient();
    const eoaAddress = await signer.getAddress();
    
    // Check if proxy is deployed on-chain (pass EOA address, not Safe address)
    const deployed = await client.getDeployed(eoaAddress);
    
    // Get contract config for Polygon to get Safe factory address
    const config = getContractConfig(POLYGON_CHAIN_ID);
    
    // Derive Safe address deterministically (same EOA -> same Safe address)
    const safeAddress = deriveSafe(eoaAddress, config.SafeContracts.SafeFactory);
    console.log(`Derived Safe address for ${eoaAddress}: ${safeAddress}`);
    
    if (deployed) {
      console.log(`Safe is deployed at ${safeAddress}`);
      return {
        safeAddress,
        proxyDeployed: true,
        eoaAddress,
      };
    }
    
    console.log(`Safe not yet deployed for ${eoaAddress} (address will be: ${safeAddress})`);
    return {
      safeAddress, // Return the derived address even if not deployed
      proxyDeployed: false,
      eoaAddress,
    };
  } catch (error) {
    console.error("Failed to get Safe address:", error);
    throw error;
  }
}

export async function deploySafeIfNeeded(): Promise<SafeAddressResult> {
  try {
    const signer = await getEthersV5Signer();
    if (!signer) {
      throw new Error("No wallet connected");
    }
    
    const client = await createRelayClient();
    const eoaAddress = await signer.getAddress();
    
    // Check if proxy is deployed (pass EOA address)
    const deployed = await client.getDeployed(eoaAddress);
    if (!deployed) {
      console.log("Deploying Polymarket proxy wallet...");
      const deployResult = await client.deploy();
      console.log("Wallet deployment initiated:", deployResult.transactionID);
      
      const deployedTx = await deployResult.wait();
      if (!deployedTx) {
        throw new Error("Wallet deployment failed");
      }
      console.log("Wallet deployed:", deployedTx.transactionHash);
    }
    
    // Get contract config and derive Safe address after deployment confirmed
    const config = getContractConfig(POLYGON_CHAIN_ID);
    const safeAddress = deriveSafe(eoaAddress, config.SafeContracts.SafeFactory);
    
    return {
      safeAddress,
      proxyDeployed: true,
      eoaAddress,
    };
  } catch (error) {
    console.error("Failed to deploy Safe:", error);
    throw error;
  }
}

export async function executeGaslessTransactions(
  transactions: Transaction[]
): Promise<GaslessResult> {
  try {
    const signer = await getEthersV5Signer();
    if (!signer) {
      throw new Error("No wallet connected");
    }
    
    const client = await createRelayClient();
    const address = await signer.getAddress();
    
    const deployed = await client.getDeployed(address);
    if (!deployed) {
      console.log("Deploying Polymarket proxy wallet...");
      const deployResult = await client.deploy();
      console.log("Wallet deployment initiated:", deployResult.transactionID);
      
      const deployedTx = await deployResult.wait();
      if (!deployedTx) {
        return {
          success: false,
          error: "Wallet deployment failed",
        };
      }
      console.log("Wallet deployed:", deployedTx.transactionHash);
    }
    
    const result = await client.execute(transactions);
    console.log("Transaction submitted:", result.transactionID);
    
    const finalState = await result.wait();
    
    if (!finalState) {
      return {
        success: false,
        error: "Transaction failed or timed out",
      };
    }
    
    return {
      success: true,
      transactionHash: finalState.transactionHash,
    };
  } catch (error) {
    console.error("Gasless transaction failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function approveUSDCGasless(): Promise<GaslessResult> {
  const transactions: Transaction[] = [
    {
      to: POLYMARKET_CONTRACTS.USDC,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [POLYMARKET_CONTRACTS.CTF_EXCHANGE, maxUint256],
      }),
      value: "0",
    },
    {
      to: POLYMARKET_CONTRACTS.USDC,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [POLYMARKET_CONTRACTS.NEG_RISK_CTF_EXCHANGE, maxUint256],
      }),
      value: "0",
    },
    {
      to: POLYMARKET_CONTRACTS.USDC,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [POLYMARKET_CONTRACTS.CTF, maxUint256],
      }),
      value: "0",
    },
  ];
  
  return executeGaslessTransactions(transactions);
}

export async function approveCTFGasless(): Promise<GaslessResult> {
  const transactions: Transaction[] = [
    {
      to: POLYMARKET_CONTRACTS.CTF,
      data: encodeFunctionData({
        abi: ERC1155_ABI,
        functionName: "setApprovalForAll",
        args: [POLYMARKET_CONTRACTS.CTF_EXCHANGE, true],
      }),
      value: "0",
    },
    {
      to: POLYMARKET_CONTRACTS.CTF,
      data: encodeFunctionData({
        abi: ERC1155_ABI,
        functionName: "setApprovalForAll",
        args: [POLYMARKET_CONTRACTS.NEG_RISK_CTF_EXCHANGE, true],
      }),
      value: "0",
    },
  ];
  
  return executeGaslessTransactions(transactions);
}

export async function approveAllGasless(): Promise<GaslessResult> {
  const transactions: Transaction[] = [
    {
      to: POLYMARKET_CONTRACTS.USDC,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [POLYMARKET_CONTRACTS.CTF_EXCHANGE, maxUint256],
      }),
      value: "0",
    },
    {
      to: POLYMARKET_CONTRACTS.USDC,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [POLYMARKET_CONTRACTS.NEG_RISK_CTF_EXCHANGE, maxUint256],
      }),
      value: "0",
    },
    {
      to: POLYMARKET_CONTRACTS.USDC,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [POLYMARKET_CONTRACTS.CTF, maxUint256],
      }),
      value: "0",
    },
    {
      to: POLYMARKET_CONTRACTS.CTF,
      data: encodeFunctionData({
        abi: ERC1155_ABI,
        functionName: "setApprovalForAll",
        args: [POLYMARKET_CONTRACTS.CTF_EXCHANGE, true],
      }),
      value: "0",
    },
    {
      to: POLYMARKET_CONTRACTS.CTF,
      data: encodeFunctionData({
        abi: ERC1155_ABI,
        functionName: "setApprovalForAll",
        args: [POLYMARKET_CONTRACTS.NEG_RISK_CTF_EXCHANGE, true],
      }),
      value: "0",
    },
  ];
  
  return executeGaslessTransactions(transactions);
}
