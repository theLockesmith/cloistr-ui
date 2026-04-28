import { useState, useRef, useEffect } from 'react';
import { useNostrAuth } from '../auth';

export interface UserMenuProps {
  /** URL to user's profile page */
  profileUrl?: string;
  /** URL to settings page */
  settingsUrl?: string;
}

/**
 * User dropdown menu showing pubkey and actions
 */
export function UserMenu({ profileUrl = '/profile', settingsUrl = '/settings' }: UserMenuProps) {
  const { authState, disconnect } = useNostrAuth();
  const [isOpen, setIsOpen] = useState(false);
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

  if (!authState.isConnected || !authState.pubkey) {
    return null;
  }

  const shortPubkey = `${authState.pubkey.slice(0, 8)}...${authState.pubkey.slice(-4)}`;

  return (
    <div className="cloistr-user-menu" ref={menuRef}>
      <button
        className="cloistr-user-menu-trigger"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <span className="cloistr-user-avatar">
          {authState.pubkey.slice(0, 2).toUpperCase()}
        </span>
        <span className="cloistr-user-pubkey">{shortPubkey}</span>
      </button>

      {isOpen && (
        <div className="cloistr-user-menu-dropdown" role="menu">
          <div className="cloistr-user-menu-header">
            <span className="cloistr-user-menu-pubkey-full" title={authState.pubkey}>
              {authState.pubkey.slice(0, 16)}...
            </span>
            <span className="cloistr-user-menu-method">
              {authState.method === 'nip07' ? 'Extension' : 'Bunker'}
            </span>
          </div>

          <div className="cloistr-user-menu-items">
            <a href={profileUrl} className="cloistr-user-menu-item" role="menuitem">
              Profile
            </a>
            <a href={settingsUrl} className="cloistr-user-menu-item" role="menuitem">
              Settings
            </a>
            <button
              className="cloistr-user-menu-item cloistr-user-menu-logout"
              onClick={() => {
                disconnect();
                setIsOpen(false);
              }}
              role="menuitem"
            >
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
