/**
 * AppShell contract tests.
 *
 * These encode architecture/navigation-model.md. They are written BEFORE the
 * component because the office-app audit (2026-08-24) found that 38 of 42
 * checklist tests could not fail, and the one item guarding "exactly one
 * hamburger" had no assertion at all. AppShell is the fix for the three
 * app-owned hamburgers that shipped; it must not repeat the pattern.
 *
 * The model's rules, restated as testable claims:
 *   - Desktop (>=768px): sidebar and menu bar visible, NO hamburger anywhere.
 *   - Mobile (<768px): exactly ONE hamburger, and it is in the shared header.
 *   - No nav and no menu => the hamburger is not rendered at all.
 *   - `menu` is DATA, not JSX, so one definition renders both presentations.
 *   - An item with no onSelect renders DISABLED with its reason, never as an
 *     enabled no-op ("an enabled item that does nothing is worse than a
 *     missing item").
 *   - The drawer closes on selection, Escape and outside click.
 *   - The trigger is at least 44x44.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppShell } from './AppShell';
import type { MenuSection } from './AppShell';

/** jsdom has no matchMedia; AppShell uses it for the 768px breakpoint. */
function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
  window.matchMedia = ((query: string) => {
    const m = /min-width:\s*(\d+)px/.exec(query);
    const min = m ? Number(m[1]) : 0;
    return {
      matches: width >= min,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

const MENU: MenuSection[] = [
  {
    label: 'File',
    items: [
      { label: 'New', onSelect: vi.fn() },
      { label: 'Export as PDF', onSelect: vi.fn(), shortcut: 'Ctrl+Shift+D' },
      { label: 'Publish', disabledReason: 'Sign in to publish' },
    ],
  },
  { label: 'Edit', items: [{ label: 'Undo', onSelect: vi.fn() }] },
];

const DESKTOP = 1440;
const MOBILE = 390;

beforeEach(() => setViewport(DESKTOP));
afterEach(() => vi.clearAllMocks());

const hamburger = () => screen.queryByTestId('appshell-hamburger');

describe('AppShell / desktop (>=768px)', () => {
  it('renders NO hamburger, because hiding nav on a wide screen hides the product', () => {
    setViewport(DESKTOP);
    render(
      <AppShell serviceId="docs" nav={<div>Folders</div>} menu={MENU}>
        <p>content</p>
      </AppShell>,
    );
    expect(hamburger()).toBeNull();
  });

  it('shows the sidebar and the menu bar', () => {
    setViewport(DESKTOP);
    render(
      <AppShell serviceId="docs" nav={<div>Folders</div>} menu={MENU}>
        <p>content</p>
      </AppShell>,
    );
    expect(screen.getByText('Folders')).toBeTruthy();
    const bar = screen.getByRole('menubar');
    expect(within(bar).getByText('File')).toBeTruthy();
    expect(within(bar).getByText('Edit')).toBeTruthy();
  });

  it('renders children', () => {
    render(<AppShell serviceId="docs"><p>content</p></AppShell>);
    expect(screen.getByText('content')).toBeTruthy();
  });
});

describe('AppShell / mobile (<768px)', () => {
  beforeEach(() => setViewport(MOBILE));

  it('renders EXACTLY ONE hamburger', () => {
    render(
      <AppShell serviceId="docs" nav={<div>Folders</div>} menu={MENU}>
        <p>c</p>
      </AppShell>,
    );
    expect(screen.getAllByTestId('appshell-hamburger')).toHaveLength(1);
  });

  it('does NOT render a hamburger when there is neither nav nor menu', () => {
    // "An empty drawer is worse than no control."
    render(<AppShell serviceId="tasks"><p>c</p></AppShell>);
    expect(hamburger()).toBeNull();
  });

  it('renders a hamburger with nav only, and with menu only', () => {
    const { unmount } = render(<AppShell serviceId="a" nav={<div>N</div>}><p>c</p></AppShell>);
    expect(hamburger()).not.toBeNull();
    unmount();
    render(<AppShell serviceId="b" menu={MENU}><p>c</p></AppShell>);
    expect(hamburger()).not.toBeNull();
  });

  it('does not render the horizontal menu bar (it collapses into the drawer)', () => {
    render(<AppShell serviceId="docs" menu={MENU}><p>c</p></AppShell>);
    expect(screen.queryByRole('menubar')).toBeNull();
  });

  it('the shipped CSS gives the trigger a >=44x44 tap target', () => {
    // jsdom does not load the external stylesheet, so getComputedStyle here
    // returns empty and an assertion on it would pass vacuously. That is the
    // exact silent-pass shape this suite exists to avoid, so assert on the CSS
    // SOURCE instead: it is the artifact that actually ships.
    //
    // The three app-owned hamburgers this component replaces were 31, 36 and
    // 36px tall. The rule below is load-bearing.
    //
    // The runtime check lives in the checklist suite (CC-LAYOUT-2), which
    // measures getBoundingClientRect against production.
    const css = readFileSync(resolve(process.cwd(), 'src/styles/components.css'), 'utf8');
    const rule = /\.cloistr-appshell-hamburger\s*\{([^}]*)\}/.exec(css);
    expect(rule, '.cloistr-appshell-hamburger rule is missing from components.css').toBeTruthy();
    const body = rule![1];
    const minW = /min-width:\s*(\d+)px/.exec(body);
    const minH = /min-height:\s*(\d+)px/.exec(body);
    expect(minW, 'hamburger has no min-width').toBeTruthy();
    expect(minH, 'hamburger has no min-height').toBeTruthy();
    expect(Number(minW![1])).toBeGreaterThanOrEqual(44);
    expect(Number(minH![1])).toBeGreaterThanOrEqual(44);
  });

  it('the drawer is closed until the trigger is pressed', () => {
    render(<AppShell serviceId="docs" nav={<div>Folders</div>} menu={MENU}><p>c</p></AppShell>);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByTestId('appshell-hamburger'));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('puts in-app navigation ABOVE app commands in the drawer', () => {
    render(<AppShell serviceId="docs" nav={<div>Folders</div>} menu={MENU}><p>c</p></AppShell>);
    fireEvent.click(screen.getByTestId('appshell-hamburger'));
    const drawer = screen.getByRole('dialog');
    const navIdx = drawer.innerHTML.indexOf('Folders');
    const menuIdx = drawer.innerHTML.indexOf('File');
    expect(navIdx).toBeGreaterThanOrEqual(0);
    expect(menuIdx).toBeGreaterThanOrEqual(0);
    expect(navIdx).toBeLessThan(menuIdx);
  });

  it('closes on Escape', () => {
    render(<AppShell serviceId="docs" menu={MENU}><p>c</p></AppShell>);
    fireEvent.click(screen.getByTestId('appshell-hamburger'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on outside click', () => {
    render(<AppShell serviceId="docs" menu={MENU}><p>c</p></AppShell>);
    fireEvent.click(screen.getByTestId('appshell-hamburger'));
    fireEvent.click(screen.getByTestId('appshell-scrim'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on selection', () => {
    render(<AppShell serviceId="docs" menu={MENU}><p>c</p></AppShell>);
    fireEvent.click(screen.getByTestId('appshell-hamburger'));
    fireEvent.click(screen.getByText('File'));
    fireEvent.click(screen.getByText('New'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('AppShell / menu items', () => {
  it('an item WITHOUT onSelect is disabled and shows its reason', () => {
    // "An enabled item that does nothing is worse than a missing item,
    //  because it teaches the user the app is broken."
    setViewport(DESKTOP);
    render(<AppShell serviceId="docs" menu={MENU}><p>c</p></AppShell>);
    fireEvent.click(screen.getByText('File'));
    const item = screen.getByRole('menuitem', { name: /Publish/ });
    expect(item.hasAttribute('disabled')).toBe(true);
    expect(item.getAttribute('title')).toBe('Sign in to publish');
  });

  it('an item WITH onSelect fires it', () => {
    setViewport(DESKTOP);
    const onSelect = vi.fn();
    render(
      <AppShell serviceId="docs" menu={[{ label: 'File', items: [{ label: 'New', onSelect }] }]}>
        <p>c</p>
      </AppShell>,
    );
    fireEvent.click(screen.getByText('File'));
    fireEvent.click(screen.getByText('New'));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('renders the shortcut text when given', () => {
    setViewport(DESKTOP);
    render(<AppShell serviceId="docs" menu={MENU}><p>c</p></AppShell>);
    fireEvent.click(screen.getByText('File'));
    expect(screen.getByText('Ctrl+Shift+D')).toBeTruthy();
  });

  it('the SAME menu data renders on desktop and mobile', () => {
    // The load-bearing reason `menu` is data and not JSX.
    setViewport(DESKTOP);
    const { unmount } = render(<AppShell serviceId="docs" menu={MENU}><p>c</p></AppShell>);
    fireEvent.click(screen.getByText('File'));
    expect(screen.getByText('Export as PDF')).toBeTruthy();
    unmount();

    setViewport(MOBILE);
    render(<AppShell serviceId="docs" menu={MENU}><p>c</p></AppShell>);
    fireEvent.click(screen.getByTestId('appshell-hamburger'));
    fireEvent.click(screen.getByText('File'));
    expect(screen.getByText('Export as PDF')).toBeTruthy();
  });
});
