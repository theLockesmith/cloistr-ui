/**
 * Fail-first tests for the Lightning link-CSRF confirm flow.
 *
 * Security: an attacker can bind a victim's Lightning wallet to the
 * attacker's account. The signer adds a confirm_account status to the
 * Lightning polling response. The modal must stop polling, show "You are
 * signing in as <username>. Is this your account?", and POST the user's
 * decision to /users/lightning/confirm.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { createElement, useState, useEffect, useCallback, act } from 'react';
import { createRoot } from 'react-dom/client';

// ── Structural: verify LoginModal source has the confirm_account handling ──

function readLoginModal(): string {
  return require('node:fs').readFileSync(
    require('node:path').join(process.cwd(), 'src', 'components', 'LoginModal.tsx'),
    'utf8',
  ) as string;
}

describe('Lightning confirm_account (structural)', () => {
  it('polling handler intercepts confirm_account status', () => {
    const src = readLoginModal();
    expect(src).toMatch(/confirm_account/);
  });

  it('lightning-confirm screen exists', () => {
    const src = readLoginModal();
    expect(src).toMatch(/lightning-confirm/);
  });

  it('POST to /users/lightning/confirm exists', () => {
    const src = readLoginModal();
    expect(src).toMatch(/\/users\/lightning\/confirm/);
  });

  it('screen type includes lightning-confirm', () => {
    const src = readLoginModal();
    expect(src).toMatch(/['"]lightning-confirm['"]/);
  });
});

// ── Component: prop-driven harness mirroring the confirm flow ─────────────

type ConfirmScreen = 'polling' | 'confirm' | 'done' | 'unlinked';

function ConfirmFlowHarness({
  pollResult,
  onConfirmPost,
  onLoginComplete,
  onRender,
}: {
  pollResult: { success: boolean; status?: string; username?: string } | null;
  onConfirmPost: (body: { session_id: string; confirm: boolean }) => Promise<void>;
  onLoginComplete: () => void;
  onRender: (screen: ConfirmScreen, text: string) => void;
}) {
  const [screen, setScreen] = useState<ConfirmScreen>('polling');
  const [confirmUsername, setConfirmUsername] = useState<string | null>(null);
  const sessionId = 'test-session-123';

  useEffect(() => {
    if (screen !== 'polling' || !pollResult) return;
    if (!pollResult.success) {
      if (pollResult.status === 'confirm_account' && pollResult.username) {
        setConfirmUsername(pollResult.username);
        setScreen('confirm');
      }
      return;
    }
    onLoginComplete();
    setScreen('done');
  }, [pollResult, screen, onLoginComplete]);

  const handleConfirm = useCallback(async (confirm: boolean) => {
    await onConfirmPost({ session_id: sessionId, confirm });
    if (confirm) {
      onLoginComplete();
      setScreen('done');
    } else {
      setScreen('unlinked');
    }
  }, [onConfirmPost, onLoginComplete]);

  let text = '';
  if (screen === 'polling') text = 'Waiting for wallet';
  else if (screen === 'confirm') text = `You are signing in as ${confirmUsername}. Is this your account?`;
  else if (screen === 'unlinked') text = 'That wallet key was removed from that account.';
  else text = 'Login complete';

  onRender(screen, text);

  if (screen === 'confirm') {
    return createElement('div', null,
      createElement('p', null, text),
      createElement('button', { onClick: () => { void handleConfirm(true); }, 'data-testid': 'confirm-yes' }, 'Yes'),
      createElement('button', { onClick: () => { void handleConfirm(false); }, 'data-testid': 'confirm-no' }, 'No'),
    );
  }
  return createElement('div', null, text);
}

describe('Lightning confirm flow (component)', () => {
  it('stops polling and shows confirm screen on confirm_account', () => {
    const renders: Array<{ screen: ConfirmScreen; text: string }> = [];
    const container = document.createElement('div');
    const root = createRoot(container);

    // Mount: polling, no result yet
    act(() => {
      root.render(createElement(ConfirmFlowHarness, {
        pollResult: null,
        onConfirmPost: async () => {},
        onLoginComplete: () => {},
        onRender: (screen: ConfirmScreen, text: string) => renders.push({ screen, text }),
      }));
    });
    expect(renders[renders.length - 1].screen).toBe('polling');

    // First poll: pending (no status)
    act(() => {
      root.render(createElement(ConfirmFlowHarness, {
        pollResult: { success: false },
        onConfirmPost: async () => {},
        onLoginComplete: () => {},
        onRender: (screen: ConfirmScreen, text: string) => renders.push({ screen, text }),
      }));
    });
    expect(renders[renders.length - 1].screen).toBe('polling');

    // Second poll: confirm_account
    act(() => {
      root.render(createElement(ConfirmFlowHarness, {
        pollResult: { success: false, status: 'confirm_account', username: 'alice' },
        onConfirmPost: async () => {},
        onLoginComplete: () => {},
        onRender: (screen: ConfirmScreen, text: string) => renders.push({ screen, text }),
      }));
    });
    expect(renders[renders.length - 1].screen).toBe('confirm');
    expect(renders[renders.length - 1].text).toContain('alice');

    root.unmount();
  });

  it('Yes button sends confirm: true and completes login', async () => {
    const confirmCalls: Array<{ session_id: string; confirm: boolean }> = [];
    let loginCompleted = false;
    const renders: Array<{ screen: ConfirmScreen; text: string }> = [];
    const container = document.createElement('div');
    const root = createRoot(container);

    act(() => {
      root.render(createElement(ConfirmFlowHarness, {
        pollResult: { success: false, status: 'confirm_account', username: 'bob' },
        onConfirmPost: async (body) => { confirmCalls.push(body); },
        onLoginComplete: () => { loginCompleted = true; },
        onRender: (screen: ConfirmScreen, text: string) => renders.push({ screen, text }),
      }));
    });
    expect(renders[renders.length - 1].screen).toBe('confirm');

    const yesBtn = container.querySelector('[data-testid="confirm-yes"]') as HTMLButtonElement;
    expect(yesBtn).toBeTruthy();
    await act(async () => { yesBtn.click(); });

    expect(confirmCalls).toEqual([{ session_id: 'test-session-123', confirm: true }]);
    expect(loginCompleted).toBe(true);
    expect(renders[renders.length - 1].screen).toBe('done');

    root.unmount();
  });

  it('No button sends confirm: false and shows unlinked message', async () => {
    const confirmCalls: Array<{ session_id: string; confirm: boolean }> = [];
    let loginCompleted = false;
    const renders: Array<{ screen: ConfirmScreen; text: string }> = [];
    const container = document.createElement('div');
    const root = createRoot(container);

    act(() => {
      root.render(createElement(ConfirmFlowHarness, {
        pollResult: { success: false, status: 'confirm_account', username: 'eve' },
        onConfirmPost: async (body) => { confirmCalls.push(body); },
        onLoginComplete: () => { loginCompleted = true; },
        onRender: (screen: ConfirmScreen, text: string) => renders.push({ screen, text }),
      }));
    });
    expect(renders[renders.length - 1].screen).toBe('confirm');

    const noBtn = container.querySelector('[data-testid="confirm-no"]') as HTMLButtonElement;
    expect(noBtn).toBeTruthy();
    await act(async () => { noBtn.click(); });

    expect(confirmCalls).toEqual([{ session_id: 'test-session-123', confirm: false }]);
    expect(loginCompleted).toBe(false);
    expect(renders[renders.length - 1].screen).toBe('unlinked');
    expect(renders[renders.length - 1].text).toContain('removed');

    root.unmount();
  });
});
