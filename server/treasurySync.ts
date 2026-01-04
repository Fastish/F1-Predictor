import { ethers } from "ethers";
import { storage } from "./storage";
import { USDC_CONTRACT_ADDRESS, USDC_DECIMALS, POLYGON_RPC } from "./polygon";

const BLOCK_BATCH_SIZE = 2000;
const INITIAL_LOOKBACK_BLOCKS = 50000;

const ERC20_TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

let provider: ethers.JsonRpcProvider | null = null;

function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(POLYGON_RPC);
  }
  return provider;
}

interface SyncResult {
  success: boolean;
  newTransfers: number;
  totalTransfers: number;
  totalCollected: number;
  fromBlock: number;
  toBlock: number;
  error?: string;
}

export async function syncTreasuryTransfers(): Promise<SyncResult> {
  try {
    const treasuryAddress = await storage.getConfig("treasury_address");
    if (!treasuryAddress) {
      return {
        success: false,
        newTransfers: 0,
        totalTransfers: 0,
        totalCollected: 0,
        fromBlock: 0,
        toBlock: 0,
        error: "Treasury address not configured",
      };
    }

    const provider = getProvider();
    const currentBlock = await provider.getBlockNumber();
    
    const lastSyncedBlock = await storage.getConfig("treasury_last_synced_block");
    let fromBlock = lastSyncedBlock 
      ? parseInt(lastSyncedBlock) + 1 
      : currentBlock - INITIAL_LOOKBACK_BLOCKS;

    if (fromBlock > currentBlock) {
      const summary = await storage.getTreasurySummary();
      return {
        success: true,
        newTransfers: 0,
        totalTransfers: summary.transferCount,
        totalCollected: summary.totalCollected,
        fromBlock,
        toBlock: currentBlock,
      };
    }

    console.log(`[TreasurySync] Syncing USDC.e transfers to ${treasuryAddress} from block ${fromBlock} to ${currentBlock}`);

    let newTransfers = 0;
    const normalizedTreasury = treasuryAddress.toLowerCase();

    for (let start = fromBlock; start <= currentBlock; start += BLOCK_BATCH_SIZE) {
      const end = Math.min(start + BLOCK_BATCH_SIZE - 1, currentBlock);
      
      try {
        const logs = await provider.getLogs({
          address: USDC_CONTRACT_ADDRESS,
          topics: [
            ERC20_TRANSFER_TOPIC,
            null,
            ethers.zeroPadValue(normalizedTreasury, 32),
          ],
          fromBlock: start,
          toBlock: end,
        });

        for (const log of logs) {
          const txHash = log.transactionHash;
          const existing = await storage.getTreasuryTransferByTxHash(txHash);
          if (existing) continue;

          const fromAddress = ethers.getAddress("0x" + log.topics[1]!.slice(26));
          const amount = parseFloat(ethers.formatUnits(BigInt(log.data), USDC_DECIMALS));

          await storage.recordTreasuryTransfer({
            txHash,
            logIndex: log.index,
            blockNumber: log.blockNumber,
            fromAddress,
            amount,
            matchedFeeId: null,
          });

          newTransfers++;
        }

        console.log(`[TreasurySync] Processed blocks ${start}-${end}, found ${logs.length} transfers`);
      } catch (err: any) {
        console.error(`[TreasurySync] Error processing blocks ${start}-${end}:`, err.message);
      }
    }

    await storage.setConfig("treasury_last_synced_block", currentBlock.toString());

    const summary = await storage.getTreasurySummary();
    
    console.log(`[TreasurySync] Complete. New: ${newTransfers}, Total: ${summary.transferCount}, Collected: $${summary.totalCollected.toFixed(4)}`);

    return {
      success: true,
      newTransfers,
      totalTransfers: summary.transferCount,
      totalCollected: summary.totalCollected,
      fromBlock,
      toBlock: currentBlock,
    };
  } catch (error: any) {
    console.error("[TreasurySync] Failed:", error);
    return {
      success: false,
      newTransfers: 0,
      totalTransfers: 0,
      totalCollected: 0,
      fromBlock: 0,
      toBlock: 0,
      error: error.message,
    };
  }
}

export async function matchTransfersToExpectations(): Promise<{ matched: number; unmatched: number }> {
  const unmatchedTransfers = await storage.getUnmatchedTransfers();
  const unmatchedExpectations = await storage.getUnmatchedExpectations();
  
  let matched = 0;
  
  for (const transfer of unmatchedTransfers) {
    for (const expectation of unmatchedExpectations) {
      if (expectation.txHash) continue;
      
      const amountDiff = Math.abs(transfer.amount - expectation.feeAmount);
      const tolerance = expectation.feeAmount * 0.01;
      
      if (transfer.fromAddress.toLowerCase() === expectation.walletAddress.toLowerCase() ||
          amountDiff <= tolerance) {
        await storage.matchFeeToTransfer(expectation.id, transfer.txHash);
        matched++;
        break;
      }
    }
  }
  
  return { matched, unmatched: unmatchedTransfers.length - matched };
}
