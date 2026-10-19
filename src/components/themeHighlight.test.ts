/**
 * The selected theme must be the highlighted one in the Appearance control.
 *
 * Bug: choosing "Dark" applied the theme but left "System" highlighted.
 * Seen on prod Stash, 0.50.0.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('../lib/runtimeConfig.js', () => ({
  getCookieDomain: () => null,
  getBaseDomain: () => 'cloistr.xyz',
  getServiceUrlOverrides: () => ({}),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  try { localStorage.clear(); } catch {}
  document.cookie = 'cloistr-theme=; max-age=0';
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function activeButtonLabels(): string[] {
  return Array.from(
    document.querySelectorAll('.cloistr-apps-theme-btn--active'),
  ).map((el) => el.textContent?.trim() ?? '');
}

function pressedButtonLabels(): string[] {
  return Array.from(
    document.querySelectorAll('.cloistr-apps-theme-btn[aria-pressed="true"]'),
  ).map((el) => el.textContent?.trim() ?? '');
}

function clickThemeButton(label: string): void {
  const btns = Array.from(
    document.querySelectorAll('.cloistr-apps-theme-btn'),
  );
  const btn = btns.find((b) => b.textContent?.includes(label));
  if (!btn) throw new Error(`No theme button found with label "${label}"`);
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function openMenu(): void {
  const trigger = document.querySelector('.cloistr-apps-trigger') as HTMLElement;
  if (!trigger) throw new Error('No apps trigger found');
  trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('ServiceMenu theme highlight', () => {
  it('defaults to System highlighted', async () => {
    const { ThemeProvider } = await import('./ThemeProvider.js');
    const { ServiceMenu, defaultServices } = await import('./ServiceMenu.js');

    await act(async () => {
      root.render(
        createElement(ThemeProvider, null,
          createElement(ServiceMenu, { services: defaultServices }),
        ),
      );
    });

    await act(async () => openMenu());

    expect(activeButtonLabels()).toEqual(['🖥️System']);
    expect(pressedButtonLabels()).toEqual(['🖥️System']);
  });

  it('clicking Dark highlights Dark, not System', async () => {
    const { ThemeProvider } = await import('./ThemeProvider.js');
    const { ServiceMenu, defaultServices } = await import('./ServiceMenu.js');

    await act(async () => {
      root.render(
        createElement(ThemeProvider, null,
          createElement(ServiceMenu, { services: defaultServices }),
        ),
      );
    });

    await act(async () => openMenu());
    await act(async () => clickThemeButton('Dark'));

    expect(activeButtonLabels()).toEqual(['🌙Dark']);
    expect(pressedButtonLabels()).toEqual(['🌙Dark']);
  });

  it('clicking Light highlights Light', async () => {
    const { ThemeProvider } = await import('./ThemeProvider.js');
    const { ServiceMenu, defaultServices } = await import('./ServiceMenu.js');

    await act(async () => {
      root.render(
        createElement(ThemeProvider, null,
          createElement(ServiceMenu, { services: defaultServices }),
        ),
      );
    });

    await act(async () => openMenu());
    await act(async () => clickThemeButton('Light'));

    expect(activeButtonLabels()).toEqual(['☀️Light']);
    expect(pressedButtonLabels()).toEqual(['☀️Light']);
  });

  it('cycling through all three modes highlights each in turn', async () => {
    const { ThemeProvider } = await import('./ThemeProvider.js');
    const { ServiceMenu, defaultServices } = await import('./ServiceMenu.js');

    await act(async () => {
      root.render(
        createElement(ThemeProvider, null,
          createElement(ServiceMenu, { services: defaultServices }),
        ),
      );
    });

    await act(async () => openMenu());

    await act(async () => clickThemeButton('Dark'));
    expect(pressedButtonLabels()).toEqual(['🌙Dark']);

    await act(async () => clickThemeButton('Light'));
    expect(pressedButtonLabels()).toEqual(['☀️Light']);

    await act(async () => clickThemeButton('System'));
    expect(pressedButtonLabels()).toEqual(['🖥️System']);
  });
});
