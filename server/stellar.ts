import * as Stellar from "@stellar/stellar-sdk";

const USE_TESTNET = true;

const HORIZON_URL = USE_TESTNET 
  ? "https://horizon-testnet.stellar.org"
  : "https://horizon.stellar.org";

const NETWORK_PASSPHRASE = USE_TESTNET 
  ? Stellar.Networks.TESTNET 
  : Stellar.Networks.PUBLIC;

const USDC_ISSUER = USE_TESTNET
  ? "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
  : "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

const USDC_ASSET = new Stellar.Asset("USDC", USDC_ISSUER);

const server = new Stellar.Horizon.Server(HORIZON_URL);

export interface StellarBalance {
  asset: string;
  balance: string;
}

export async function getAccountBalances(publicKey: string): Promise<StellarBalance[]> {
  try {
    const account = await server.loadAccount(publicKey);
    return account.balances.map((b: any) => ({
      asset: b.asset_type === "native" ? "XLM" : b.asset_code,
      balance: b.balance,
    }));
  } catch (error: any) {
    if (error.response?.status === 404) {
      return [];
    }
    throw error;
  }
}

export async function getUSDCBalance(publicKey: string): Promise<string> {
  try {
    const account = await server.loadAccount(publicKey);
    const usdcBalance = account.balances.find(
      (b: any) => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER
    );
    return usdcBalance ? usdcBalance.balance : "0";
  } catch (error: any) {
    if (error.response?.status === 404) {
      return "0";
    }
    throw error;
  }
}

export async function validateStellarAddress(publicKey: string): Promise<boolean> {
  try {
    Stellar.StrKey.decodeEd25519PublicKey(publicKey);
    return true;
  } catch {
    return false;
  }
}

export async function accountExists(publicKey: string): Promise<boolean> {
  try {
    await server.loadAccount(publicKey);
    return true;
  } catch (error: any) {
    if (error.response?.status === 404) {
      return false;
    }
    throw error;
  }
}

export async function hasUSDCTrustline(publicKey: string): Promise<boolean> {
  try {
    const account = await server.loadAccount(publicKey);
    return account.balances.some(
      (b: any) => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER
    );
  } catch {
    return false;
  }
}

export async function getRecentUSDCPayments(publicKey: string, limit: number = 10) {
  try {
    const payments = await server
      .payments()
      .forAccount(publicKey)
      .order("desc")
      .limit(limit)
      .call();

    return payments.records
      .filter((p: any) => p.asset_code === "USDC" && p.asset_issuer === USDC_ISSUER)
      .map((p: any) => ({
        id: p.id,
        from: p.from,
        to: p.to,
        amount: p.amount,
        createdAt: p.created_at,
        transactionHash: p.transaction_hash,
      }));
  } catch {
    return [];
  }
}

export function generateDepositMemo(userId: string): string {
  return userId.slice(0, 28);
}

export {
  USDC_ASSET,
  USDC_ISSUER,
  HORIZON_URL,
  NETWORK_PASSPHRASE,
  USE_TESTNET,
  server,
};
