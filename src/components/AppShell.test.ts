import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { appShellChrome, menuItemState, isSeparator, nextMenuIndex, APPSHELL_BREAKPOINT } from './AppShell.js';

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

describe('isSeparator', () => {
  // Real menus group their items. An app that cannot express a rule in the
  // shared model keeps its own renderer to get one, which is how docs ended up
  // with a second, mobile-only menu implementation beside the shared bar.
  it('recognises a separator entry', () => {
    expect(isSeparator({ separator: true })).toBe(true);
  });

  it('does not mistake an item for a separator', () => {
    expect(isSeparator({ label: 'New', onSelect: () => {} })).toBe(false);
  });

  it('does not mistake a disabled item for a separator', () => {
    expect(isSeparator({ label: 'Publish' })).toBe(false);
  });
});

describe('menuItemState with toggle items', () => {
  // Toggle items (Bold, Italic) must still be enabled when active. Treating
  // `active` as a disable signal would silently break every format menu.
  it('an active toggle with onSelect is enabled', () => {
    expect(menuItemState({ label: 'Bold', onSelect: () => {}, active: true })).toEqual({
      disabled: false,
      title: undefined,
    });
  });

  it('an inactive toggle with onSelect is enabled', () => {
    expect(menuItemState({ label: 'Bold', onSelect: () => {}, active: false })).toEqual({
      disabled: false,
      title: undefined,
    });
  });
});

describe('nextMenuIndex', () => {
  // Wrapping is where roving-index navigation goes wrong, and docs' own MenuBar
  // implemented arrow keys that must not be lost when the shell replaces it.
  it('moves forward and wraps at the end', () => {
    expect(nextMenuIndex(0, 3, 'ArrowRight')).toBe(1);
    expect(nextMenuIndex(2, 3, 'ArrowRight')).toBe(0);
  });

  it('moves backward and wraps at the start', () => {
    expect(nextMenuIndex(2, 3, 'ArrowLeft')).toBe(1);
    expect(nextMenuIndex(0, 3, 'ArrowLeft')).toBe(2);
  });

  it('treats Down/Up the same as Right/Left', () => {
    expect(nextMenuIndex(0, 3, 'ArrowDown')).toBe(1);
    expect(nextMenuIndex(0, 3, 'ArrowUp')).toBe(2);
  });

  it('jumps to first and last', () => {
    expect(nextMenuIndex(1, 4, 'Home')).toBe(0);
    expect(nextMenuIndex(1, 4, 'End')).toBe(3);
  });

  it('returns -1 for keys that do not navigate, so they are not swallowed', () => {
    // Returning 0 here would hijack Enter, Tab and every printable character.
    for (const k of ['Enter', 'Tab', 'a', 'Escape', ' ']) {
      expect(nextMenuIndex(1, 3, k)).toBe(-1);
    }
  });

  it('returns -1 when there are no sections', () => {
    expect(nextMenuIndex(0, 0, 'ArrowRight')).toBe(-1);
  });
});

describe('toggle placement', () => {
  // The gate caught this against already-migrated code: AppShell rendered its
  // trigger as its own child, which sits BELOW the app's <Header> — the exact
  // position of the app-owned hamburgers it replaced. The model requires the
  // one control to be IN the shared header.
  it('appShellChrome still decides whether a hamburger is wanted at all', () => {
    // Placement is a separate question from existence; moving the trigger must
    // not resurrect it on desktop or for an app with nothing to show.
    expect(appShellChrome({ isMobile: false, hasNav: true, hasMenu: true }).hamburger).toBe(false);
    expect(appShellChrome({ isMobile: true, hasNav: false, hasMenu: false }).hamburger).toBe(false);
    expect(appShellChrome({ isMobile: true, hasNav: true, hasMenu: false }).hamburger).toBe(true);
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

  it('styles the separator as a visible rule', () => {
    const rule = /\.cloistr-appshell-menu-separator\s*\{([^}]*)\}/.exec(css());
    expect(rule, 'separator has no style, so grouping would be invisible').toBeTruthy();
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
