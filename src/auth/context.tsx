import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import type { AuthState, AuthContextValue, SignerInterface } from './types';
import { createNip07Signer, isNip07Available } from './nip07';
import { createBunkerSigner } from './nip46';

const initialState: AuthState = {
  isConnected: false,
  pubkey: null,
  signer: null,
  method: null,
  isLoading: false,
  error: null,
};

const AuthContext = createContext<AuthContextValue | null>(null);

const AUTH_STORAGE_KEY = 'cloistr_auth';

interface StoredAuth {
  method: 'nip07' | 'nip46';
  bunkerUrl?: string;
}

/**
 * Authentication provider component
 * Wrap your app with this to enable authentication
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState);

  // Restore session on mount
  useEffect(() => {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      try {
        const auth: StoredAuth = JSON.parse(stored);
        if (auth.method === 'nip07' && isNip07Available()) {
          connectNip07();
        } else if (auth.method === 'nip46' && auth.bunkerUrl) {
          connectNip46(auth.bunkerUrl);
        }
      } catch {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    }
  }, []);

  const connectNip07 = useCallback(async () => {
    setState(s => ({ ...s, isLoading: true, error: null }));

    try {
      const signer = createNip07Signer();
      if (!signer) {
        throw new Error('No Nostr extension found. Install Alby, nos2x, or another NIP-07 extension.');
      }

      const pubkey = await signer.getPublicKey();

      setState({
        isConnected: true,
        pubkey,
        signer,
        method: 'nip07',
        isLoading: false,
        error: null,
      });

      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ method: 'nip07' }));
    } catch (err) {
      setState(s => ({
        ...s,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to connect',
      }));
    }
  }, []);

  const connectNip46 = useCallback(async (bunkerUrl: string) => {
    setState(s => ({ ...s, isLoading: true, error: null }));

    try {
      const signer = createBunkerSigner(bunkerUrl);
      await signer.connect();
      const pubkey = await signer.getPublicKey();

      setState({
        isConnected: true,
        pubkey,
        signer,
        method: 'nip46',
        isLoading: false,
        error: null,
      });

      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ method: 'nip46', bunkerUrl }));
    } catch (err) {
      setState(s => ({
        ...s,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to connect to bunker',
      }));
    }
  }, []);

  const disconnect = useCallback(() => {
    setState(initialState);
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }, []);

  const value: AuthContextValue = {
    state,
    connectNip07,
    connectNip46,
    disconnect,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Hook to access authentication state and methods
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

/**
 * Hook to get just the authentication state
 */
export function useAuthState(): AuthState {
  const { state } = useAuth();
  return state;
}

/**
 * Hook to get the current signer
 */
export function useSigner(): SignerInterface | null {
  const { state } = useAuth();
  return state.signer;
}

/**
 * Hook to get the current pubkey
 */
export function usePubkey(): string | null {
  const { state } = useAuth();
  return state.pubkey;
}

/**
 * Hook to check if user is connected
 */
export function useIsConnected(): boolean {
  const { state } = useAuth();
  return state.isConnected;
}
