import { useEffect, useReducer, useRef } from 'react';
import { useNostrAuth } from '../auth/index.js';

export interface WriteGateStatus {
  status: 'idle' | 'loading' | 'loaded' | 'failed';
  loadedPubkey: string | null;
  loadingPubkey: string | null;
  error: Error | null;
}

type WriteGateAction =
  | { type: 'pubkey-changed'; pubkey: string | null }
  | { type: 'load-succeeded'; pubkey: string }
  | { type: 'load-failed'; pubkey: string; error: Error };

export function createWriteGateState(): WriteGateStatus {
  return { status: 'idle', loadedPubkey: null, loadingPubkey: null, error: null };
}

/**
 * Pure state machine for the write gate. Transitions:
 *
 *  idle --[pubkey arrives]--> loading
 *  loading --[load-succeeded for same pubkey]--> loaded
 *  loading --[load-failed for same pubkey]--> failed
 *  loaded --[pubkey changes]--> loading (resets)
 *  any --[pubkey goes null]--> idle
 *  loaded --[same pubkey arrives]--> loaded (no-op)
 */
export function writeGateTransition(
  state: WriteGateStatus,
  action: WriteGateAction,
): WriteGateStatus {
  switch (action.type) {
    case 'pubkey-changed': {
      if (!action.pubkey) {
        return createWriteGateState();
      }
      if (state.loadedPubkey === action.pubkey && state.status === 'loaded') {
        return state;
      }
      return {
        status: 'loading',
        loadedPubkey: null,
        loadingPubkey: action.pubkey,
        error: null,
      };
    }
    case 'load-succeeded': {
      if (state.loadingPubkey !== action.pubkey) return state;
      return {
        status: 'loaded',
        loadedPubkey: action.pubkey,
        loadingPubkey: null,
        error: null,
      };
    }
    case 'load-failed': {
      if (state.loadingPubkey !== action.pubkey) return state;
      return {
        status: 'failed',
        loadedPubkey: null,
        loadingPubkey: null,
        error: action.error,
      };
    }
  }
}

export interface WriteGate {
  loading: boolean;
  loaded: boolean;
  failed: boolean;
  error: Error | null;
  pubkey: string | null;
}

/**
 * Blocks writes until the load function succeeds for the current identity.
 * Resets and re-runs whenever activePubkey changes. A timeout or failure is
 * an ERROR state, never "empty data".
 *
 * Must be called inside a SharedAuthProvider or AuthProvider tree.
 *
 * Usage:
 *   const gate = useWriteGate(async (pubkey) => {
 *     await loadRelayPrefs(pubkey);
 *   });
 *   // In save handler:
 *   if (!gate.loaded) return; // Block write
 */
export function useWriteGate(
  loadFn: (pubkey: string) => Promise<void>,
): WriteGate {
  const { authState } = useNostrAuth();
  const [state, dispatch] = useReducer(writeGateTransition, undefined, createWriteGateState);
  const loadFnRef = useRef(loadFn);
  loadFnRef.current = loadFn;

  useEffect(() => {
    const pubkey = authState.activePubkey;
    dispatch({ type: 'pubkey-changed', pubkey });

    if (!pubkey) return;

    let cancelled = false;
    loadFnRef.current(pubkey)
      .then(() => {
        if (!cancelled) dispatch({ type: 'load-succeeded', pubkey });
      })
      .catch((err) => {
        if (!cancelled) dispatch({ type: 'load-failed', pubkey, error: err instanceof Error ? err : new Error(String(err)) });
      });

    return () => { cancelled = true; };
  }, [authState.activePubkey]);

  return {
    loading: state.status === 'loading',
    loaded: state.status === 'loaded',
    failed: state.status === 'failed',
    error: state.error,
    pubkey: state.loadedPubkey,
  };
}
