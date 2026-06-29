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
  /** Custom signer URL (defaults to the canonical Cloistr signer) */
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
  signerUrl = 'https://signer.cloistr.xyz',
  children,
}: HeaderProps) {
  const { authState } = useNostrAuth();
  const [showLoginModal, setShowLoginModal] = useState(false);

  const defaultLogo = (
    <svg width="32" height="32" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M40,10 Q47,24 40,38 Q31,47 18,47 Q3,47 3,24 Q3,1 18,1 Q31,1 40,10 L34,16 Q28,9 18,9 Q9,9 9,24 Q9,39 18,39 Q28,39 34,32 Z" fill="#7C3AED" />
      <path d="M37,13 Q42,24 37,35 Q30,41 18,41 Q7,41 7,24 Q7,7 18,7 Q30,7 37,13 L33,18 Q27,12 18,12 Q12,12 12,24 Q12,36 18,36 Q27,36 33,30 Z" fill="#8B5CF6" />
      <circle cx="35" cy="24" r="7" fill="#E9D5FF" />
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
