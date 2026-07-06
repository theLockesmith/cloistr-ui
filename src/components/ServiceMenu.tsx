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
  { id: 'home', name: 'Home', url: 'https://cloistr.xyz', icon: '🏠' },
  { id: 'identity', name: 'Identity', url: 'https://me.cloistr.xyz', icon: '🔑' },
  { id: 'relay', name: 'Relay', url: 'https://relay.cloistr.xyz', icon: '📡' },
  { id: 'signer', name: 'Signer', url: 'https://signer.cloistr.xyz', icon: '🔐' },
  { id: 'space', name: 'Space', url: 'https://space.cloistr.xyz', icon: '🚀' },
  { id: 'docs', name: 'Docs', url: 'https://docs.cloistr.xyz', icon: '📄' },
  { id: 'sheets', name: 'Sheets', url: 'https://sheets.cloistr.xyz', icon: '📊' },
  { id: 'whiteboard', name: 'Whiteboard', url: 'https://whiteboard.cloistr.xyz', icon: '🎨' },
  { id: 'slides', name: 'Slides', url: 'https://slides.cloistr.xyz', icon: '📽️' },
  { id: 'files', name: 'Files', url: 'https://stash.cloistr.xyz', icon: '📁' },
  { id: 'photos', name: 'Photos', url: 'https://photos.cloistr.xyz', icon: '📸' },
  { id: 'email', name: 'Email', url: 'https://mail.cloistr.xyz', icon: '✉️' },
  { id: 'tasks', name: 'Tasks', url: 'https://tasks.cloistr.xyz', icon: '✅' },
  { id: 'workspace', name: 'Workspace', url: 'https://workspace.cloistr.xyz', icon: '💼' },
  { id: 'discover', name: 'Discover', url: 'https://discover.cloistr.xyz', icon: '🔍' },
];

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
                    {service.icon || '📱'}
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
