import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Magic } from 'magic-sdk';

interface MagicContextType {
  magic: Magic | null;
  isLoggedIn: boolean;
  userAddress: string | null;
  userEmail: string | null;
  isLoading: boolean;
  login: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

const MagicContext = createContext<MagicContextType | undefined>(undefined);

const MAGIC_API_KEY = import.meta.env.VITE_MAGIC_API_KEY || '';

export function MagicProvider({ children }: { children: ReactNode }) {
  const [magic, setMagic] = useState<Magic | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userAddress, setUserAddress] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!MAGIC_API_KEY) {
      console.warn('Magic API key not configured');
      setIsLoading(false);
      return;
    }

    const magicInstance = new Magic(MAGIC_API_KEY, {
      network: {
        rpcUrl: 'https://polygon-rpc.com',
        chainId: 137,
      },
    });
    setMagic(magicInstance);

    const checkLoginStatus = async () => {
      try {
        const loggedIn = await magicInstance.user.isLoggedIn();
        if (loggedIn) {
          const metadata = await magicInstance.user.getInfo();
          setIsLoggedIn(true);
          setUserAddress(metadata.publicAddress || null);
          setUserEmail(metadata.email || null);
        }
      } catch (error) {
        console.error('Error checking login status:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkLoginStatus();
  }, []);

  const login = async (email: string) => {
    if (!magic) throw new Error('Magic not initialized');
    setIsLoading(true);
    try {
      await magic.auth.loginWithMagicLink({ email });
      const metadata = await magic.user.getInfo();
      setIsLoggedIn(true);
      setUserAddress(metadata.publicAddress || null);
      setUserEmail(metadata.email || null);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    if (!magic) return;
    setIsLoading(true);
    try {
      await magic.user.logout();
      setIsLoggedIn(false);
      setUserAddress(null);
      setUserEmail(null);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <MagicContext.Provider
      value={{ magic, isLoggedIn, userAddress, userEmail, isLoading, login, logout }}
    >
      {children}
    </MagicContext.Provider>
  );
}

export function useMagic() {
  const context = useContext(MagicContext);
  if (!context) {
    throw new Error('useMagic must be used within a MagicProvider');
  }
  return context;
}
