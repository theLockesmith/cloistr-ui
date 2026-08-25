import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { SidebarToggle } from './Sidebar.js';

/**
 * AppShell — the shared application chrome.
 *
 * WHY THIS EXISTS
 *
 * `Sidebar` fixed the hand-rolled drawers. It did not fix the second problem:
 * apps also hand-roll their own MENU control, separately from their sidebar.
 * Measured in production on 2026-08-24 at 390x844, authenticated, inside a real
 * document:
 *
 *   docs        button.menubar-hamburger         390x31  + 17 expanded commands
 *   sheets      button (no class), "Open menu"     56x36  + Univer's own ribbon
 *   slides      button.slides-menubar-hamburger    44x36  + 13 expanded commands
 *   whiteboard  none                                      (extends Excalidraw)
 *
 * Three apps, three different class names, one with no class at all, every one
 * below the 44x44 tap minimum, none of them in the shared header. On a phone a
 * user in docs sees three controls that all read as "menu": the 9-dot apps
 * switcher, the shared sidebar toggle, and docs' own `menubar-hamburger`.
 *
 * THE CONTRACT
 *
 * Apps DECLARE what they have; the shell decides how to present it.
 *
 *   <AppShell serviceId="docs" nav={<FolderTree/>} menu={sections}>
 *
 * `menu` is DATA, not JSX. That is the load-bearing decision. A rendered
 * <MenuBar> can only ever be a horizontal bar; a data structure renders as a
 * bar on desktop AND as collapsible drawer sections on mobile from ONE
 * definition. Passing JSX is what forced each app to build a second mobile
 * menu, which is how three separate hamburgers came to exist.
 *
 * RULES (architecture/navigation-model.md)
 *   - Desktop (>=768px): sidebar and menu bar shown, NO hamburger. Hiding
 *     navigation on a wide screen wastes the screen and hides the product.
 *   - Mobile (<768px): exactly ONE hamburger, reusing `SidebarToggle` so the
 *     glyph and a11y match the rest of the fleet. It opens ONE drawer, with
 *     in-app nav ABOVE app commands.
 *   - Neither nav nor menu => no hamburger. An empty drawer is worse than no
 *     control.
 *   - The 9-dot ServiceMenu is NOT a hamburger and must never be restyled into
 *     one.
 */

export interface MenuItem {
  /** e.g. "Export as PDF" */
  label: string;
  /** Absent => rendered DISABLED. Never an enabled no-op. */
  onSelect?: () => void;
  /** e.g. "Ctrl+Shift+D". Must actually perform the action. */
  shortcut?: string;
  /** Shown when there is no onSelect, so a disabled item explains itself. */
  disabledReason?: string;
  /**
   * Toggle-style items (Bold, Italic, a view mode) render a checkmark when on.
   * Without this apps keep their own menu renderer just to show state, which is
   * how docs ended up with a second, mobile-only menu implementation.
   */
  active?: boolean;
}

/**
 * A rule between groups of items. Real menus group ("Undo/Redo" apart from
 * "Cut/Copy/Paste"), and an app that cannot express that in the shared model
 * keeps its own renderer instead.
 */
export interface MenuSeparator {
  separator: true;
}

export type MenuEntry = MenuItem | MenuSeparator;

export function isSeparator(entry: MenuEntry): entry is MenuSeparator {
  return 'separator' in entry && entry.separator === true;
}

export interface MenuSection {
  /** e.g. "File" */
  label: string;
  items: MenuEntry[];
}

/**
 * Drawer state, so the trigger can live somewhere else in the tree.
 *
 * The model says the ONE control belongs "in the shared header, in the same
 * position in every app". AppShell originally rendered it as its own child,
 * which sits BELOW the app's <Header> — the same position as the app-owned
 * hamburgers it replaced, and the pre-merge gate caught that on its first run
 * against already-migrated code.
 *
 * Apps render <Header><AppShellToggle /></Header> inside <AppShell> so the
 * trigger is a real descendant of <header>.
 */
interface AppShellContextValue {
  open: boolean;
  toggle: () => void;
  /** True when a hamburger should exist at all: mobile, and there is something to show. */
  wanted: boolean;
}

const AppShellContext = createContext<AppShellContextValue | null>(null);

/**
 * The single nav trigger, placed by the app inside the shared Header.
 *
 * Renders nothing on desktop, and nothing when the app has neither nav nor
 * commands — an empty drawer is worse than no control.
 */
export function AppShellToggle({ className }: { className?: string } = {}) {
  const ctx = useContext(AppShellContext);
  // Subscribe to the slot's existence so the first render after Header mounts
  // still lands in the right place. Returning null on the server keeps this
  // safe outside a browser.
  const slot = useSyncExternalStore(
    subscribeToSlot,
    () => document.querySelector('[data-appshell-slot]'),
    () => null,
  );

  if (!ctx || !ctx.wanted) return null;

  const button = (
    <div className={`cloistr-appshell-hamburger ${className ?? ''}`.trim()} data-testid="appshell-hamburger">
      <SidebarToggle expanded={ctx.open} onClick={ctx.toggle} />
    </div>
  );

  // Portal into the shared Header when it is present. React context follows the
  // REACT tree, not the DOM tree, so the drawer state still reaches this button
  // even though it renders inside <header>.
  return slot ? createPortal(button, slot) : button;
}

/**
 * The Header may mount after AppShell. Re-read the slot on the next frames so
 * the toggle does not silently fall back to inline placement forever because it
 * looked once, too early — which would reintroduce a trigger below the header,
 * the exact defect this replaces.
 */
function subscribeToSlot(onChange: () => void): () => void {
  if (typeof MutationObserver === 'undefined') return () => {};
  const obs = new MutationObserver(onChange);
  obs.observe(document.body, { childList: true, subtree: true });
  return () => obs.disconnect();
}

export interface AppShellProps {
  /** Which app this is, e.g. "docs". */
  serviceId: string;
  /**
   * Place the trigger yourself, via <AppShellToggle /> inside your <Header>.
   *
   * Defaults to false so existing consumers keep the inline trigger and nothing
   * breaks; set it true once your header renders AppShellToggle, which is what
   * the navigation model actually requires.
   */
  toggleInHeader?: boolean;
  /** Optional in-app navigation (folder tree, mailbox list, slide navigator). */
  nav?: ReactNode;
  /** Optional app commands, as DATA. See the note above. */
  menu?: MenuSection[];
  children?: ReactNode;
}

export const APPSHELL_BREAKPOINT = 768;

/**
 * What chrome does this app get at this viewport?
 *
 * Extracted as a pure function, matching how Sidebar's behaviour is pinned, so
 * the rules are testable without a DOM. This is the whole decision:
 *
 *   - a hamburger ONLY on mobile, and ONLY when there is something to put in it
 *   - the horizontal menu bar ONLY on desktop
 *   - the sidebar in flow ONLY on desktop; on mobile it lives in the drawer
 */
export function appShellChrome(opts: {
  isMobile: boolean;
  hasNav: boolean;
  hasMenu: boolean;
}): { hamburger: boolean; menuBar: boolean; sidebar: boolean } {
  const { isMobile, hasNav, hasMenu } = opts;
  return {
    // An empty drawer is worse than no control.
    hamburger: isMobile && (hasNav || hasMenu),
    menuBar: !isMobile && hasMenu,
    sidebar: !isMobile && hasNav,
  };
}

/**
 * Is this item interactive?
 *
 * An item with no `onSelect` is DISABLED, never an enabled no-op. slides ships
 * `Format > Theme…` enabled, and clicking it does nothing observable, which
 * teaches users the app is broken.
 */
export function menuItemState(item: MenuItem): {
  disabled: boolean;
  title: string | undefined;
} {
  const disabled = typeof item.onSelect !== 'function';
  return { disabled, title: disabled ? item.disabledReason : undefined };
}

/**
 * Roving-index step for keyboard menu navigation.
 *
 * Extracted pure because the wrapping is where these go wrong, and because
 * docs' own MenuBar implemented arrow-key navigation that would otherwise be
 * lost when it is replaced by the shell. Returns the new index, or -1 for keys
 * that do not move the selection.
 */
export function nextMenuIndex(current: number, count: number, key: string): number {
  if (count <= 0) return -1;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return -1;
  }
}

/** True when the viewport is below the mobile breakpoint. */
export function useIsMobile(breakpoint = APPSHELL_BREAKPOINT): boolean {
  const query = `(min-width: ${breakpoint}px)`;
  const read = () =>
    typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? false
      : !window.matchMedia(query).matches;

  const [isMobile, setIsMobile] = useState<boolean>(read);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setIsMobile(!mql.matches);
    onChange();
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, [query]);

  return isMobile;
}

function MenuItemButton({ item, onDone }: { item: MenuItem; onDone: () => void }) {
  const { disabled, title } = menuItemState(item);
  return (
    <button
      type="button"
      role={item.active === undefined ? 'menuitem' : 'menuitemcheckbox'}
      className="cloistr-appshell-menuitem"
      disabled={disabled}
      title={title}
      aria-disabled={disabled || undefined}
      aria-checked={item.active === undefined ? undefined : item.active}
      onClick={() => {
        if (!item.onSelect) return;
        item.onSelect();
        onDone();
      }}
    >
      <span className="cloistr-appshell-menuitem-check" aria-hidden="true">
        {item.active ? '\u2713' : ''}
      </span>
      <span className="cloistr-appshell-menuitem-label">{item.label}</span>
      {item.shortcut ? (
        <span className="cloistr-appshell-menuitem-shortcut">{item.shortcut}</span>
      ) : null}
    </button>
  );
}

/** Render one section's entries, turning separators into real rules. */
function MenuEntries({ entries, onDone }: { entries: MenuEntry[]; onDone: () => void }) {
  return (
    <>
      {entries.map((entry, i) =>
        isSeparator(entry) ? (
          <div key={`sep-${i}`} className="cloistr-appshell-menu-separator" role="separator" />
        ) : (
          <MenuItemButton key={entry.label} item={entry} onDone={onDone} />
        ),
      )}
    </>
  );
}

/** Desktop presentation: a horizontal bar of dropdowns. */
function MenuBar({ sections }: { sections: MenuSection[] }) {
  const [openLabel, setOpenLabel] = useState<string | null>(null);
  const triggers = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!openLabel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenLabel(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openLabel]);

  // Arrow keys move between top-level menus, matching what docs' own MenuBar
  // did before the shell replaced it.
  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextMenuIndex(index, sections.length, e.key);
    if (next < 0) return;
    e.preventDefault();
    triggers.current[next]?.focus();
    // Keep the open menu following the focus, as a menubar should.
    if (openLabel) setOpenLabel(sections[next].label);
  };

  return (
    <div className="cloistr-appshell-menubar" role="menubar" aria-label="Application menu">
      {sections.map((section, index) => (
        <div className="cloistr-appshell-menubar-section" key={section.label}>
          <button
            type="button"
            ref={(el) => {
              triggers.current[index] = el;
            }}
            className="cloistr-appshell-menubar-trigger"
            aria-haspopup="true"
            aria-expanded={openLabel === section.label}
            onKeyDown={(e) => onTriggerKeyDown(e, index)}
            onClick={() => setOpenLabel((cur) => (cur === section.label ? null : section.label))}
          >
            {section.label}
          </button>
          {openLabel === section.label ? (
            <div className="cloistr-appshell-dropdown" role="menu" aria-label={section.label}>
              <MenuEntries entries={section.items} onDone={() => setOpenLabel(null)} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Mobile presentation: the SAME data as collapsible drawer sections. */
function DrawerMenu({ sections, onDone }: { sections: MenuSection[]; onDone: () => void }) {
  const [openLabel, setOpenLabel] = useState<string | null>(null);
  return (
    <div className="cloistr-appshell-drawer-menu">
      {sections.map((section) => (
        <div className="cloistr-appshell-drawer-section" key={section.label}>
          <button
            type="button"
            className="cloistr-appshell-drawer-section-trigger"
            aria-expanded={openLabel === section.label}
            onClick={() => setOpenLabel((cur) => (cur === section.label ? null : section.label))}
          >
            {section.label}
          </button>
          {openLabel === section.label ? (
            <div role="menu" aria-label={section.label}>
              <MenuEntries entries={section.items} onDone={onDone} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function AppShell({ serviceId, nav, menu, children, toggleInHeader = false }: AppShellProps) {
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const chrome = appShellChrome({
    isMobile,
    hasNav: Boolean(nav),
    hasMenu: Boolean(menu && menu.length > 0),
  });

  const close = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen, close]);

  // Leaving the mobile breakpoint must not strand an open drawer.
  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile]);

  const ctx: AppShellContextValue = {
    open: drawerOpen,
    toggle: () => setDrawerOpen((v) => !v),
    wanted: chrome.hamburger,
  };

  return (
    <AppShellContext.Provider value={ctx}>
    <div
      className="cloistr-appshell"
      data-service-id={serviceId}
      data-viewport={isMobile ? 'mobile' : 'desktop'}
    >
      {chrome.hamburger && !toggleInHeader ? (
        // Legacy placement: a child of the shell, which sits BELOW the app's
        // <Header>. Kept so existing consumers do not break, but apps should
        // move to <AppShellToggle /> inside their Header — see the context doc
        // above. Rendering BOTH is impossible: this branch is skipped whenever
        // toggleInHeader is set.
        <div className="cloistr-appshell-hamburger" data-testid="appshell-hamburger">
          <SidebarToggle expanded={drawerOpen} onClick={() => setDrawerOpen((v) => !v)} />
        </div>
      ) : null}

      {chrome.menuBar ? <MenuBar sections={menu as MenuSection[]} /> : null}

      <div className="cloistr-appshell-body">
        {chrome.sidebar ? (
          <aside className="cloistr-appshell-sidebar" aria-label="In-app navigation">
            {nav}
          </aside>
        ) : null}

        <main className="cloistr-appshell-content" data-testid="workspace">
          {children}
        </main>
      </div>

      {drawerOpen ? (
        <>
          <div
            className="cloistr-appshell-scrim"
            data-testid="appshell-scrim"
            onClick={close}
            aria-hidden="true"
          />
          <div className="cloistr-appshell-drawer" role="dialog" aria-modal="true" aria-label="Menu">
            {/* In-app navigation FIRST: it is what people reach for most. */}
            {nav ? (
              <nav className="cloistr-appshell-drawer-nav" aria-label="In-app navigation" onClick={close}>
                {nav}
              </nav>
            ) : null}
            {menu && menu.length > 0 ? (
              <DrawerMenu sections={menu} onDone={close} />
            ) : null}
          </div>
        </>
      ) : null}
    </div>
    </AppShellContext.Provider>
  );
}
