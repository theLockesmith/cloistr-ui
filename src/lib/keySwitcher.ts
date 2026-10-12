/**
 * useKeySwitcherBootstrap — shared key-switcher runtime.
 *
 * Encapsulates ALL multi-identity logic that previously lived exclusively in
 * SharedAuthProvider.  Both SharedAuthProvider and BackendAuthProvider import
 * this hook so JWT apps get an identical key-list, active-key cookie sync, and
 * cross-tab propagation without duplicating the implementation.
 *
 * Contract: must be called INSIDE an @cloistr/auth AuthProvider tree (it uses
 * useNostrAuth() internally).
 *
 * Returns:
 *   - mintSignerForKey   – low-level primitive; exposed so callers can drive the
 *                          bootstrap signer mint without re-entering the hook.
 *   - resolveSigner      – stable callback for AuthProvider's resolveSigner prop.
 *   - bootstrapKeys      – async function; runs GET /api/v1/keys → setKeys →
 *                          pick active → mintSignerForKey → registerKey.
 *                          Returns true on success, false on failure; THROWS
 *                          a key_locked error so the caller can act on it.
 *   - isResolving        – true while the on-load SSO restore is in flight.
 *   - setIsResolving     – let callers release the gate on their own schedule.
 *   - pin                – per-tab pin utilities (pinnedPubkey, setPinnedPubkey,
 *                          clearPin). Same shape as SharedSessionContextValue.pin.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNostrAuth, connectNip07, isNip07Supported } from '../auth/index.js';
import type { KeyIdentity, SignerInterface } from '../auth/index.js';
import { startNostrConnect } from '@cloistr/auth';
import type { NostrConnectSession } from '@cloistr/auth';
import { wrapSignerWithReauth, probeSignerApi, isKeyLockedError, cloistrKeyIdFor, KEY_LOCKED } from './signerReauth.js';
import {
  getActivePubkeyCookie,
  setActivePubkeyCookie,
  isCloistrDomain,
} from './session.js';

/**
 * The signer refuses a nostrconnect session with this code when the user's key
 * is not unlocked on any replica. A locked key and an unreachable relay are
 * different problems with different remedies, and the whole point of the code
 * is that a browser cannot tell them apart otherwise. Defined in signerReauth,
 * which acts on it; exported here too for existing importers.
 */
export { KEY_LOCKED };

/** Shape returned by the GET /api/v1/keys endpoint */
export interface SignerKey {
  id: string;
  pubkey?: string;
  name?: string;
  is_primary?: boolean;
}

/** Per-tab pin surface (same shape as SharedSessionContextValue.pin) */
export interface PinState {
  pinnedPubkey: string | null;
  setPinnedPubkey: (pubkey: string) => void;
  clearPin: () => void;
}

export interface KeySwitcherBootstrap {
  /** Low-level: mint a NIP-46 signer for a specific key_id via nostrconnect/session */
  mintSignerForKey: (keyId: string, pubkey: string) => Promise<SignerInterface>;
  /** Stable callback passed to AuthProvider.resolveSigner */
  resolveSigner: (identity: KeyIdentity) => Promise<SignerInterface>;
  /**
   * Bootstrap: GET /api/v1/keys → setKeys → pick active (cookie or first) →
   * mintSignerForKey → registerKey(active, signer, {activate:true}).
   * Returns true on success, false if keys list is empty or minting fails.
   * Only runs on cloistr.xyz origins (parent-domain cookie required).
   */
  bootstrapKeys: () => Promise<boolean>;
  /** True while the on-load SSO restore is in flight */
  isResolving: boolean;
  /** Release the gate explicitly (callers set false on success or final failure) */
  setIsResolving: (v: boolean) => void;
  /** Per-tab pin utilities */
  pin: PinState;
  /**
   * Attach deploy recovery to a signer this hook did not mint (one opened
   * through the sign-in form). Resolves null when the key is not in the
   * user's Cloistr signer account (their own bunker): leave that alone.
   */
  adoptSignerForReauth: (signer: SignerInterface, pubkey: string) => Promise<SignerInterface | null>;
}

const PIN_KEY = 'cloistr:auth:pinnedPubkey';

export interface KeySwitcherOptions {
  /**
   * Ask the user to sign in again; resolves once they have, rejects if they
   * decline. When given, every signer this hook mints is wrapped so a locked
   * key (after a signer deploy) is recovered instead of hanging. See
   * signerReauth.ts for the rule.
   */
  requestReauth?: () => Promise<void>;
}

export function useKeySwitcherBootstrap(
  signerUrl: string,
  initiallyResolving = true,
  options: KeySwitcherOptions = {},
): KeySwitcherBootstrap {
  const requestReauthRef = useRef(options.requestReauth);
  requestReauthRef.current = options.requestReauth;

  const { connectViaNostrConnect, setKeys, registerKey, setActiveKey, authState } =
    useNostrAuth();

  const [isResolving, setIsResolving] = useState(initiallyResolving);

  // --- per-tab pin ---

  const [pinnedPubkey, setPinnedPubkeyState] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(PIN_KEY);
    } catch {
      return null;
    }
  });

  const getPinnedPubkey = useCallback((): string | null => {
    try {
      return sessionStorage.getItem(PIN_KEY);
    } catch {
      return null;
    }
  }, []);

  const setPinnedPubkeyFn = useCallback(
    (pubkey: string) => {
      try {
        sessionStorage.setItem(PIN_KEY, pubkey);
      } catch {
        /* noop */
      }
      setPinnedPubkeyState(pubkey);
      void setActiveKey(pubkey);
    },
    [setActiveKey],
  );

  const clearPinFn = useCallback(() => {
    try {
      sessionStorage.removeItem(PIN_KEY);
    } catch {
      /* noop */
    }
    setPinnedPubkeyState(null);
  }, []);

  // --- mintSignerForKey ---

  const rawMintSignerForKey = useCallback(
    async (keyId: string, _pubkey: string, detached = false): Promise<SignerInterface> => {
      return new Promise<SignerInterface>((resolve, reject) => {
        let ncSessionRef: NostrConnectSession | null = null;
        // connectViaNostrConnect settles AFTER `approved` (it fetches the
        // pubkey first) and then installs the RAW signer as the context's
        // signer. Resolving on `approved` alone let that land after our caller
        // registered its own (wrapped) signer, silently replacing it. Measured
        // live 2026-10-12: the re-sign-in wrapper was never on the signing
        // path. So hand the signer over only once connect has fully settled.
        let connectDone: Promise<unknown> = Promise.resolve();

        const onUri = async (uri: string, ncSession: NostrConnectSession) => {
          ncSessionRef = ncSession;
          try {
            // WAIT UNTIL WE ARE LISTENING BEFORE ASKING THE SIGNER TO APPROVE.
            //
            // The POST below tells the signer to approve, and it publishes the
            // ack immediately. Kind 24133 is in the ephemeral range
            // (20000-29999), which relays do NOT store — so an ack published
            // before our REQ is on the wire is lost permanently and `approved`
            // just waits out its 30s timeout. No signer, no JWT exchange, and
            // the app shows a sign-in screen to someone holding a valid
            // session.
            //
            // Measured in production before this: POST /nostrconnect/session
            // returned 200 and the relay sockets were open on EVERY attempt,
            // yet 2 of 4 loads never reached /auth/challenge at all.
            // Optional-chained on purpose: @cloistr/auth gains `subscribed` in
            // the release that adds it, and this package must keep building
            // against the currently-published version. On an older auth this
            // is a no-op and behaviour is exactly as before; once the bump
            // lands the wait takes effect. Avoids a lockstep release.
            await (ncSession as NostrConnectSession & { subscribed?: Promise<void> })
              .subscribed;

            const sessionRes = await fetch(
              `${signerUrl}/api/v1/nostrconnect/session`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ uri, key_id: keyId }),
              },
            );
            if (!sessionRes.ok) {
              ncSession.cancel();
              // 409 key_locked is NOT a failure to reach the signer. Every key
              // is user-held, so it lives only in the memory of the replica
              // that handled that user's login; after a pod restart, or a
              // request that lands elsewhere, the key genuinely needs the
              // user's passphrase again.
              //
              // Before the signer returned this code, that case answered 200
              // and then published no ack, so the browser waited out a 30s
              // timeout and reported "Could not reach your signer" about a
              // signer that was healthy — then pushed the user toward a NIP-07
              // extension login they did not need. Carry the code so callers
              // can ask for the password instead of blaming the network.
              let code: string | undefined;
              try {
                code = ((await sessionRes.json()) as { code?: string }).code;
              } catch {
                // Body was not JSON; fall through to the status-only error.
              }
              const err = new Error(
                code === KEY_LOCKED
                  ? 'KEY_LOCKED: your signing key is locked; sign in with your password to unlock it'
                  : `nostrconnect/session failed: ${sessionRes.status}`,
              );
              (err as Error & { code?: string }).code = code;
              reject(err);
              return;
            }
            const body = (await sessionRes.json()) as {
              success?: boolean;
              consent_required?: boolean;
            };
            if (body.consent_required || !body.success) {
              ncSession.cancel();
              reject(new Error('consent_required or not success'));
              return;
            }
            ncSession.approved
              .then(async (signer) => {
                await connectDone;
                resolve(signer);
              })
              .catch(reject);
          } catch (err) {
            ncSession.cancel();
            reject(err);
          }
        };

        // DETACHED: open the session without the auth context. A re-mint
        // replaces the session UNDER the wrapper the app already signs
        // through, so it must not touch app-wide state. Going through
        // connectViaNostrConnect did: its failure path (the silent retry
        // answering key_locked) clears the context's signer, which signs the
        // app out, and the next attempt then raised the full-screen "signing
        // you in" gate and UNMOUNTED THE APP, losing whatever was open.
        // Measured live 2026-10-12 after a real signer restart.
        const start = detached
          ? async (_params: undefined, cb: typeof onUri) => {
              const session = startNostrConnect();
              await cb(session.uri, session);
              await session.approved;
            }
          : connectViaNostrConnect;
        connectDone = start(undefined, onUri).catch((err) => {
          if (!ncSessionRef) reject(err);
        });
      });
    },
    [signerUrl, connectViaNostrConnect],
  );

  const wrapForKey = useCallback(
    (signer: SignerInterface, keyId: string, pubkey: string): SignerInterface =>
      wrapSignerWithReauth(signer, {
        probe: () => probeSignerApi(signerUrl),
        // Detached: the wrapper stays the context's signer throughout and
        // swaps its inner session; the app's sign-in state never changes.
        remint: () => rawMintSignerForKey(keyId, pubkey, true),
        requestReauth: () =>
          requestReauthRef.current
            ? requestReauthRef.current()
            : Promise.reject(new Error('re-sign-in unavailable')),
      }),
    [signerUrl, rawMintSignerForKey],
  );

  const mintSignerForKey = useCallback(
    async (keyId: string, pubkey: string): Promise<SignerInterface> => {
      const signer = await rawMintSignerForKey(keyId, pubkey);
      if (!requestReauthRef.current) return signer;
      return wrapForKey(signer, keyId, pubkey);
    },
    [rawMintSignerForKey, wrapForKey],
  );

  const adoptSignerForReauth = useCallback(
    async (signer: SignerInterface, pubkey: string): Promise<SignerInterface | null> => {
      if (!requestReauthRef.current) return null;
      try {
        const res = await fetch(`${signerUrl}/api/v1/keys`, { credentials: 'include' });
        if (!res.ok) return null;
        const body = (await res.json()) as unknown;
        const keys = Array.isArray(body) ? (body as SignerKey[]) : (((body as { keys?: SignerKey[] }).keys) ?? []);
        const keyId = cloistrKeyIdFor(keys, pubkey);
        return keyId ? wrapForKey(signer, keyId, pubkey) : null;
      } catch {
        return null;
      }
    },
    [signerUrl, wrapForKey],
  );

  // --- resolveSigner ---

  const resolveSigner = useCallback(
    async (identity: KeyIdentity): Promise<SignerInterface> => {
      // NIP-07: the extension IS the signer — we do NOT control the key and
      // CANNOT mint a nostrconnect signer for it. Return a fresh extension signer
      // (window.nostr) so setActiveKey(nip07Pubkey) works without crashing.
      if (identity.method === 'nip07') {
        if (!isNip07Supported()) {
          throw new Error('NIP-07 browser extension not available');
        }
        return connectNip07();
      }
      const keyId = identity.pubkey.slice(0, 16);
      return mintSignerForKey(keyId, identity.pubkey);
    },
    [mintSignerForKey],
  );

  // --- bootstrapKeys ---

  const bootstrapKeys = useCallback(async (): Promise<boolean> => {
    // bootstrapKeys drives the signer's nostrconnect/session mint path.
    // It MUST NOT run for NIP-07 sessions: the extension holds the key
    // non-custodially and there is no signer-session cookie to authenticate
    // with. The caller (SharedAuthProvider / BackendAuthProvider) is
    // responsible for detecting the NIP-07 case and calling connectNip07()
    // instead (see attemptAutoConnect / initAuth in those providers).
    if (!isCloistrDomain()) return false;

    let signerKeys: SignerKey[] = [];
    try {
      const keysRes = await fetch(`${signerUrl}/api/v1/keys`, {
        credentials: 'include',
      });
      if (keysRes.ok) {
        const keysBody = (await keysRes.json()) as unknown;
        signerKeys = Array.isArray(keysBody)
          ? (keysBody as SignerKey[])
          : (((keysBody as { keys?: SignerKey[] }).keys) ?? []);
      }
    } catch {
      return false;
    }

    if (signerKeys.length === 0) return false;

    const allIdentities: KeyIdentity[] = signerKeys.map((k) => ({
      pubkey: k.pubkey ?? k.id,
      method: 'nip46' as const,
      name: k.name,
    }));
    setKeys(allIdentities);

    const cookieActive = getActivePubkeyCookie();
    // Prefer the key the user explicitly set as primary; fall back to the
    // first key only for legacy accounts that pre-date the is_primary field.
    const primarySignerKey = signerKeys.find((k) => k.is_primary) ?? signerKeys[0];
    const primaryPubkey = primarySignerKey.pubkey ?? primarySignerKey.id;
    const activeIdentity =
      (cookieActive != null &&
        allIdentities.find((i) => i.pubkey === cookieActive)) ||
      allIdentities.find((i) => i.pubkey === primaryPubkey) ||
      allIdentities[0];

    if (!activeIdentity) return false;

    const activeSignerKey = signerKeys.find(
      (k) => (k.pubkey ?? k.id) === activeIdentity.pubkey,
    );
    const keyId = activeSignerKey?.id ?? activeIdentity.pubkey.slice(0, 16);

    try {
      const signer = await mintSignerForKey(keyId, activeIdentity.pubkey);
      registerKey(activeIdentity, signer, { activate: true });
      return true;
    } catch (err) {
      // A locked key is not a connection failure: no retry of the same
      // request can fix it, so carry it to the caller, which decides whether
      // to ask the user to sign in again (SharedAuthProvider).
      if (isKeyLockedError(err)) throw err;
      return false;
    }
  }, [signerUrl, setKeys, registerKey, mintSignerForKey]);

  // --- active-key cookie write ---

  useEffect(() => {
    if (authState.activePubkey && !getPinnedPubkey()) {
      setActivePubkeyCookie(authState.activePubkey);
    }
  }, [authState.activePubkey, getPinnedPubkey]);

  // --- cross-tab propagation ---

  useEffect(() => {
    const checkCookieSwitch = () => {
      if (getPinnedPubkey()) return;
      const cookiePubkey = getActivePubkeyCookie();
      if (
        cookiePubkey &&
        authState.activePubkey &&
        cookiePubkey !== authState.activePubkey &&
        !authState.isSwitching
      ) {
        // NEVER auto-switch INTO a NIP-07 key.
        //
        // resolveSigner() answers a nip07 identity by calling connectNip07(),
        // which touches window.nostr — and an extension prompts the moment it
        // is touched. This effect runs on a 2s interval, on focus and on
        // storage events, so an active-pubkey cookie naming an extension key
        // made Alby demand authorisation over and over, on a session the user
        // had established with a password somewhere else entirely.
        //
        // Reported as: "it's no longer logging me in with my un/pw and trying
        // to force an alby login despite showing Signing you in securely."
        //
        // An extension is a USER-PRESENT signer. It may only be invoked by
        // explicit intent — the "login with extension" button, or restoring a
        // session whose own method was nip07. Background reconciliation does
        // not qualify, so this leaves the cookie alone and keeps the current
        // key rather than prompting.
        const target = authState.keys?.find(k => k.pubkey === cookiePubkey);
        if (target?.method === 'nip07' && authState.method !== 'nip07') return;

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
  }, [authState.activePubkey, authState.isSwitching, setActiveKey, getPinnedPubkey]);

  // --- per-tab pin restore on first connect ---

  const hasPinRef = useRef(false);
  useEffect(() => {
    if (hasPinRef.current) return;
    if (!authState.isConnected || authState.keys.length === 0) return;

    const pinned = getPinnedPubkey();
    if (!pinned) return;

    const inList = authState.keys.some((k) => k.pubkey === pinned);
    if (!inList) {
      try {
        sessionStorage.removeItem(PIN_KEY);
      } catch {
        /* noop */
      }
      return;
    }

    hasPinRef.current = true;
    if (pinned !== authState.activePubkey) {
      void setActiveKey(pinned);
    }
  }, [
    authState.isConnected,
    authState.keys,
    authState.activePubkey,
    getPinnedPubkey,
    setActiveKey,
  ]);

  return {
    mintSignerForKey,
    adoptSignerForReauth,
    resolveSigner,
    bootstrapKeys,
    isResolving,
    setIsResolving,
    pin: {
      pinnedPubkey,
      setPinnedPubkey: setPinnedPubkeyFn,
      clearPin: clearPinFn,
    },
  };
}
