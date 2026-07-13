/**
 * SharedAuthProvider - Cross-subdomain authentication provider
 *
 * Wraps the collab-common AuthProvider and adds cross-domain session sync.
 * Enables single sign-on across all *.cloistr.xyz services.
 *
 * Multi-identity: on load, fetches all keys from the signer, calls setKeys(),
 * mints a signer for the active key, and passes resolveSigner so setActiveKey()
 * can mint signers for non-active keys on demand.
 *
 * Key-switcher bootstrap and cookie/cross-tab logic lives in
 * src/lib/keySwitcher.ts (useKeySwitcherBootstrap) and is shared with
 * BackendAuthProvider so JWT apps get identical multi-identity behaviour.
 */

import { useEffect, useCallback, useRef, createContext, useContext, useMemo, ReactNode } from 'react';
import {
  AuthProvider,
  useNostrAuth,
  useAuthHelpers,
} from '../auth/index.js';
import type { KeyIdentity, SignerInterface } from '../auth/index.js';
import {
  getSharedSession,
  saveSharedSession,
  clearSharedSession,
  hasSharedSession,
  isCloistrDomain,
  type SharedSession,
} from '../lib/session.js';
import { useKeySwitcherBootstrap } from '../lib/keySwitcher.js';
import { Spinner } from './Spinner.js';

export interface SharedAuthProviderProps {
  children: ReactNode;
  /**
   * Whether to automatically connect if a shared session exists.
   * Default: true
   */
  autoConnect?: boolean;
  /**
   * Callback when auto-connect completes (success or failure)
   */
  onAutoConnectComplete?: (success: boolean, pubkey?: string) => void;
  /**
   * Signer (IdP) base URL used to resolve the shared `.cloistr.xyz` session on
   * load. Default: https://signer.cloistr.xyz
   */
  signerUrl?: string;
}

/**
 * Context for shared session state
 */
interface SharedSessionContextValue {
  /** Whether a shared session cookie exists */
  hasSharedSession: boolean;
  /** Get the shared session data */
  getSharedSession: () => SharedSession | null;
  /** Whether running on a cloistr.xyz domain */
  isCloistrDomain: boolean;
  /**
   * True while the on-load SSO restore is still in flight. Apps MUST wait for
   * this to be false before deciding the user is logged out / redirecting to a
   * login screen — otherwise they redirect before the silent .cloistr.xyz SSO
   * completes, which reads as "no session persistence across pages".
   */
  isResolving: boolean;
  /**
   * Per-tab pin utilities. The pin overrides the global active key for this tab
   * only (stored in sessionStorage, not propagated via cookie).
   */
  pin: {
    /** Currently pinned pubkey for this tab, or null */
    pinnedPubkey: string | null;
    /** Pin a pubkey to this tab and switch locally (no global cookie write) */
    setPinnedPubkey: (pubkey: string) => void;
    /** Clear the per-tab pin */
    clearPin: () => void;
  };
}

const SharedSessionContext = createContext<SharedSessionContextValue | null>(null);

export { SharedSessionContext };

/**
 * Hook to access shared session utilities
 */
export function useSharedSession(): SharedSessionContextValue {
  const context = useContext(SharedSessionContext);
  if (!context) {
    throw new Error('useSharedSession must be used within SharedAuthProvider');
  }
  return context;
}

/**
 * Hook to access shared session utilities without throwing.
 * Returns null when used outside SharedAuthProvider (e.g. bare AuthProvider apps).
 */
export function useSharedSessionMaybe(): SharedSessionContextValue | null {
  return useContext(SharedSessionContext);
}

/**
 * Inner component that handles session sync after auth context is available.
 *
 * It also wires up the resolveSigner function into the ref that SharedAuthProvider
 * passes to AuthProvider — this is the only way to give AuthProvider a signer-mint
 * callback that itself needs the auth context (connectViaNostrConnect).
 */
function SessionSyncInner({
  children,
  autoConnect,
  onAutoConnectComplete,
  signerUrl = 'https://signer.cloistr.xyz',
  resolveSignerRef,
}: SharedAuthProviderProps & {
  resolveSignerRef: React.MutableRefObject<((identity: KeyIdentity) => Promise<SignerInterface>) | undefined>;
}) {
  const { authState } = useNostrAuth();
  const { isAuthenticated } = useAuthHelpers();
  const autoConnectAttempted = useRef(false);
  const prevConnectedRef = useRef(authState.isConnected);

  // All multi-identity / cookie / cross-tab logic lives here.
  const {
    mintSignerForKey: _mintSignerForKey,
    resolveSigner,
    bootstrapKeys,
    isResolving,
    setIsResolving,
    pin,
  } = useKeySwitcherBootstrap(signerUrl, autoConnect !== false);

  // Keep the ref up-to-date so AuthProvider always calls the current closure
  useEffect(() => {
    resolveSignerRef.current = resolveSigner;
  }, [resolveSignerRef, resolveSigner]);

  /**
   * Sync successful auth to shared session cookies on connect transition
   */
  useEffect(() => {
    if (authState.isConnected && !prevConnectedRef.current && authState.pubkey && authState.method) {
      let bunkerUrl: string | undefined;
      if (authState.method === 'nip46') {
        try {
          bunkerUrl = localStorage.getItem('cloistr:auth:bunkerUrl') || undefined;
        } catch {
          // localStorage not available
        }
      }
      saveSharedSession({
        method: authState.method,
        pubkey: authState.pubkey,
        bunkerUrl,
      });
    }
    prevConnectedRef.current = authState.isConnected;
  }, [authState.isConnected, authState.pubkey, authState.method]);

  /**
   * Clear shared session on disconnect
   */
  useEffect(() => {
    if (!authState.isConnected && prevConnectedRef.current) {
      clearSharedSession();
    }
  }, [authState.isConnected]);

  /**
   * SSO bootstrap: resolve the shared `.cloistr.xyz` signer session on load.
   * Delegates the key-list + signer mint to bootstrapKeys() from the shared hook.
   */
  const attemptSsoConnect = useCallback(async (): Promise<boolean> => {
    return bootstrapKeys();
  }, [bootstrapKeys]);

  const attemptAutoConnect = useCallback(async () => {
    if (autoConnectAttempted.current || isAuthenticated || authState.isConnecting) {
      setIsResolving(false);
      return;
    }
    autoConnectAttempted.current = true;

    try {
      // 1. SSO first: silent reconnect via the signer session.
      try {
        if (await attemptSsoConnect()) {
          onAutoConnectComplete?.(true);
          return;
        }
      } catch (error) {
        console.warn('SSO bootstrap failed, falling back to local session:', error);
      }

      // 2. Legacy fallback: check if a shared session cookie exists. On non-cloistr
      // origins (dev/test) we can't drive the nostrconnect flow, so we report
      // not-connected and let the app show its login UI.
      const session = getSharedSession();
      onAutoConnectComplete?.(false, session?.pubkey);
    } finally {
      // Restore settled (success OR failure) — release the login gate.
      setIsResolving(false);
    }
  }, [isAuthenticated, authState.isConnecting, attemptSsoConnect, onAutoConnectComplete, setIsResolving]);

  /**
   * Attempt auto-connect on mount
   */
  useEffect(() => {
    if (autoConnect === false) {
      setIsResolving(false);
      return;
    }
    // Small delay to let the page settle.
    const timeout = setTimeout(attemptAutoConnect, 100);
    // Safety cap: never hold the login gate longer than 3s even if a restore
    // (e.g. a nostrconnect round-trip) stalls — apps then proceed as logged-out.
    const safety = setTimeout(() => setIsResolving(false), 3000);
    return () => {
      clearTimeout(timeout);
      clearTimeout(safety);
    };
  }, [autoConnect, attemptAutoConnect, setIsResolving]);

  /**
   * Context value for shared session utilities
   */
  const pinValue = useMemo(() => ({
    pinnedPubkey: pin.pinnedPubkey,
    setPinnedPubkey: pin.setPinnedPubkey,
    clearPin: pin.clearPin,
  }), [pin.pinnedPubkey, pin.setPinnedPubkey, pin.clearPin]);

  const sharedSessionValue: SharedSessionContextValue = {
    hasSharedSession: hasSharedSession(),
    getSharedSession,
    isCloistrDomain: isCloistrDomain(),
    isResolving,
    pin: pinValue,
  };

  // Central login-race guard: while the silent SSO restore is still running on
  // a cloistr.xyz origin (and we're not already authenticated), hold the app's
  // first render so it can't redirect to /login before the session resolves.
  // Bounded by the 3s safety cap above; a no-op off-cloistr or once resolved.
  const gateRestore = isResolving && !isAuthenticated && isCloistrDomain();

  return (
    <SharedSessionContext.Provider value={sharedSessionValue}>
      {gateRestore ? (
        // Shared "signing you in" view shown while the silent SSO restore runs
        // (bounded by the 3s cap). Gives every SharedAuthProvider app a single,
        // consistent login-in-progress affordance instead of a blank flash or a
        // raw nostrconnect modal. Themed via design tokens so it follows
        // light/dark automatically.
        <div
          aria-busy="true"
          role="status"
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem',
            background: 'var(--cloistr-bg)',
          }}
        >
          <Spinner size="xl" label="Signing you in" />
          <p
            style={{
              color: 'var(--cloistr-text-muted)',
              fontSize: '0.95rem',
              margin: 0,
            }}
          >
            Signing you in…
          </p>
        </div>
      ) : (
        children
      )}
    </SharedSessionContext.Provider>
  );
}

/**
 * SharedAuthProvider component
 *
 * Drop-in replacement for AuthProvider that adds cross-subdomain session sync.
 * Use this instead of AuthProvider directly to enable single sign-on.
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <SharedAuthProvider>
 *       <YourApp />
 *     </SharedAuthProvider>
 *   );
 * }
 * ```
 */
export function SharedAuthProvider({
  children,
  autoConnect = true,
  onAutoConnectComplete,
  signerUrl,
}: SharedAuthProviderProps) {
  // resolveSigner is built inside SessionSyncInner (needs connectViaNostrConnect
  // from the auth context). We hoist it into a stable ref so AuthProvider receives
  // a stable function reference while still calling the current closure.
  const resolveSignerRef = useRef<((identity: KeyIdentity) => Promise<SignerInterface>) | undefined>(undefined);

  const resolveSignerProp = useCallback(
    (identity: KeyIdentity): Promise<SignerInterface> => {
      if (!resolveSignerRef.current) {
        return Promise.reject(new Error('resolveSigner not yet initialized'));
      }
      return resolveSignerRef.current(identity);
    },
    [],
  );

  // autoRestore is intentionally FALSE: SessionSyncInner owns the single
  // restore path (SSO-first, then legacy localStorage). Leaving the inner
  // @cloistr/auth autoRestore on would race a second connectNip07() → the
  // extension re-prompt bug the unified-auth work is fixing.
  return (
    <AuthProvider autoRestore={false} resolveSigner={resolveSignerProp}>
      <SessionSyncInner
        autoConnect={autoConnect}
        onAutoConnectComplete={onAutoConnectComplete}
        signerUrl={signerUrl}
        resolveSignerRef={resolveSignerRef}
      >
        {children}
      </SessionSyncInner>
    </AuthProvider>
  );
}
