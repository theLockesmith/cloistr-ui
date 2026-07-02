import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import type { AuthState, AuthContextValue, SignerInterface } from './types';
import { createNip07Signer, isNip07Available } from './nip07';
import { createBunkerSigner } from './nip46';
import { generateSecretKey, getPublicKey, nip04 } from 'nostr-tools';

const NOSTRCONNECT_RELAY = 'wss://relay.cloistr.xyz';

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

  const connectViaNostrConnect = useCallback(async (
    _options: undefined | Record<string, unknown>,
    onApprove: (uri: string) => Promise<void>
  ) => {
    setState(s => ({ ...s, isLoading: true, error: null }));

    try {
      const skBytes = generateSecretKey();
      const localPubkey = getPublicKey(skBytes);
      const uri = `nostrconnect://${localPubkey}?relay=${encodeURIComponent(NOSTRCONNECT_RELAY)}`;

      const remotePubkey = await new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(NOSTRCONNECT_RELAY);
        const subId = 'nc-' + localPubkey.slice(0, 8);
        let settled = false;

        const done = (pubkey?: string, err?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try { ws.close(); } catch { /* ignore */ }
          if (err) reject(err);
          else if (pubkey) resolve(pubkey);
        };

        const timer = setTimeout(() => {
          done(undefined, new Error('nostrconnect timed out after 60s'));
        }, 60000);

        ws.onopen = () => {
          ws.send(JSON.stringify([
            'REQ', subId,
            { kinds: [24133], '#p': [localPubkey], since: Math.floor(Date.now() / 1000) - 5 },
          ]));

          onApprove(uri).catch(err => {
            done(undefined, err instanceof Error ? err : new Error('Approval failed'));
          });
        };

        ws.onmessage = (event: MessageEvent) => {
          try {
            const msg = JSON.parse(event.data as string) as unknown[];
            if (!Array.isArray(msg) || msg[0] !== 'EVENT') return;
            const ev = msg[2] as { kind: number; pubkey: string; content: string };
            if (ev.kind !== 24133) return;

            const decrypted = nip04.decrypt(skBytes, ev.pubkey, ev.content);
            const response = JSON.parse(decrypted) as { result?: unknown };
            if (response.result !== undefined) {
              ws.send(JSON.stringify(['CLOSE', subId]));
              done(ev.pubkey);
            }
          } catch { /* ignore malformed messages */ }
        };

        ws.onerror = () => {
          done(undefined, new Error('Relay connection failed'));
        };
      });

      const bunkerUrl = `bunker://${remotePubkey}?relay=${encodeURIComponent(NOSTRCONNECT_RELAY)}`;
      const signer = createBunkerSigner(bunkerUrl);

      setState({
        isConnected: true,
        pubkey: remotePubkey,
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
        error: err instanceof Error ? err.message : 'Connection failed',
      }));
      throw err;
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
    connectViaNostrConnect,
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
