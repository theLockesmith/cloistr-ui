import { useState, useRef, useEffect, useCallback } from 'react';
import { useThemeOptional, type ThemeMode } from './ThemeProvider.js';

export interface Service {
  /** Service identifier */
  id: string;
  /** Display name */
  name: string;
  /** URL to the service */
  url: string;
  /** Optional icon (emoji or URL) */
  icon?: string;
  /** Whether this is the current service */
  active?: boolean;
}

export interface ServiceMenuProps {
  /** List of services to display */
  services: Service[];
  /** Currently active service ID */
  activeServiceId?: string;
  /** Base domain for services (e.g., 'cloistr.xyz') */
  baseDomain?: string;
}

/**
 * Default Cloistr services
 */
export const defaultServices: Service[] = [
  { id: 'home', name: 'Home', url: 'https://cloistr.xyz' },
  { id: 'identity', name: 'Identity', url: 'https://me.cloistr.xyz' },
  { id: 'relay', name: 'Relay', url: 'https://relay.cloistr.xyz' },
  { id: 'signer', name: 'Signer', url: 'https://signer.cloistr.xyz' },
  { id: 'space', name: 'Space', url: 'https://space.cloistr.xyz' },
  { id: 'docs', name: 'Docs', url: 'https://docs.cloistr.xyz' },
  { id: 'sheets', name: 'Sheets', url: 'https://sheets.cloistr.xyz' },
  { id: 'whiteboard', name: 'Whiteboard', url: 'https://whiteboard.cloistr.xyz' },
  { id: 'slides', name: 'Slides', url: 'https://slides.cloistr.xyz' },
  { id: 'files', name: 'Files', url: 'https://stash.cloistr.xyz' },
  { id: 'photos', name: 'Photos', url: 'https://photos.cloistr.xyz' },
  { id: 'email', name: 'Email', url: 'https://mail.cloistr.xyz' },
  { id: 'tasks', name: 'Tasks', url: 'https://tasks.cloistr.xyz' },
  { id: 'discover', name: 'Discover', url: 'https://discover.cloistr.xyz' },
];

/**
 * Professional monochrome service glyphs (Material-style, single-path, drawn in
 * currentColor so they inherit the tile's text color). Deliberately flat and
 * uniform — the "fun colorful emoji" set read as toy-like next to Google/MS.
 *
 * Note the two identity-adjacent glyphs: `identity` (me.cloistr.xyz) is a
 * person, and `signer` is the key — the key belongs to the signer, not to the
 * identity profile.
 */
const SERVICE_ICONS: Record<string, string> = {
  home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  identity:
    'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  relay:
    'M6.18 15.64a2.18 2.18 0 0 1 2.18 2.18C8.36 19 7.38 20 6.18 20 5 20 4 19 4 17.82a2.18 2.18 0 0 1 2.18-2.18M4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27zm0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93z',
  signer:
    'M12.65 10A5.99 5.99 0 0 0 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6a5.99 5.99 0 0 0 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z',
  space:
    'M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6 0h-4V4h4v2z',
  docs:
    'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
  sheets:
    'M20 2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM8 20H4v-4h4v4zm0-6H4v-4h4v4zm0-6H4V4h4v4zm6 12h-4v-4h4v4zm0-6h-4v-4h4v4zm0-6h-4V4h4v4zm6 12h-4v-4h4v4zm0-6h-4v-4h4v4zm0-6h-4V4h4v4z',
  whiteboard:
    'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  slides:
    'M10 8v8l5-4-5-4zm9-5H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z',
  files: 'M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
  photos:
    'M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z',
  email:
    'M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z',
  tasks:
    'M22 5.18L10.59 16.6l-4.24-4.24 1.41-1.41 2.83 2.83 10-10L22 5.18zm-2.21 5.04c.13.57.21 1.17.21 1.78 0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8c1.58 0 3.04.46 4.28 1.25l1.44-1.44C16.1 2.67 14.13 2 12 2 6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10c0-1.19-.22-2.33-.6-3.39l-1.61 1.61z',
  discover:
    'M15.5 14h-.79l-.28-.27a6.5 6.5 0 0 0 1.48-5.34c-.47-2.78-2.79-5-5.59-5.34a6.505 6.505 0 0 0-7.27 7.27c.34 2.8 2.56 5.12 5.34 5.59a6.5 6.5 0 0 0 5.34-1.48l.27.28v.79l4.25 4.25c.41.41 1.08.41 1.49 0 .41-.41.41-1.08 0-1.49L15.5 14zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
};

/** Renders a service glyph in currentColor at the tile icon size. */
function ServiceGlyph({ id, fallback }: { id: string; fallback?: string }) {
  const d = SERVICE_ICONS[id];
  if (!d) return <>{fallback || '📱'}</>;
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** 3×3 grid-of-dots icon (classic Google-apps trigger) */
function AppsGridIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="3.5" cy="3.5" r="1.5" />
      <circle cx="10" cy="3.5" r="1.5" />
      <circle cx="16.5" cy="3.5" r="1.5" />
      <circle cx="3.5" cy="10" r="1.5" />
      <circle cx="10" cy="10" r="1.5" />
      <circle cx="16.5" cy="10" r="1.5" />
      <circle cx="3.5" cy="16.5" r="1.5" />
      <circle cx="10" cy="16.5" r="1.5" />
      <circle cx="16.5" cy="16.5" r="1.5" />
    </svg>
  );
}

const THEME_ICON: Record<ThemeMode, string> = {
  light: '☀️',
  dark: '🌙',
  system: '🖥️',
};

const THEME_LABEL: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

const THEME_MODES: ThemeMode[] = ['light', 'dark', 'system'];

/**
 * Service switcher — Google-style app-grid panel.
 *
 * The trigger is a 9-dot icon (icon-only, no text label).
 * The panel is rendered at position:fixed so it escapes any overflow:hidden
 * ancestor (sidebars, scrollable regions) and floats above all app content.
 * z-index uses var(--cloistr-z-app-switcher) which sits between dropdown(100)
 * and modal(200).
 */
export function ServiceMenu({
  services = defaultServices,
  activeServiceId,
  baseDomain: _baseDomain = 'cloistr.xyz',
}: ServiceMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const themeCtx = useThemeOptional();

  /** Recompute the panel position from the trigger's bounding rect. */
  const computePos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPanelPos({
      top: rect.bottom + 6,
      right: window.innerWidth - rect.right,
    });
  }, []);

  const open = useCallback(() => {
    computePos();
    setIsOpen(true);
  }, [computePos]);

  const close = useCallback(() => setIsOpen(false), []);

  const toggle = useCallback(() => {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }, [isOpen, open, close]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current && triggerRef.current.contains(target)
      ) return;
      if (panelRef.current && panelRef.current.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, close]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, close]);

  // Reposition if the window resizes while open
  useEffect(() => {
    if (!isOpen) return;
    const handler = () => computePos();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [isOpen, computePos]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="cloistr-apps-trigger"
        onClick={toggle}
        aria-label="Apps"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        title="Apps"
      >
        <AppsGridIcon />
      </button>

      {isOpen && panelPos && (
        <div
          ref={panelRef}
          className="cloistr-apps-panel"
          role="dialog"
          aria-label="App switcher"
          style={{
            position: 'fixed',
            top: panelPos.top,
            right: panelPos.right,
            zIndex: 'var(--cloistr-z-app-switcher)' as unknown as number,
          }}
        >
          {/* Service grid */}
          <div className="cloistr-apps-grid">
            {services.map((service) => {
              const isActive = service.id === activeServiceId;
              return (
                <a
                  key={service.id}
                  href={service.url}
                  className={`cloistr-apps-tile${isActive ? ' cloistr-apps-tile--active' : ''}`}
                  title={service.name}
                  onClick={close}
                >
                  <span className="cloistr-apps-tile-icon" aria-hidden="true">
                    <ServiceGlyph id={service.id} fallback={service.icon} />
                  </span>
                  <span className="cloistr-apps-tile-name">{service.name}</span>
                </a>
              );
            })}
          </div>

          {/* Appearance section — only rendered when ThemeProvider is mounted */}
          {themeCtx && (
            <div className="cloistr-apps-appearance">
              <p className="cloistr-apps-appearance-label">Appearance</p>
              <div className="cloistr-apps-theme-options" role="group" aria-label="Theme">
                {THEME_MODES.map((mode) => {
                  const active = themeCtx.theme === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      className={`cloistr-apps-theme-btn${active ? ' cloistr-apps-theme-btn--active' : ''}`}
                      onClick={() => themeCtx.setTheme(mode)}
                      aria-pressed={active}
                      title={THEME_LABEL[mode]}
                    >
                      <span aria-hidden="true">{THEME_ICON[mode]}</span>
                      <span>{THEME_LABEL[mode]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
