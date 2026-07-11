/**
 * SharedAuthProvider - Cross-subdomain authentication provider
 *
 * Wraps the collab-common AuthProvider and adds cross-domain session sync.
 * Enables single sign-on across all *.cloistr.xyz services.
 */

import { useEffect, useState, useCallback, useRef, createContext, useContext, ReactNode } from 'react';
import {
  AuthProvider,
  useNostrAuth,
  useAuthHelpers,
  isNip07Supported,
} from '../auth/index.js';
import {
  getSharedSession,
  saveSharedSession,
  clearSharedSession,
  hasSharedSession,
  isCloistrDomain,
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
 * Inner component that handles session sync after auth context is available
 */
function SessionSyncManager({
  children,
  autoConnect,
  onAutoConnectComplete,
  signerUrl = 'https://signer.cloistr.xyz',
}: SharedAuthProviderProps) {
  const { authState, connectNip07, connectNip46, connectViaNostrConnect } = useNostrAuth();
  const { isAuthenticated } = useAuthHelpers();
  const autoConnectAttempted = useRef(false);
  const prevConnectedRef = useRef(authState.isConnected);
  // True while the on-load SSO restore runs; apps gate their login redirect on it.
  const [isResolving, setIsResolving] = useState(autoConnect !== false);

  /**
   * Sync successful auth to shared session cookies
   */
  useEffect(() => {
    // Only sync if we just became connected (transition from false to true)
    if (authState.isConnected && !prevConnectedRef.current && authState.pubkey && authState.method) {
      // Get bunker URL from localStorage if NIP-46
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
      // User disconnected - clear shared session
      clearSharedSession();
    }
  }, [authState.isConnected]);

  /**
   * SSO bootstrap: resolve the shared `.cloistr.xyz` signer session on load and
   * silently reconnect. This is the unified-auth slice 1 (see
   * arbiter/cloistr/architecture/unified-auth-design.md §8.3).
   *
   * Precedence:
   *  1. If a signer session exists (`GET /api/v1/keys` rides the parent-domain
   *     cookie), drive an *auto-approved* nostrconnect — real signer, no extension
   *     prompt, works across subdomains even with no per-origin localStorage.
   *  2. Else fall back to the per-origin localStorage shared session (legacy
   *     nip07/nip46 restore).
   *
   * Why this kills the re-prompt: previously TWO restore paths raced — the inner
   * `@cloistr/auth` `autoRestore` AND this manager — both calling `connectNip07()`
   * (which re-prompts on `getPublicKey`). We now disable the inner autoRestore
   * (see SharedAuthProvider below) and prefer the silent SSO path here.
   */

  // Attempt SSO via the signer session. Returns true if it established (or is
  // establishing) a connection; false if there is no usable signer session and
  // the caller should fall back to the legacy localStorage restore.
  const attemptSsoConnect = useCallback(async (): Promise<boolean> => {
    // Cross-origin credentialed probe only makes sense on a cloistr.xyz origin
    // (the parent-domain cookie won't be sent otherwise); dev/other origins fall
    // straight through to the legacy path.
    if (!isCloistrDomain()) return false;

    let sessionKeyId: string | null = null;
    try {
      const keysRes = await fetch(`${signerUrl}/api/v1/keys`, { credentials: 'include' });
      if (keysRes.ok) {
        const keysBody = (await keysRes.json()) as unknown;
        const keys = Array.isArray(keysBody)
          ? keysBody
          : ((keysBody as { keys?: Array<{ id: string }> }).keys ?? []);
        if (keys.length) sessionKeyId = (keys[0] as { id: string }).id;
      }
      // 401 / no keys → no signer session → sessionKeyId stays null.
    } catch {
      // Network/CORS error → treat as no session, fall back to legacy.
      return false;
    }

    if (!sessionKeyId) return false;

    // Active session — drive an auto-approved nostrconnect. The POST happens
    // inside the onUri callback (before we await approval); if the signer needs
    // first-time consent (or the session expired), we cancel the pending connect
    // so it never hangs and never falls through to an extension re-prompt.
    const capturedKeyId = sessionKeyId;
    await connectViaNostrConnect(undefined, async (uri, ncSession) => {
      try {
        const sessionRes = await fetch(`${signerUrl}/api/v1/nostrconnect/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ uri, key_id: capturedKeyId }),
        });
        if (!sessionRes.ok) {
          ncSession.cancel();
          return;
        }
        const body = (await sessionRes.json()) as {
          success?: boolean;
          consent_required?: boolean;
        };
        if (body.consent_required || !body.success) {
          // First-time consent needs the LoginModal UI; don't auto-approve
          // silently. Abort cleanly — the user will see the modal / consent
          // screen on demand rather than an extension prompt.
          ncSession.cancel();
        }
        // body.success → let `approved` resolve; state flips to connected silently.
      } catch {
        ncSession.cancel();
      }
    });
    return true;
  }, [signerUrl, connectViaNostrConnect]);

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

      // 2. Legacy fallback: per-origin localStorage shared session.
      const session = getSharedSession();
      if (!session) {
        onAutoConnectComplete?.(false);
        return;
      }

      try {
        if (session.method === 'nip07' && isNip07Supported()) {
          await connectNip07();
          onAutoConnectComplete?.(true, session.pubkey);
        } else if (session.method === 'nip46' && session.bunkerUrl) {
          await connectNip46({ bunkerUrl: session.bunkerUrl });
          onAutoConnectComplete?.(true, session.pubkey);
        } else {
          // Session exists but can't restore (e.g., NIP-07 extension not installed)
          onAutoConnectComplete?.(false);
        }
      } catch (error) {
        console.warn('Failed to auto-connect from shared session:', error);
        // Don't clear shared session - might work on another page
        onAutoConnectComplete?.(false);
      }
    } finally {
      // Restore settled (success OR failure) — release the login gate.
      setIsResolving(false);
    }
  }, [isAuthenticated, authState.isConnecting, attemptSsoConnect, connectNip07, connectNip46, onAutoConnectComplete]);

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
  // autoRestore is intentionally FALSE: SessionSyncManager owns the single
  // restore path (SSO-first, then legacy localStorage). Leaving the inner
  // @cloistr/auth autoRestore on would race a second connectNip07() → the
  // extension re-prompt bug the unified-auth work is fixing.
  return (
    <AuthProvider autoRestore={false}>
      <SessionSyncManager
        autoConnect={autoConnect}
        onAutoConnectComplete={onAutoConnectComplete}
        signerUrl={signerUrl}
      >
        {children}
      </SessionSyncManager>
    </AuthProvider>
  );
}
