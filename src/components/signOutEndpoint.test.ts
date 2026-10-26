/**
 * Behavioural test: sign-out calls the per-session endpoint at runtime.
 *
 * The source-level tests in UserMenu.test.ts verify the literal URL string is
 * present. These tests render each component, trigger sign-out, and assert the
 * fetch that fires hits POST /api/v1/users/session/logout — not the
 * account-wide /api/v1/users/logout that deletes all sessions and revokes app
 * consents.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// Suppress "not configured to support act" warnings in jsdom.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { SIGNER_URL, PER_SESSION, ACCOUNT_WIDE, TEST_PUBKEY } = vi.hoisted(() => {
  const SIGNER_URL = 'https://signer.test';
  return {
    SIGNER_URL,
    PER_SESSION: `${SIGNER_URL}/api/v1/users/session/logout`,
    ACCOUNT_WIDE: `${SIGNER_URL}/api/v1/users/logout`,
    TEST_PUBKEY:
      'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  };
});

// ── Mocks (hoisted; order does not matter) ─────────────────────────────────

vi.mock('../auth/index.js', () => ({
  AuthProvider: ({ children }: { children: any }) => children,
  useNostrAuth: () => ({
    authState: {
      isConnecting: false,
      isConnected: true,
      pubkey: TEST_PUBKEY,
      activePubkey: TEST_PUBKEY,
      method: 'nip46',
      keys: [],
      isSwitching: false,
    },
    disconnect: vi.fn(),
    setActiveKey: vi.fn(),
    signer: null,
    registerKey: vi.fn(),
    setKeys: vi.fn(),
    connectNip46: vi.fn(),
    connectNip07: vi.fn(),
    bootstrapKeys: vi.fn().mockResolvedValue(false),
    connectViaNostrConnect: vi.fn().mockResolvedValue(false),
  }),
  useAuthHelpers: () => ({
    isAuthenticated: true,
    isNip07Available: false,
  }),
  isNip07Supported: () => false,
  connectNip07: vi.fn(),
  connectNip46: vi.fn(),
}));

vi.mock('./SharedAuthProvider.js', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const React = require('react');
  return {
    useSharedSessionMaybe: () => null,
    SharedSessionContext: React.createContext(null),
    shouldGateRestore: () => false,
    decideRestoreView: () => 'children',
  };
});

vi.mock('../lib/overlayAnchor.js', () => ({
  anchorBelow: () => ({ top: 50, right: 10 }),
}));

vi.mock('../lib/nip05.js', () => ({
  useNip05: () => 'test@cloistr.xyz',
  getDefaultIdentityDomain: () => 'cloistr.xyz',
}));

vi.mock('../lib/runtimeConfig.js', () => ({
  getSignerUrl: () => SIGNER_URL,
}));

vi.mock('./SettingsModal.js', () => ({
  default: () => null,
}));

vi.mock('nostr-tools', () => ({
  nip19: { npubEncode: (hex: string) => `npub1${hex.slice(0, 58)}` },
}));

vi.mock('nostr-tools/pure', () => ({
  verifyEvent: () => true,
}));

vi.mock('../lib/session.js', () => ({
  saveSharedSession: vi.fn(),
  clearSharedSession: vi.fn(),
  getSharedSession: () => null,
  isCloistrDomain: () => false,
  renewSession: vi.fn(),
  hasSharedSession: () => false,
}));

vi.mock('../lib/keySwitcher.js', () => ({
  useKeySwitcherBootstrap: () => ({
    resolveSigner: vi.fn(),
    bootstrapKeys: vi.fn().mockResolvedValue(false),
    pin: { pinnedPubkey: null, setPinnedPubkey: vi.fn(), clearPin: vi.fn() },
    isResolving: false,
    setIsResolving: vi.fn(),
    mintSignerForKey: vi.fn(),
    adoptSignerForReauth: vi.fn(),
  }),
}));

vi.mock('./authRestorePolicy.js', () => ({
  planPageLoadRestore: () => ({ offerExtensionInLoginUi: false }),
}));

vi.mock('./AuthRestoreGate.js', () => ({
  AuthRestoreGate: () => null,
  AuthPendingView: () => null,
}));

// ── Imports (resolved against mocks) ───────────────────────────────────────

import { UserMenu } from './UserMenu.js';
import { BackendAuthProvider, useBackendAuth } from './BackendAuthProvider.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function fetchCallUrls(): string[] {
  return (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map(
    (args: unknown[]) => (typeof args[0] === 'string' ? args[0] : ''),
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('sign-out hits the per-session endpoint at runtime', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('UserMenu: clicking Sign Out POSTs to /api/v1/users/session/logout', async () => {
    await act(async () => {
      root.render(createElement(UserMenu, { signerUrl: SIGNER_URL }));
    });

    const trigger = container.querySelector(
      '.cloistr-user-menu-trigger',
    ) as HTMLButtonElement;
    expect(trigger, 'trigger button must render').toBeTruthy();

    await act(async () => {
      trigger.click();
    });

    // Clear earlier mount-time fetches so the assertion is isolated.
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();

    // The dropdown is portaled to document.body.
    const signOutBtn = document.body.querySelector(
      '.cloistr-user-menu-logout',
    ) as HTMLButtonElement;
    expect(signOutBtn, 'Sign Out button must be in the portal').toBeTruthy();

    await act(async () => {
      signOutBtn.click();
    });

    // Let the async handleSignOut settle.
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const urls = fetchCallUrls();
    expect(urls, 'must call the per-session endpoint').toContain(PER_SESSION);
    expect(urls, 'must NOT call the account-wide endpoint').not.toContain(
      ACCOUNT_WIDE,
    );
  });

  it('BackendAuthProvider: logout() POSTs to /api/v1/users/session/logout', async () => {
    let capturedLogout: (() => void) | null = null;

    function LogoutCapture() {
      const { logout } = useBackendAuth();
      const captured = useRef(false);
      useEffect(() => {
        if (!captured.current) {
          captured.current = true;
          capturedLogout = logout;
        }
      }, [logout]);
      return createElement('div', null, 'ready');
    }

    await act(async () => {
      root.render(
        createElement(
          BackendAuthProvider,
          { config: { signerUrl: SIGNER_URL } } as any,
          createElement(LogoutCapture),
        ),
      );
    });

    // Flush mount-time effects (token restore, SSO probes, etc.).
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Clear fetch spy so only the logout call is asserted.
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();

    expect(capturedLogout, 'child must capture logout from context').toBeTruthy();

    act(() => {
      capturedLogout!();
    });

    // logout() fires fetch as fire-and-forget; give it a microtask.
    await act(async () => {
      await Promise.resolve();
    });

    const urls = fetchCallUrls();
    expect(urls, 'must call the per-session endpoint').toContain(PER_SESSION);
    expect(urls, 'must NOT call the account-wide endpoint').not.toContain(
      ACCOUNT_WIDE,
    );
  });
});
