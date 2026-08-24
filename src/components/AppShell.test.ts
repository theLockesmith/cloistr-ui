import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { appShellChrome, menuItemState, APPSHELL_BREAKPOINT } from './AppShell.js';

/**
 * AppShell encodes architecture/navigation-model.md. The decisions live in pure
 * functions so they can be pinned without a DOM, the same way Sidebar's
 * two-mode behaviour is pinned — the mapping is where the bugs are, not the
 * markup.
 *
 * Context for why these are worth pinning: three apps shipped their own
 * hamburger outside the shared header (docs 390x31, sheets 56x36, slides
 * 44x36), all under the 44x44 tap minimum, with 17 and 13 app commands rendered
 * expanded beside them. See cloistr/docs/2026-08-24-office-app-audit.md.
 */

describe('appShellChrome', () => {
  // Desktop: show structure, do not hide it. Hiding navigation on a wide
  // screen wastes the screen and hides the product.
  it('desktop with nav and menu: sidebar + menu bar, NO hamburger', () => {
    expect(appShellChrome({ isMobile: false, hasNav: true, hasMenu: true })).toEqual({
      hamburger: false,
      menuBar: true,
      sidebar: true,
    });
  });

  it('desktop with neither: no chrome at all', () => {
    expect(appShellChrome({ isMobile: false, hasNav: false, hasMenu: false })).toEqual({
      hamburger: false,
      menuBar: false,
      sidebar: false,
    });
  });

  // Mobile: exactly ONE hamburger, and the menu bar collapses INTO it. The bar
  // must not also render — that is the docs/slides bug, where the hamburger and
  // the full command set were on screen together.
  it('mobile with nav and menu: hamburger only, no bar, no in-flow sidebar', () => {
    expect(appShellChrome({ isMobile: true, hasNav: true, hasMenu: true })).toEqual({
      hamburger: true,
      menuBar: false,
      sidebar: false,
    });
  });

  it('mobile with nav only: still one hamburger', () => {
    expect(appShellChrome({ isMobile: true, hasNav: true, hasMenu: false }).hamburger).toBe(true);
  });

  it('mobile with menu only: still one hamburger', () => {
    expect(appShellChrome({ isMobile: true, hasNav: false, hasMenu: true }).hamburger).toBe(true);
  });

  // "If an app has neither nav nor commands, the hamburger is NOT rendered.
  //  An empty drawer is worse than no control."
  it('mobile with NEITHER: no hamburger', () => {
    expect(appShellChrome({ isMobile: true, hasNav: false, hasMenu: false }).hamburger).toBe(false);
  });

  it('breakpoint is 768, matching the model', () => {
    expect(APPSHELL_BREAKPOINT).toBe(768);
  });
});

describe('menuItemState', () => {
  // "An enabled item that does nothing is worse than a missing item, because it
  //  teaches the user the app is broken." slides ships `Format > Theme…`
  // enabled and inert; this makes that shape unrepresentable.
  it('an item WITHOUT onSelect is disabled and carries its reason', () => {
    expect(menuItemState({ label: 'Publish', disabledReason: 'Sign in to publish' })).toEqual({
      disabled: true,
      title: 'Sign in to publish',
    });
  });

  it('an item WITH onSelect is enabled and has no title', () => {
    expect(menuItemState({ label: 'New', onSelect: () => {} })).toEqual({
      disabled: false,
      title: undefined,
    });
  });

  it('a disabled item with no reason is still disabled', () => {
    // Undesirable but honest: disabled and unexplained beats enabled and inert.
    expect(menuItemState({ label: 'Publish' })).toEqual({ disabled: true, title: undefined });
  });
});

describe('AppShell styles', () => {
  const css = () => readFileSync(resolve(process.cwd(), 'src/styles/components.css'), 'utf8');

  it('gives the hamburger a >=44x44 tap target', () => {
    // The three app-owned hamburgers this replaces were 31, 36 and 36px tall.
    // Asserted against the CSS SOURCE because that is the artifact that ships;
    // the runtime check is CC-LAYOUT-2 in the checklist suite, which measures
    // getBoundingClientRect against production.
    const rule = /\.cloistr-appshell-hamburger[^{]*\{([^}]*)\}/.exec(css());
    expect(rule, '.cloistr-appshell-hamburger rule missing from components.css').toBeTruthy();
    const minW = /min-width:\s*(\d+)px/.exec(rule![1]);
    const minH = /min-height:\s*(\d+)px/.exec(rule![1]);
    expect(minW, 'hamburger has no min-width').toBeTruthy();
    expect(minH, 'hamburger has no min-height').toBeTruthy();
    expect(Number(minW![1])).toBeGreaterThanOrEqual(44);
    expect(Number(minH![1])).toBeGreaterThanOrEqual(44);
  });

  it('gives menu items a >=44px row so they are tappable', () => {
    const rule = /\.cloistr-appshell-menuitem\s*\{([^}]*)\}/.exec(css());
    expect(rule).toBeTruthy();
    const minH = /min-height:\s*(\d+)px/.exec(rule![1]);
    expect(minH).toBeTruthy();
    expect(Number(minH![1])).toBeGreaterThanOrEqual(44);
  });

  it('sizes the shell in dvh so the mobile URL bar cannot clip it', () => {
    // The package-wide sweep in Button.test.ts already forbids the static
    // viewport unit anywhere in source; this pins that the shell root actually
    // sets a dynamic height rather than leaving it unset.
    const rule = /\.cloistr-appshell\s*\{([^}]*)\}/.exec(css());
    expect(rule).toBeTruthy();
    expect(rule![1]).toMatch(/100dvh/);
  });

  it('paints the drawer ABOVE the scrim, and the scrim above the page', () => {
    // Four apps independently chose a z-index below the sticky header and
    // painted the header over their own open drawer.
    const scrim = /\.cloistr-appshell-scrim\s*\{([^}]*)\}/.exec(css());
    const drawer = /\.cloistr-appshell-drawer\s*\{([^}]*)\}/.exec(css());
    expect(scrim).toBeTruthy();
    expect(drawer).toBeTruthy();
    expect(scrim![1]).toMatch(/z-index/);
    expect(drawer![1]).toMatch(/z-index/);
  });
});
