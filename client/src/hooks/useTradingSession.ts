import { useState, useCallback, useEffect, useMemo } from "react";
import { ClobClient } from "@polymarket/clob-client";
import { BuilderConfig } from "@polymarket/builder-signing-sdk";
import { useWallet } from "@/context/WalletContext";
import { getSafeAddress as fetchSafeAddressFromRelayer, isExternalWalletAvailable, deriveSafeAddressFromEoa } from "@/lib/polymarketGasless";
import type { ethers } from "ethers";

const CLOB_API_URL = "https://clob.polymarket.com";
const POLYGON_CHAIN_ID = 137;
const SESSION_STORAGE_KEY = "polymarket_trading_session";

// Polymarket requires signatureType=2 (browser wallet proxy) for external wallets
// signatureType=0 (EOA) is no longer supported for trading
const SIGNATURE_TYPE_BROWSER_WALLET = 2;

// Adapter to wrap ethers v6 signer with ethers v5 _signTypedData method
// Polymarket SDK expects _signTypedData (v5) but ethers v6 uses signTypedData
function wrapSignerForPolymarket(signer: ethers.Signer): any {
  // Create a proxy that adds _signTypedData method
  return new Proxy(signer, {
    get(target: any, prop: string) {
      if (prop === "_signTypedData") {
        // Map _signTypedData to signTypedData (ethers v6 method)
        return async (domain: any, types: any, value: any) => {
          return target.signTypedData(domain, types, value);
        };
      }
      // For all other properties, return the original
      const value = target[prop];
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },
  });
}

export interface UserApiCredentials {
  key: string;
  secret: string;
  passphrase: string;
}

export interface TradingSession {
  eoaAddress: string;
  safeAddress?: string;
  signatureType: number;
  proxyDeployed: boolean;
  hasApiCredentials: boolean;
  apiCredentials?: UserApiCredentials;
  lastChecked: number;
}

export type SessionStep =
  | "idle"
  | "checking"
  | "credentials"
  | "complete"
  | "error";

function loadSession(address: string): TradingSession | null {
  try {
    const stored = localStorage.getItem(
      `${SESSION_STORAGE_KEY}_${address.toLowerCase()}`
    );
    if (!stored) return null;
    const session = JSON.parse(stored) as TradingSession;
    if (session.eoaAddress.toLowerCase() !== address.toLowerCase()) {
      clearSession(address);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function saveSession(address: string, session: TradingSession): void {
  localStorage.setItem(
    `${SESSION_STORAGE_KEY}_${address.toLowerCase()}`,
    JSON.stringify(session)
  );
}

function clearSession(address: string): void {
  localStorage.removeItem(`${SESSION_STORAGE_KEY}_${address.toLowerCase()}`);
}

export function useTradingSession() {
  const { walletAddress, signer } = useWallet();
  const [tradingSession, setTradingSession] = useState<TradingSession | null>(null);
  const [currentStep, setCurrentStep] = useState<SessionStep>("idle");
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);

  // Load existing session when wallet connects
  useEffect(() => {
    if (!walletAddress) {
      setTradingSession(null);
      setCurrentStep("idle");
      setSessionError(null);
      return;
    }
    const stored = loadSession(walletAddress);
    setTradingSession(stored);
    // Mark as complete if we have credentials AND a Safe address
    // proxyDeployed status is informational - we'll let the server reject if not deployed
    if (stored?.hasApiCredentials && stored?.safeAddress) {
      setCurrentStep("complete");
    } else if (stored?.hasApiCredentials && !stored?.safeAddress) {
      // Has credentials but no Safe - needs to reinitialize
      setCurrentStep("idle");
    }
  }, [walletAddress]);

  // Wrap signer for Polymarket SDK compatibility (ethers v5 _signTypedData)
  const wrappedSigner = useMemo(() => {
    if (!signer) return null;
    return wrapSignerForPolymarket(signer);
  }, [signer]);

  // Create temporary ClobClient for credential derivation
  const createTempClobClient = useCallback(() => {
    if (!wrappedSigner) return null;
    return new ClobClient(CLOB_API_URL, POLYGON_CHAIN_ID, wrappedSigner);
  }, [wrappedSigner]);

  // Derive or create user API credentials
  const deriveApiCredentials = useCallback(async (): Promise<UserApiCredentials> => {
    console.log("[TradingSession] deriveApiCredentials called");
    const tempClient = createTempClobClient();
    if (!tempClient) {
      console.error("[TradingSession] No signer available for ClobClient");
      throw new Error("No signer available");
    }
    console.log("[TradingSession] Created temporary ClobClient, calling deriveApiKey()...");
    console.log("[TradingSession] This should trigger a signature request from your wallet!");

    try {
      // Try to derive existing credentials first - THIS TRIGGERS SIGNATURE
      console.log("[TradingSession] Calling tempClient.deriveApiKey() - SIGNATURE REQUEST SHOULD APPEAR NOW");
      const derivedCreds = await tempClient.deriveApiKey().catch((err) => {
        console.log("[TradingSession] deriveApiKey failed:", err?.message || err);
        return null;
      });
      if (derivedCreds?.key && derivedCreds?.secret && derivedCreds?.passphrase) {
        console.log("[TradingSession] Successfully derived existing User API Credentials");
        return derivedCreds;
      }

      // Create new credentials if derivation failed
      console.log("[TradingSession] Creating new User API Credentials...");
      const newCreds = await tempClient.createApiKey();
      console.log("[TradingSession] Successfully created new User API Credentials");
      return newCreds;
    } catch (err) {
      console.error("[TradingSession] Failed to get credentials:", err);
      throw err;
    }
  }, [createTempClobClient]);

  // Fetch user's Safe/proxy address using the RelayClient or direct derivation
  const fetchSafeAddress = useCallback(async (): Promise<{ safeAddress: string | null; proxyDeployed: boolean }> => {
    try {
      // If external wallet is available (window.ethereum), use RelayClient for deployment check
      if (isExternalWalletAvailable()) {
        const result = await fetchSafeAddressFromRelayer();
        console.log("Safe address result (from RelayClient):", result);
        return {
          safeAddress: result.safeAddress,
          proxyDeployed: result.proxyDeployed,
        };
      }
      
      // For WalletConnect users (no window.ethereum), derive Safe address directly from EOA
      // This works because Safe address is deterministic based on EOA address
      if (walletAddress) {
        console.log("Deriving Safe address directly for WalletConnect user:", walletAddress);
        const safeAddress = deriveSafeAddressFromEoa(walletAddress);
        console.log("Safe address result (direct derivation):", safeAddress);
        // We can't check deployment status without RelayClient, assume not deployed
        // Trading will still work as long as user has set up on polymarket.com
        return {
          safeAddress,
          proxyDeployed: false, // Can't verify without RelayClient
        };
      }
      
      console.log("No wallet address available for Safe address derivation");
      return { safeAddress: null, proxyDeployed: false };
    } catch (err) {
      console.error("Failed to fetch Safe address:", err);
      return { safeAddress: null, proxyDeployed: false };
    }
  }, [walletAddress]);

  // Initialize trading session
  const initializeTradingSession = useCallback(async () => {
    console.log("[TradingSession] initializeTradingSession called", { walletAddress, hasSigner: !!signer });
    
    if (!walletAddress || !signer) {
      console.error("[TradingSession] Cannot initialize - wallet not connected");
      throw new Error("Wallet not connected");
    }

    setIsInitializing(true);
    setCurrentStep("checking");
    setSessionError(null);

    try {
      // Check for existing session with valid credentials and Safe address
      const existingSession = loadSession(walletAddress);
      console.log("[TradingSession] Existing session:", existingSession ? {
        hasCredentials: existingSession.hasApiCredentials,
        hasSafeAddress: !!existingSession.safeAddress,
        safeAddress: existingSession.safeAddress?.substring(0, 10) + "...",
      } : "none");
      
      if (existingSession?.hasApiCredentials && existingSession?.apiCredentials && existingSession?.safeAddress) {
        console.log("[TradingSession] Using existing complete session");
        setTradingSession(existingSession);
        setCurrentStep("complete");
        setIsInitializing(false);
        return existingSession;
      }

      // Derive user API credentials - THIS WILL TRIGGER A SIGNATURE REQUEST
      console.log("[TradingSession] Deriving API credentials (will request signature from wallet)...");
      setCurrentStep("credentials");
      const apiCreds = await deriveApiCredentials();
      console.log("[TradingSession] Got API credentials:", apiCreds ? "success" : "failed");

      // Fetch the user's Safe proxy address from Polymarket RelayClient
      console.log("Fetching Safe address from Polymarket...");
      let safeAddress: string | null = null;
      let proxyDeployed = false;
      
      try {
        const safeResult = await fetchSafeAddress();
        safeAddress = safeResult.safeAddress;
        proxyDeployed = safeResult.proxyDeployed;
        console.log("Safe address result:", { safeAddress, proxyDeployed });
      } catch (safeError) {
        console.error("Failed to fetch Safe address:", safeError);
        // Continue anyway - we'll try to proceed without the Safe check
      }

      if (!safeAddress) {
        // Can't derive Safe address - user needs to set up on polymarket.com
        console.warn("Could not derive Safe address. User needs to complete setup on polymarket.com");
        const partialSession: TradingSession = {
          eoaAddress: walletAddress,
          signatureType: SIGNATURE_TYPE_BROWSER_WALLET,
          proxyDeployed: false,
          hasApiCredentials: true,
          apiCredentials: apiCreds,
          lastChecked: Date.now(),
        };
        setTradingSession(partialSession);
        saveSession(walletAddress, partialSession);
        setSessionError("Could not set up trading. Please visit polymarket.com to create your account first.");
        setCurrentStep("error");
        setIsInitializing(false);
        return partialSession;
      }
      
      // If we have a Safe address but proxy not deployed, still save it but warn user
      if (!proxyDeployed) {
        console.warn("Safe address derived but proxy not yet deployed on-chain");
      }

      // Create complete session with Safe address
      // Even if proxyDeployed check returned false, we'll try to proceed
      // The Polymarket server will reject if proxy truly isn't deployed
      const newSession: TradingSession = {
        eoaAddress: walletAddress,
        safeAddress: safeAddress,
        signatureType: SIGNATURE_TYPE_BROWSER_WALLET,
        proxyDeployed: proxyDeployed, // Use actual value from check
        hasApiCredentials: true,
        apiCredentials: apiCreds,
        lastChecked: Date.now(),
      };

      setTradingSession(newSession);
      saveSession(walletAddress, newSession);
      setCurrentStep("complete");
      setIsInitializing(false);
      console.log("Trading session initialized with Safe:", safeAddress);
      return newSession;
    } catch (err: any) {
      console.error("Session initialization error:", err);
      setSessionError(err.message || "Failed to initialize trading session");
      setCurrentStep("error");
      setIsInitializing(false);
      throw err;
    }
  }, [walletAddress, signer, deriveApiCredentials, fetchSafeAddress]);

  // End trading session
  const endTradingSession = useCallback(() => {
    if (!walletAddress) return;
    clearSession(walletAddress);
    setTradingSession(null);
    setCurrentStep("idle");
    setSessionError(null);
  }, [walletAddress]);

  // Clear session on credential error (expired/revoked)
  const invalidateSession = useCallback(() => {
    if (!walletAddress) return;
    console.log("Invalidating session due to credential error");
    clearSession(walletAddress);
    setTradingSession(null);
    setCurrentStep("idle");
    setSessionError("Session expired. Please reinitialize.");
  }, [walletAddress]);

  // Create authenticated ClobClient with builder config for order placement
  const clobClient = useMemo(() => {
    if (!wrappedSigner || !walletAddress || !tradingSession?.apiCredentials) {
      return null;
    }

    // Require Safe address for trading (signatureType=2)
    // Note: We only require safeAddress to exist, not proxyDeployed
    // If proxy isn't deployed, Polymarket server will reject the order
    if (!tradingSession.safeAddress) {
      console.warn("ClobClient not created: No Safe address available. User needs to set up proxy on polymarket.com");
      return null;
    }

    // Get remote signing URL (with full origin for client-side)
    const remoteSigningUrl = typeof window !== "undefined"
      ? `${window.location.origin}/api/polymarket/sign`
      : "/api/polymarket/sign";

    // Builder config with remote server signing for order attribution
    const builderConfig = new BuilderConfig({
      remoteBuilderConfig: {
        url: remoteSigningUrl,
      },
    });

    // Create authenticated ClobClient with browser wallet proxy (signatureType=2)
    // Polymarket requires signatureType=2 for external wallets with Safe proxy as funder
    console.log(`Creating ClobClient with signatureType=${SIGNATURE_TYPE_BROWSER_WALLET}, funder=${tradingSession.safeAddress}`);
    return new ClobClient(
      CLOB_API_URL,
      POLYGON_CHAIN_ID,
      wrappedSigner,
      tradingSession.apiCredentials,
      SIGNATURE_TYPE_BROWSER_WALLET, // signatureType = 2 for browser wallet proxy
      tradingSession.safeAddress, // funder = user's Safe proxy wallet
      undefined,
      false,
      builderConfig
    );
  }, [wrappedSigner, walletAddress, tradingSession?.apiCredentials, tradingSession?.safeAddress]);

  return {
    tradingSession,
    currentStep,
    sessionError,
    isInitializing,
    isTradingSessionComplete: !!tradingSession?.hasApiCredentials && !!tradingSession?.safeAddress,
    isProxyDeployed: !!tradingSession?.proxyDeployed,
    safeAddress: tradingSession?.safeAddress,
    signerAvailable: !!signer, // Expose signer availability for UI checks
    initializeTradingSession,
    endTradingSession,
    invalidateSession,
    clobClient,
  };
}
