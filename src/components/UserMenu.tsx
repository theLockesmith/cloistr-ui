import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { useNostrAuth } from '../auth/index.js';
import { useSharedSessionMaybe } from './SharedAuthProvider.js';

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
  /** Signer base URL for central logout (defaults to signer.cloistr.xyz) */
  signerUrl?: string;
  /**
   * Callback invoked when the user clicks "Add account". If not provided, the
   * Add account item is rendered as a disabled stub (full external-add is a later
   * phase).
   */
  onSignIn?: () => void;
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
  signerUrl = 'https://signer.cloistr.xyz',
  onSignIn,
}: UserMenuProps) {
  const { authState, disconnect, setActiveKey } = useNostrAuth();
  const sharedSession = useSharedSessionMaybe();
  const pin = sharedSession?.pin ?? null;
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

  // Central logout: best-effort call to the signer to revoke the shared session
  // cookie, then fall through to the local disconnect/onLogout.
  const handleSignOut = async () => {
    setIsOpen(false);
    try {
      await fetch(`${signerUrl}/api/v1/users/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Best-effort — don't block local disconnect on network failure
    }
    (onLogout ?? disconnect)();
  };

  const handleSwitchKey = (targetPubkey: string) => {
    if (targetPubkey === authState.activePubkey || authState.isSwitching) return;
    void setActiveKey(targetPubkey);
  };

  if (!effectivePubkey) {
    return null;
  }

  const shortPubkey = `${effectivePubkey.slice(0, 8)}...${effectivePubkey.slice(-4)}`;
  const hasMultipleKeys = authState.keys.length > 1;

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

          {/* Accounts section: show when there are keys in the context (multi-identity) */}
          {authState.keys.length > 0 && (
            <div className="cloistr-user-menu-accounts">
              <p className="cloistr-user-menu-section-label">
                Accounts
                {pin?.pinnedPubkey && (
                  <span className="cloistr-user-menu-pin-badge" aria-label="This tab is pinned to a specific account">
                    {' '}— Pinned to this tab
                  </span>
                )}
              </p>
              {authState.keys.map((k) => {
                const isActive = k.pubkey === authState.activePubkey;
                const isPinned = pin?.pinnedPubkey === k.pubkey;
                const displayName = k.name ?? `${k.pubkey.slice(0, 16)}…`;
                return (
                  <div key={k.pubkey} className="cloistr-user-menu-account-row">
                    <button
                      className={`cloistr-user-menu-account-item${isActive ? ' cloistr-user-menu-account-item--active' : ''}`}
                      role="menuitemradio"
                      aria-checked={isActive}
                      disabled={authState.isSwitching}
                      onClick={() => handleSwitchKey(k.pubkey)}
                      title={k.pubkey}
                    >
                      <span className="cloistr-user-menu-account-name">{displayName}</span>
                      {isActive && (
                        <span className="cloistr-user-menu-account-check" aria-hidden="true">✓</span>
                      )}
                    </button>
                    {pin && (
                      <button
                        className={`cloistr-user-menu-account-pin${isPinned ? ' cloistr-user-menu-account-pin--active' : ''}`}
                        title={isPinned ? 'Clear tab pin' : 'Pin this account to this tab'}
                        aria-label={isPinned ? 'Clear tab pin' : `Pin ${displayName} to this tab`}
                        onClick={() => {
                          if (isPinned) {
                            pin.clearPin();
                          } else {
                            pin.setPinnedPubkey(k.pubkey);
                          }
                        }}
                        disabled={authState.isSwitching}
                      >
                        {isPinned ? '📌' : '📍'}
                      </button>
                    )}
                  </div>
                );
              })}
              {/* "Add account": open the sign-in flow to connect an additional identity */}
              <button
                className="cloistr-user-menu-account-item cloistr-user-menu-account-add"
                role="menuitem"
                disabled={!onSignIn}
                onClick={() => {
                  if (onSignIn) {
                    setIsOpen(false);
                    onSignIn();
                  }
                }}
              >
                {onSignIn ? '+ Add account' : 'Add account (soon)'}
              </button>
            </div>
          )}

          <div className={`cloistr-user-menu-items${hasMultipleKeys ? ' cloistr-user-menu-items--with-accounts' : ''}`}>
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
              onClick={handleSignOut}
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
