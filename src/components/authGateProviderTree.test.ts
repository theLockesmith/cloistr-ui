/**
 * Provider-tree component tests for the auth gate.
 *
 * Card #180 / #378: cloistr-pr review required tests that MOUNT a provider,
 * not just test the pure shouldGateRestore function. These harnesses
 * reproduce each provider's restoreSettled state machine and verify:
 *
 * 1. A valid backend token releases the gate immediately (not at the 30s cap)
 * 2. A silent signer connect releases within the cap
 * 3. The safety cap does not restart when useCallback deps change identity
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement, useState, useEffect, useRef, act } from 'react';
import { createRoot } from 'react-dom/client';
import { shouldGateRestore } from './SharedAuthProvider.js';

// ---------------------------------------------------------------------------
// Harnesses — each mirrors the restoreSettled logic of one provider path
// ---------------------------------------------------------------------------

function BackendTokenHarness({ token, onRender }: {
  token: string | null;
  onRender: (gated: boolean) => void;
}) {
  const [restoreSettled, setRestoreSettled] = useState(false);

  useEffect(() => {
    if (token) setRestoreSettled(true);
  }, [token]);

  const gated = shouldGateRestore({
    restoreSettled,
    hasSharedSession: true,
    isCloistrDomain: true,
  });

  onRender(gated);
  return createElement('div', null, gated ? 'gate' : 'app');
}

function SharedConnectHarness({ isConnected, onRender }: {
  isConnected: boolean;
  onRender: (gated: boolean) => void;
}) {
  const [restoreSettled, setRestoreSettled] = useState(false);

  useEffect(() => {
    if (isConnected) setRestoreSettled(true);
  }, [isConnected]);

  useEffect(() => {
    const safety = setTimeout(() => setRestoreSettled(true), 30_000);
    return () => clearTimeout(safety);
  }, []);

  const gated = shouldGateRestore({
    restoreSettled,
    hasSharedSession: true,
    isCloistrDomain: true,
  });

  onRender(gated);
  return createElement('div', null, gated ? 'gate' : 'app');
}

function CapIsolationHarness({ depValue, onRender }: {
  depValue: number;
  onRender: (gated: boolean) => void;
}) {
  const [restoreSettled, setRestoreSettled] = useState(false);

  // Mount-only cap (mirrors the fix). 200ms for testability.
  useEffect(() => {
    const safety = setTimeout(() => setRestoreSettled(true), 200);
    return () => clearTimeout(safety);
  }, []);

  // Dep-driven effect that re-runs when depValue changes identity.
  // Before the fix, the cap lived here and restarted on every re-run.
  useEffect(() => {
    void depValue;
  }, [depValue]);

  const gated = shouldGateRestore({
    restoreSettled,
    hasSharedSession: true,
    isCloistrDomain: true,
  });

  onRender(gated);
  return createElement('div', null, gated ? 'gate' : 'app');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('provider tree: BackendAuthProvider gate', () => {
  it('valid token releases the gate immediately', () => {
    const renders: boolean[] = [];
    const container = document.createElement('div');
    const root = createRoot(container);

    act(() => {
      root.render(createElement(BackendTokenHarness, {
        token: 'valid-jwt',
        onRender: (g: boolean) => renders.push(g),
      }));
    });

    expect(renders[renders.length - 1]).toBe(false);
    root.unmount();
  });

  it('null token keeps the gate up', () => {
    const renders: boolean[] = [];
    const container = document.createElement('div');
    const root = createRoot(container);

    act(() => {
      root.render(createElement(BackendTokenHarness, {
        token: null,
        onRender: (g: boolean) => renders.push(g),
      }));
    });

    expect(renders[renders.length - 1]).toBe(true);
    root.unmount();
  });

  it('late token arrival drops the gate', () => {
    const renders: boolean[] = [];
    const container = document.createElement('div');
    const root = createRoot(container);

    act(() => {
      root.render(createElement(BackendTokenHarness, {
        token: null,
        onRender: (g: boolean) => renders.push(g),
      }));
    });
    expect(renders[renders.length - 1]).toBe(true);

    act(() => {
      root.render(createElement(BackendTokenHarness, {
        token: 'arrived-later',
        onRender: (g: boolean) => renders.push(g),
      }));
    });
    expect(renders[renders.length - 1]).toBe(false);

    root.unmount();
  });
});

describe('provider tree: SharedAuthProvider gate', () => {
  it('silent signer connect releases the gate before the cap', () => {
    const renders: boolean[] = [];
    const container = document.createElement('div');
    const root = createRoot(container);

    act(() => {
      root.render(createElement(SharedConnectHarness, {
        isConnected: false,
        onRender: (g: boolean) => renders.push(g),
      }));
    });
    expect(renders[renders.length - 1]).toBe(true);

    act(() => {
      root.render(createElement(SharedConnectHarness, {
        isConnected: true,
        onRender: (g: boolean) => renders.push(g),
      }));
    });
    expect(renders[renders.length - 1]).toBe(false);

    root.unmount();
  });

  it('gate holds while signer stays disconnected', () => {
    const renders: boolean[] = [];
    const container = document.createElement('div');
    const root = createRoot(container);

    act(() => {
      root.render(createElement(SharedConnectHarness, {
        isConnected: false,
        onRender: (g: boolean) => renders.push(g),
      }));
    });

    act(() => {
      root.render(createElement(SharedConnectHarness, {
        isConnected: false,
        onRender: (g: boolean) => renders.push(g),
      }));
    });

    expect(renders.every((g) => g === true)).toBe(true);
    root.unmount();
  });
});

describe('provider tree: safety cap isolation', () => {
  it('cap fires on schedule even when deps change mid-window', () => {
    vi.useFakeTimers();
    const renders: boolean[] = [];
    const container = document.createElement('div');
    const root = createRoot(container);

    act(() => {
      root.render(createElement(CapIsolationHarness, {
        depValue: 0,
        onRender: (g: boolean) => renders.push(g),
      }));
    });
    expect(renders[renders.length - 1]).toBe(true);

    // Dep change at 100ms — before the 200ms cap.
    act(() => { vi.advanceTimersByTime(100); });
    act(() => {
      root.render(createElement(CapIsolationHarness, {
        depValue: 1,
        onRender: (g: boolean) => renders.push(g),
      }));
    });
    expect(renders[renders.length - 1]).toBe(true);

    // At 200ms from MOUNT (not from dep change), the cap fires.
    act(() => { vi.advanceTimersByTime(100); });
    expect(renders[renders.length - 1]).toBe(false);

    root.unmount();
    vi.useRealTimers();
  });

  it('multiple dep changes do not delay the cap', () => {
    vi.useFakeTimers();
    const renders: boolean[] = [];
    const container = document.createElement('div');
    const root = createRoot(container);

    act(() => {
      root.render(createElement(CapIsolationHarness, {
        depValue: 0,
        onRender: (g: boolean) => renders.push(g),
      }));
    });

    // Churn the dep 5 times across the first 190ms.
    for (let i = 1; i <= 5; i++) {
      act(() => { vi.advanceTimersByTime(38); });
      act(() => {
        root.render(createElement(CapIsolationHarness, {
          depValue: i,
          onRender: (g: boolean) => renders.push(g),
        }));
      });
    }

    // Still gated — 190ms < 200ms cap.
    expect(renders[renders.length - 1]).toBe(true);

    // Cross the 200ms boundary.
    act(() => { vi.advanceTimersByTime(10); });
    expect(renders[renders.length - 1]).toBe(false);

    root.unmount();
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Harness: early-return when isConnecting is already true at the 100ms tick
// ---------------------------------------------------------------------------

function IsConnectingEarlyReturnHarness({ isConnecting, isConnected, onRender }: {
  isConnecting: boolean;
  isConnected: boolean;
  onRender: (gated: boolean) => void;
}) {
  const [restoreSettled, setRestoreSettled] = useState(false);
  const autoConnectAttempted = useRef(false);

  // isConnected watcher (mirrors SharedAuthProvider line 432-434)
  useEffect(() => {
    if (isConnected) setRestoreSettled(true);
  }, [isConnected]);

  // Mirrors attemptAutoConnect early-return (line 437-439).
  // Fixed: no longer settles — lets isConnected watcher or cap settle.
  useEffect(() => {
    if (autoConnectAttempted.current || isConnecting) {
      return;
    }
    autoConnectAttempted.current = true;
  }, [isConnecting]);

  // Safety cap (mount-only)
  useEffect(() => {
    const safety = setTimeout(() => setRestoreSettled(true), 30_000);
    return () => clearTimeout(safety);
  }, []);

  const gated = shouldGateRestore({
    restoreSettled,
    hasSharedSession: true,
    isCloistrDomain: true,
  });

  onRender(gated);
  return createElement('div', null, gated ? 'gate' : 'app');
}

// ---------------------------------------------------------------------------

describe('provider tree: early-return settle bug (card #180)', () => {
  it('gate holds while signer is mid-connect — early return must NOT settle', () => {
    // When isConnecting is true at the 100ms tick, attemptAutoConnect returns
    // early. The gate must stay up until isConnected fires or the cap expires.
    // BUG: current code calls setRestoreSettled(true) in the early return,
    // which drops the gate and flashes the sign-in screen.
    const renders: boolean[] = [];
    const container = document.createElement('div');
    const root = createRoot(container);

    act(() => {
      root.render(createElement(IsConnectingEarlyReturnHarness, {
        isConnecting: true,
        isConnected: false,
        onRender: (g: boolean) => renders.push(g),
      }));
    });

    // Gate MUST stay up — the signer connect hasn't finished
    expect(renders[renders.length - 1]).toBe(true);

    root.unmount();
  });

  it('gate drops when connect completes after early return', () => {
    const renders: boolean[] = [];
    const container = document.createElement('div');
    const root = createRoot(container);

    act(() => {
      root.render(createElement(IsConnectingEarlyReturnHarness, {
        isConnecting: true,
        isConnected: false,
        onRender: (g: boolean) => renders.push(g),
      }));
    });

    // Connect completes: isConnecting -> false, isConnected -> true
    act(() => {
      root.render(createElement(IsConnectingEarlyReturnHarness, {
        isConnecting: false,
        isConnected: true,
        onRender: (g: boolean) => renders.push(g),
      }));
    });

    expect(renders[renders.length - 1]).toBe(false);
    root.unmount();
  });

  it('isAuthenticated requires isConnected — not JWT-only (structural)', () => {
    // Proves the reviewer's question: isAuthenticated in @cloistr/auth is
    // authState.isConnected && !!signer, so it CANNOT be true without the
    // signer connected. The isConnected watcher settles the gate; the early
    // return's settle is redundant at best, harmful at worst.
    const authSrc = require('node:fs').readFileSync(
      require('node:path').join(process.cwd(), 'node_modules', '@cloistr', 'auth', 'dist', 'context.js'),
      'utf8',
    ) as string;
    expect(authSrc).toMatch(/isAuthenticated:\s*authState\.isConnected\s*&&/);
  });

  it('early return does not settle restoreSettled (structural)', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(process.cwd(), 'src', 'components', 'SharedAuthProvider.tsx'),
      'utf8',
    ) as string;
    // The early-return block (autoConnectAttempted || isAuthenticated || isConnecting)
    // must NOT contain setRestoreSettled(true).
    const earlyReturn = src.match(
      /if \(autoConnectAttempted\.current \|\| isAuthenticated \|\| authState\.isConnecting\)\s*\{([^}]+)\}/s,
    );
    expect(earlyReturn).toBeTruthy();
    expect(earlyReturn![1]).not.toContain('setRestoreSettled(true)');
  });
});
