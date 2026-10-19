/**
 * Tests that bootstrapKeys classifies signer HTTP responses correctly:
 * - 401/403 → returns false (not authenticated, not an error)
 * - 500/502/503/429 → throws CONNECTION_FAILED (server error, retryable)
 * - network error → throws CONNECTION_FAILED (retryable)
 *
 * Without the !keysRes.ok guard, 502/503/429/500 fell through to
 * signerKeys.length === 0 → return false, which meant a signed-in user
 * hitting a signer roll landed signed-out with no retry and no recovery
 * screen.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('../auth/index.js', () => ({
  useNostrAuth: () => ({
    authState: {
      keys: [],
      isConnected: false,
      pubkey: null,
      method: null,
      activePubkey: null,
      isSwitching: false,
    },
    signer: null,
    setKeys: vi.fn(),
    setActiveKey: vi.fn(),
    connectNip46: vi.fn().mockResolvedValue(null),
    connectNip07: vi.fn(),
    registerKey: vi.fn(),
  }),
  connectNip07: vi.fn(),
  isNip07Supported: () => false,
}));

vi.mock('./session.js', () => ({
  isCloistrDomain: () => true,
  getActivePubkeyCookie: () => null,
  setActivePubkeyCookie: vi.fn(),
}));

vi.mock('./signerReauth.js', () => ({
  wrapSignerWithReauth: vi.fn(),
  probeSignerApi: vi.fn().mockResolvedValue(true),
  isKeyLockedError: () => false,
  cloistrKeyIdFor: vi.fn(),
  KEY_LOCKED: 'KEY_LOCKED',
}));

vi.mock('./staySignedIn.js', () => ({
  unsealSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@cloistr/auth', () => ({
  startNostrConnect: vi.fn(),
}));

import { useKeySwitcherBootstrap } from './keySwitcher.js';

let capturedBootstrapKeys: (() => Promise<boolean>) | null = null;

function Capture() {
  const hook = useKeySwitcherBootstrap('https://signer.test', false);
  capturedBootstrapKeys = hook.bootstrapKeys;
  return null;
}

describe('bootstrapKeys response classification', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    capturedBootstrapKeys = null;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    container = document.createElement('div');
    root = createRoot(container);
    act(() => {
      root.render(createElement(Capture));
    });
    expect(capturedBootstrapKeys).not.toBeNull();
  });

  afterEach(() => {
    root.unmount();
    vi.unstubAllGlobals();
  });

  it('401 returns false (not authenticated)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(capturedBootstrapKeys!()).resolves.toBe(false);
  });

  it('403 returns false (not authenticated)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403 });
    await expect(capturedBootstrapKeys!()).resolves.toBe(false);
  });

  it('502 throws CONNECTION_FAILED (retryable server error)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502 });
    try {
      await capturedBootstrapKeys!();
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('CONNECTION_FAILED');
      expect(err.message).toContain('502');
    }
  });

  it('503 throws CONNECTION_FAILED (retryable server error)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    try {
      await capturedBootstrapKeys!();
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('CONNECTION_FAILED');
      expect(err.message).toContain('503');
    }
  });

  it('429 throws CONNECTION_FAILED (retryable server error)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429 });
    try {
      await capturedBootstrapKeys!();
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('CONNECTION_FAILED');
      expect(err.message).toContain('429');
    }
  });

  it('500 throws CONNECTION_FAILED (retryable server error)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    try {
      await capturedBootstrapKeys!();
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('CONNECTION_FAILED');
      expect(err.message).toContain('500');
    }
  });

  it('network error throws CONNECTION_FAILED', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network failed'));
    try {
      await capturedBootstrapKeys!();
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('CONNECTION_FAILED');
    }
  });
});
