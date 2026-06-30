import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { useNostrAuth } from '../auth/index.js';

// Lazy load SettingsModal for zero overhead until user clicks
const SettingsModal = lazy(() => import('./SettingsModal.js'));

export interface UserMenuProps {
  /** URL to user's profile page */
  profileUrl?: string;
  /** Whether to use inline settings modal (default) or external URL */
  settingsUrl?: string;
  /** Disable inline settings modal (use settingsUrl instead) */
  useExternalSettings?: boolean;
  /** External pubkey for backend-auth apps; falls back to the Nostr context */
  pubkey?: string;
  /** External auth method label (e.g. 'nip07' | 'nip46') */
  method?: string;
  /** External logout handler for backend-auth apps; falls back to Nostr disconnect */
  onLogout?: () => void;
}

/**
 * User dropdown menu showing pubkey and actions.
 *
 * By default it reads the Nostr auth context. Apps with their own session
 * (e.g. backend-JWT via BackendAuthProvider) can pass `pubkey`/`onLogout`
 * to drive it explicitly.
 */
export function UserMenu({
  profileUrl = '/profile',
  settingsUrl = '/settings',
  useExternalSettings = false,
  pubkey,
  method,
  onLogout,
}: UserMenuProps) {
  const { authState, disconnect } = useNostrAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Prefer an explicitly-provided pubkey (backend-auth apps); else the Nostr context.
  const effectivePubkey = pubkey ?? (authState.isConnected ? authState.pubkey : undefined);
  const effectiveMethod = method ?? authState.method;
  const handleLogout = onLogout ?? disconnect;

  if (!effectivePubkey) {
    return null;
  }

  const shortPubkey = `${effectivePubkey.slice(0, 8)}...${effectivePubkey.slice(-4)}`;

  return (
    <div className="cloistr-user-menu" ref={menuRef}>
      <button
        className="cloistr-user-menu-trigger"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <span className="cloistr-user-avatar">
          {effectivePubkey.slice(0, 2).toUpperCase()}
        </span>
        <span className="cloistr-user-pubkey">{shortPubkey}</span>
      </button>

      {isOpen && (
        <div className="cloistr-user-menu-dropdown" role="menu">
          <div className="cloistr-user-menu-header">
            <span className="cloistr-user-menu-pubkey-full" title={effectivePubkey}>
              {effectivePubkey.slice(0, 16)}...
            </span>
            <span className="cloistr-user-menu-method">
              {effectiveMethod === 'nip07' ? 'Extension' : 'Bunker'}
            </span>
          </div>

          <div className="cloistr-user-menu-items">
            <a href={profileUrl} className="cloistr-user-menu-item" role="menuitem">
              Profile
            </a>
            {useExternalSettings ? (
              <a href={settingsUrl} className="cloistr-user-menu-item" role="menuitem">
                Settings
              </a>
            ) : (
              <button
                className="cloistr-user-menu-item"
                onClick={() => {
                  setShowSettings(true);
                  setIsOpen(false);
                }}
                role="menuitem"
              >
                Settings
              </button>
            )}
            <button
              className="cloistr-user-menu-item cloistr-user-menu-logout"
              onClick={() => {
                handleLogout();
                setIsOpen(false);
              }}
              role="menuitem"
            >
              Sign Out
            </button>
          </div>
        </div>
      )}

      {/* Lazy-loaded settings modal */}
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsModal
            isOpen={showSettings}
            onClose={() => setShowSettings(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
