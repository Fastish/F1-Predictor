import { useState, useCallback, useEffect, useMemo, useRef } from "react";
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
  | "deploying"
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
  const { walletAddress, signer, walletType } = useWallet();
  const [tradingSession, setTradingSession] = useState<TradingSession | null>(null);
  const [currentStep, setCurrentStep] = useState<SessionStep>("idle");
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [credentialsValidated, setCredentialsValidated] = useState(false);

  // Load existing session when wallet connects
  useEffect(() => {
    if (!walletAddress) {
      setTradingSession(null);
      setCurrentStep("idle");
      setSessionError(null);
      setCredentialsValidated(false);
      return;
    }
    const stored = loadSession(walletAddress);
    
    // VALIDATION: Check if stored Safe address matches the derived one
    // This catches corrupted sessions where the wrong Safe address was stored
    // (e.g., if window.ethereum returned a different wallet's address)
    if (stored?.safeAddress) {
      const expectedSafeAddress = deriveSafeAddressFromEoa(walletAddress);
      if (stored.safeAddress.toLowerCase() !== expectedSafeAddress.toLowerCase()) {
        console.warn("[TradingSession] Session Safe address mismatch! Clearing corrupted session.");
        console.warn("[TradingSession] Stored:", stored.safeAddress);
        console.warn("[TradingSession] Expected:", expectedSafeAddress);
        clearSession(walletAddress);
        setTradingSession(null);
        setCurrentStep("idle");
        setCredentialsValidated(false);
        return;
      }
    }
    
    setTradingSession(stored);
    setCredentialsValidated(false); // Need to validate on each session load
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
  // IMPORTANT: For Safe wallets (signatureType=2), we must pass the Safe address as funder
  // to derive credentials that work with the Safe wallet configuration
  const createTempClobClient = useCallback((safeAddress?: string) => {
    if (!wrappedSigner) return null;
    
    // If safeAddress is provided, create ClobClient with Safe wallet configuration
    // This is critical for WalletConnect and external wallets that use Safe proxies
    if (safeAddress) {
      console.log(`[TradingSession] Creating temp ClobClient with signatureType=${SIGNATURE_TYPE_BROWSER_WALLET}, funder=${safeAddress}`);
      return new ClobClient(
        CLOB_API_URL,
        POLYGON_CHAIN_ID,
        wrappedSigner,
        undefined, // No credentials yet
        SIGNATURE_TYPE_BROWSER_WALLET, // signatureType = 2 for Safe wallets
        safeAddress // funder = Safe address
      );
    }
    
    // Fallback for Magic wallets (which don't use Safe)
    console.log("[TradingSession] Creating temp ClobClient with default config (no Safe)");
    return new ClobClient(CLOB_API_URL, POLYGON_CHAIN_ID, wrappedSigner);
  }, [wrappedSigner]);

  // Validate that cached API credentials are still valid with Polymarket
  // Note: We can't properly validate without HMAC signing, so we use server-side validation
  const validateApiCredentials = useCallback(async (credentials: UserApiCredentials): Promise<boolean> => {
    try {
      console.log("[TradingSession] Validating cached API credentials via server...");
      console.log("[TradingSession] API key prefix:", credentials.key?.substring(0, 10) + "...");
      
      // Use server-side endpoint to validate credentials with proper HMAC signing
      const response = await fetch("/api/polymarket/validate-credentials", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-POLY-API-KEY": credentials.key,
          "X-POLY-API-SECRET": credentials.secret,
          "X-POLY-PASSPHRASE": credentials.passphrase,
        },
      });
      
      const result = await response.json();
      console.log("[TradingSession] Credential validation result:", result);
      
      if (result.valid) {
        console.log("[TradingSession] Credentials are valid");
        return true;
      } else {
        console.log("[TradingSession] Credentials invalid:", result.error);
        return false;
      }
    } catch (err) {
      console.error("[TradingSession] Error validating credentials:", err);
      // On network error, assume credentials might be valid and let the order fail naturally
      // This prevents blocking users when validation endpoint is unavailable
      return true;
    }
  }, []);

  // Helper to add timeout to a promise (for mobile wallet scenarios)
  const withTimeout = useCallback(<T>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => 
        setTimeout(() => reject(new Error(errorMessage)), ms)
      )
    ]);
  }, []);

  // Derive or create user API credentials
  // IMPORTANT: For Safe wallets, we must pass the Safe address to derive credentials
  // that will work when trading with signatureType=2
  const deriveApiCredentials = useCallback(async (safeAddress?: string): Promise<UserApiCredentials> => {
    console.log("[TradingSession] deriveApiCredentials called", { safeAddress });
    const tempClient = createTempClobClient(safeAddress);
    if (!tempClient) {
      console.error("[TradingSession] No signer available for ClobClient");
      throw new Error("No signer available");
    }
    console.log("[TradingSession] Created temporary ClobClient for credential derivation");
    console.log("[TradingSession] This will trigger a signature request from your wallet!");

    try {
      // Try to derive existing credentials first - THIS TRIGGERS SIGNATURE
      // Add 60-second timeout for mobile wallet scenarios where session might be stale
      console.log("[TradingSession] Calling tempClient.deriveApiKey() - SIGNATURE REQUEST SHOULD APPEAR NOW");
      console.log("[TradingSession] Timeout set to 60 seconds - please sign in your wallet app");
      
      const derivedCreds = await withTimeout(
        tempClient.deriveApiKey(),
        60000,
        "Signature request timed out. Please disconnect and reconnect your wallet, then try again."
      ).catch((err: any) => {
        console.log("[TradingSession] deriveApiKey failed:", err?.message || err);
        console.log("[TradingSession] Full error:", JSON.stringify(err, Object.getOwnPropertyNames(err)));
        
        // If it's a timeout error, throw it to show user-friendly message
        if (err?.message?.includes("timed out")) {
          throw err;
        }
        return null;
      });
      if (derivedCreds?.key && derivedCreds?.secret && derivedCreds?.passphrase) {
        console.log("[TradingSession] Successfully derived API Credentials!");
        console.log("[TradingSession] API key prefix:", derivedCreds.key.substring(0, 15) + "...");
        
        // Immediately validate the newly derived credentials
        console.log("[TradingSession] Validating freshly derived credentials...");
        const isValid = await validateApiCredentials(derivedCreds);
        if (!isValid) {
          console.error("[TradingSession] CRITICAL: Freshly derived credentials are INVALID!");
          console.log("[TradingSession] This wallet may not have completed setup on polymarket.com");
          // Don't throw - let the order fail naturally with a better error message
        } else {
          console.log("[TradingSession] Freshly derived credentials validated successfully!");
        }
        
        return derivedCreds;
      }

      // Create new credentials if derivation failed
      console.log("[TradingSession] deriveApiKey returned null, trying createApiKey...");
      const newCreds = await tempClient.createApiKey();
      console.log("[TradingSession] Successfully created new User API Credentials");
      console.log("[TradingSession] New API key prefix:", newCreds.key.substring(0, 15) + "...");
      return newCreds;
    } catch (err: any) {
      console.error("[TradingSession] Failed to get credentials:", err?.message || err);
      console.log("[TradingSession] Full error:", JSON.stringify(err, Object.getOwnPropertyNames(err)));
      throw err;
    }
  }, [createTempClobClient, validateApiCredentials]);

  // Fetch user's Safe/proxy address using the RelayClient or direct derivation
  const fetchSafeAddress = useCallback(async (): Promise<{ safeAddress: string | null; proxyDeployed: boolean }> => {
    try {
      // IMPORTANT: For WalletConnect users, we must ALWAYS use direct derivation from walletAddress
      // because window.ethereum might belong to a different wallet (e.g., Phantom) that's also installed.
      // The RelayClient uses window.ethereum.getAddress() which would return the wrong EOA address.
      if (walletType === 'walletconnect') {
        if (walletAddress) {
          console.log("[fetchSafeAddress] WalletConnect detected - using direct derivation from EOA:", walletAddress);
          const safeAddress = deriveSafeAddressFromEoa(walletAddress);
          console.log("[fetchSafeAddress] Safe address result (direct derivation):", safeAddress);
          return {
            safeAddress,
            proxyDeployed: false, // Can't verify deployment without RelayClient for WalletConnect
          };
        }
        console.log("[fetchSafeAddress] WalletConnect but no walletAddress available");
        return { safeAddress: null, proxyDeployed: false };
      }
      
      // For external/phantom wallets that use window.ethereum directly, use RelayClient
      if (isExternalWalletAvailable()) {
        console.log("[fetchSafeAddress] Using RelayClient for external wallet type:", walletType);
        const result = await fetchSafeAddressFromRelayer();
        console.log("[fetchSafeAddress] Safe address result (from RelayClient):", result);
        return {
          safeAddress: result.safeAddress,
          proxyDeployed: result.proxyDeployed,
        };
      }
      
      // Fallback: derive directly from walletAddress if available
      if (walletAddress) {
        console.log("[fetchSafeAddress] Fallback - deriving Safe address directly from EOA:", walletAddress);
        const safeAddress = deriveSafeAddressFromEoa(walletAddress);
        console.log("[fetchSafeAddress] Safe address result (direct derivation):", safeAddress);
        return {
          safeAddress,
          proxyDeployed: false,
        };
      }
      
      console.log("[fetchSafeAddress] No wallet address available for Safe address derivation");
      return { safeAddress: null, proxyDeployed: false };
    } catch (err) {
      console.error("[fetchSafeAddress] Failed to fetch Safe address:", err);
      return { safeAddress: null, proxyDeployed: false };
    }
  }, [walletAddress, walletType]);

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
        // CRITICAL: If the cached session has proxyDeployed: false, the credentials were derived
        // BEFORE the Safe was deployed. Per Polymarket docs, these credentials are invalid.
        // We must clear and re-derive credentials after deploying the Safe.
        if (!existingSession.proxyDeployed) {
          console.log("[TradingSession] Cached session has proxyDeployed=false - credentials were derived before Safe deployment");
          console.log("[TradingSession] Per Polymarket docs, must re-derive credentials after deploying Safe");
          clearSession(walletAddress);
          // Continue to deploy Safe and derive new credentials below
        } else {
          // Validate that cached credentials are still valid before using them
          console.log("[TradingSession] Checking if cached credentials are still valid...");
          const isValid = await validateApiCredentials(existingSession.apiCredentials);
          
          if (isValid) {
            console.log("[TradingSession] Using existing complete session (credentials valid)");
            setTradingSession(existingSession);
            setCurrentStep("complete");
            setCredentialsValidated(true);
            setIsInitializing(false);
            return existingSession;
          } else {
            // Cached credentials expired - need to re-derive
            console.log("[TradingSession] Cached credentials expired, clearing session and re-deriving...");
            clearSession(walletAddress);
            // Continue to derive new credentials below
          }
        }
      }

      // STEP 1: Fetch the user's Safe proxy address FIRST
      // We need this BEFORE deriving credentials because Safe wallets require
      // signatureType=2 and funder=safeAddress when deriving API credentials
      console.log("[TradingSession] Fetching Safe address from Polymarket...");
      let safeAddress: string | null = null;
      let proxyDeployed = false;
      
      try {
        const safeResult = await fetchSafeAddress();
        safeAddress = safeResult.safeAddress;
        proxyDeployed = safeResult.proxyDeployed;
        console.log("[TradingSession] Safe address result:", { safeAddress, proxyDeployed });
      } catch (safeError) {
        console.error("[TradingSession] Failed to fetch Safe address:", safeError);
        // For WalletConnect users, try direct derivation
        if (walletAddress && walletType === 'walletconnect') {
          safeAddress = deriveSafeAddressFromEoa(walletAddress);
          console.log("[TradingSession] Derived Safe address directly:", safeAddress);
        }
      }

      if (!safeAddress) {
        // Can't derive Safe address - user needs to set up on polymarket.com
        console.warn("Could not derive Safe address. User needs to complete setup on polymarket.com");
        setSessionError("Could not set up trading. Please visit polymarket.com to create your account first.");
        setCurrentStep("error");
        setIsInitializing(false);
        return null;
      }

      // STEP 2: Deploy Safe if not already deployed
      // CRITICAL: According to Polymarket docs, Safe must be deployed BEFORE deriving API credentials
      // https://github.com/Polymarket/wagmi-safe-builder-example#5-safe-deployment
      if (!proxyDeployed) {
        console.log("[TradingSession] Safe not deployed, deploying now (one-time setup)...");
        setCurrentStep("deploying");
        
        try {
          // Import and call deploySafeIfNeeded
          const { deploySafeIfNeeded } = await import("@/lib/polymarketGasless");
          const deployResult = await deploySafeIfNeeded();
          
          if (deployResult.proxyDeployed) {
            console.log("[TradingSession] Safe deployed successfully!");
            proxyDeployed = true;
          } else {
            console.warn("[TradingSession] Safe deployment initiated but may not be confirmed yet");
            // Continue anyway - the deployment might be in progress
          }
        } catch (deployError: any) {
          console.error("[TradingSession] Safe deployment failed:", deployError);
          // Don't block - user can try again
          setSessionError("Failed to deploy trading wallet. Please try again.");
          setCurrentStep("error");
          setIsInitializing(false);
          return null;
        }
      }

      // STEP 3: Derive user API credentials - THIS WILL TRIGGER A SIGNATURE REQUEST
      // IMPORTANT: Pass safeAddress so credentials are derived with signatureType=2
      // Now that Safe is deployed, credentials will be valid for trading
      console.log("[TradingSession] Deriving API credentials (will request signature from wallet)...");
      console.log("[TradingSession] Using Safe address for credential derivation:", safeAddress);
      setCurrentStep("credentials");
      const apiCreds = await deriveApiCredentials(safeAddress || undefined);
      console.log("[TradingSession] Got API credentials:", apiCreds ? "success" : "failed");

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
      setCredentialsValidated(true);
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
  }, [walletAddress, walletType, signer, deriveApiCredentials, fetchSafeAddress, validateApiCredentials]);

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
    setCredentialsValidated(false);
    setSessionError("Session expired. Please reinitialize.");
  }, [walletAddress]);

  // Force re-initialization of credentials (called when order fails with auth error)
  const forceReinitialize = useCallback(async () => {
    if (!walletAddress) return;
    console.log("[TradingSession] Force reinitializing session (credentials expired)");
    clearSession(walletAddress);
    setTradingSession(null);
    setCredentialsValidated(false);
    setSessionError(null);
    // Re-run initialization which will derive new credentials
    return initializeTradingSession();
  }, [walletAddress, initializeTradingSession]);

  // Track previous ClobClient identity to prevent unnecessary recreation
  // Using a ref to store the identity string of the last created ClobClient
  const lastClobClientIdentityRef = useRef<string | null>(null);
  const clobClientRef = useRef<ClobClient | null>(null);
  
  // Create authenticated ClobClient with builder config for order placement
  // Use a stable identity check to prevent recreation on every render
  const clobClient = useMemo(() => {
    if (!wrappedSigner || !walletAddress || !tradingSession?.apiCredentials) {
      clobClientRef.current = null;
      lastClobClientIdentityRef.current = null;
      return null;
    }

    // Require Safe address for trading (signatureType=2)
    // Note: We only require safeAddress to exist, not proxyDeployed
    // If proxy isn't deployed, Polymarket server will reject the order
    if (!tradingSession.safeAddress) {
      console.warn("ClobClient not created: No Safe address available. User needs to set up proxy on polymarket.com");
      clobClientRef.current = null;
      lastClobClientIdentityRef.current = null;
      return null;
    }

    // Create a stable identity string based on actual credential VALUES, not object references
    // This prevents recreating ClobClient when the tradingSession object reference changes
    // but the actual credential values remain the same
    const apiKeyPrefix = tradingSession.apiCredentials.key?.substring(0, 20) || '';
    const clobIdentity = `${walletAddress}-${tradingSession.safeAddress}-${apiKeyPrefix}`;
    
    // If identity hasn't changed, return the cached ClobClient
    if (lastClobClientIdentityRef.current === clobIdentity && clobClientRef.current) {
      return clobClientRef.current;
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
    const newClient = new ClobClient(
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
    
    // Cache the new client and identity
    clobClientRef.current = newClient;
    lastClobClientIdentityRef.current = clobIdentity;
    
    return newClient;
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
    credentialsValidated,
    initializeTradingSession,
    endTradingSession,
    invalidateSession,
    forceReinitialize,
    clobClient,
  };
}
