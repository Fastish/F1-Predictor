import { encodeFunctionData, maxUint256, parseUnits, type Hex } from "viem";

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

interface Transaction {
  to: string;
  data: string;
  value: string;
}

interface RelayerExecutionResult {
  success: boolean;
  transactionHash?: string;
  proxyAddress?: string;
  error?: string;
}

export type WalletType = "safe" | "proxy";

export async function checkRelayerAvailable(): Promise<boolean> {
  // Delegate to the new gasless implementation
  try {
    const response = await fetch("/api/polymarket/relayer-status");
    if (!response.ok) return false;
    const data = await response.json();
    return data.available === true;
  } catch {
    return false;
  }
}

async function executeViaRelayer(
  walletAddress: string,
  walletType: WalletType,
  transactions: Transaction[],
  description: string
): Promise<RelayerExecutionResult> {
  const response = await fetch("/api/polymarket/relayer-execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      walletAddress,
      walletType,
      transactions,
      description,
    }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    return { success: false, error: error.error || "Relayer execution failed" };
  }
  
  return response.json();
}

async function deployViaRelayer(
  walletAddress: string,
  walletType: WalletType
): Promise<RelayerExecutionResult> {
  const response = await fetch("/api/polymarket/relayer-deploy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      walletAddress,
      walletType,
    }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    return { success: false, error: error.error || "Wallet deployment failed" };
  }
  
  return response.json();
}

export async function approveUSDCForTradingGasless(
  walletAddress: string,
  walletType: WalletType = "proxy"
): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
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
    // CTF Contract also needs USDC approval for splitting positions
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
  
  const result = await executeViaRelayer(
    walletAddress,
    walletType,
    transactions,
    "Approve USDC for Polymarket trading"
  );
  
  return {
    success: result.success,
    transactionHash: result.transactionHash,
    error: result.error,
  };
}

export async function approveCTFForTradingGasless(
  walletAddress: string,
  walletType: WalletType = "proxy"
): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
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
  
  const result = await executeViaRelayer(
    walletAddress,
    walletType,
    transactions,
    "Approve CTF for Polymarket trading"
  );
  
  return {
    success: result.success,
    transactionHash: result.transactionHash,
    error: result.error,
  };
}

export async function deployPolymarketWallet(
  walletAddress: string,
  walletType: WalletType = "proxy"
): Promise<{ success: boolean; transactionHash?: string; proxyAddress?: string; error?: string }> {
  return deployViaRelayer(walletAddress, walletType);
}

export async function transferUSDCGasless(
  walletAddress: string,
  to: string,
  amount: string,
  walletType: WalletType = "proxy"
): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
  const amountWei = parseUnits(amount, 6);
  
  const transactions: Transaction[] = [
    {
      to: POLYMARKET_CONTRACTS.USDC,
      data: encodeFunctionData({
        abi: [
          {
            name: "transfer",
            type: "function",
            inputs: [
              { name: "to", type: "address" },
              { name: "amount", type: "uint256" },
            ],
            outputs: [{ type: "bool" }],
          },
        ] as const,
        functionName: "transfer",
        args: [to as Hex, amountWei],
      }),
      value: "0",
    },
  ];
  
  const result = await executeViaRelayer(
    walletAddress,
    walletType,
    transactions,
    `Transfer ${amount} USDC`
  );
  
  return {
    success: result.success,
    transactionHash: result.transactionHash,
    error: result.error,
  };
}
