/**
 * First visit to a Cloistr app after signing in ONLY on the signer.
 *
 * Reported by cloistr-sanctuary on cloistr.xyz (3/3 runs): the signed-out
 * landing showed for ~2.5s before the dashboard. A signer sign-in leaves only
 * the HttpOnly auth_token cookie; the JS-readable shared cookies the gate keys
 * off are written later by an app. So shouldGateRestore saw "no session",
 * rendered the app, and the silent restore swapped it out seconds later.
 *
 * Mounts the REAL SharedAuthProvider. Asserts nothing of the app renders until
 * the signer session probe answers, the normal gate holds on 'signed-in', an
 * anonymous visitor still gets the app, and the wait is capped.
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
let onCloistrDomain = true;
let resolveProbe: (v: string) => void = () => {};
const { probeSignerSession, connectWithLockedKeyRecovery } = vi.hoisted(() => ({
  probeSignerSession: vi.fn(),
  // The silent restore: pending unless a test settles it.
  connectWithLockedKeyRecovery: vi.fn(() => new Promise<boolean>(() => {})),
}));
probeSignerSession.mockImplementation(() => new Promise<string>((r) => { resolveProbe = r; }));

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
  useAuthHelpers: () => ({ isAuthenticated: authStateMock.isConnected, isNip07Available: false }),
  isNip07Supported: () => false,
}));

// No shared JS-readable cookie: the signer-only sign-in case.
vi.mock('../lib/session.js', () => ({
  getSharedSession: () => null,
  saveSharedSession: vi.fn(),
  clearSharedSession: vi.fn(),
  hasSharedSession: () => false,
  isCloistrDomain: () => onCloistrDomain,
}));

vi.mock('../lib/runtimeConfig.js', () => ({ getSignerUrl: () => 'https://signer.test' }));

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
vi.mock('../lib/useRelayReconnect.js', () => ({ useRelayReconnect: vi.fn() }));
vi.mock('./AuthRestoreGate.js', () => ({
  AuthRestoreGate: () => createElement('span', null, '[gate]'),
  AuthPendingView: () => createElement('span', null, '[pending]'),
}));
vi.mock('./SignerReauthPrompt.js', () => ({ SignerReauthPrompt: () => null }));
vi.mock('../lib/signerReauth.js', () => ({
  activeBunkerUrl: () => null,
  connectWithLockedKeyRecovery,
  probeSignerApi: vi.fn().mockResolvedValue(true),
  probeSignerSession,
  shouldAdoptForReauth: () => false,
}));
vi.mock('../lib/staySignedIn.js', () => ({ unsealSession: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/useSessionKeepAlive.js', () => ({ useSessionKeepAlive: vi.fn() }));
vi.mock('../lib/signerRetry.js', () => ({ withSignerRetry: vi.fn().mockResolvedValue(false) }));

import { SharedAuthProvider, decideRestoreView } from './SharedAuthProvider.js';

function mount() {
  const container = document.createElement('div');
  const root = createRoot(container);
  const render = () =>
    root.render(
      createElement(SharedAuthProvider, { signerUrl: 'https://signer.test' } as any,
        createElement('span', null, '[app]'),
      ),
    );
  act(render);
  return { container, rerender: () => act(render), unmount: () => act(() => root.unmount()) };
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('first visit with no shared cookie (real provider)', () => {
  beforeEach(() => {
    authStateMock = { isConnecting: false, isConnected: false, pubkey: null, method: null, keys: [] };
    onCloistrDomain = true;
    probeSignerSession.mockClear();
    probeSignerSession.mockImplementation(() => new Promise<string>((r) => { resolveProbe = r; }));
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('renders nothing of the app while the signer session probe is in flight', () => {
    const { container, unmount } = mount();
    expect(container.textContent).toBe('[pending]');
    expect(probeSignerSession).toHaveBeenCalledWith('https://signer.test');
    unmount();
  });

  it('signed in on the signer only: holds the gate, never the signed-out app, until restore lands', async () => {
    const { container, rerender, unmount } = mount();
    resolveProbe('signed-in');
    await flush();
    expect(container.textContent).toBe('[gate]');

    authStateMock = { ...authStateMock, isConnected: true, pubkey: 'pk', method: 'nip46' };
    rerender();
    expect(container.textContent).toBe('[app]');
    unmount();
  });

  it('anonymous visitor: the app (landing) renders once the probe says signed out', async () => {
    const { container, unmount } = mount();
    resolveProbe('signed-out');
    await flush();
    expect(container.textContent).toBe('[app]');
    unmount();
  });

  it('a signer that never answers holds the page for 1s at most', async () => {
    const { container, unmount } = mount();
    act(() => { vi.advanceTimersByTime(999); });
    expect(container.textContent).toBe('[pending]');
    act(() => { vi.advanceTimersByTime(1); });
    expect(container.textContent).toBe('[app]');
    unmount();
  });

  it('off a cloistr domain: no probe, the app renders at once', () => {
    onCloistrDomain = false;
    const { container, unmount } = mount();
    expect(container.textContent).toBe('[app]');
    expect(probeSignerSession).not.toHaveBeenCalled();
    unmount();
  });
});

describe('decideRestoreView', () => {
  const base = { restoreSettled: false, hasSharedSession: false, isCloistrDomain: true };
  it('shared cookie present: gate, whatever the hint', () => {
    expect(decideRestoreView({ ...base, hasSharedSession: true, signerHint: 'none' })).toBe('gate');
  });
  it('no cookie, probe pending: pending', () => {
    expect(decideRestoreView({ ...base, signerHint: 'pending' })).toBe('pending');
  });
  it('no cookie, signer says signed in: gate', () => {
    expect(decideRestoreView({ ...base, signerHint: 'signed-in' })).toBe('gate');
  });
  it('no cookie, no signer session: children', () => {
    expect(decideRestoreView({ ...base, signerHint: 'none' })).toBe('children');
  });
  it('restore settled: children even if the hint is still pending', () => {
    expect(decideRestoreView({ ...base, restoreSettled: true, signerHint: 'pending' })).toBe('children');
  });
});
