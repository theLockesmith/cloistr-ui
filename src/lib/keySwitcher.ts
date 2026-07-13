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
 *                          Returns true on success, false on failure.
 *   - isResolving        – true while the on-load SSO restore is in flight.
 *   - setIsResolving     – let callers release the gate on their own schedule.
 *   - pin                – per-tab pin utilities (pinnedPubkey, setPinnedPubkey,
 *                          clearPin). Same shape as SharedSessionContextValue.pin.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNostrAuth, connectNip07, isNip07Supported } from '../auth/index.js';
import type { KeyIdentity, SignerInterface } from '../auth/index.js';
import type { NostrConnectSession } from '@cloistr/auth';
import {
  getActivePubkeyCookie,
  setActivePubkeyCookie,
  isCloistrDomain,
} from './session.js';

/** Shape returned by the GET /api/v1/keys endpoint */
export interface SignerKey {
  id: string;
  pubkey?: string;
  name?: string;
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
}

const PIN_KEY = 'cloistr:auth:pinnedPubkey';

export function useKeySwitcherBootstrap(
  signerUrl: string,
  initiallyResolving = true,
): KeySwitcherBootstrap {
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

  const mintSignerForKey = useCallback(
    async (keyId: string, _pubkey: string): Promise<SignerInterface> => {
      return new Promise<SignerInterface>((resolve, reject) => {
        let ncSessionRef: NostrConnectSession | null = null;

        const onUri = async (uri: string, ncSession: NostrConnectSession) => {
          ncSessionRef = ncSession;
          try {
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
              reject(
                new Error(`nostrconnect/session failed: ${sessionRes.status}`),
              );
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
            ncSession.approved.then(resolve).catch(reject);
          } catch (err) {
            ncSession.cancel();
            reject(err);
          }
        };

        connectViaNostrConnect(undefined, onUri).catch((err) => {
          if (!ncSessionRef) reject(err);
        });
      });
    },
    [signerUrl, connectViaNostrConnect],
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
    const activeIdentity =
      (cookieActive != null &&
        allIdentities.find((i) => i.pubkey === cookieActive)) ||
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
    } catch {
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
