import { useState, useCallback, useEffect, useMemo } from "react";
import { ClobClient } from "@polymarket/clob-client";
import { BuilderConfig } from "@polymarket/builder-signing-sdk";
import { useWallet } from "@/context/WalletContext";
import { getSafeAddress as fetchSafeAddressFromRelayer, isExternalWalletAvailable, deriveSafeAddressFromEoa } from "@/lib/polymarketGasless";
import { approveUSDCForTradingGasless, approveCTFForTradingGasless } from "@/lib/polymarketRelayer";
import type { ethers } from "ethers";

const CLOB_API_URL = "https://clob.polymarket.com";
const POLYGON_CHAIN_ID = 137;
const SESSION_STORAGE_KEY = "polymarket_trading_session";

// Polymarket requires signatureType=2 (browser wallet proxy) for external wallets
// signatureType=0 (EOA) is no longer supported for trading
const SIGNATURE_TYPE_BROWSER_WALLET = 2;

// Version for credential derivation format
// Increment this when making breaking changes to how credentials are derived
// v1: Initial implementation (EOA address in ClobAuth)
// v2: Safe address override in ClobAuth for Safe wallets (didn't work - L1 auth fails)
// v3: EOA address in ClobAuth (correct - L1 auth needs ecrecover to match POLY_ADDRESS)
//     Order submission uses owner=EOA (API key binding), maker=Safe (funds)
// v4: Force re-derive after fixing API key binding (v2/v3 keys may be bound to wrong address)
const CREDENTIAL_VERSION = 4;

// Feature flag: Fee collection authorization
// Set to false to disable fee authorization step (relayer doesn't support fees yet)
const FEE_AUTHORIZATION_ENABLED = false;

// MODULE-LEVEL ClobClient cache - shared across ALL components using useTradingSession
// This prevents the issue where each component (header, bet modal) gets its own ClobClient
// and the bet modal would submit orders with missing credentials
let cachedClobClient: ClobClient | null = null;
let cachedClobClientIdentity: string | null = null;

// Clear the module-level ClobClient cache (called on disconnect/session end)
// EXPORTED so WalletContext can clear the cache when wallet identity changes
export function clearClobClientCache() {
  console.log("[TradingSession] Clearing ClobClient cache (invalidating stale signer)");
  cachedClobClient = null;
  cachedClobClientIdentity = null;
}

// Adapter to wrap ethers v6 signer with ethers v5 _signTypedData method
// Polymarket SDK expects _signTypedData (v5) but ethers v6 uses signTypedData
function wrapSignerForPolymarket(signer: ethers.Signer, overrideAddress?: string): any {
  // Create a proxy that:
  // 1. Adds _signTypedData method (ethers v5 compatibility for Polymarket SDK)
  // 2. Optionally overrides getAddress() to return Safe address for credential derivation
  //
  // For Safe wallets (signatureType=2), the ClobAuth message must contain the Safe address
  // so that API keys get bound to the Safe. The EOA still signs the message.
  return new Proxy(signer, {
    get(target: any, prop: string) {
      if (prop === "_signTypedData") {
        // Map _signTypedData to signTypedData (ethers v6 method)
        return async (domain: any, types: any, value: any) => {
          return target.signTypedData(domain, types, value);
        };
      }
      
      // Override getAddress to return Safe address for credential derivation
      // This makes the ClobAuth message contain the Safe address
      if (prop === "getAddress" && overrideAddress) {
        return async () => {
          console.log(`[wrapSigner] Overriding getAddress: returning Safe ${overrideAddress} instead of EOA`);
          return overrideAddress;
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
  credentialVersion?: number; // Version of credential derivation format
  feeAuthorizationComplete?: boolean; // Whether user has authorized fee collection via relayer
}

export type SessionStep =
  | "idle"
  | "checking"
  | "deploying"
  | "credentials"
  | "fee_authorization"
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
    
    // VALIDATION 1: Check credential version - invalidate sessions with old credential format
    // This forces re-derivation when credential derivation logic changes
    console.log(`[TradingSession] Checking credential version: stored=${stored?.credentialVersion}, current=${CREDENTIAL_VERSION}`);
    if (stored?.hasApiCredentials && stored.credentialVersion !== CREDENTIAL_VERSION) {
      console.warn(`[TradingSession] CREDENTIAL VERSION MISMATCH! Stored: ${stored.credentialVersion}, Current: ${CREDENTIAL_VERSION}`);
      console.warn("[TradingSession] CLEARING STALE CREDENTIALS - API keys may be bound to wrong address");
      clearSession(walletAddress);
      clearClobClientCache(); // Also clear the module-level cache
      setTradingSession(null);
      setCurrentStep("idle");
      setCredentialsValidated(false);
      return;
    }
    
    // VALIDATION 2: Check if stored Safe address matches the derived one
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
    // Mark as complete if we have credentials AND a Safe address AND (fee authorization OR feature disabled)
    // proxyDeployed status is informational - we'll let the server reject if not deployed
    if (stored?.hasApiCredentials && stored?.safeAddress) {
      if (FEE_AUTHORIZATION_ENABLED && !stored.feeAuthorizationComplete) {
        // Has credentials but fee authorization pending
        setCurrentStep("fee_authorization");
      } else {
        setCurrentStep("complete");
      }
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
  // For Safe wallets (signatureType=2):
  // - API keys are bound to EOA (the actual signer) because L1 auth uses ecrecover
  // - Safe address is passed as funder for order execution
  // - Order submission uses: maker=Safe (funds), owner=EOA (API key binding)
  const createTempClobClient = useCallback((safeAddress?: string) => {
    if (!signer) return null;
    
    // For Safe wallets, we create ClobClient with Safe wallet configuration
    // BUT we do NOT override getAddress - L1 auth needs real EOA address for signature verification
    if (safeAddress) {
      console.log(`[TradingSession] Creating temp ClobClient with signatureType=${SIGNATURE_TYPE_BROWSER_WALLET}, funder=${safeAddress}`);
      console.log(`[TradingSession] API keys will be bound to EOA (for L1 auth verification)`);
      console.log(`[TradingSession] Order submission will use: maker=Safe, owner=EOA`);
      
      // Wrap signer WITHOUT address override - L1 auth verifies signature against POLY_ADDRESS
      const wrappedSigner = wrapSignerForPolymarket(signer);
      
      return new ClobClient(
        CLOB_API_URL,
        POLYGON_CHAIN_ID,
        wrappedSigner,
        undefined, // No credentials yet
        SIGNATURE_TYPE_BROWSER_WALLET, // signatureType = 2 for Safe wallets
        safeAddress // funder = Safe address (where funds are held)
      );
    }
    
    // Fallback for Magic wallets (which don't use Safe)
    console.log("[TradingSession] Creating temp ClobClient with default config (no Safe)");
    const defaultSigner = wrapSignerForPolymarket(signer);
    return new ClobClient(CLOB_API_URL, POLYGON_CHAIN_ID, defaultSigner);
  }, [signer]);

  // Validate that cached API credentials are still valid with Polymarket
  // Note: We can't properly validate without HMAC signing, so we use server-side validation
  // Returns: true = definitely valid, false = definitely invalid or inconclusive (should try createApiKey)
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
      } else if (result.inconclusive) {
        // Validation endpoint is unavailable (405) - treat as invalid to trigger createApiKey
        console.log("[TradingSession] Credentials validation inconclusive:", result.warning);
        console.log("[TradingSession] Will try createApiKey() to register credentials");
        return false;
      } else {
        console.log("[TradingSession] Credentials invalid:", result.error);
        return false;
      }
    } catch (err) {
      console.error("[TradingSession] Error validating credentials:", err);
      // On network error, treat as inconclusive - should try createApiKey
      console.log("[TradingSession] Network error - will try createApiKey() as fallback");
      return false;
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
          console.log("[TradingSession] Falling back to createApiKey() to register new credentials...");
          
          // deriveApiKey() returns credentials but they might not be registered
          // createApiKey() will register new credentials with Polymarket
          try {
            const newCreds = await tempClient.createApiKey();
            if (newCreds?.key) {
              console.log("[TradingSession] Successfully created new User API Credentials via createApiKey!");
              console.log("[TradingSession] New API key prefix:", newCreds.key.substring(0, 15) + "...");
              return newCreds;
            } else {
              console.log("[TradingSession] createApiKey returned empty response, using derived credentials");
              return derivedCreds;
            }
          } catch (createErr: any) {
            // "Could not create api key" usually means an API key already exists
            // In this case, the derived credentials should be correct
            const errMsg = createErr?.message || createErr?.data?.error || String(createErr);
            console.error("[TradingSession] createApiKey failed:", errMsg);
            if (errMsg.includes("Could not create")) {
              console.log("[TradingSession] API key already exists - derived credentials should work");
            }
            // Return derived creds - they exist and should work
            console.log("[TradingSession] Using derived credentials (API key exists)");
            return derivedCreds;
          }
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
            // Check if fee authorization is complete (only if feature enabled)
            if (FEE_AUTHORIZATION_ENABLED && !existingSession.feeAuthorizationComplete) {
              console.log("[TradingSession] Session valid but fee authorization pending - showing fee step");
              setTradingSession(existingSession);
              setCurrentStep("fee_authorization");
              setCredentialsValidated(true);
              setIsInitializing(false);
              return existingSession;
            }
            
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

      // STEP 2.5: Register token approvals with Polymarket's relayer
      // This is CRITICAL for sell orders - on-chain approvals alone are not recognized by Polymarket's API
      // The relayer tracks approvals internally and validates them when processing orders
      console.log("[TradingSession] Registering token approvals with Polymarket relayer...");
      try {
        // Register USDC approvals for buying
        const usdcResult = await approveUSDCForTradingGasless(safeAddress, "safe", walletAddress);
        if (usdcResult.success) {
          console.log("[TradingSession] USDC approvals registered:", usdcResult.transactionHash);
        } else {
          console.warn("[TradingSession] USDC approval registration failed (may already be registered):", usdcResult.error);
        }
        
        // Register CTF approvals for selling outcome tokens
        const ctfResult = await approveCTFForTradingGasless(safeAddress, "safe", walletAddress);
        if (ctfResult.success) {
          console.log("[TradingSession] CTF approvals registered:", ctfResult.transactionHash);
        } else {
          console.warn("[TradingSession] CTF approval registration failed (may already be registered):", ctfResult.error);
        }
      } catch (approvalError: any) {
        // Don't block on approval failures - they may already be registered
        // The actual trade will fail if approvals are truly missing
        console.warn("[TradingSession] Token approval registration warning:", approvalError.message);
      }

      // STEP 3: Derive user API credentials - THIS WILL TRIGGER A SIGNATURE REQUEST
      // IMPORTANT: Pass safeAddress so credentials are derived with signatureType=2
      // Now that Safe is deployed, credentials will be valid for trading
      console.log("[TradingSession] Deriving API credentials (will request signature from wallet)...");
      console.log("[TradingSession] Using Safe address for credential derivation:", safeAddress);
      setCurrentStep("credentials");
      const apiCreds = await deriveApiCredentials(safeAddress || undefined);
      console.log("[TradingSession] Got API credentials:", apiCreds ? "success" : "failed");

      // Create session with Safe address
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
        credentialVersion: CREDENTIAL_VERSION, // Track credential derivation format version
        feeAuthorizationComplete: !FEE_AUTHORIZATION_ENABLED, // Auto-complete if feature disabled
      };

      setTradingSession(newSession);
      saveSession(walletAddress, newSession);
      
      // STEP 4: Fee Authorization (only if feature enabled)
      if (FEE_AUTHORIZATION_ENABLED) {
        // Pause at fee_authorization step - user must explicitly authorize
        // The UI will show a button to authorize fee collection
        console.log("[TradingSession] Fee authorization required - pausing for user confirmation");
        setCurrentStep("fee_authorization");
      } else {
        // Skip fee authorization - go straight to complete
        console.log("[TradingSession] Fee authorization disabled - session complete");
        setCurrentStep("complete");
      }
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
    clearClobClientCache(); // Clear module-level ClobClient cache
    setTradingSession(null);
    setCurrentStep("idle");
    setSessionError(null);
  }, [walletAddress]);

  // Clear session on credential error (expired/revoked)
  const invalidateSession = useCallback(() => {
    if (!walletAddress) return;
    console.log("Invalidating session due to credential error");
    clearSession(walletAddress);
    clearClobClientCache(); // Clear module-level ClobClient cache
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
    clearClobClientCache(); // Clear module-level ClobClient cache
    setTradingSession(null);
    setCredentialsValidated(false);
    setSessionError(null);
    // Re-run initialization which will derive new credentials
    return initializeTradingSession();
  }, [walletAddress, initializeTradingSession]);

  // Re-register token approvals with Polymarket's relayer
  // Called when sell orders fail with "not enough balance / allowance"
  // This can fix issues where approvals exist on-chain but aren't registered with Polymarket
  const reregisterApprovals = useCallback(async () => {
    if (!walletAddress || !tradingSession?.safeAddress) {
      console.error("[TradingSession] Cannot register approvals: no wallet or Safe address");
      return { success: false, error: "No wallet connected" };
    }
    
    console.log("[TradingSession] Re-registering token approvals with Polymarket relayer...");
    const safeAddress = tradingSession.safeAddress;
    
    try {
      // Register USDC approvals
      const usdcResult = await approveUSDCForTradingGasless(safeAddress, "safe", walletAddress);
      console.log("[TradingSession] USDC approval result:", usdcResult);
      
      // Register CTF approvals (required for sell orders)
      const ctfResult = await approveCTFForTradingGasless(safeAddress, "safe", walletAddress);
      console.log("[TradingSession] CTF approval result:", ctfResult);
      
      if (ctfResult.success || usdcResult.success) {
        return { success: true, message: "Approvals registered successfully" };
      } else {
        return { success: false, error: ctfResult.error || usdcResult.error };
      }
    } catch (error: any) {
      console.error("[TradingSession] Failed to register approvals:", error);
      return { success: false, error: error.message || "Failed to register approvals" };
    }
  }, [walletAddress, tradingSession?.safeAddress]);

  // Authorize fee collection for existing sessions that don't have authorization
  // This updates the session to mark fee collection as authorized
  const authorizeFees = useCallback(async () => {
    if (!walletAddress || !tradingSession) {
      console.error("[TradingSession] Cannot authorize fees: no wallet or session");
      return { success: false, error: "No trading session" };
    }
    
    console.log("[TradingSession] Authorizing fee collection...");
    
    try {
      // Update session with fee authorization
      const updatedSession: TradingSession = {
        ...tradingSession,
        feeAuthorizationComplete: true,
      };
      
      setTradingSession(updatedSession);
      saveSession(walletAddress, updatedSession);
      
      // Transition to complete step now that fees are authorized
      setCurrentStep("complete");
      console.log("[TradingSession] Fee authorization complete - session now complete");
      
      return { success: true };
    } catch (error: any) {
      console.error("[TradingSession] Failed to authorize fees:", error);
      return { success: false, error: error.message || "Failed to authorize fees" };
    }
  }, [walletAddress, tradingSession]);

  // Collect pending fees from user's Safe wallet to treasury
  // This is called by the server when there are pending fees to collect
  const collectPendingFees = useCallback(async () => {
    if (!walletAddress || !tradingSession?.safeAddress) {
      console.error("[TradingSession] Cannot collect fees: no wallet or Safe address");
      return { success: false, error: "No trading session" };
    }
    
    if (!tradingSession.feeAuthorizationComplete) {
      console.error("[TradingSession] Cannot collect fees: fee authorization not complete");
      return { success: false, error: "Fee authorization required" };
    }
    
    console.log("[TradingSession] Collecting pending fees...");
    
    try {
      // Call server endpoint to trigger fee collection
      const response = await fetch("/api/fees/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          safeAddress: tradingSession.safeAddress,
          eoaAddress: walletAddress,
        }),
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        return { success: false, error: result.error || "Fee collection failed" };
      }
      
      console.log("[TradingSession] Fee collection result:", result);
      return { success: true, ...result };
    } catch (error: any) {
      console.error("[TradingSession] Failed to collect fees:", error);
      return { success: false, error: error.message || "Failed to collect fees" };
    }
  }, [walletAddress, tradingSession?.safeAddress, tradingSession?.feeAuthorizationComplete]);

  // Create authenticated ClobClient with builder config for order placement
  // Uses MODULE-LEVEL cache (cachedClobClient, cachedClobClientIdentity) to ensure
  // all components share the same ClobClient instance with valid credentials
  const clobClient = useMemo(() => {
    if (!wrappedSigner || !walletAddress || !tradingSession?.apiCredentials) {
      // IMPORTANT: Only return cached client if it belongs to the SAME wallet
      // Otherwise return null to prevent using stale credentials from a previous session
      if (cachedClobClient && cachedClobClientIdentity?.startsWith(walletAddress || '')) {
        return cachedClobClient;
      }
      return null;
    }

    // Require Safe address for trading (signatureType=2)
    // Note: We only require safeAddress to exist, not proxyDeployed
    // If proxy isn't deployed, Polymarket server will reject the order
    if (!tradingSession.safeAddress) {
      console.warn("ClobClient not created: No Safe address available. User needs to set up proxy on polymarket.com");
      // Only return cached if same wallet
      if (cachedClobClient && cachedClobClientIdentity?.startsWith(walletAddress)) {
        return cachedClobClient;
      }
      return null;
    }

    // Create a stable identity string based on actual credential VALUES, not object references
    // This prevents recreating ClobClient when the tradingSession object reference changes
    // but the actual credential values remain the same
    const apiKeyPrefix = tradingSession.apiCredentials.key?.substring(0, 20) || '';
    const clobIdentity = `${walletAddress}-${tradingSession.safeAddress}-${apiKeyPrefix}`;
    
    // If identity hasn't changed, return the MODULE-LEVEL cached ClobClient
    // This ensures ALL components using this hook share the same client
    if (cachedClobClientIdentity === clobIdentity && cachedClobClient) {
      return cachedClobClient;
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
    
    // Update MODULE-LEVEL cache so all components share this client
    cachedClobClient = newClient;
    cachedClobClientIdentity = clobIdentity;
    
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
    feeAuthorizationComplete: !!tradingSession?.feeAuthorizationComplete,
    initializeTradingSession,
    endTradingSession,
    invalidateSession,
    forceReinitialize,
    reregisterApprovals, // Re-register approvals with Polymarket's relayer
    authorizeFees, // Authorize fee collection for existing sessions
    collectPendingFees, // Collect pending fees from user's Safe wallet
    clobClient,
  };
}
