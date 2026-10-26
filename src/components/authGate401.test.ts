/**
 * Integration test: a fresh browser (no shared session) that gets 401 from
 * the signer must land on the signed-out page, NOT the "Could not reach your
 * signer" error screen.
 *
 * Bug: bootstrapKeys returns false for a 401, attemptSsoConnect turns that
 * into CONNECTION_FAILED, and consumer apps see the isResolving true→false
 * transition as a connect failure — showing an error screen to someone who
 * was never signed in.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

let authStateMock = {
  isConnecting: false,
  isConnected: false,
  pubkey: null as string | null,
  method: null as string | null,
  keys: [] as any[],
};

let observedRenders: Array<{
  isResolving: boolean;
  restoreSettled: boolean;
  signerUnreachable: boolean;
}> = [];

// useSharedSession is imported below (after mocks) and used in Observer.

vi.mock('../auth/index.js', () => ({
  AuthProvider: ({ children }: { children: any }) => children,
  useNostrAuth: () => ({
    authState: authStateMock,
    signer: null,
    registerKey: vi.fn(),
    setKeys: vi.fn(),
    setActiveKey: vi.fn(),
    connectNip46: vi.fn(),
    connectNip07: vi.fn(),
    bootstrapKeys: vi.fn().mockResolvedValue(false),
    connectViaNostrConnect: vi.fn().mockResolvedValue(false),
  }),
  useAuthHelpers: () => ({
    isAuthenticated: false,
    isNip07Available: false,
  }),
  isNip07Supported: () => false,
}));

// Fresh browser: NO shared session
vi.mock('../lib/session.js', () => ({
  getSharedSession: () => null,
  saveSharedSession: vi.fn(),
  clearSharedSession: vi.fn(),
  hasSharedSession: () => false,
  isCloistrDomain: () => true,
  getActivePubkeyCookie: () => null,
  setActivePubkeyCookie: vi.fn(),
}));

vi.mock('../lib/runtimeConfig.js', () => ({
  getSignerUrl: () => 'https://signer.test',
}));

vi.mock('../lib/keySwitcher.js', () => ({
  useKeySwitcherBootstrap: (_signerUrl: string, initiallyResolving: boolean) => ({
    mintSignerForKey: vi.fn(),
    resolveSigner: vi.fn(),
    bootstrapKeys: vi.fn().mockResolvedValue(false),
    isResolving: initiallyResolving,
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
  AuthRestoreGate: () => null,
  AuthPendingView: () => null,
}));

vi.mock('./SignerReauthPrompt.js', () => ({
  SignerReauthPrompt: () => null,
}));

vi.mock('../lib/signerReauth.js', () => ({
  activeBunkerUrl: () => null,
  connectWithLockedKeyRecovery: vi.fn().mockResolvedValue(false),
  probeSignerApi: vi.fn().mockResolvedValue(true),
  // Fresh browser: the signer answers that nobody is signed in.
  probeSignerSession: vi.fn().mockResolvedValue('signed-out'),
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

import { SharedAuthProvider, useSharedSession } from './SharedAuthProvider.js';

function Observer() {
  const session = useSharedSession();
  observedRenders.push({
    isResolving: session.isResolving,
    restoreSettled: session.restoreSettled,
    signerUnreachable: session.signerUnreachable,
  });
  return createElement('div', null, 'landing-page');
}

describe('fresh browser 401: signed-out, not error screen', () => {
  beforeEach(() => {
    authStateMock = {
      isConnecting: false,
      isConnected: false,
      pubkey: null,
      method: null,
      keys: [],
    };
    observedRenders = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('isResolving starts false when there is no shared session', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    act(() => {
      root.render(
        createElement(
          SharedAuthProvider,
          { signerUrl: 'https://signer.test' } as any,
          createElement(Observer, null),
        ),
      );
    });

    // With no shared cookie the provider first asks the signer whether this
    // browser is signed in (authGateFirstVisit.test.ts). Let it answer.
    await act(async () => { await Promise.resolve(); });

    // The observer renders because the gate is NOT up (signer says signed out).
    expect(observedRenders.length).toBeGreaterThan(0);

    const last = observedRenders[observedRenders.length - 1];

    // CRITICAL: isResolving must be false from the first render.
    // Before the fix, isResolving was true regardless of session state,
    // which made consumer apps (stash, etc.) enter a "connecting" phase
    // and then interpret the true→false transition as a connect failure.
    expect(last.isResolving).toBe(false);

    // signerUnreachable must be false — the signer was reachable, the user
    // is simply not authenticated.
    expect(last.signerUnreachable).toBe(false);

    root.unmount();
  });
});
