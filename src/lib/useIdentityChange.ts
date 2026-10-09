import { useEffect, useRef } from 'react';
import { useNostrAuth } from '../auth/index.js';
import type { AuthMethod } from '../auth/index.js';

export interface IdentityChangeEvent {
  pubkey: string;
  previousPubkey: string | null;
  method: AuthMethod | null;
}

interface IdentitySnapshot {
  pubkey: string | null;
  method: AuthMethod | null;
}

/**
 * Pure logic: should we fire an identity-change event given prev and current?
 * Returns the event to fire, or null if no change.
 */
export function shouldFireIdentityChange(
  prev: IdentitySnapshot,
  current: IdentitySnapshot,
): IdentityChangeEvent | null {
  if (!current.pubkey) return null;
  if (prev.pubkey === current.pubkey && prev.method === current.method) return null;
  return {
    pubkey: current.pubkey,
    previousPubkey: prev.pubkey,
    method: current.method,
  };
}

/**
 * Fires the callback on every identity change: sign-in, key switch,
 * cross-tab sync, SSO restore, or pin restore. Does NOT fire on sign-out
 * (pubkey goes null) or when nothing changed.
 *
 * Must be called inside a SharedAuthProvider or AuthProvider tree.
 */
export function useIdentityChange(
  callback: (event: IdentityChangeEvent) => void,
): void {
  const { authState } = useNostrAuth();
  const prevRef = useRef<IdentitySnapshot>({ pubkey: null, method: null });
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const current: IdentitySnapshot = {
      pubkey: authState.activePubkey,
      method: authState.method,
    };
    const event = shouldFireIdentityChange(prevRef.current, current);
    prevRef.current = current;
    if (event) callbackRef.current(event);
  }, [authState.activePubkey, authState.method]);
}
