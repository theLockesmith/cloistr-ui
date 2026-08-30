import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { useNostrAuth } from '../auth/index.js';
import { useSharedSessionMaybe } from './SharedAuthProvider.js';
import { anchorBelow, type OverlayAnchor } from '../lib/overlayAnchor.js';
import { useNip05 } from '../lib/nip05.js';

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
  const [anchor, setAnchor] = useState<OverlayAnchor | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  /**
   * Anchor the dropdown to the trigger in VIEWPORT coordinates.
   *
   * The dropdown is portaled to <body> (see lib/overlayAnchor.ts for why), so it
   * no longer shares an offset parent with the trigger and cannot be positioned
   * with `top: 100%; right: 0` any more.
   */
  const computeAnchor = useCallback(() => {
    if (!menuRef.current) return;
    setAnchor(anchorBelow(menuRef.current.getBoundingClientRect(), window.innerWidth));
  }, []);

  // Close menu when clicking outside.
  // The dropdown is NOT a DOM descendant of menuRef once portaled, so it has to
  // be tested separately — checking only menuRef would treat every click on a
  // menu item as an outside click and close the menu out from under it.
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setIsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Escape closes, matching ServiceMenu.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  // A fixed-position overlay does not travel with the trigger, so re-anchor it
  // when the page moves under it. `scroll` is captured so it also fires for the
  // app's own scroll containers, not just the window.
  useEffect(() => {
    if (!isOpen) return;
    const handler = () => computeAnchor();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [isOpen, computeAnchor]);

  // Prefer an explicitly-provided pubkey (backend-auth apps); else the Nostr context.
  const effectivePubkey = pubkey ?? (authState.isConnected ? authState.pubkey : undefined);
  const effectiveMethod = method ?? authState.method;

  // The signer publishes a key's NIP-05 under its NAME, so the lookup needs the
  // name from the key list. A backend-auth pubkey may not be in that list at
  // all, in which case there is nothing to resolve and we stay on the pubkey.
  const activeKeyName = authState.keys.find((k) => k.pubkey === effectivePubkey)?.name;
  // Called before the early return below: hook order must not depend on whether
  // the user is signed in.
  const activeNip05 = useNip05(effectivePubkey, activeKeyName, signerUrl);

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

  // NIP-05 when the domain vouches for one, hex otherwise. `activeNip05` is null
  // until resolution finishes, so the identity is never blank and never flashes
  // empty — it upgrades in place.
  const triggerLabel = activeNip05 ?? shortPubkey;
  const fullLabel = activeNip05 ?? `${effectivePubkey.slice(0, 16)}...`;

  const dropdown = (
        <div
          className="cloistr-user-menu-dropdown"
          role="menu"
          ref={dropdownRef}
          style={{
            position: 'fixed',
            top: anchor?.top ?? 0,
            right: anchor?.right ?? 0,
          }}
        >
          <div className="cloistr-user-menu-header">
            {/* The hex stays reachable on hover even when a NIP-05 is shown —
                the pubkey is the identity, the NIP-05 is a label for it. */}
            <span className="cloistr-user-menu-pubkey-full" title={effectivePubkey}>
              {fullLabel}
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
              {authState.keys.map((k) => (
                <AccountRow
                  key={k.pubkey}
                  identity={k}
                  isActive={k.pubkey === authState.activePubkey}
                  isPinned={pin?.pinnedPubkey === k.pubkey}
                  isSwitching={authState.isSwitching}
                  pin={pin}
                  signerUrl={signerUrl}
                  onSwitch={handleSwitchKey}
                />
              ))}
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
  );

  return (
    <div className="cloistr-user-menu" ref={menuRef}>
      <button
        className="cloistr-user-menu-trigger"
        onClick={() => {
          if (!isOpen) computeAnchor();
          setIsOpen(!isOpen);
        }}
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <span className="cloistr-user-avatar">
          {effectivePubkey.slice(0, 2).toUpperCase()}
        </span>
        <span className="cloistr-user-pubkey" title={effectivePubkey}>{triggerLabel}</span>
      </button>

      {/*
        Portaled to <body> ON PURPOSE. The header is a stacking context
        (position:sticky + z-index), so a dropdown rendered inside it is painted
        within that context and no z-index — not 100, not 99999 — can lift it
        above page content. See lib/overlayAnchor.ts for the browser-verified
        evidence. Rendering it here instead of inside the header is the fix.

        Guarded on `document` so server rendering does not crash; the menu only
        exists after a click, so there is nothing to render on the server anyway.
      */}
      {isOpen && anchor && typeof document !== 'undefined'
        ? createPortal(dropdown, document.body)
        : null}

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

/**
 * One row in the account switcher.
 *
 * Split out of the `.map` because each row resolves its OWN NIP-05, and a hook
 * cannot be called inside a loop body. Resolution is cached per pubkey, so N
 * rows still make at most N requests once per tab, not once per render.
 */
function AccountRow({
  identity,
  isActive,
  isPinned,
  isSwitching,
  pin,
  signerUrl,
  onSwitch,
}: {
  identity: { pubkey: string; name?: string };
  isActive: boolean;
  isPinned: boolean;
  isSwitching: boolean;
  pin: { setPinnedPubkey: (pubkey: string) => void; clearPin: () => void } | null;
  signerUrl: string;
  onSwitch: (pubkey: string) => void;
}) {
  const nip05 = useNip05(identity.pubkey, identity.name, signerUrl);

  // Preference order: the verified NIP-05, then the signer's name for the key,
  // then hex. The NIP-05 outranks the bare name because it is the same name
  // plus a domain that has vouched for this pubkey.
  const displayName = nip05 ?? identity.name ?? `${identity.pubkey.slice(0, 16)}…`;

  return (
    <div className="cloistr-user-menu-account-row">
      <button
        className={`cloistr-user-menu-account-item${isActive ? ' cloistr-user-menu-account-item--active' : ''}`}
        role="menuitemradio"
        aria-checked={isActive}
        disabled={isSwitching}
        onClick={() => onSwitch(identity.pubkey)}
        title={identity.pubkey}
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
              pin.setPinnedPubkey(identity.pubkey);
            }
          }}
          disabled={isSwitching}
        >
          {isPinned ? '📌' : '📍'}
        </button>
      )}
    </div>
  );
}
