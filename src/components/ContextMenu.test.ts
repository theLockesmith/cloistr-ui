/**
 * ContextMenu component tests.
 *
 * No DOM environment is available in this package (no jsdom, no
 * @testing-library/react). Tests are split into:
 *
 *   BEHAVIOURAL (pure helpers): contextMenuClasses(), contextMenuItemClasses(),
 *   and clampToViewport() are pure functions. Asserting their output covers
 *   the className and positioning logic without rendering.
 *
 *   SOURCE-LEVEL: invariants that pin the accessibility contract, portal usage,
 *   and structural decisions. These are the things most likely to be
 *   accidentally dropped in a future edit.
 *
 *   CSS PRESENCE: required selectors exist in components.css with the correct
 *   source order.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  contextMenuClasses,
  contextMenuItemClasses,
  clampToViewport,
} from './ContextMenu.js';

const SRC = readFileSync(new URL('./ContextMenu.tsx', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../styles/components.css', import.meta.url), 'utf8');

// --- CLASS-NAME HELPERS (behavioural) ----------------------------------------

describe('contextMenuClasses', () => {
  it('returns the base class with no extras', () => {
    expect(contextMenuClasses()).toBe('cloistr-context-menu');
  });

  it('appends an extra class without double-spacing', () => {
    const result = contextMenuClasses('my-menu');
    expect(result).toBe('cloistr-context-menu my-menu');
    expect(result).not.toMatch(/\s{2,}/);
  });

  it('tolerates empty extra class without trailing whitespace', () => {
    const result = contextMenuClasses('');
    expect(result).toBe('cloistr-context-menu');
    expect(result).not.toMatch(/\s$/);
  });
});

describe('contextMenuItemClasses', () => {
  it('returns the base class for a normal item', () => {
    expect(contextMenuItemClasses()).toBe('cloistr-context-menu-item');
  });

  it('adds the danger modifier', () => {
    expect(contextMenuItemClasses(true)).toBe(
      'cloistr-context-menu-item cloistr-context-menu-item--danger',
    );
  });

  it('adds the disabled modifier', () => {
    expect(contextMenuItemClasses(false, true)).toBe(
      'cloistr-context-menu-item cloistr-context-menu-item--disabled',
    );
  });

  it('adds both modifiers', () => {
    expect(contextMenuItemClasses(true, true)).toBe(
      'cloistr-context-menu-item cloistr-context-menu-item--danger cloistr-context-menu-item--disabled',
    );
  });
});

// --- VIEWPORT CLAMPING (behavioural) -----------------------------------------

describe('clampToViewport', () => {
  const VP_W = 1024;
  const VP_H = 768;
  const MENU_W = 200;
  const MENU_H = 300;
  const MARGIN = 8;

  it('passes through a position that fits', () => {
    const result = clampToViewport(100, 100, MENU_W, MENU_H, VP_W, VP_H);
    expect(result).toEqual({ top: 100, left: 100 });
  });

  it('clamps when the menu would overflow the right edge', () => {
    const result = clampToViewport(900, 100, MENU_W, MENU_H, VP_W, VP_H);
    expect(result.left).toBe(VP_W - MENU_W - MARGIN);
    expect(result.top).toBe(100);
  });

  it('clamps when the menu would overflow the bottom edge', () => {
    const result = clampToViewport(100, 600, MENU_W, MENU_H, VP_W, VP_H);
    expect(result.left).toBe(100);
    expect(result.top).toBe(VP_H - MENU_H - MARGIN);
  });

  it('clamps both axes when near the bottom-right corner', () => {
    const result = clampToViewport(900, 600, MENU_W, MENU_H, VP_W, VP_H);
    expect(result.left).toBe(VP_W - MENU_W - MARGIN);
    expect(result.top).toBe(VP_H - MENU_H - MARGIN);
  });

  it('enforces minimum margin from the top-left', () => {
    const result = clampToViewport(2, 3, MENU_W, MENU_H, VP_W, VP_H);
    expect(result.left).toBe(MARGIN);
    expect(result.top).toBe(MARGIN);
  });
});

// --- SOURCE-LEVEL: TRIGGER HOOK ----------------------------------------------

describe('useContextMenuTrigger source', () => {
  it('only starts the hold timer on the primary button (button 0)', () => {
    // Right-click (button 2) goes through onContextMenu instead. Starting the
    // hold timer on a right-click would cause a double-open: the timer fires
    // AND onContextMenu fires.
    expect(SRC).toContain('e.button !== 0');
  });

  it('swallows the click after a hold by checking firedRef', () => {
    // After a long-press completes (firedRef.current = true), the browser
    // still dispatches a click event. Without this guard a single long-press
    // would both open the menu AND fire onActivate.
    expect(SRC).toContain('firedRef.current');
    expect(SRC).toContain('e.stopPropagation()');
  });

  it('calls preventDefault on the native contextmenu event', () => {
    // Without this the browser context menu would appear alongside ours.
    expect(SRC).toContain('e.preventDefault()');
  });

  it('cleans up the timer on unmount', () => {
    // An uncleaned timer would fire onOpen after the component unmounts,
    // causing a React state update on an unmounted component.
    expect(SRC).toContain('useEffect(() => clear, [clear])');
  });

  it('respects the disabled flag on all interaction paths', () => {
    // Every handler must bail early when disabled. Count the guard lines:
    // onPointerDown, onContextMenu, onClick, onKeyDown = 4 paths.
    const matches = SRC.match(/if \(disabled\) return;/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });
});

// --- SOURCE-LEVEL: MENU COMPONENT -------------------------------------------

describe('ContextMenu source', () => {
  it('portals to document.body', () => {
    // position:fixed inside a sticky/transformed parent breaks because
    // the transform creates a new containing block. The portal escapes
    // all stacking contexts by attaching directly to body.
    expect(SRC).toContain('createPortal(menuContent, document.body)');
  });

  it('uses role="menu" on the container', () => {
    expect(SRC).toContain('role="menu"');
  });

  it('uses role="menuitem" on each entry', () => {
    expect(SRC).toContain('role="menuitem"');
  });

  it('supports Escape to close', () => {
    expect(SRC).toContain("e.key === 'Escape'");
  });

  it('supports ArrowDown and ArrowUp keyboard navigation', () => {
    expect(SRC).toContain("e.key === 'ArrowDown'");
    expect(SRC).toContain("e.key === 'ArrowUp'");
  });

  it('supports Home and End keys', () => {
    expect(SRC).toContain("e.key === 'Home'");
    expect(SRC).toContain("e.key === 'End'");
  });

  it('marks disabled items with aria-disabled', () => {
    expect(SRC).toContain('aria-disabled={item.disabled || undefined}');
  });

  it('closes after activating an item', () => {
    // Each item's onClick must call onClose() so the menu disappears
    // after the user makes a choice.
    expect(SRC).toContain('item.onClick()');
    // onClose follows onClick in the handler.
    const clickIdx = SRC.indexOf('item.onClick()');
    const closeIdx = SRC.indexOf('onClose()', clickIdx);
    expect(closeIdx).toBeGreaterThan(clickIdx);
  });

  it('guards disabled items from activation', () => {
    // Clicking a disabled item must not fire its onClick.
    expect(SRC).toContain('if (item.disabled) return');
  });

  it('excludes disabled items from keyboard focus', () => {
    // The querySelectorAll for keyboard navigation filters out disabled items.
    expect(SRC).toContain(':not([aria-disabled="true"])');
  });

  it('restores focus to the previously active element on close', () => {
    expect(SRC).toContain('previousActiveElement.current?.focus()');
  });
});

// --- CSS PRESENCE ------------------------------------------------------------

describe('ContextMenu CSS', () => {
  it('defines .cloistr-context-menu in components.css', () => {
    expect(CSS).toContain('.cloistr-context-menu');
  });

  it('defines .cloistr-context-menu-item', () => {
    expect(CSS).toContain('.cloistr-context-menu-item');
  });

  it('defines the danger modifier', () => {
    expect(CSS).toContain('.cloistr-context-menu-item--danger');
  });

  it('defines the disabled modifier', () => {
    expect(CSS).toContain('.cloistr-context-menu-item--disabled');
  });

  it('uses position:fixed on the menu', () => {
    // The menu portals to body and positions at viewport coordinates.
    // position:fixed is the only correct value here (not absolute).
    const menuBlock = CSS.slice(
      CSS.indexOf('.cloistr-context-menu {'),
    ).slice(0, 300);
    expect(menuBlock).toContain('position: fixed');
  });

  it('uses the dropdown z-index layer', () => {
    const menuBlock = CSS.slice(
      CSS.indexOf('.cloistr-context-menu {'),
    ).slice(0, 300);
    expect(menuBlock).toContain('var(--cloistr-z-dropdown)');
  });

  it('has hover styles on items', () => {
    expect(CSS).toContain('.cloistr-context-menu-item:hover');
  });

  it('has focus-visible styles on items', () => {
    // Keyboard users need to see which item has focus.
    expect(CSS).toContain('.cloistr-context-menu-item:focus-visible');
  });
});
