import { describe, it, expect } from 'vitest';
import { sidebarClasses, sidebarItemClasses, collapsedItemA11y } from './Sidebar.js';

// The modifier classes carry ALL the behaviour: the CSS decides what `--open`
// and `--collapsed` mean at each breakpoint. Getting this mapping wrong is
// exactly how four apps ended up with drawers painted under the sticky header,
// so it is worth pinning even though it looks trivial.
describe('sidebarClasses', () => {
  it('is the bare rail when closed and expanded', () => {
    expect(sidebarClasses(false, false)).toBe('cloistr-sidebar');
  });

  it('marks the open drawer (mobile: slides on screen)', () => {
    expect(sidebarClasses(true, false)).toBe('cloistr-sidebar cloistr-sidebar--open');
  });

  it('marks the collapsed rail (desktop: icons only)', () => {
    expect(sidebarClasses(false, true)).toBe('cloistr-sidebar cloistr-sidebar--collapsed');
  });

  // Both at once is legitimate and must not be collapsed into one state: the
  // app persists a desktop icons-only preference while the phone drawer is
  // open. The two modifiers are independent because the two modes are
  // independent — mobile collapses COMPLETELY, desktop collapses TO ICONS.
  it('carries both modifiers independently', () => {
    expect(sidebarClasses(true, true)).toBe(
      'cloistr-sidebar cloistr-sidebar--open cloistr-sidebar--collapsed'
    );
  });

  it('never emits empty class fragments', () => {
    for (const [o, c] of [[false, false], [true, false], [false, true], [true, true]] as const) {
      expect(sidebarClasses(o, c)).not.toMatch(/\s{2,}|\s$/);
    }
  });
});

describe('sidebarItemClasses', () => {
  it('marks the active item', () => {
    expect(sidebarItemClasses(true)).toBe('cloistr-sidebar-item cloistr-sidebar-item--active');
    expect(sidebarItemClasses(false)).toBe('cloistr-sidebar-item');
  });
});

describe('collapsedItemA11y', () => {
  // Collapsed hides the label, so it has to survive as the accessible name and
  // the tooltip. Without this an icon-only rail is unusable with a screen
  // reader and unguessable with a mouse.
  it('promotes the label to name + tooltip when collapsed', () => {
    expect(collapsedItemA11y(true, 'Inbox')).toEqual({ title: 'Inbox', 'aria-label': 'Inbox' });
  });

  it('adds nothing when expanded — the visible label is the name', () => {
    expect(collapsedItemA11y(false, 'Inbox')).toEqual({});
  });
});
