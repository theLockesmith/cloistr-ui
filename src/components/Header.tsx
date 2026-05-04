import React, { useState } from 'react';
import { useNostrAuth } from '../auth/index.js';
import { ServiceMenu, Service, defaultServices } from './ServiceMenu.js';
import { UserMenu } from './UserMenu.js';
import { LoginModal } from './LoginModal.js';

export interface HeaderProps {
  /** Logo URL or element */
  logo?: React.ReactNode;
  /** Link for the logo */
  logoHref?: string;
  /** Services to show in the service menu */
  services?: Service[];
  /** Currently active service ID */
  activeServiceId?: string;
  /** URL to user's profile page */
  profileUrl?: string;
  /** URL to settings page */
  settingsUrl?: string;
  /** Custom signer URL */
  signerUrl?: string;
  /** Additional header content (right side) */
  children?: React.ReactNode;
}

/**
 * Shared header component with logo, service menu, and auth
 */
export function Header({
  logo,
  logoHref = 'https://cloistr.xyz',
  services = defaultServices,
  activeServiceId,
  profileUrl,
  settingsUrl,
  signerUrl,
  children,
}: HeaderProps) {
  const { authState } = useNostrAuth();
  const [showLoginModal, setShowLoginModal] = useState(false);

  const defaultLogo = (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="currentColor">
      <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" fill="none" />
      <path d="M16 8v16M10 14h12M10 18h12" stroke="currentColor" strokeWidth="2" />
    </svg>
  );

  return (
    <>
      <header className="cloistr-header">
        <div className="cloistr-header-left">
          <a href={logoHref} className="cloistr-header-logo">
            {logo || defaultLogo}
            <span className="cloistr-header-brand">Cloistr</span>
          </a>
          <ServiceMenu services={services} activeServiceId={activeServiceId} />
        </div>

        <div className="cloistr-header-right">
          {children}
          {authState.isConnected ? (
            <UserMenu profileUrl={profileUrl} settingsUrl={settingsUrl} />
          ) : (
            <button
              className="cloistr-btn cloistr-btn-primary"
              onClick={() => setShowLoginModal(true)}
            >
              Sign In
            </button>
          )}
        </div>
      </header>

      <LoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        signerUrl={signerUrl}
      />
    </>
  );
}
