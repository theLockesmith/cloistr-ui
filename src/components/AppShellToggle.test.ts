/**
 * AppShellToggle's aria-expanded must describe only what the toggle controls
 * at this viewport: the drawer on mobile, the rail on desktop. It used to say
 * `open || !collapsed`, so on a phone, in any app that does not pass
 * `collapsed`, a CLOSED drawer read as expanded (found by cloistr-mail, which
 * had to work around it).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell, AppShellToggle, toggleExpanded, APPSHELL_BREAKPOINT } from './AppShell.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('toggleExpanded', () => {
  it('mobile: the drawer alone decides, whatever the rail says', () => {
    expect(toggleExpanded({ isMobile: true, drawerOpen: false, railCollapsed: false })).toBe(false);
    expect(toggleExpanded({ isMobile: true, drawerOpen: true, railCollapsed: true })).toBe(true);
  });
  it('desktop: the rail alone decides', () => {
    expect(toggleExpanded({ isMobile: false, drawerOpen: false, railCollapsed: false })).toBe(true);
    expect(toggleExpanded({ isMobile: false, drawerOpen: true, railCollapsed: true })).toBe(false);
  });
});

/** matchMedia answering for a viewport `width` pixels wide. */
function viewport(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === `(min-width: ${APPSHELL_BREAKPOINT}px)` ? width >= APPSHELL_BREAKPOINT : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('AppShellToggle aria-expanded (mounted, uncontrolled collapse)', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const mount = () =>
    act(() => {
      root.render(
        createElement(
          AppShell,
          {
            serviceId: 'test',
            nav: createElement('nav', null, 'nav'),
            toggleInHeader: true,
          },
          createElement(AppShellToggle),
        ),
      );
    });
  const toggle = () =>
    container.querySelector('[data-testid="appshell-hamburger"] button') as HTMLButtonElement;

  it('phone: a closed drawer reads collapsed, an open one expanded', () => {
    viewport(390);
    mount();
    expect(toggle()).toBeTruthy();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    act(() => toggle().click());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    act(() => toggle().click());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('desktop: an open rail reads expanded, a collapsed one not', () => {
    viewport(1280);
    mount();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    act(() => toggle().click());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });
});
