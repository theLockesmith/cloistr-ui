import { useCallback, useEffect, useState, type ReactNode } from 'react';
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
}

export interface MenuSection {
  /** e.g. "File" */
  label: string;
  items: MenuItem[];
}

export interface AppShellProps {
  /** Which app this is, e.g. "docs". */
  serviceId: string;
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
      role="menuitem"
      className="cloistr-appshell-menuitem"
      disabled={disabled}
      title={title}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!item.onSelect) return;
        item.onSelect();
        onDone();
      }}
    >
      <span className="cloistr-appshell-menuitem-label">{item.label}</span>
      {item.shortcut ? (
        <span className="cloistr-appshell-menuitem-shortcut">{item.shortcut}</span>
      ) : null}
    </button>
  );
}

/** Desktop presentation: a horizontal bar of dropdowns. */
function MenuBar({ sections }: { sections: MenuSection[] }) {
  const [openLabel, setOpenLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!openLabel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenLabel(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openLabel]);

  return (
    <div className="cloistr-appshell-menubar" role="menubar" aria-label="Application menu">
      {sections.map((section) => (
        <div className="cloistr-appshell-menubar-section" key={section.label}>
          <button
            type="button"
            className="cloistr-appshell-menubar-trigger"
            aria-haspopup="true"
            aria-expanded={openLabel === section.label}
            onClick={() => setOpenLabel((cur) => (cur === section.label ? null : section.label))}
          >
            {section.label}
          </button>
          {openLabel === section.label ? (
            <div className="cloistr-appshell-dropdown" role="menu" aria-label={section.label}>
              {section.items.map((item) => (
                <MenuItemButton key={item.label} item={item} onDone={() => setOpenLabel(null)} />
              ))}
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
              {section.items.map((item) => (
                <MenuItemButton key={item.label} item={item} onDone={onDone} />
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function AppShell({ serviceId, nav, menu, children }: AppShellProps) {
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

  return (
    <div
      className="cloistr-appshell"
      data-service-id={serviceId}
      data-viewport={isMobile ? 'mobile' : 'desktop'}
    >
      {chrome.hamburger ? (
        // Reuse SidebarToggle: same glyph, same a11y, one control in the fleet.
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
  );
}
