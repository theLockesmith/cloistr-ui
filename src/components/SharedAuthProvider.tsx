/**
 * SharedAuthProvider - Cross-subdomain authentication provider
 *
 * Wraps the collab-common AuthProvider and adds cross-domain session sync.
 * Enables single sign-on across all *.cloistr.xyz services.
 *
 * Multi-identity: on load, fetches all keys from the signer, calls setKeys(),
 * mints a signer for the active key, and passes resolveSigner so setActiveKey()
 * can mint signers for non-active keys on demand.
 */

import { useEffect, useState, useCallback, useRef, createContext, useContext, ReactNode } from 'react';
import {
  AuthProvider,
  useNostrAuth,
  useAuthHelpers,
} from '../auth/index.js';
import type { KeyIdentity, SignerInterface } from '../auth/index.js';
import type { NostrConnectSession } from '@cloistr/auth';
import {
  getSharedSession,
  saveSharedSession,
  clearSharedSession,
  hasSharedSession,
  isCloistrDomain,
  getActivePubkeyCookie,
  setActivePubkeyCookie,
  type SharedSession,
} from '../lib/session.js';
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
}

const SharedSessionContext = createContext<SharedSessionContextValue | null>(null);

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
 * Signer-API key shape returned by GET /api/v1/keys
 */
interface SignerKey {
  id: string;
  pubkey?: string;
  name?: string;
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
  const { authState, connectViaNostrConnect, setKeys, registerKey, setActiveKey } = useNostrAuth();
  const { isAuthenticated } = useAuthHelpers();
  const autoConnectAttempted = useRef(false);
  const prevConnectedRef = useRef(authState.isConnected);
  // True while the on-load SSO restore runs; apps gate their login redirect on it.
  const [isResolving, setIsResolving] = useState(autoConnect !== false);

  /**
   * Mint a signer for a specific key_id + pubkey via the nostrconnect/session flow.
   *
   * The onUri callback POSTs the nostrconnect URI to the signer's session endpoint
   * for auto-approval. If the signer returns consent_required or an error, we cancel
   * so the returned promise rejects (callers handle that gracefully).
   *
   * Used by:
   *   - attemptSsoConnect (bootstrap): mint the active key's signer on load.
   *   - resolveSigner (on-demand): mint a signer for any key on setActiveKey().
   */
  const mintSignerForKey = useCallback(async (
    keyId: string,
    _pubkey: string,
  ): Promise<SignerInterface> => {
    return new Promise<SignerInterface>((resolve, reject) => {
      let ncSessionRef: NostrConnectSession | null = null;

      const onUri = async (uri: string, ncSession: NostrConnectSession) => {
        ncSessionRef = ncSession;
        try {
          const sessionRes = await fetch(`${signerUrl}/api/v1/nostrconnect/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ uri, key_id: keyId }),
          });
          if (!sessionRes.ok) {
            ncSession.cancel();
            reject(new Error(`nostrconnect/session failed: ${sessionRes.status}`));
            return;
          }
          const body = (await sessionRes.json()) as { success?: boolean; consent_required?: boolean };
          if (body.consent_required || !body.success) {
            ncSession.cancel();
            reject(new Error('consent_required or not success'));
            return;
          }
          // success: let approved resolve and hand the ready signer to caller
          ncSession.approved.then(resolve).catch(reject);
        } catch (err) {
          ncSession.cancel();
          reject(err);
        }
      };

      connectViaNostrConnect(undefined, onUri).catch((err) => {
        // Only reject if onUri was never called (connectViaNostrConnect itself threw)
        if (!ncSessionRef) reject(err);
      });
    });
  }, [signerUrl, connectViaNostrConnect]);

  /**
   * resolveSigner: injected into AuthProvider so setActiveKey() can mint a signer
   * for any known key on demand (when no cached signer exists for that pubkey).
   */
  const resolveSigner = useCallback(async (identity: KeyIdentity): Promise<SignerInterface> => {
    const keyId = identity.pubkey.slice(0, 16);
    return mintSignerForKey(keyId, identity.pubkey);
  }, [mintSignerForKey]);

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
   * Persist activePubkey to cookie whenever it changes so other tabs can follow
   */
  useEffect(() => {
    if (authState.activePubkey) {
      setActivePubkeyCookie(authState.activePubkey);
    }
  }, [authState.activePubkey]);

  /**
   * Cross-tab key-switch propagation.
   *
   * Poll the activePubkey cookie every 2s, and also on window focus + storage
   * events. When another tab calls setActiveKey(), the cookie changes; we call
   * setActiveKey here so this tab picks up the switch without a reload.
   */
  useEffect(() => {
    const checkCookieSwitch = () => {
      const cookiePubkey = getActivePubkeyCookie();
      if (
        cookiePubkey &&
        authState.activePubkey &&
        cookiePubkey !== authState.activePubkey &&
        !authState.isSwitching
      ) {
        void setActiveKey(cookiePubkey);
      }
    };

    const interval = setInterval(checkCookieSwitch, 2000);
    window.addEventListener('focus', checkCookieSwitch);
    window.addEventListener('storage', checkCookieSwitch);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', checkCookieSwitch);
      window.removeEventListener('storage', checkCookieSwitch);
    };
  }, [authState.activePubkey, authState.isSwitching, setActiveKey]);

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
   *
   * Multi-identity flow:
   *  1. GET /api/v1/keys → full list. Map all to KeyIdentity; call setKeys(all).
   *  2. Determine active key: activePubkey cookie (if still in list) else keys[0].
   *  3. Mint signer for active key via mintSignerForKey; registerKey(active, signer, {activate:true}).
   *  4. Return true (connected). Return false on 401/empty/mint failure → legacy path.
   *
   * Only runs on cloistr.xyz origins (parent-domain cookie required).
   */
  const attemptSsoConnect = useCallback(async (): Promise<boolean> => {
    if (!isCloistrDomain()) return false;

    let signerKeys: SignerKey[] = [];
    try {
      const keysRes = await fetch(`${signerUrl}/api/v1/keys`, { credentials: 'include' });
      if (keysRes.ok) {
        const keysBody = (await keysRes.json()) as unknown;
        signerKeys = Array.isArray(keysBody)
          ? (keysBody as SignerKey[])
          : (((keysBody as { keys?: SignerKey[] }).keys) ?? []);
      }
      // 401 / empty → no signer session
    } catch {
      return false;
    }

    if (signerKeys.length === 0) return false;

    // Build the full KeyIdentity list and populate the context
    const allIdentities: KeyIdentity[] = signerKeys.map((k) => ({
      pubkey: k.pubkey ?? k.id,
      method: 'nip46' as const,
      name: k.name,
    }));
    setKeys(allIdentities);

    // Determine active key: cookie value if present in list, else first key
    const cookieActive = getActivePubkeyCookie();
    const activeIdentity =
      (cookieActive != null && allIdentities.find((i) => i.pubkey === cookieActive)) ||
      allIdentities[0];

    if (!activeIdentity) return false;

    // Resolve the signer-API key_id (the signer's internal identifier for the key)
    const activeSignerKey = signerKeys.find(
      (k) => (k.pubkey ?? k.id) === activeIdentity.pubkey,
    );
    const keyId = activeSignerKey?.id ?? activeIdentity.pubkey.slice(0, 16);

    try {
      const signer = await mintSignerForKey(keyId, activeIdentity.pubkey);
      registerKey(activeIdentity, signer, { activate: true });
      return true;
    } catch {
      // consent_required or network failure; fall back
      return false;
    }
  }, [signerUrl, setKeys, registerKey, mintSignerForKey]);

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
  }, [isAuthenticated, authState.isConnecting, attemptSsoConnect, onAutoConnectComplete]);

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
  }, [autoConnect, attemptAutoConnect]);

  /**
   * Context value for shared session utilities
   */
  const sharedSessionValue: SharedSessionContextValue = {
    hasSharedSession: hasSharedSession(),
    getSharedSession,
    isCloistrDomain: isCloistrDomain(),
    isResolving,
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
