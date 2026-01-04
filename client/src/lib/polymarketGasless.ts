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
  NEG_RISK_ADAPTER: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296" as const,
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

// Get the active Ethereum provider (supports Phantom, MetaMask, etc.)
function getActiveEthereumProvider(): any {
  // Check Phantom's preferred injection point first
  if ((window as any).phantom?.ethereum) {
    return (window as any).phantom.ethereum;
  }
  // Check window.ethereum with isPhantom flag
  if ((window as any).ethereum?.isPhantom) {
    return (window as any).ethereum;
  }
  // Fallback to standard window.ethereum
  return (window as any).ethereum;
}

export async function checkGaslessAvailable(hasExternalSigner: boolean = false): Promise<boolean> {
  try {
    // Check if Builder credentials are configured on server
    const response = await fetch("/api/polymarket/relayer-status");
    if (!response.ok) return false;
    const data = await response.json();
    if (!data.available) return false;
    
    // Gasless works with:
    // 1. External wallets (window.ethereum or window.phantom.ethereum)
    // 2. WalletConnect (when hasExternalSigner is true - signer passed from wagmi)
    const ethereum = getActiveEthereumProvider();
    if (!ethereum && !hasExternalSigner) return false;
    
    return true;
  } catch {
    return false;
  }
}

export function isExternalWalletAvailable(): boolean {
  return !!getActiveEthereumProvider();
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
  const ethereum = getActiveEthereumProvider();
  if (!ethereum) return null;
  
  const provider = new Web3Provider(ethereum);
  
  // Check if connected to Polygon
  const network = await provider.getNetwork();
  if (network.chainId !== POLYGON_CHAIN_ID) {
    throw new Error(`Please switch to Polygon network. Current: ${network.chainId}, Required: ${POLYGON_CHAIN_ID}`);
  }
  
  return provider.getSigner();
}

// Store for external EIP-1193 provider (used by WalletConnect)
let externalEIP1193Provider: any = null;

export function setExternalProviderForGasless(provider: any) {
  externalEIP1193Provider = provider;
  console.log("[Gasless] External EIP-1193 provider set for gasless operations");
}

export function clearExternalProviderForGasless() {
  externalEIP1193Provider = null;
}

// Cache deployment status to avoid re-checking/re-deploying within same session
// Moved here so resetGaslessState can access it
let cachedDeploymentStatus: { safeAddress: string; deployed: boolean } | null = null;

// Reset all gasless state (provider + cached deployment status)
// Call this when wallet identity changes to prevent stale Safe address issues
export function resetGaslessState() {
  externalEIP1193Provider = null;
  cachedDeploymentStatus = null;
  console.log("[Gasless] State reset - external provider and deployment cache cleared");
}

async function getExternalV5Signer() {
  if (!externalEIP1193Provider) return null;
  
  try {
    const provider = new Web3Provider(externalEIP1193Provider);
    const network = await provider.getNetwork();
    if (network.chainId !== POLYGON_CHAIN_ID) {
      throw new Error(`Please switch to Polygon network. Current: ${network.chainId}, Required: ${POLYGON_CHAIN_ID}`);
    }
    return provider.getSigner();
  } catch (error) {
    console.error("[Gasless] Error creating signer from external provider:", error);
    return null;
  }
}

// Get the best available signer - prioritizes external provider (WalletConnect) over window.ethereum
// This is critical to avoid using the wrong wallet when multiple wallets are installed
async function getBestAvailableSigner() {
  console.log("[Gasless] getBestAvailableSigner called, externalEIP1193Provider:", !!externalEIP1193Provider);
  
  // Priority 1: External EIP-1193 provider (WalletConnect)
  // This must be checked first because window.ethereum might be a different wallet (e.g., Phantom)
  if (externalEIP1193Provider) {
    console.log("[Gasless] External provider is set, attempting to get signer...");
    const externalSigner = await getExternalV5Signer();
    if (externalSigner) {
      const address = await externalSigner.getAddress();
      console.log("[Gasless] Using external provider signer (WalletConnect), address:", address);
      return externalSigner;
    }
    console.log("[Gasless] External provider set but couldn't get signer");
  }
  
  // Priority 2: window.ethereum (MetaMask, Phantom, etc.)
  const windowSigner = await getEthersV5Signer();
  if (windowSigner) {
    const address = await windowSigner.getAddress();
    console.log("[Gasless] Using window.ethereum signer, address:", address);
    return windowSigner;
  }
  
  return null;
}

async function createRelayClient(providedSigner?: any): Promise<RelayClient> {
  // Priority: provided signer > external WalletConnect signer > window.ethereum signer
  let signer = providedSigner;
  
  if (!signer) {
    // Try external EIP-1193 provider (WalletConnect)
    signer = await getExternalV5Signer();
  }
  
  if (!signer) {
    // Try window.ethereum (MetaMask, Phantom, etc.)
    signer = await getEthersV5Signer();
  }
  
  if (!signer) {
    throw new Error("No wallet connected. Please connect an external wallet (MetaMask, Rainbow, etc.) or use WalletConnect");
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

// Derive Safe address from EOA address without needing window.ethereum
// This works for all wallet types including WalletConnect
export function deriveSafeAddressFromEoa(eoaAddress: string): string {
  const config = getContractConfig(POLYGON_CHAIN_ID);
  const safeAddress = deriveSafe(eoaAddress, config.SafeContracts.SafeFactory);
  console.log(`Derived Safe address for ${eoaAddress}: ${safeAddress}`);
  return safeAddress;
}

// Get Safe address with deployment check - requires a connected wallet
export async function getSafeAddress(): Promise<SafeAddressResult> {
  try {
    // Use getBestAvailableSigner to prioritize WalletConnect over window.ethereum
    const signer = await getBestAvailableSigner();
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
    // Use getBestAvailableSigner to prioritize WalletConnect over window.ethereum
    const signer = await getBestAvailableSigner();
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

export async function executeGaslessTransactions(
  transactions: Transaction[]
): Promise<GaslessResult> {
  try {
    // IMPORTANT: Use getBestAvailableSigner() to prioritize WalletConnect provider over window.ethereum
    // This prevents using the wrong wallet (e.g., Phantom) when WalletConnect is active
    const signer = await getBestAvailableSigner();
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
    // NegRisk Adapter needs approval for negRisk markets (F1 championships)
    {
      to: POLYMARKET_CONTRACTS.USDC,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [POLYMARKET_CONTRACTS.NEG_RISK_ADAPTER, maxUint256],
      }),
      value: "0",
    },
  ];
  
  console.log("[approveUSDCGasless] Approving USDC to 4 contracts: CTF Exchange, NegRisk Exchange, CTF, NegRisk Adapter");
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
    // Also approve NEG_RISK_ADAPTER for CTF tokens (required for negRisk market sells)
    {
      to: POLYMARKET_CONTRACTS.CTF,
      data: encodeFunctionData({
        abi: ERC1155_ABI,
        functionName: "setApprovalForAll",
        args: [POLYMARKET_CONTRACTS.NEG_RISK_ADAPTER, true],
      }),
      value: "0",
    },
  ];
  
  return executeGaslessTransactions(transactions);
}

export async function transferFeeFromSafe(treasuryAddress: string, amountInWei: bigint): Promise<GaslessResult> {
  console.log(`[TransferFee] Initiating fee transfer of ${amountInWei} to treasury ${treasuryAddress}`);
  
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
      args: [treasuryAddress as `0x${string}`, amountInWei],
    });
    
    console.log(`[TransferFee] Transfer data encoded: ${transferData.slice(0, 20)}...`);

    const transactions: Transaction[] = [
      {
        to: POLYMARKET_CONTRACTS.USDC,
        data: transferData,
        value: "0",
      },
    ];
    
    const result = await executeGaslessTransactions(transactions);
    
    if (result.success) {
      console.log(`[TransferFee] Success! TX: ${result.transactionHash}`);
    } else {
      console.error(`[TransferFee] Failed: ${result.error}`);
    }
    
    return result;
  } catch (error) {
    console.error("[TransferFee] Error during fee transfer:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown fee transfer error",
    };
  }
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

export async function transferTokenFromSafe(tokenAddress: string, recipientAddress: string, amountInWei: bigint): Promise<GaslessResult> {
  console.log(`[TransferToken] Transferring ${amountInWei} of ${tokenAddress} to ${recipientAddress}`);
  
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
    
    console.log(`[TransferToken] Transfer data encoded: ${transferData.slice(0, 20)}...`);

    const transactions: Transaction[] = [
      {
        to: tokenAddress,
        data: transferData,
        value: "0",
      },
    ];
    
    const result = await executeGaslessTransactions(transactions);
    
    if (result.success) {
      console.log(`[TransferToken] Success! TX: ${result.transactionHash}`);
    } else {
      console.error(`[TransferToken] Failed: ${result.error}`);
    }
    
    return result;
  } catch (error) {
    console.error("[TransferToken] Error during token transfer:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown token transfer error",
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
    // Also approve NEG_RISK_ADAPTER for CTF tokens (required for negRisk market sells)
    {
      to: POLYMARKET_CONTRACTS.CTF,
      data: encodeFunctionData({
        abi: ERC1155_ABI,
        functionName: "setApprovalForAll",
        args: [POLYMARKET_CONTRACTS.NEG_RISK_ADAPTER, true],
      }),
      value: "0",
    },
  ];
  
  return executeGaslessTransactions(transactions);
}
