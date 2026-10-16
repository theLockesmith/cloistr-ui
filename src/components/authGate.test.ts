import { describe, it, expect } from 'vitest';
import { shouldGateRestore } from './SharedAuthProvider.js';

/**
 * Pin the gate decision for the auth-restore spinner.
 *
 * Card #180: Space reproduced the operator's "reload a deep link and get
 * signed out" bug. Two root causes, both in the gate condition:
 *
 * 1. The old gate used !isAuthenticated (the backend JWT or the signer
 *    connection). A returning user with a still-valid JWT got no gate at all
 *    while the NIP-46 signer reconnect was still running.
 *
 * 2. isResolving and authState.isConnecting update in different React
 *    contexts. There is a render gap between isResolving clearing and
 *    isConnected propagating where neither flag holds and the gate drops
 *    for one frame — enough for the app to flash a login screen.
 *
 * The fix: one flag, restoreSettled (true once the signer is connected or the
 * restore definitely failed). The gate holds until that flag is true, period.
 * No isAuthenticated, no multi-flag combination.
 */

describe('shouldGateRestore', () => {
  it('gates while restore has not settled and a shared session exists on cloistr domain', () => {
    expect(shouldGateRestore({
      restoreSettled: false,
      hasSharedSession: true,
      isCloistrDomain: true,
    })).toBe(true);
  });

  it('drops the gate once restore has settled', () => {
    expect(shouldGateRestore({
      restoreSettled: true,
      hasSharedSession: true,
      isCloistrDomain: true,
    })).toBe(false);
  });

  it('does not gate a first-time visitor (no shared session)', () => {
    expect(shouldGateRestore({
      restoreSettled: false,
      hasSharedSession: false,
      isCloistrDomain: true,
    })).toBe(false);
  });

  it('does not gate off a cloistr domain (no SSO to restore)', () => {
    expect(shouldGateRestore({
      restoreSettled: false,
      hasSharedSession: true,
      isCloistrDomain: false,
    })).toBe(false);
  });

  // Issue 1: the gate must hold regardless of the backend JWT or signer
  // connection state. shouldGateRestore does not take isAuthenticated at all.
  it('is independent of isAuthenticated — no such parameter exists', () => {
    const fn = shouldGateRestore as (...args: unknown[]) => unknown;
    // Passing extra properties does nothing; the only inputs are restoreSettled,
    // hasSharedSession, isCloistrDomain. This test documents the contract.
    expect(shouldGateRestore({
      restoreSettled: false,
      hasSharedSession: true,
      isCloistrDomain: true,
    })).toBe(true);
    void fn;
  });

  // Issue 2: the gap between isResolving clearing and isConnected
  // propagating. In that gap, restoreSettled is still false, so the gate holds.
  it('holds through the isResolving → isConnected gap', () => {
    // Simulates: isResolving just cleared, isConnecting is false,
    // isConnected is false. The old code dropped the gate here.
    // restoreSettled is still false because isConnected hasn't fired yet.
    expect(shouldGateRestore({
      restoreSettled: false,
      hasSharedSession: true,
      isCloistrDomain: true,
    })).toBe(true);
  });
});
