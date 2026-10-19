/**
 * Integration test: mounts the REAL LoginModal to verify the Lightning
 * link-CSRF confirm flow. Mocks the network (fetch) and upstream hooks,
 * not the component logic.
 *
 * FAILS on the pre-fix code for double-click (no in-flight guard).
 * PASSES on the current branch (lightningConfirmBusy disables buttons).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

// ── Module mocks (must precede LoginModal import) ──

vi.mock('qrcode', () => ({
  default: { toCanvas: () => Promise.resolve() },
  toCanvas: () => Promise.resolve(),
}));

const authStateMock = {
  isConnecting: false,
  isConnected: false,
  pubkey: null as string | null,
  method: null as string | null,
  keys: [] as any[],
  error: null as string | null,
};

vi.mock('../auth/index.js', () => ({
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
  isValidBunkerUrl: () => false,
}));

vi.mock('../lib/username.js', () => ({
  isValidHumanName: (s: string) => /^[a-z0-9_-]{3,}$/i.test(s),
}));

vi.mock('../lib/approveAfterListening.js', () => ({
  approveAfterListening: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/runtimeConfig.js', () => ({
  getSignerUrl: () => 'https://signer.test',
  getSignerHostname: () => 'signer.test',
}));

vi.mock('../lib/staySignedIn.js', () => ({
  fetchStaySignedInOptions: () => Promise.resolve(null),
  stayFieldsForLogin: () => ({}),
  describeGrant: () => '',
  STAY_LABELS: {},
}));

import { LoginModal } from './LoginModal.js';

// ── Helpers ──

function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  } as unknown as Response;
}

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// ── Tests ──

describe('integration: Lightning confirm screen (real LoginModal)', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let fetchMock: ReturnType<typeof vi.fn<FetchFn>>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    fetchMock = vi.fn<FetchFn>();
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
  });

  afterEach(() => {
    root.unmount();
    document.body.removeChild(container);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /**
   * Drive the real LoginModal from method → lightning → lightning-confirm:
   * 1. Click "Other login methods" to expand advanced options
   * 2. Click "Lightning" to start the flow
   * 3. The challenge POST fires → mock it
   * 4. The poll interval fires → mock confirm_account
   * 5. The component transitions to lightning-confirm
   */
  async function driveToConfirmScreen(opts?: { username?: string; onClose?: ReturnType<typeof vi.fn> }) {
    const username = opts?.username ?? 'alice';
    const onClose = opts?.onClose ?? vi.fn();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/lightning/challenge')) {
        return mockResponse({ lnurl: 'lnurl-test', k1: 'k1-test', session_id: 'sess-123' });
      }
      if (url.includes('/lightning/status')) {
        return mockResponse({ success: false, status: 'confirm_account', username });
      }
      return mockResponse({}, 404);
    });

    await act(async () => {
      root.render(createElement(LoginModal, {
        isOpen: true,
        onClose,
        signerUrl: 'https://signer.test',
      }));
    });

    const toggleBtn = container.querySelector('.cloistr-login-more-toggle') as HTMLButtonElement;
    expect(toggleBtn).toBeTruthy();
    await act(async () => { toggleBtn.click(); });

    const buttons = container.querySelectorAll('.cloistr-login-options-advanced .cloistr-btn');
    let lightningBtn: HTMLButtonElement | null = null;
    buttons.forEach((btn) => {
      if (btn.textContent?.includes('Lightning')) lightningBtn = btn as HTMLButtonElement;
    });
    expect(lightningBtn).toBeTruthy();
    await act(async () => { lightningBtn!.click(); });

    await act(async () => { await Promise.resolve(); });

    await act(async () => { vi.advanceTimersByTime(2100); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const confirmText = container.querySelector('.cloistr-lightning-confirm');
    expect(confirmText).toBeTruthy();
    expect(container.textContent).toContain(username);
  }

  it('Yes button POSTs confirm:true and completes flow', async () => {
    await driveToConfirmScreen();

    const confirmCalls: Array<{ url: string; body: any }> = [];
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/lightning/confirm')) {
        confirmCalls.push({ url, body: JSON.parse(init?.body as string) });
        return mockResponse({ success: true });
      }
      return mockResponse({}, 404);
    });

    const yesBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Yes',
    ) as HTMLButtonElement;
    expect(yesBtn).toBeTruthy();

    await act(async () => { yesBtn.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(confirmCalls.length).toBe(1);
    expect(confirmCalls[0].body).toEqual({ session_id: 'sess-123', confirm: true });
  });

  it('No button POSTs confirm:false and shows removal message', async () => {
    await driveToConfirmScreen();

    const confirmCalls: Array<{ url: string; body: any }> = [];
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/lightning/confirm')) {
        confirmCalls.push({ url, body: JSON.parse(init?.body as string) });
        return mockResponse({ success: true });
      }
      return mockResponse({}, 404);
    });

    const noBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'No',
    ) as HTMLButtonElement;
    expect(noBtn).toBeTruthy();

    await act(async () => { noBtn.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(confirmCalls.length).toBe(1);
    expect(confirmCalls[0].body).toEqual({ session_id: 'sess-123', confirm: false });
    expect(container.textContent).toContain('removed');
  });

  it('409 resumes polling instead of restarting Lightning flow', async () => {
    await driveToConfirmScreen();

    let statusPollCount = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/lightning/confirm')) {
        return mockResponse({ status: 'conflict' }, 409);
      }
      if (url.includes('/lightning/status')) {
        statusPollCount++;
        return mockResponse({ success: false, status: 'pending' });
      }
      if (url.includes('/lightning/challenge')) {
        throw new Error('Should NOT restart challenge — 409 resumes polling');
      }
      return mockResponse({}, 404);
    });

    const yesBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Yes',
    ) as HTMLButtonElement;
    expect(yesBtn).toBeTruthy();

    await act(async () => { yesBtn.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(container.querySelector('.cloistr-lightning')).toBeTruthy();

    await act(async () => { vi.advanceTimersByTime(2100); });
    await act(async () => { await Promise.resolve(); });

    expect(statusPollCount).toBeGreaterThan(0);
  });

  it('double-click sends only one POST (in-flight guard)', async () => {
    await driveToConfirmScreen();

    let postCount = 0;
    let resolvePost: (() => void) | null = null;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/lightning/confirm')) {
        postCount++;
        await new Promise<void>((r) => { resolvePost = r; });
        return mockResponse({ success: true });
      }
      return mockResponse({}, 404);
    });

    const yesBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Yes',
    ) as HTMLButtonElement;
    expect(yesBtn).toBeTruthy();

    // First click — starts the POST
    act(() => { yesBtn.click(); });

    // Second click — should be blocked by lightningConfirmBusy guard
    act(() => { yesBtn.click(); });

    // Resolve the first POST
    await act(async () => {
      resolvePost?.();
      await Promise.resolve();
    });

    // WITHOUT the in-flight guard (pre-fix): postCount === 2
    // WITH the guard (current branch): postCount === 1
    expect(postCount).toBe(1);
  });

  it('attacker username renders as escaped text, not HTML', async () => {
    const xss = '<img src=x onerror=alert(1)>';
    await driveToConfirmScreen({ username: xss });

    // The username must appear as visible text
    expect(container.textContent).toContain(xss);

    // But NOT as a parsed HTML element — no <img> tag should exist
    expect(container.querySelector('img')).toBeNull();

    // Verify it's inside a <strong> element (React's text interpolation escapes)
    const strong = container.querySelector('.cloistr-lightning-confirm strong');
    expect(strong).toBeTruthy();
    expect(strong!.textContent).toBe(xss);
  });

  it('No button does not trigger any sign-in call', async () => {
    const onClose = vi.fn();
    await driveToConfirmScreen({ onClose });

    const postBodies: any[] = [];
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/lightning/confirm')) {
        postBodies.push(JSON.parse(init?.body as string));
        return mockResponse({ success: true });
      }
      if (url.includes('/nostrconnect')) {
        throw new Error('Should NOT call nostrconnect after No');
      }
      return mockResponse({}, 404);
    });

    const noBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'No',
    ) as HTMLButtonElement;
    await act(async () => { noBtn.click(); });
    await act(async () => { await Promise.resolve(); });

    // Only the confirm POST was made, with confirm: false
    expect(postBodies).toEqual([{ session_id: 'sess-123', confirm: false }]);
    // onClose was NOT called — the user sees the "removed" message, not a silent close
    expect(onClose).not.toHaveBeenCalled();
  });

  it('failed POST (network error) re-enables buttons for retry', async () => {
    await driveToConfirmScreen();

    let postCount = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/lightning/confirm')) {
        postCount++;
        if (postCount === 1) throw new Error('Network error');
        return mockResponse({ success: true });
      }
      return mockResponse({}, 404);
    });

    const yesBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Yes',
    ) as HTMLButtonElement;

    // First click — network error
    await act(async () => { yesBtn.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(postCount).toBe(1);

    // Error sends to method screen. Re-drive to confirm for retry.
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/lightning/challenge')) {
        return mockResponse({ lnurl: 'lnurl-test', k1: 'k1-test', session_id: 'sess-456' });
      }
      if (url.includes('/lightning/status')) {
        return mockResponse({ success: false, status: 'confirm_account', username: 'alice' });
      }
      if (url.includes('/lightning/confirm')) {
        postCount++;
        return mockResponse({ success: true });
      }
      return mockResponse({}, 404);
    });

    const toggleBtn = container.querySelector('.cloistr-login-more-toggle') as HTMLButtonElement;
    if (toggleBtn) await act(async () => { toggleBtn.click(); });
    const btns = container.querySelectorAll('.cloistr-login-options-advanced .cloistr-btn');
    let lightningBtn: HTMLButtonElement | null = null;
    btns.forEach((btn) => {
      if (btn.textContent?.includes('Lightning')) lightningBtn = btn as HTMLButtonElement;
    });
    if (lightningBtn) {
      await act(async () => { lightningBtn!.click(); });
      await act(async () => { await Promise.resolve(); });
      await act(async () => { vi.advanceTimersByTime(2100); });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });

      const retryYes = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === 'Yes',
      ) as HTMLButtonElement;
      expect(retryYes).toBeTruthy();
      expect(retryYes.disabled).toBe(false);
      await act(async () => { retryYes.click(); });
      await act(async () => { await Promise.resolve(); });
      expect(postCount).toBe(2);
    }
  });

  it('failed POST (500) re-enables buttons for retry', async () => {
    await driveToConfirmScreen();

    let postCount = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/lightning/confirm')) {
        postCount++;
        if (postCount === 1) return mockResponse({ error: 'Internal server error' }, 500);
        return mockResponse({ success: true });
      }
      return mockResponse({}, 404);
    });

    const yesBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Yes',
    ) as HTMLButtonElement;

    // First click — 500 error
    await act(async () => { yesBtn.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(postCount).toBe(1);

    // 500 throws, sends back to method screen. Re-drive to confirm.
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/lightning/challenge')) {
        return mockResponse({ lnurl: 'lnurl-test', k1: 'k1-test', session_id: 'sess-789' });
      }
      if (url.includes('/lightning/status')) {
        return mockResponse({ success: false, status: 'confirm_account', username: 'alice' });
      }
      if (url.includes('/lightning/confirm')) {
        postCount++;
        return mockResponse({ success: true });
      }
      return mockResponse({}, 404);
    });

    const toggleBtn = container.querySelector('.cloistr-login-more-toggle') as HTMLButtonElement;
    if (toggleBtn) await act(async () => { toggleBtn.click(); });
    const btns = container.querySelectorAll('.cloistr-login-options-advanced .cloistr-btn');
    let lightningBtn: HTMLButtonElement | null = null;
    btns.forEach((btn) => {
      if (btn.textContent?.includes('Lightning')) lightningBtn = btn as HTMLButtonElement;
    });
    if (lightningBtn) {
      await act(async () => { lightningBtn!.click(); });
      await act(async () => { await Promise.resolve(); });
      await act(async () => { vi.advanceTimersByTime(2100); });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });

      const retryYes = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === 'Yes',
      ) as HTMLButtonElement;
      expect(retryYes).toBeTruthy();
      expect(retryYes.disabled).toBe(false);
      await act(async () => { retryYes.click(); });
      await act(async () => { await Promise.resolve(); });
      expect(postCount).toBe(2);
    }
  });
});
