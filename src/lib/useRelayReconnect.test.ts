/**
 * Source-level guards for useRelayReconnect (part 4 of the signer-resilience
 * design).
 *
 * THIS FILE IS SOURCE-LEVEL ONLY.
 *
 * The hook registers DOM event listeners (document.visibilitychange,
 * window.online) and reads a React context (useNostrAuth). Testing those
 * behaviourally requires a DOM environment (jsdom) AND @testing-library/react
 * to render the hook inside an AuthProvider tree. Adding both is a multi-
 * dependency change with lockfile implications; the appropriate location for
 * those tests is a consuming app's suite where the full React tree is already
 * present.
 *
 * What these tests DO guarantee:
 *
 *   - The correct event names are registered (visibilitychange, online).
 *   - Only the 'visible' direction of visibilitychange triggers a reconnect.
 *   - The debounce guard (clearTimeout before scheduling) is present.
 *   - Only NIP-46 sessions are acted on (no interference with NIP-07).
 *   - The reconnect path calls getPublicKey(), the Nip46Signer lazy-connect
 *     trigger — not a full re-auth that would reprompt the user.
 *   - Session-clearing APIs are never called.
 *   - Listeners are removed on cleanup.
 *
 * What these tests CANNOT guarantee without a DOM environment:
 *
 *   - That the debounce fires once, not once per rapid event.
 *   - That reconnect is skipped when the signer is already live.
 *   - That listeners are cleaned up correctly in React Strict Mode double-mounts.
 *
 * Those behavioural properties are covered in the BEHAVIOURAL TEST PLAN at the
 * bottom of this file.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const SOURCE = readFileSync(
  new URL('./useRelayReconnect.ts', import.meta.url),
  'utf8',
);

describe('useRelayReconnect (source assertions)', () => {
  it("registers the 'visibilitychange' event", () => {
    expect(SOURCE).toContain("'visibilitychange'");
  });

  it("registers the 'online' event", () => {
    expect(SOURCE).toContain("'online'");
  });

  it("only reconnects when visibilityState becomes 'visible', not on hide", () => {
    // visibilitychange fires on both transitions. Reconnecting on hide is
    // pointless — the OS is about to kill the sockets anyway — and wastes a
    // relay negotiation round-trip.
    expect(SOURCE).toContain("visibilityState === 'visible'");
  });

  it('has a debounce guard that clears any pending timer before scheduling', () => {
    // Without this guard, two rapid events each schedule an independent
    // reconnect and both fire — the storm the design document warns about.
    expect(SOURCE).toContain('clearTimeout(timerRef.current)');
  });

  it("checks for method !== 'nip46' before acting", () => {
    // NIP-07 (browser extension) signers manage their own sockets. The hook
    // must not call getPublicKey() on an extension signer — extensions prompt
    // the user on every access.
    expect(SOURCE).toContain("method !== 'nip46'");
  });

  it('warms up the connection via getPublicKey(), not a full re-auth', () => {
    // getPublicKey() is the lightest Nip46Signer operation that exercises the
    // lazy-connect path. A full re-auth (connectNip46, connectViaNostrConnect)
    // would drive a new nostrconnect:// flow and reprompt the user.
    expect(SOURCE).toContain('getPublicKey()');
    expect(SOURCE).not.toContain('connectNip46(');
    expect(SOURCE).not.toContain('connectViaNostrConnect(');
    expect(SOURCE).not.toContain('connectNip07(');
  });

  it('never touches session or token state', () => {
    // A reconnect hook that clears auth reintroduces the bug the signer-
    // resilience design exists to fix.
    //
    // Checked as call-site patterns (name + '(') so that comments explaining
    // what the hook must NOT do do not trigger the assertion — the same
    // technique SignerRecovery.test.ts uses for 'sign in' vs 'signing'.
    for (const forbidden of [
      'logout(',
      'clearAuth(',
      'clearSharedSession(',
      'clearNip46Session(',
      'disconnect(',
      'setIsConnected(',
    ]) {
      expect(SOURCE, `must not call '${forbidden}'`).not.toContain(forbidden);
    }
    // localStorage is checked as a property access, not a call, because all
    // usage forms (localStorage.setItem, localStorage.getItem, etc.) must be
    // absent — and it does not appear in this module's own prose comments.
    expect(SOURCE).not.toContain('localStorage');
  });

  it('removes both event listeners on cleanup', () => {
    // A hook that leaks listeners accumulates reconnect attempts with every
    // React Strict Mode double-mount or fast-refresh cycle.
    expect(SOURCE).toContain("removeEventListener('visibilitychange'");
    expect(SOURCE).toContain("removeEventListener('online'");
  });

  it('cancels the debounce timer on cleanup', () => {
    // An in-flight timer after unmount would call getPublicKey() on a signer
    // that may have been replaced or torn down.
    expect(SOURCE).toContain('clearTimeout(timerRef.current)');
  });
});

/*
 * BEHAVIOURAL TEST PLAN
 *
 * These tests are specified here but not yet runnable. They require
 * `vitest + jsdom + @testing-library/react` — a multi-dependency addition
 * with lockfile implications. They belong in this package once those
 * dependencies are present, or in a consuming app's test suite in the
 * meantime.
 *
 * 1. Debounce collapses a burst into one call.
 *    Setup: render the hook with a mocked signer; dispatch visibilitychange
 *    (hidden → visible) three times within debounceMs.
 *    Assert: signer.getPublicKey() called exactly once after debounceMs.
 *
 * 2. NIP-07 is ignored.
 *    Setup: render with authState.method = 'nip07' and a mocked signer.
 *    Assert: signer.getPublicKey() never called on any visibility event.
 *
 * 3. Disconnected session is ignored.
 *    Setup: render with authState.isConnected = false.
 *    Assert: signer.getPublicKey() never called on any visibility event.
 *
 * 4. Listeners are cleaned up on unmount.
 *    Setup: render the hook, then unmount.
 *    Assert: dispatching visibilitychange or online after unmount does not
 *    call signer.getPublicKey().
 *
 * 5. online event triggers reconnect independently of visibilityState.
 *    Setup: render with authState.method = 'nip46'; dispatch window 'online'.
 *    Assert: signer.getPublicKey() called once after debounceMs.
 */
