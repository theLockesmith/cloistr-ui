/**
 * Integration test: mounts the REAL SharedAuthProvider with mocked
 * @cloistr/auth hooks to verify the isConnecting→false settle watcher.
 *
 * This exercises the actual provider code, not a harness mirror. The
 * AuthRestoreGate mock acts as an observer inside SharedSessionContext,
 * reporting restoreSettled and signerUnreachable on every render.
 *
 * FAILS on 9e49e3e (watcher missing), PASSES on the current branch.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

// ── Controllable mock auth state ──

let authStateMock = {
  isConnecting: false,
  isConnected: false,
  pubkey: null as string | null,
  method: null as string | null,
  keys: [] as any[],
};

// ── Render log populated by the AuthRestoreGate mock ──

let gateRenders: Array<{ restoreSettled: boolean; signerUnreachable: boolean; isResolving: boolean }> = [];

// Set after import; the mock component reads it at render time.
let useSharedSessionFn: (() => { restoreSettled: boolean; signerUnreachable: boolean; isResolving: boolean }) | null = null;

// ── Module mocks (must precede SharedAuthProvider import) ──

vi.mock('../auth/index.js', () => ({
  AuthProvider: ({ children }: { children: any }) => children,
  useNostrAuth: () => ({
    authState: authStateMock,
    signer: authStateMock.isConnected ? { pubkey: 'mock-signer' } : null,
    registerKey: vi.fn(),
    setKeys: vi.fn(),
    setActiveKey: vi.fn(),
    connectNip46: vi.fn(),
    connectNip07: vi.fn(),
    bootstrapKeys: vi.fn().mockResolvedValue(false),
    connectViaNostrConnect: vi.fn().mockResolvedValue(false),
  }),
  useAuthHelpers: () => ({
    isAuthenticated: authStateMock.isConnected,
    isNip07Available: false,
  }),
  isNip07Supported: () => false,
}));

vi.mock('../lib/session.js', () => ({
  getSharedSession: () => ({ pubkey: 'test-pub', method: 'nip46' }),
  saveSharedSession: vi.fn(),
  clearSharedSession: vi.fn(),
  hasSharedSession: () => true,
  isCloistrDomain: () => true,
}));

vi.mock('../lib/runtimeConfig.js', () => ({
  getSignerUrl: () => 'https://signer.test',
}));

vi.mock('../lib/keySwitcher.js', () => ({
  useKeySwitcherBootstrap: () => ({
    mintSignerForKey: vi.fn(),
    resolveSigner: vi.fn(),
    bootstrapKeys: vi.fn().mockResolvedValue(false),
    isResolving: false,
    setIsResolving: vi.fn(),
    pin: { pinnedPubkey: null, setPinnedPubkey: vi.fn(), clearPin: vi.fn() },
    adoptSignerForReauth: vi.fn(),
  }),
}));

vi.mock('./authRestorePolicy.js', () => ({
  planPageLoadRestore: () => ({ offerExtensionInLoginUi: false }),
}));

vi.mock('../lib/useRelayReconnect.js', () => ({
  useRelayReconnect: vi.fn(),
}));

vi.mock('./AuthRestoreGate.js', () => ({
  AuthRestoreGate: () => {
    // Renders inside SharedSessionContext.Provider when the gate is UP.
    // useSharedSessionFn is set after import, available at render time.
    if (!useSharedSessionFn) return null;
    const session = useSharedSessionFn();
    gateRenders.push({
      restoreSettled: session.restoreSettled,
      signerUnreachable: session.signerUnreachable,
      isResolving: session.isResolving,
    });
    return null;
  },
}));

vi.mock('./SignerReauthPrompt.js', () => ({
  SignerReauthPrompt: () => null,
}));

vi.mock('../lib/signerReauth.js', () => ({
  activeBunkerUrl: () => null,
  connectWithLockedKeyRecovery: vi.fn().mockResolvedValue(false),
  probeSignerApi: vi.fn().mockResolvedValue(true),
  shouldAdoptForReauth: () => false,
}));

vi.mock('../lib/staySignedIn.js', () => ({
  unsealSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/useSessionKeepAlive.js', () => ({
  useSessionKeepAlive: vi.fn(),
}));

vi.mock('../lib/signerRetry.js', () => ({
  withSignerRetry: vi.fn().mockResolvedValue(false),
}));

// Import AFTER mocks
import { SharedAuthProvider, useSharedSession } from './SharedAuthProvider.js';
useSharedSessionFn = useSharedSession;

// Child observer: renders when the gate drops.
let childRenders: Array<{ restoreSettled: boolean; signerUnreachable: boolean }> = [];

function Observer() {
  const session = useSharedSession();
  childRenders.push({
    restoreSettled: session.restoreSettled,
    signerUnreachable: session.signerUnreachable,
  });
  return createElement('div', null, 'app-content');
}

// ── Tests ──

describe('integration: connect failure settle (real provider)', () => {
  beforeEach(() => {
    authStateMock = { isConnecting: false, isConnected: false, pubkey: null, method: null, keys: [] };
    gateRenders = [];
    childRenders = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('failed connect settles gate immediately and marks signer unreachable', () => {
    // Start with connect in-flight (returning user)
    authStateMock = { ...authStateMock, isConnecting: true };

    const container = document.createElement('div');
    const root = createRoot(container);

    act(() => {
      root.render(
        createElement(SharedAuthProvider, { signerUrl: 'https://signer.test' } as any,
          createElement(Observer, null),
        ),
      );
    });

    // Gate is UP (restoreSettled false, hasSession true, isCloistrDomain true).
    // AuthRestoreGate mock renders; children (Observer) are blocked.
    expect(gateRenders.length).toBeGreaterThan(0);
    expect(gateRenders[gateRenders.length - 1].restoreSettled).toBe(false);
    expect(childRenders.length).toBe(0);

    // Connect FAILS: isConnecting → false, isConnected stays false.
    // Do NOT advance timers — the watcher must fire synchronously in the
    // effect pass, not via a delayed retry.
    authStateMock = { ...authStateMock, isConnecting: false, isConnected: false };
    act(() => {
      root.render(
        createElement(SharedAuthProvider, { signerUrl: 'https://signer.test' } as any,
          createElement(Observer, null),
        ),
      );
    });

    // WITH the watcher (current branch): the isConnecting true→false effect
    // fires, sets signerUnreachable + restoreSettled. The gate drops and
    // children render. The Observer (a child) mounts and reports the context.
    //
    // WITHOUT the watcher (9e49e3e): nothing settles until either the
    // auto-connect retry runs (100ms timer, not advanced) or the 30s cap.
    // Gate stays up → Observer never mounts → childRenders is empty → FAILS.
    expect(childRenders.length).toBeGreaterThan(0);
    expect(childRenders[childRenders.length - 1].restoreSettled).toBe(true);
    expect(childRenders[childRenders.length - 1].signerUnreachable).toBe(true);

    root.unmount();
  });
});
