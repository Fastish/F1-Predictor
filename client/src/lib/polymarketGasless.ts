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

// Use the real Polymarket relayer URL directly
// The SDK signs for the canonical path, so we must use the actual relayer URL
// CORS should not be an issue as the relayer supports cross-origin requests
const POLYMARKET_RELAYER_URL = "https://relayer-v2.polymarket.com";
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
  
  // Use RelayerTxType.SAFE for external wallets (MetaMask, Rainbow, etc.)
  // SAFE uses the Safe Factory (0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b)
  // PROXY uses Magic Proxy Factory (0xaB45c5A4B0c941a2F231C04C3f49182e1A254052) - for Magic Link users only
  return new RelayClient(
    POLYMARKET_RELAYER_URL,
    POLYGON_CHAIN_ID,
    signer as any,
    builderConfig,
    RelayerTxType.SAFE
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
    
    // Get contract config for Polygon to get Safe factory address
    const config = getContractConfig(POLYGON_CHAIN_ID);
    
    // Derive Safe address deterministically (same EOA -> same Safe address)
    const safeAddress = deriveSafe(eoaAddress, config.SafeContracts.SafeFactory);
    console.log(`Derived Safe address for ${eoaAddress}: ${safeAddress}`);
    
    // Check if proxy is deployed on-chain using Safe address (not EOA)
    const deployed = await client.getDeployed(safeAddress);
    
    if (deployed) {
      console.log(`Safe is deployed at ${safeAddress}`);
      // Update cache
      cachedDeploymentStatus = { safeAddress, deployed: true };
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
    
    // Derive Safe address first
    const config = getContractConfig(POLYGON_CHAIN_ID);
    const safeAddress = deriveSafe(eoaAddress, config.SafeContracts.SafeFactory);
    
    // Check cached status first
    if (cachedDeploymentStatus?.safeAddress === safeAddress && cachedDeploymentStatus?.deployed) {
      console.log(`Safe already deployed (cached): ${safeAddress}`);
      return {
        safeAddress,
        proxyDeployed: true,
        eoaAddress,
      };
    }
    
    // Check if proxy is deployed using Safe address (not EOA)
    const deployed = await client.getDeployed(safeAddress);
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
    
    // Update cache
    cachedDeploymentStatus = { safeAddress, deployed: true };
    
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

// Cache deployment status to avoid re-checking/re-deploying within same session
let cachedDeploymentStatus: { safeAddress: string; deployed: boolean } | null = null;

export async function executeGaslessTransactions(
  transactions: Transaction[]
): Promise<GaslessResult> {
  try {
    const signer = await getEthersV5Signer();
    if (!signer) {
      throw new Error("No wallet connected");
    }
    
    const client = await createRelayClient();
    const eoaAddress = await signer.getAddress();
    
    // Derive the Safe address deterministically
    const config = getContractConfig(POLYGON_CHAIN_ID);
    const safeAddress = deriveSafe(eoaAddress, config.SafeContracts.SafeFactory);
    console.log(`[Gasless] EOA address: ${eoaAddress}`);
    console.log(`[Gasless] Derived Safe address: ${safeAddress}`);
    console.log(`[Gasless] Safe Factory used: ${config.SafeContracts.SafeFactory}`);
    
    // Check cached deployment status first (same session optimization)
    let isDeployed = cachedDeploymentStatus?.safeAddress === safeAddress && cachedDeploymentStatus?.deployed;
    
    if (!isDeployed) {
      // Check deployment using the Safe address, not EOA
      const deployed = await client.getDeployed(safeAddress);
      console.log(`Safe deployment check for ${safeAddress}: ${deployed}`);
      
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
      
      // Cache the deployment status
      cachedDeploymentStatus = { safeAddress, deployed: true };
    } else {
      console.log(`Using cached deployment status for ${safeAddress}`);
    }
    
    console.log(`[Gasless] Executing ${transactions.length} transactions via Safe ${safeAddress}...`);
    const result = await client.execute(transactions);
    console.log("[Gasless] Transaction submitted:", result.transactionID);
    
    const finalState = await result.wait();
    
    if (!finalState) {
      console.error("[Gasless] Transaction failed or timed out");
      return {
        success: false,
        error: "Transaction failed or timed out",
      };
    }
    
    console.log(`[Gasless] Transaction successful! Hash: ${finalState.transactionHash}`);
    console.log(`[Gasless] Approvals now set on Safe address: ${safeAddress}`);
    
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

export async function withdrawFromSafe(recipientAddress: string, amountInWei: bigint): Promise<GaslessResult> {
  console.log(`[Withdraw] Initiating withdrawal of ${amountInWei} to ${recipientAddress}`);
  
  const ERC20_TRANSFER_ABI = [
    {
      name: "transfer",
      type: "function",
      inputs: [
        { name: "to", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      outputs: [{ type: "bool" }],
    },
  ] as const;

  try {
    const transferData = encodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [recipientAddress as `0x${string}`, amountInWei],
    });
    
    console.log(`[Withdraw] Transfer data encoded: ${transferData.slice(0, 20)}...`);

    const transactions: Transaction[] = [
      {
        to: POLYMARKET_CONTRACTS.USDC,
        data: transferData,
        value: "0",
      },
    ];
    
    const result = await executeGaslessTransactions(transactions);
    
    if (result.success) {
      console.log(`[Withdraw] Success! TX: ${result.transactionHash}`);
    } else {
      console.error(`[Withdraw] Failed: ${result.error}`);
    }
    
    return result;
  } catch (error) {
    console.error("[Withdraw] Error during withdrawal:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown withdrawal error",
    };
  }
}

export async function swapFromSafe(swapTransaction: { to: string; data: string; value?: string }): Promise<GaslessResult> {
  console.log(`[SwapFromSafe] Initiating swap via Safe`);
  
  try {
    const transactions: Transaction[] = [
      {
        to: swapTransaction.to,
        data: swapTransaction.data,
        value: swapTransaction.value || "0",
      },
    ];
    
    const result = await executeGaslessTransactions(transactions);
    
    if (result.success) {
      console.log(`[SwapFromSafe] Success! TX: ${result.transactionHash}`);
    } else {
      console.error(`[SwapFromSafe] Failed: ${result.error}`);
    }
    
    return result;
  } catch (error) {
    console.error("[SwapFromSafe] Error during swap:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown swap error",
    };
  }
}

export async function approveTokenFromSafe(tokenAddress: string, spenderAddress: string): Promise<GaslessResult> {
  console.log(`[ApproveFromSafe] Approving ${tokenAddress} for ${spenderAddress}`);
  
  try {
    const approveData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spenderAddress as `0x${string}`, maxUint256],
    });
    
    const transactions: Transaction[] = [
      {
        to: tokenAddress,
        data: approveData,
        value: "0",
      },
    ];
    
    const result = await executeGaslessTransactions(transactions);
    
    if (result.success) {
      console.log(`[ApproveFromSafe] Success! TX: ${result.transactionHash}`);
    } else {
      console.error(`[ApproveFromSafe] Failed: ${result.error}`);
    }
    
    return result;
  } catch (error) {
    console.error("[ApproveFromSafe] Error during approval:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown approval error",
    };
  }
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
