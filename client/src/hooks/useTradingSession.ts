import { useState, useCallback, useEffect, useMemo } from "react";
import { ClobClient } from "@polymarket/clob-client";
import { BuilderConfig } from "@polymarket/builder-signing-sdk";
import { useWallet } from "@/context/WalletContext";
import type { ethers } from "ethers";

const CLOB_API_URL = "https://clob.polymarket.com";
const POLYGON_CHAIN_ID = 137;
const SESSION_STORAGE_KEY = "polymarket_trading_session";

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
    if (stored?.hasApiCredentials) {
      setCurrentStep("complete");
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
    const tempClient = createTempClobClient();
    if (!tempClient) throw new Error("No signer available");

    try {
      // Try to derive existing credentials first
      const derivedCreds = await tempClient.deriveApiKey().catch(() => null);
      if (derivedCreds?.key && derivedCreds?.secret && derivedCreds?.passphrase) {
        console.log("Successfully derived existing User API Credentials");
        return derivedCreds;
      }

      // Create new credentials if derivation failed
      console.log("Creating new User API Credentials...");
      const newCreds = await tempClient.createApiKey();
      console.log("Successfully created new User API Credentials");
      return newCreds;
    } catch (err) {
      console.error("Failed to get credentials:", err);
      throw err;
    }
  }, [createTempClobClient]);

  // Initialize trading session
  const initializeTradingSession = useCallback(async () => {
    if (!walletAddress || !signer) {
      throw new Error("Wallet not connected");
    }

    setIsInitializing(true);
    setCurrentStep("checking");
    setSessionError(null);

    try {
      // Check for existing session with valid credentials
      const existingSession = loadSession(walletAddress);
      if (existingSession?.hasApiCredentials && existingSession?.apiCredentials) {
        setTradingSession(existingSession);
        setCurrentStep("complete");
        setIsInitializing(false);
        return existingSession;
      }

      // Derive user API credentials
      setCurrentStep("credentials");
      const apiCreds = await deriveApiCredentials();

      // Create new session
      const newSession: TradingSession = {
        eoaAddress: walletAddress,
        hasApiCredentials: true,
        apiCredentials: apiCreds,
        lastChecked: Date.now(),
      };

      setTradingSession(newSession);
      saveSession(walletAddress, newSession);
      setCurrentStep("complete");
      setIsInitializing(false);
      return newSession;
    } catch (err: any) {
      console.error("Session initialization error:", err);
      setSessionError(err.message || "Failed to initialize trading session");
      setCurrentStep("error");
      setIsInitializing(false);
      throw err;
    }
  }, [walletAddress, signer, deriveApiCredentials]);

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

    // Create authenticated ClobClient with wrapped signer (ethers v5 compatibility)
    // signatureType 0 = EOA signature (user signing directly)
    return new ClobClient(
      CLOB_API_URL,
      POLYGON_CHAIN_ID,
      wrappedSigner,
      tradingSession.apiCredentials,
      0, // signatureType = 0 for EOA
      walletAddress, // funder = user's wallet
      undefined,
      false,
      builderConfig
    );
  }, [wrappedSigner, walletAddress, tradingSession?.apiCredentials]);

  return {
    tradingSession,
    currentStep,
    sessionError,
    isInitializing,
    isTradingSessionComplete: !!tradingSession?.hasApiCredentials,
    initializeTradingSession,
    endTradingSession,
    invalidateSession,
    clobClient,
  };
}
