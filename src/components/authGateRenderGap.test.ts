/**
 * Component test: the auth gate does not drop during the React render gap
 * between isResolving clearing and authState.isConnected propagating.
 *
 * Card #180, issue (2). isResolving and authState.isConnected live in
 * different React contexts. When the bootstrap resolves, both update in
 * the same async continuation, but React may flush them in separate
 * renders (legacy mode, or an intermediate await splitting microtasks).
 * The old gate, which combined isResolving/isConnecting/isConnected,
 * dropped for one frame in that gap, flashing a login screen.
 *
 * The fix: restoreSettled, set ONLY by a useEffect watching
 * authState.isConnected (on the success path). The gate holds until
 * that effect fires, which by definition cannot happen before the render
 * where isConnected is true.
 *
 * This test renders a component that mirrors SessionSyncInner's gate
 * logic, drives a delayed connect, and asserts the gate is never false
 * while the signer has not confirmed connected.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { createElement, useState, useEffect, act } from 'react';
import { createRoot } from 'react-dom/client';
import { shouldGateRestore } from './SharedAuthProvider.js';

/**
 * Minimal harness mirroring SessionSyncInner's restoreSettled logic.
 *
 * isConnected is a prop (simulating the @cloistr/auth context arriving
 * from a different provider), so the test controls when it transitions
 * independently of internal state.
 */
function GateHarness({ isConnected, onRender }: {
  isConnected: boolean;
  onRender: (gated: boolean) => void;
}) {
  const [restoreSettled, setRestoreSettled] = useState(false);

  useEffect(() => {
    if (isConnected) setRestoreSettled(true);
  }, [isConnected]);

  const gated = shouldGateRestore({
    restoreSettled,
    hasSharedSession: true,
    isCloistrDomain: true,
  });

  onRender(gated);

  return createElement('div', null, gated ? 'gate' : 'app');
}

describe('auth gate render gap (component)', () => {
  it('never drops the gate before isConnected propagates', () => {
    const renders: boolean[] = [];
    const container = document.createElement('div');
    const root = createRoot(container);

    // Phase 1: initial render. Signer not connected, gate must hold.
    act(() => {
      root.render(createElement(GateHarness, {
        isConnected: false,
        onRender: (g: boolean) => renders.push(g),
      }));
    });
    expect(renders[renders.length - 1]).toBe(true);

    // Phase 2: connect transitions. In the real code, isResolving has
    // already cleared (a different setState in a different context) and
    // authState.isConnected is about to become true. We simulate ONLY
    // the isConnected change, because the gate must hold on restoreSettled
    // alone — isResolving is irrelevant.
    act(() => {
      root.render(createElement(GateHarness, {
        isConnected: true,
        onRender: (g: boolean) => renders.push(g),
      }));
    });

    // The gate must transition true → false, never false → true.
    // Concretely: every true must come before every false.
    const firstFalse = renders.indexOf(false);
    const lastTrue = renders.lastIndexOf(true);

    // The gate eventually drops (restoreSettled flipped via the useEffect).
    expect(firstFalse).toBeGreaterThan(-1);
    // No true appears after the first false — no flash.
    expect(lastTrue).toBeLessThan(firstFalse);
    // Final state: gate is down.
    expect(renders[renders.length - 1]).toBe(false);

    root.unmount();
  });

  it('gate holds indefinitely when isConnected stays false (signer never responds)', () => {
    const renders: boolean[] = [];
    const container = document.createElement('div');
    const root = createRoot(container);

    act(() => {
      root.render(createElement(GateHarness, {
        isConnected: false,
        onRender: (g: boolean) => renders.push(g),
      }));
    });

    // Re-render with same props (simulating other state changes).
    act(() => {
      root.render(createElement(GateHarness, {
        isConnected: false,
        onRender: (g: boolean) => renders.push(g),
      }));
    });

    // Every render must show the gate.
    expect(renders.every((g) => g === true)).toBe(true);

    root.unmount();
  });
});
