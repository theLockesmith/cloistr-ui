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

import { withSignerRetry } from '../lib/signerRetry.js';
import { useEffect, useCallback, useRef, createContext, useContext, useMemo, ReactNode, useState} from 'react';
import {
  AuthProvider,
  useNostrAuth,
  useAuthHelpers,
  isNip07Supported,
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
import { useRelayReconnect } from '../lib/useRelayReconnect.js';
import { AuthRestoreGate } from './AuthRestoreGate.js';

/**
 * Backstop for a genuinely hung SSO restore.
 *
 * DERIVED, not picked. The NIP-46 restore is TWO sequential relay handshakes:
 * bootstrapKeys → startNostrConnect waits up to CONNECT_TIMEOUT_MS (10s), and
 * the ack then triggers a second connectNip46 round-trip with the same ceiling.
 * The real worst case is therefore ~20s before anything has gone wrong.
 *
 * This was 12000, which is BELOW that ceiling — so on a slow or mobile network
 * the backstop fired mid-handshake and flipped the app to logged-out while a
 * perfectly valid session was still resolving. The comment beside it already
 * said the cap "must sit ABOVE the NIP-46 relay handshake ceiling"; the value
 * simply did not honour it.
 *
 * Measured on stash: "Connecting to your account…" at 8s and 16s, then the
 * signed-out landing page at 26s, on a valid session. Reported as logins not
 * persisting and as apps refusing a session established elsewhere.
 *
 * 30s = the 20s handshake ceiling plus margin, and matches @cloistr/auth's
 * BASE_TIMEOUT_MS for a NIP-46 request. The happy path never waits this long:
 * attemptAutoConnect's finally releases the gate as soon as bootstrapKeys
 * settles, success or failure. This only bounds a hang.
 */
const SSO_SAFETY_CAP_MS = 30000;

/**
 * The one decision that keeps being got wrong: is the user LOGGED OUT, or is
 * their signer merely UNREACHABLE?
 *
 * "session" = who you are (the shared .cloistr.xyz cookie). Only a genuine
 * expiry justifies asking for credentials.
 * "signer reachability" = can we reach their bunker over relays right now.
 * That is transient and must be retried, then surfaced as "try again".
 *
 * Conflating them is what let a relay hiccup render a login prompt over a
 * perfectly valid session — which to a non-technical user reads as "this app
 * randomly logs me out", and is fatal for a product holding their mail.
 *
 * Pure and exported so the rule is pinned by test rather than living inside a
 * component nobody can assert on.
 */
export type RestoreOutcome = 'connected' | 'signer-unreachable' | 'logged-out';

export function classifyRestoreOutcome(opts: {
  connected: boolean;
  hasSession: boolean;
}): RestoreOutcome {
  if (opts.connected) return 'connected';
  // A session we could not use is NOT a logged-out session.
  return opts.hasSession ? 'signer-unreachable' : 'logged-out';
}

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
   * The session is VALID but the signer could not be reached, after bounded
   * retries. Apps MUST render the recovery screen for this, never a login
   * prompt: session validity and signer reachability are different things, and
   * conflating them is what made a relay hiccup look like "this app randomly
   * logged me out".
   */
  signerUnreachable: boolean;
  /** Retry the signer connect. Backs the recovery screen's "Try again". */
  retrySignerConnect: () => Promise<boolean>;
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
  const { authState, connectNip07: connectNip07Ctx } = useNostrAuth();
  const { isAuthenticated } = useAuthHelpers();
  const autoConnectAttempted = useRef(false);
  const prevConnectedRef = useRef(authState.isConnected);

  // Part 4 of the signer-resilience design: reconnect relay WebSockets when
  // the page regains visibility (phone app-switcher, file picker, screen lock)
  // or the network comes back online — before the user next acts. Apps using
  // SharedAuthProvider get this automatically with no extra mount required.
  useRelayReconnect();

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
    // Bounded retry with backoff and full jitter. A NIP-46 connect failing once
    // is almost always transient — a relay socket that died while the phone was
    // backgrounded — and the previous code gave up after ONE attempt and handed
    // the app a "not connected", which rendered a login prompt over a perfectly
    // valid session.
    //
    // ~3 attempts inside the safety cap, so the user reaches a decision in a few
    // seconds instead of staring at a spinner for 30.
    return withSignerRetry(async () => {
      const ok = await bootstrapKeys();
      // bootstrapKeys resolves false rather than throwing; turn that into a
      // throw so the retry policy can see it as a retryable failure.
      if (!ok) throw new Error('CONNECTION_FAILED: signer bootstrap returned false');
      return ok;
    }, { attempts: 3, baseDelayMs: 600, maxDelayMs: 2500 });
  }, [bootstrapKeys]);

  const [signerUnreachable, setSignerUnreachable] = useState(false);

  const retrySignerConnect = useCallback(async (): Promise<boolean> => {
    setSignerUnreachable(false);
    try {
      const ok = await attemptSsoConnect();
      if (!ok) setSignerUnreachable(true);
      return ok;
    } catch {
      setSignerUnreachable(true);
      return false;
    }
  }, [attemptSsoConnect]);

  const attemptAutoConnect = useCallback(async () => {
    if (autoConnectAttempted.current || isAuthenticated || authState.isConnecting) {
      setIsResolving(false);
      return;
    }
    autoConnectAttempted.current = true;

    try {
      // Check the shared session cookie first to detect NIP-07 sessions before
      // attempting any signer-session bootstrap.
      const session = getSharedSession();

      // NIP-07: the extension holds the key non-custodially. The signer has no
      // session cookie for this key, so bootstrapKeys() would just return false.
      // Instead, call connectNip07() directly which re-prompts the extension and
      // registers the pubkey into authState. We do NOT try to run a signer fetch.
      if (session?.method === 'nip07' && isNip07Supported()) {
        try {
          await connectNip07Ctx();
          onAutoConnectComplete?.(true);
          return;
        } catch (error) {
          console.warn('NIP-07 session restore failed:', error);
          // Fall through — let app show its login UI.
          onAutoConnectComplete?.(false, session.pubkey);
          return;
        }
      }

      // 1. SSO first: silent reconnect via the signer session (NIP-46 / nostrconnect).
      try {
        if (await attemptSsoConnect()) {
          setSignerUnreachable(false);
          onAutoConnectComplete?.(true);
          return;
        }
      } catch (error) {
        console.warn('SSO bootstrap failed after retries:', error);
        // A shared session cookie means the user IS signed in; we simply could
        // not reach their signer. Surfacing that as "not connected" is what
        // produced a credential prompt over a valid session. Flag it instead so
        // the app renders recovery, and do NOT report a failed auto-connect.
        if (classifyRestoreOutcome({ connected: false, hasSession: !!session }) === 'signer-unreachable') {
          setSignerUnreachable(true);
          return;
        }
      }

      // 2. Legacy fallback: check if a shared session cookie exists. On non-cloistr
      // origins (dev/test) we can't drive the nostrconnect flow, so we report
      // not-connected and let the app show its login UI.
      onAutoConnectComplete?.(false, session?.pubkey);
    } finally {
      // Restore settled (success OR failure) — release the login gate.
      setIsResolving(false);
    }
  }, [isAuthenticated, authState.isConnecting, connectNip07Ctx, attemptSsoConnect, onAutoConnectComplete, setIsResolving]);

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
    // Safety cap: a last-resort backstop for a genuinely hung restore. It must
    // sit ABOVE the NIP-46 relay handshake ceiling (bootstrapKeys →
    // startNostrConnect uses CONNECT_TIMEOUT_MS=10s, and the ack triggers a
    // second connectNip46 round-trip), otherwise it fires mid-handshake and
    // flips the app to logged-out while a valid SSO session is still resolving
    // — the intermittent false-logout seen on cross-subdomain app-switch. The
    // happy path never waits this long: attemptAutoConnect's finally releases
    // the gate the moment bootstrapKeys settles (success or failure).
    const safety = setTimeout(() => setIsResolving(false), SSO_SAFETY_CAP_MS);
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
    signerUnreachable,
    retrySignerConnect,
    pin: pinValue,
  };

  // Central login-race guard: while the silent SSO restore is still running on
  // a cloistr.xyz origin (and we're not already authenticated), hold the app's
  // first render so it can't redirect to /login before the session resolves.
  // Bounded by the 3s safety cap above; a no-op off-cloistr or once resolved.
  //
  // ALSO covers the NIP-46 handshake that follows. isResolving clears when
  // bootstrapKeys settles, but the signer round-trip then runs under
  // isConnecting — and during that window an app seeing only `isConnected:false`
  // renders its sign-in screen. For a user who already has a shared session and
  // is just moving between apps, that reads as being logged out: reported as
  // "I see a bunker URL modal, or nothing, between pages".
  //
  // Gated on hasSharedSession() so this only affects RETURNING users. A first
  // login must NOT be covered — there the person is deliberately on the sign-in
  // screen and LoginModal has its own inline connecting affordance (disabled
  // buttons, "Connecting..."); replacing that with a full-screen spinner would
  // hide the very controls they are interacting with.
  const restoringSession = isResolving && !isAuthenticated && isCloistrDomain();
  const reconnectingKnownSession =
    !!authState.isConnecting && !isAuthenticated && hasSharedSession();
  const gateRestore = restoringSession || reconnectingKnownSession;

  return (
    <SharedSessionContext.Provider value={sharedSessionValue}>
      {gateRestore ? (
        // Shared "signing you in" view shown while the silent SSO restore runs
        // (bounded by the 3s cap). Gives every SharedAuthProvider app a single,
        // consistent login-in-progress affordance instead of a blank flash or a
        // raw nostrconnect modal.
        //
        // Extracted to AuthRestoreGate 2026-08-17 so BackendAuthProvider renders
        // the IDENTICAL view. It previously had no gate at all, which is why
        // mail.cloistr.xyz showed a bare "Loading..." and looked like a
        // different product from the rest of the suite.
        <AuthRestoreGate />
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
