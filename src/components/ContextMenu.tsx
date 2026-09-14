/**
 * Context menu — right-click / long-press menu for Cloistr apps.
 *
 * WHY THIS EXISTS
 *
 * stash and space both built their own right-click + long-press menus. Stash
 * hand-rolled a position:fixed div with click-away; space built a
 * useLongPressMenu hook with pointer-event timing and click swallowing. Both
 * solutions work, but the timing/swallowing logic is subtle enough that
 * duplicating it guarantees they'll diverge. This component provides the menu
 * rendering; useContextMenuTrigger provides the trigger mechanics.
 *
 * THREE LAYERS, each independently useful:
 *
 *   useContextMenuTrigger — the input layer. Long-press (500ms), right-click,
 *   and ArrowDown all funnel into a single onOpen callback. Click swallowing
 *   after a hold prevents the tap from also firing the default action. This is
 *   the piece space needs (it renders its own ReactionPicker, not a menu).
 *
 *   useContextMenu — the state layer. Tracks open/closed and the {x, y}
 *   position. Returns menuProps to spread onto <ContextMenu>.
 *
 *   ContextMenu — the visual layer. Portals to document.body with
 *   position:fixed, clamped to the viewport. Keyboard-navigable (arrow keys,
 *   Enter, Escape). This is the piece stash needs.
 *
 * ACCESSIBILITY
 *
 * The menu carries role="menu" and each item role="menuitem". Arrow keys move
 * focus between items, Enter/Space activates, Escape closes. Focus is trapped
 * inside the open menu and restored to the previously focused element on close.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single entry in the context menu. */
export interface ContextMenuEntry {
  /** Unique key for React reconciliation. */
  key: string;
  /** Display label. */
  label: string;
  /** Called when the item is activated. */
  onClick: () => void;
  /** Renders the item in the error/destructive style. */
  danger?: boolean;
  /** Dims the item and prevents activation. */
  disabled?: boolean;
}

/** Position in viewport pixels, as returned by MouseEvent.clientX/Y. */
export interface ContextMenuPosition {
  x: number;
  y: number;
}

export interface ContextMenuProps {
  /** Whether the menu is visible. */
  isOpen: boolean;
  /** Viewport coordinates for the top-left corner. */
  position: ContextMenuPosition;
  /** Called when the menu should close (click-away, Escape, item activation). */
  onClose: () => void;
  /** The menu entries to render. */
  items: ContextMenuEntry[];
  /** Additional CSS class on the menu container. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing without a DOM)
// ---------------------------------------------------------------------------

/** Build the CSS class string for the context menu container. */
export function contextMenuClasses(extra?: string): string {
  const parts = ['cloistr-context-menu'];
  if (extra) parts.push(extra);
  return parts.join(' ').replace(/\s{2,}/g, ' ').trim();
}

/** Build the CSS class string for a single menu item. */
export function contextMenuItemClasses(
  danger?: boolean,
  disabled?: boolean,
): string {
  const parts = ['cloistr-context-menu-item'];
  if (danger) parts.push('cloistr-context-menu-item--danger');
  if (disabled) parts.push('cloistr-context-menu-item--disabled');
  return parts.join(' ');
}

/**
 * Clamp a context menu position so the menu stays inside the viewport.
 *
 * Pure function: no window/DOM reads. The caller passes the viewport
 * dimensions and estimated menu size. Returns CSS-ready { top, left }.
 */
export function clampToViewport(
  x: number,
  y: number,
  menuWidth: number,
  menuHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): { top: number; left: number } {
  const MARGIN = 8;
  let left = x;
  let top = y;

  if (left + menuWidth + MARGIN > viewportWidth) {
    left = viewportWidth - menuWidth - MARGIN;
  }
  if (top + menuHeight + MARGIN > viewportHeight) {
    top = viewportHeight - menuHeight - MARGIN;
  }
  if (left < MARGIN) left = MARGIN;
  if (top < MARGIN) top = MARGIN;

  return { top, left };
}

// ---------------------------------------------------------------------------
// useContextMenu — state hook
// ---------------------------------------------------------------------------

export interface UseContextMenuReturn {
  /** Open the menu at viewport coordinates {x, y}. */
  open: (pos: ContextMenuPosition) => void;
  /** Close the menu. */
  close: () => void;
  /** Spread onto <ContextMenu>. */
  menuProps: {
    isOpen: boolean;
    position: ContextMenuPosition;
    onClose: () => void;
  };
}

/**
 * State hook for the context menu. Tracks open/closed and position.
 *
 * @example
 * ```tsx
 * const ctxMenu = useContextMenu();
 *
 * function handleContextMenu(e: React.MouseEvent) {
 *   e.preventDefault();
 *   ctxMenu.open({ x: e.clientX, y: e.clientY });
 * }
 *
 * return (
 *   <>
 *     <div onContextMenu={handleContextMenu}>Right-click me</div>
 *     <ContextMenu {...ctxMenu.menuProps} items={items} />
 *   </>
 * );
 * ```
 */
export function useContextMenu(): UseContextMenuReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<ContextMenuPosition>({ x: 0, y: 0 });

  const open = useCallback((pos: ContextMenuPosition) => {
    setPosition(pos);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  return {
    open,
    close,
    menuProps: { isOpen, position, onClose: close },
  };
}

// ---------------------------------------------------------------------------
// useContextMenuTrigger — input hook
// ---------------------------------------------------------------------------

export interface ContextMenuTriggerOptions {
  /** Called when the menu should open (long-press, right-click, or ArrowDown). */
  onOpen: () => void;
  /** Called on a plain click (the default action, not the menu). */
  onActivate: () => void;
  /** Disables all interactions. */
  disabled?: boolean;
  /** Long-press hold duration in milliseconds. Default 500. */
  holdMs?: number;
}

export interface ContextMenuTriggerHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onClick: (e: React.MouseEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

/**
 * Trigger hook for context menus. Handles long-press (pointer), right-click,
 * and keyboard (ArrowDown) as three entry paths into the same onOpen callback.
 *
 * The critical subtlety: after a long-press completes or a right-click fires,
 * the browser still dispatches a click event. Without swallowing it, a single
 * gesture would both open the menu AND fire the default action. The firedRef
 * flag absorbs that trailing click exactly once.
 *
 * @example
 * ```tsx
 * const { handlers } = useContextMenuTrigger({
 *   onOpen: () => setPickerOpen(true),
 *   onActivate: onReact,
 *   disabled: !canAct,
 * });
 *
 * return <button {...handlers} aria-haspopup="menu">React</button>;
 * ```
 */
export function useContextMenuTrigger({
  onOpen,
  onActivate,
  disabled = false,
  holdMs = 500,
}: ContextMenuTriggerOptions): { handlers: ContextMenuTriggerHandlers } {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Clean up timer on unmount.
  useEffect(() => clear, [clear]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      // Only primary button starts the hold timer. Right-click (button 2)
      // goes through onContextMenu to avoid double-opening.
      if (e.button !== 0) return;

      firedRef.current = false;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        firedRef.current = true;
        onOpen();
      }, holdMs);
    },
    [disabled, holdMs, onOpen],
  );

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      e.preventDefault();
      clear();
      firedRef.current = true;
      onOpen();
    },
    [disabled, clear, onOpen],
  );

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      if (firedRef.current) {
        // Swallow the trailing click after a hold or right-click.
        e.preventDefault();
        e.stopPropagation();
        firedRef.current = false;
        return;
      }
      onActivate();
    },
    [disabled, onActivate],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        onOpen();
      }
    },
    [disabled, onOpen],
  );

  return {
    handlers: {
      onPointerDown,
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
      onContextMenu,
      onClick,
      onKeyDown,
    },
  };
}

// ---------------------------------------------------------------------------
// ContextMenu — visual component
// ---------------------------------------------------------------------------

/**
 * Estimated menu dimensions for viewport clamping on first render.
 * After the menu mounts and we measure it, clamping uses the real size.
 * These are generous estimates so the menu doesn't flash off-screen.
 */
const ESTIMATED_WIDTH = 200;
const ESTIMATED_ITEM_HEIGHT = 36;

/**
 * @cloistr/ui ContextMenu component.
 *
 * Renders a positioned overlay via portal, keyboard-navigable, with
 * click-away and Escape-to-close.
 *
 * @example
 * ```tsx
 * const ctxMenu = useContextMenu();
 * const items: ContextMenuEntry[] = [
 *   { key: 'rename', label: 'Rename', onClick: () => rename(file) },
 *   { key: 'delete', label: 'Delete', onClick: () => del(file), danger: true },
 * ];
 *
 * return (
 *   <>
 *     <div onContextMenu={(e) => { e.preventDefault(); ctxMenu.open({ x: e.clientX, y: e.clientY }); }}>
 *       Right-click me
 *     </div>
 *     <ContextMenu {...ctxMenu.menuProps} items={items} />
 *   </>
 * );
 * ```
 */
export function ContextMenu({
  isOpen,
  position,
  onClose,
  items,
  className = '',
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const [clamped, setClamped] = useState<{ top: number; left: number } | null>(null);

  // Clamp position to viewport after the menu mounts and we know its size.
  useEffect(() => {
    if (!isOpen) {
      setClamped(null);
      return;
    }

    const el = menuRef.current;
    const w = el ? el.offsetWidth : ESTIMATED_WIDTH;
    const h = el ? el.offsetHeight : items.length * ESTIMATED_ITEM_HEIGHT;

    setClamped(
      clampToViewport(
        position.x,
        position.y,
        w,
        h,
        window.innerWidth,
        window.innerHeight,
      ),
    );
  }, [isOpen, position, items.length]);

  // Focus the menu on open; restore focus on close.
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      // Delay focus so the portal has mounted.
      requestAnimationFrame(() => {
        const first = menuRef.current?.querySelector<HTMLElement>(
          '[role="menuitem"]:not([aria-disabled="true"])',
        );
        first?.focus();
      });
    } else {
      previousActiveElement.current?.focus();
      previousActiveElement.current = null;
    }
  }, [isOpen]);

  // Click-away: close when clicking outside the menu.
  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Use setTimeout(0) so the opening click doesn't immediately close.
    const id = setTimeout(() => {
      document.addEventListener('pointerdown', handlePointerDown);
    }, 0);

    return () => {
      clearTimeout(id);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isOpen, onClose]);

  // Keyboard navigation inside the menu.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      const el = menuRef.current;
      if (!el) return;

      const focusable = Array.from(
        el.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])'),
      );
      const current = document.activeElement as HTMLElement;
      const idx = focusable.indexOf(current);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = idx < focusable.length - 1 ? idx + 1 : 0;
        focusable[next]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = idx > 0 ? idx - 1 : focusable.length - 1;
        focusable[prev]?.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        focusable[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        focusable[focusable.length - 1]?.focus();
      }
    },
    [onClose],
  );

  if (!isOpen || items.length === 0) return null;

  const style: React.CSSProperties = clamped
    ? { left: `${clamped.left}px`, top: `${clamped.top}px` }
    : { left: `${position.x}px`, top: `${position.y}px` };

  const menuContent = (
    <div
      ref={menuRef}
      className={contextMenuClasses(className)}
      style={style}
      role="menu"
      onKeyDown={handleKeyDown}
    >
      {items.map((item) => (
        <button
          key={item.key}
          className={contextMenuItemClasses(item.danger, item.disabled)}
          role="menuitem"
          tabIndex={-1}
          aria-disabled={item.disabled || undefined}
          onClick={() => {
            if (item.disabled) return;
            item.onClick();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );

  return createPortal(menuContent, document.body);
}
