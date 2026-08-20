import { readFileSync } from 'node:fs';
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

/**
 * The `children` slot exists so an app with richer navigation than a flat list
 * can still use this shell. Stash's sidebar is a folder TREE, which cannot be
 * expressed as SidebarItem[], so before this it kept its own 258-line
 * implementation — the exact divergence this component exists to end.
 */
describe('Sidebar children slot', () => {
  const src = readFileSync(new URL('./Sidebar.tsx', import.meta.url), 'utf8');

  it('accepts children in its props', () => {
    expect(src).toMatch(/children\?: ReactNode/);
  });

  it('destructures children in the component', () => {
    const body = src.slice(src.indexOf('export function Sidebar('));
    expect(body.slice(0, 500)).toContain('children');
  });

  it('renders children OUTSIDE the nav element', () => {
    // An app with richer navigation brings its own <nav> elements (stash has
    // two). Nesting them would put landmarks inside landmarks. Scrolling is
    // unaffected: overflow lives on .cloistr-sidebar, not .cloistr-sidebar-nav.
    const nav = src.slice(src.indexOf('<nav'), src.indexOf('</nav>'));
    expect(nav).not.toContain('{children}');
    expect(src).toContain('{children}');
  });

  it('renders children after the item list, not instead of it', () => {
    // An app may want both: standard items AND a tree.
    expect(src.indexOf('</nav>')).toBeLessThan(src.indexOf('{children}'));
  });

  it('skips the nav landmark entirely when there are no items', () => {
    // An empty <nav> is a landmark a screen-reader user steps through for
    // nothing, which is the common case for a children-only sidebar.
    expect(src).toContain('items.length > 0 &&');
  });
});
