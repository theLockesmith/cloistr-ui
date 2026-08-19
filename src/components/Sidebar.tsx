import { useEffect, type ReactNode } from 'react';

/**
 * Shared navigation sidebar.
 *
 * WHY THIS EXISTS
 *
 * @cloistr/ui had no sidebar, nav or drawer component, so every app hand-rolled
 * one. The results diverged exactly as you would expect: cloistr-email and
 * cloistr-stash shipped different hamburger glyphs, different open/close
 * behaviour, and different z-index layers — and four apps independently chose
 * `z-40`, which sits BELOW the sticky header, so every one of them painted the
 * header over the top of its own open drawer.
 *
 * TWO COLLAPSE MODES, DELIBERATELY NOT THE SAME
 *
 *   below `md`  the drawer collapses COMPLETELY (off-canvas) over a dismissable
 *               backdrop. A phone has no room to spare: a permanently-mounted
 *               256px rail consumes ~68% of a 375px viewport, which is what made
 *               mail's compose screen unusable.
 *   `md` and up the rail collapses TO ICONS, staying in flow. Desktop has room
 *               for a persistent affordance, and losing navigation entirely on a
 *               wide screen is worse than showing it narrow.
 *
 * Both states are CONTROLLED by the app. The desktop collapse in particular is a
 * preference worth persisting, and that is the app's decision — a component that
 * owned it would either forget on every mount or reach into storage on the app's
 * behalf.
 */
export interface SidebarItem {
  /** Stable id, also used to mark the active item. */
  id: string;
  label: string;
  /** Rendered in collapsed (icon-only) mode; the label becomes its tooltip. */
  icon?: ReactNode;
  /** Anchor destination. Rendered as a button when absent. */
  href?: string;
  onClick?: () => void;
  /** Small count/status, hidden while collapsed to icons. */
  badge?: ReactNode;
}

export interface SidebarProps {
  items: SidebarItem[];
  /** id of the current item. */
  activeId?: string;
  /** Mobile drawer visibility. Ignored at `md` and up. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Desktop icons-only state. Ignored below `md`. */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Branding slot at the top — logo, wordmark, whatever the app wants. */
  header?: ReactNode;
  /** Compact branding for the collapsed rail; falls back to nothing. */
  collapsedHeader?: ReactNode;
  ariaLabel?: string;
}

/**
 * The hamburger. Exported so every app opens its drawer with the SAME glyph —
 * mail used `&#9776;` and stash used its own button, which is precisely the
 * inconsistency this component exists to remove.
 *
 * Mobile-only by default: at `md` and up the rail is in flow and uses the
 * collapse toggle instead.
 */
export function SidebarToggle({
  onClick,
  expanded,
  className = '',
}: {
  onClick: () => void;
  expanded: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`cloistr-sidebar-toggle ${className}`.trim()}
      aria-label={expanded ? 'Close navigation' : 'Open navigation'}
      aria-expanded={expanded}
      onClick={onClick}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4 6h16M4 12h16M4 18h16"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

/**
 * Class list for the sidebar root.
 *
 * Extracted as a pure function so the two-mode behaviour is testable without a
 * DOM. The modifiers carry ALL the meaning — CSS decides what `--open` and
 * `--collapsed` do at each breakpoint, and getting the mapping wrong is exactly
 * how four apps ended up with drawers underneath the header.
 */
export function sidebarClasses(open: boolean, collapsed: boolean): string {
  return [
    'cloistr-sidebar',
    open ? 'cloistr-sidebar--open' : '',
    collapsed ? 'cloistr-sidebar--collapsed' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Class list for one nav item. */
export function sidebarItemClasses(isActive: boolean): string {
  return `cloistr-sidebar-item${isActive ? ' cloistr-sidebar-item--active' : ''}`;
}

/**
 * Accessibility props for an item while the rail is collapsed to icons.
 *
 * Collapsed means the label is not rendered, so it has to survive as the
 * accessible name and the tooltip — an icon-only rail without this is unusable
 * with a screen reader and unguessable with a mouse.
 */
export function collapsedItemA11y(collapsed: boolean, label: string) {
  return collapsed ? { title: label, 'aria-label': label } : {};
}

export function Sidebar({
  items,
  activeId,
  open,
  onOpenChange,
  collapsed = false,
  onCollapsedChange,
  header,
  collapsedHeader,
  ariaLabel = 'Navigation',
}: SidebarProps) {
  // Escape closes the mobile drawer. Without it the only ways out are the
  // backdrop and the close button, which is poor for keyboard and screen-reader
  // users — and on a phone the backdrop is a small target.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const classes = sidebarClasses(open, collapsed);

  return (
    <>
      {/* Backdrop: mobile only, only while open. */}
      {open && (
        <div
          className="cloistr-sidebar-backdrop"
          aria-hidden="true"
          onClick={() => onOpenChange(false)}
        />
      )}

      <aside className={classes} aria-label={ariaLabel}>
        <div className="cloistr-sidebar-header">
          {collapsed ? (collapsedHeader ?? null) : header}

          {/* Close: mobile only. The drawer overlays content, so it needs an exit
              that does not depend on hitting the backdrop. */}
          <button
            type="button"
            className="cloistr-sidebar-close"
            aria-label="Close navigation"
            onClick={() => onOpenChange(false)}
          >
            &times;
          </button>
        </div>

        <nav className="cloistr-sidebar-nav">
          <ul>
            {items.map((item) => {
              const isActive = item.id === activeId;
              const cls = sidebarItemClasses(isActive);
              // While collapsed the label is not visible, so it becomes the
              // accessible name and the tooltip. Without this an icon-only rail
              // is unusable with a screen reader.
              const a11y = collapsedItemA11y(collapsed, item.label);
              const body = (
                <>
                  {item.icon && <span className="cloistr-sidebar-icon">{item.icon}</span>}
                  <span className="cloistr-sidebar-label">{item.label}</span>
                  {item.badge != null && <span className="cloistr-sidebar-badge">{item.badge}</span>}
                </>
              );

              // Selecting a destination on mobile must also dismiss the drawer,
              // or it stays over the page just navigated to.
              const handle = () => {
                item.onClick?.();
                onOpenChange(false);
              };

              return (
                <li key={item.id}>
                  {item.href ? (
                    <a
                      href={item.href}
                      className={cls}
                      aria-current={isActive ? 'page' : undefined}
                      onClick={handle}
                      {...a11y}
                    >
                      {body}
                    </a>
                  ) : (
                    <button type="button" className={cls} onClick={handle} {...a11y}>
                      {body}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Desktop-only collapse control. Rendered only when the app opts in by
            passing a handler — an app with no persistence for it should not show
            a toggle that silently forgets. */}
        {onCollapsedChange && (
          <button
            type="button"
            className="cloistr-sidebar-collapse"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            onClick={() => onCollapsedChange(!collapsed)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d={collapsed ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="cloistr-sidebar-label">Collapse</span>
          </button>
        )}
      </aside>
    </>
  );
}
