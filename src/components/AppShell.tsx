import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * AppShell — the shared application chrome.
 *
 * Implements architecture/navigation-model.md. It exists because there was no
 * shared navigation model, so every app invented one. Measured in production
 * on 2026-08-24, at 390x844, authenticated:
 *
 *   docs        button.menubar-hamburger         390x31  + 17 expanded commands
 *   sheets      button (no class), "Open menu"    56x36  + Univer's own ribbon
 *   slides      button.slides-menubar-hamburger   44x36  + 13 expanded commands
 *   whiteboard  none                                     (extends Excalidraw)
 *
 * Three apps, three different class names, one with no class at all, all three
 * below the 44x44 tap minimum, none of them in the shared header.
 *
 * The contract:
 *   - Apps DECLARE what they have. The shell decides how to present it.
 *   - Desktop (>=768px): sidebar and menu bar shown, NO hamburger. Hiding
 *     navigation on a wide screen wastes the screen and hides the product.
 *   - Mobile (<768px): exactly ONE hamburger, in the shared header, opening one
 *     drawer with in-app nav ABOVE app commands.
 *   - Neither nav nor menu => no hamburger. An empty drawer is worse than no
 *     control.
 *   - No app renders its own hamburger. Ever.
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
  /** Which app this is, e.g. "docs". Used for the active ServiceMenu entry. */
  serviceId: string;
  /** Optional in-app navigation (folder tree, mailbox list, slide navigator). */
  nav?: React.ReactNode;
  /**
   * Optional app commands, as DATA.
   *
   * This is the load-bearing decision of the whole model. A rendered <MenuBar>
   * can only ever be a horizontal bar; a data structure renders as a bar on
   * desktop AND as collapsible drawer sections on mobile from one definition.
   * Passing JSX is what forced each app to build a second mobile menu, which is
   * how three separate hamburgers came to exist.
   */
  menu?: MenuSection[];
  children?: React.ReactNode;
}

const MOBILE_BREAKPOINT = 768;

/** True when the viewport is below the mobile breakpoint. */
function useIsMobile(): boolean {
  const query = `(min-width: ${MOBILE_BREAKPOINT}px)`;
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

/** The hamburger glyph. Never a 9-dot grid: the ServiceMenu is not a hamburger. */
function HamburgerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** One menu item, in either presentation. */
function MenuItemButton({ item, onDone }: { item: MenuItem; onDone: () => void }) {
  const disabled = !item.onSelect;
  return (
    <button
      type="button"
      role="menuitem"
      className="cloistr-appshell-menuitem"
      disabled={disabled}
      // A disabled item must say WHY. Silence teaches users the app is broken.
      title={disabled ? item.disabledReason : undefined}
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
  const barRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openLabel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenLabel(null);
    };
    const onClick = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenLabel(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [openLabel]);

  return (
    <div className="cloistr-appshell-menubar" role="menubar" aria-label="Application menu" ref={barRef}>
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

  const hasNav = Boolean(nav);
  const hasMenu = Boolean(menu && menu.length > 0);
  // An empty drawer is worse than no control.
  const showHamburger = isMobile && (hasNav || hasMenu);

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
    <div className="cloistr-appshell" data-service-id={serviceId} data-viewport={isMobile ? 'mobile' : 'desktop'}>
      {showHamburger ? (
        <button
          type="button"
          className="cloistr-appshell-hamburger"
          data-testid="appshell-hamburger"
          aria-label="Open menu"
          aria-expanded={drawerOpen}
          aria-haspopup="dialog"
          onClick={() => setDrawerOpen((v) => !v)}
        >
          <HamburgerIcon />
        </button>
      ) : null}

      {!isMobile && hasMenu ? <MenuBar sections={menu as MenuSection[]} /> : null}

      <div className="cloistr-appshell-body">
        {!isMobile && hasNav ? (
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
            {hasNav ? (
              <nav className="cloistr-appshell-drawer-nav" aria-label="In-app navigation" onClick={close}>
                {nav}
              </nav>
            ) : null}
            {hasMenu ? <DrawerMenu sections={menu as MenuSection[]} onDone={close} /> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
