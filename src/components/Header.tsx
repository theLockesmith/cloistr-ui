import React, { useState } from 'react';
import { useNostrAuth } from '../auth/index.js';
import { ServiceMenu, defaultServices } from './ServiceMenu.js';
import { UserMenu } from './UserMenu.js';
import { LoginModal } from './LoginModal.js';

/** Cloistr wordmark logo, inlined as a data URI so consumers need no asset pipeline. */
const CLOISTR_WORDMARK =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MDAgMTAwIj48cGF0aCBkPSJNMjQuODc3IDQuNzdDMTcuNzcxIDQuODQgMTEuNTk2IDEyLjQ3IDExLjU5NiAyMGMwIDAtLjY2MyAyMC40NDUtLjY2MiAzMC42NjguMDAxIDkuNzc3LjY2MiAyOS4zMzIuNjYyIDI5LjMzMi4wMzcgOC4zMSA3LjgzNyAxOC4xNDQgMTUuNTI5IDE1bDM4LjgzMy0xNS44NzVjNC4wNi0xLjY2IDkuNzk0LTUuMDE5IDEyLjU0LTcuODczIDAgMC05LjU1Ni0yLjUzNi0xMi4zNy00LjUwNi0yLjkwNC0yLjAzNC02LjI4Mi00Ljc5My02LjI4Mi00Ljc5My0xLjc1MSAxLjAwNS0zLjk3NiAzLjc5NC01Ljg4OCA0LjgxOGwtMTQuODMzIDcuOTM3Yy01Ljg2MiAzLjEzNy0xMy4wNTgtLjA2LTEzLjA1OC02LjcwOCAwIDAtMS4wNTktMTEuNTU1LTEuMDU5LTE3LjMzMiAwLTYuMjIzIDEuMDU5LTE4LjY2OCAxLjA1OS0xOC42NjggMC02LjY0OCA2LjkyLTE0LjU1NiAxMy4wNTgtMTJsMTMuNTMyIDcuNzE0czIuNjQtMy40MDEgNS4zOTItNS4zNTdjMy4xMi0yLjIxOCAxMS40NTEtNy4xNDggMTEuNDUxLTcuMTQ4TDI3LjEyNSA1YTEwLjIgMTAuMiAwIDAgMC0yLjI0OC0uMjMiIHN0eWxlPSJmaWxsOiNhNzhiZmE7c3Ryb2tlLXdpZHRoOjIuNjQ1ODM7c3Ryb2tlLWxpbmVqb2luOnJvdW5kIi8+PHBhdGggZD0iTTQ2LjAzNy0yOS4xMDRoMTM2Ljc5di41SDQ2LjAzN3oiIHN0eWxlPSJmaWxsOiNhNzhiZmE7c3Ryb2tlLXdpZHRoOjIuNjQ1ODQ7c3Ryb2tlLWxpbmVqb2luOnJvdW5kIi8+PHBhdGggZD0iTTgyLjMwMiA3LjE2MmExNC45NyAxNC45NyAwIDAgMC0yLjE4IDcuODF2NjBjMCA4LjMxIDYuNzkyIDE2LjI5NiAxNSAxNWwzMy41NDMtNS4yOWM0LjQxOC0uNjk4IDguNDU5LTIuMzA0IDExLjIwNy01LjI4IDAgMC0yLjY2OC0zLjcyNi01LjA2LTYuMTE4LTIuNDM4LTIuNDM3LTkuNDI4LTguMzctOS40MjgtOC4zNy0yLjM5MSAyLjUyMi01LjAxIDUuNTM2LTguNjYgNi44ODRsLTguNiAzLjE3NWMtNi43NTcgMi40OTQtMTQuMjk4LTcuOTE5LTE0LjA2LTE1LjExN2wxLjA1OS0zMS44ODNjLjA0NC0xLjMxNS0yLjgwOC03LjI4Mi00LjE3Ni04Ljk5MnpNMTQxLjUwNyAxMC44MTJjLTYuODY4LS41OTgtMTMuMTc5IDUuNTE4LTEyLjQ0NiAxMi4yODZsNC4zOSA0MC41NzhjLjczMyA2Ljc2OCA1LjYwNyAxMS40MiAxMi40NDcgMTIuMjg3bDQxLjAwNCA1LjE5YzYuODQuODY2IDExLjczLTUuNTE2IDEyLjQ0Ny0xMi4yODZsNC4zOS00MS40MzRjLjcxOC02Ljc3LTUuNTc3LTExLjY4OS0xMi40NDYtMTIuMjg3em0xMC43ODcgMTIuMjg2IDI4LjIxMiA0LjMzNWM1LjkwNS45MDcgMTIuMDQ1IDQuODc4IDEwLjc4NyAxMC42NDhsLTQuMzkgMjAuMTM4Yy0xLjI1OSA1Ljc3LTUuMDE3IDEyLjE5LTEwLjc4NyAxMC42NDhsLTE5LjQzLTUuMTljLTUuNzctMS41NDItOS40NzctNC44OTUtMTAuNzg4LTEwLjY0OWwtNC4zOS0xOS4yODFjLTEuMzExLTUuNzU1IDQuODgyLTExLjU1NiAxMC43ODYtMTAuNjQ5TTIxNS4zMiA0MC45ODFjLjA4Mi41OTIuMTI4IDEuMTk0LjEyOCAxLjgwOSAwIDAgMS4wNzggMTMuMTg5IDEuMDU4IDE4Ljg1OHMtMS4wNTggMTUuMTQyLTEuMDU4IDE1LjE0MmMtLjE2NCA0LjY5NS0xLjY0IDkuNjU4LTUuMTYgMTIuMTFoMTkuNDIxYy4xMjgtLjc3Mi4yMDEtMS41MzguMjEtMi4yODZsLjUyOS00NS42MzNzLTUuOTQxIDEuMDU5LTguNDYzIDEuMDU5Yy0yLjUyIDAtNi42NjQtMS4wNTktNi42NjQtMS4wNTkiIHN0eWxlPSJmaWxsOiNhNzhiZmE7c3Ryb2tlLXdpZHRoOjIuNjQ1ODM7c3Ryb2tlLWxpbmVqb2luOnJvdW5kIi8+PGNpcmNsZSBjeD0iMjIyLjUxNCIgY3k9IjE5LjE4MiIgcj0iMTIuMTE2IiBzdHlsZT0iZmlsbDojYTc4YmZhO3N0cm9rZS13aWR0aDoyLjY0NTgyO3N0cm9rZS1saW5lam9pbjpyb3VuZCIvPjxwYXRoIGQ9Ik0yNTcuMzc5IDExLjU0OWMtMy41IDEuMjg5LTYuOTUgMy4zODktOS4yMDQgNi4zNTktMS42NiAyLjE4NS0yLjI0NyA1LjA3Mi0yLjY4OCA3Ljc4LS4zOTggMi40NDctLjM4IDUgLjA3NiA3LjQzNi40OTMgMi42MzggMS4zNzIgNS4yODQgMi44MzUgNy41MzMgNS4xODMgNy45NzEgOS43MTEgNS43MiAyMC4zMjMgMjAuMDE0cy0yOC42OCAxMS45NzctMjguODcxIDkuOTg3LTUuNzQ1IDExLjI0NS01Ljc0NSAxMS4yNDUgMTAuMzczIDIuOTQzIDE1LjcxIDMuNDc4YzQuNzA0LjQ3MiA5LjQ4NC4yODMgMTQuMTgyLS4yNTUgMy4wNDYtLjM0OSA2LjI4LS40OTUgOC45OTUtMS45MTggNC4xNTYtMi4xNzkgNy45MTYtNS41OCAxMC4yNDYtOS42NTMgMi4zLTQuMDIgMy40NDYtMTEuNzkyIDMuMDg5LTEzLjU0Ny0uNjk5LTMuNDM2LTUuMzY2LTEwLjgzMy05LjYyOS0xNC4yMzItNC4yNjItMy4zOTktMTQuMDk0LTExLjQ1My0xNC4wOTQtMTEuNDUzLTUuNjMtNC40OSAxLjY0Mi0xMi45OTEgOC43NjctMTEuOTQybDE3Ljk2NSAyLjY0NnMtLjE4NS0zLjU0NC0uMjA3LTUuNThjLS4wMjItMi4wMzggMS43OTUtNi4zNzcgMS43OTUtNi4zNzdzLTEwLjYzLTEuMTgzLTE0LjY5NS0xLjU0NS03LjQwNC0uODI1LTExLjExOC0uNzY0Yy0yLjU5LjA0My01LjMwMS0uMTA4LTcuNzMyLjc4OE0zMDUuODkzIDguNjA1bC4xNzcgMjAuMjgyLTE2LjIxMi0yLjA4MS0uMDQ3IDkuNDMgMTYuMzYzIDIuMTk3LjI0OCAyOS4yMWMuMDg5IDkuOTI4IDYuNzY2IDIyLjE3MyAxNC4xODUgMjMuMzZsNi42NjItMTkuNDljLTQuNDAyLTIuNjg4LTYuMTk0LTkuODQ4LTYuMzc2LTE2LjU4MSAwIDAtLjU5My04LjA2LS44OTItMTQuNjQ3bDE5LjAzNiAyLjM1MSAxLjEwNS05LjQzLTEwLjUyNS0xLjUzNi05LjY2OS0xLjQ1NWMuMjczLTguMDkuOTQ1LTE5LjI3Ljk0NS0xOS4yN3EuMDAyLTEuMTkyLjEyNy0yLjM0cy00LjE0NCAxLjM3LTYuNjY1IDEuMzctOC40NjItMS4zNy04LjQ2Mi0xLjM3IiBzdHlsZT0iZmlsbDojYTc4YmZhO3N0cm9rZS13aWR0aDoyLjY0NTgzO3N0cm9rZS1saW5lam9pbjpyb3VuZCIvPjxwYXRoIGQ9Ik0zNTguMDYzIDgyLjc3YTE5IDE5IDAgMCAxLS4xMjctMi4xODRzLTEuMDc4LTE1LjkzNi0xLjA1OC0yMi43ODYtLjM1My0xMi4yMTEgMC0xOC4yOTVjLjIxLTMuNjI1LjAzNC03LjQ3NiAxLjI1OC0xMC43OTYuOTY4LTIuNjI2IDIuNDczLTUuMjkzIDQuNTktNi42MDcgMS41MzgtLjk1NiAzLjQ2OC0uODI3IDUuMTc0LS40ODMgMS45MTguMzg3IDMuNzEzIDEuNTM3IDUuMzU1IDIuNzk1IDMuNDQ4IDIuNjQgOS4xODcgOS43ODIgOS4xODcgOS43ODJsNS41OTgtMTlzLTEwLjc5OC04LjE2NC0xNi44Ny0xMC4wNTVjLTIuMzA1LS43MTgtNC43NTYtLjUzMS03LjEzNC0uMzk5LTIuMTQ3LjEyLTQuMzg2LjEyNC02LjM4NSAxLjA3Ny0yLjgzNSAxLjM1LTUuNDY3IDMuNTg2LTcuNDc3IDYuMzUzLTMuMTc3IDQuMzc0LTUuMjk2IDkuODk5LTYuNzA5IDE1LjQ2My0xLjAxOCA0LjAxMS0uOTc4IDguMzE5LTEuMTY3IDEyLjUwOC0uMjMzIDUuMTYxLS4wMiAxMC4zMzguMDQzIDE1LjUwNi4xMTIgOS4wNDMuNTk1IDI3LjEyMi41OTUgMjcuMTIyczUuOTQyLTEuMjggOC40NjMtMS4yOCA2LjY2NSAxLjI4IDYuNjY1IDEuMjgiIHN0eWxlPSJmaWxsOiNhNzhiZmE7c3Ryb2tlLXdpZHRoOjIuNjQ1ODI7c3Ryb2tlLWxpbmVqb2luOnJvdW5kIi8+PC9zdmc+';

export interface HeaderAuth {
  /** Whether the user is authenticated */
  authenticated: boolean;
  /** User pubkey (for the user-menu display) */
  pubkey?: string;
  /** Auth method label ('nip07' | 'nip46') */
  method?: string;
  /** Called when the Sign In button is clicked */
  onSignIn?: () => void;
  /** Called when the user signs out */
  onLogout?: () => void;
}

export interface HeaderProps {
  /** Logo URL or element */
  logo?: React.ReactNode;
  /** Link for the logo */
  logoHref?: string;
  /**
   * Which service is currently active (highlighted) in the menu. This is the
   * ONLY way apps customize the menu — the service catalog itself is owned by
   * @cloistr/ui (see `defaultServices`). There is deliberately no `services`
   * prop: passing a custom catalog would fragment the nav across apps. To add
   * or change a service, PR `defaultServices` in this package.
   */
  activeServiceId?: string;
  /** URL to user's profile page */
  profileUrl?: string;
  /** URL to settings page */
  settingsUrl?: string;
  /** Custom signer URL (defaults to the canonical Cloistr signer) */
  signerUrl?: string;
  /** Additional header content (right side) */
  children?: React.ReactNode;
  /**
   * Explicit auth state for apps that manage their own session (e.g. backend-JWT
   * via BackendAuthProvider). When provided, the Header uses it instead of the
   * Nostr auth context, and Sign In calls `onSignIn` instead of opening the
   * Nostr login modal.
   */
  auth?: HeaderAuth;
}

/**
 * Shared header component with logo, service menu, and auth
 */
export function Header({
  logo,
  logoHref = 'https://cloistr.xyz',
  activeServiceId,
  profileUrl,
  settingsUrl,
  signerUrl = 'https://signer.cloistr.xyz',
  children,
  auth,
}: HeaderProps) {
  const { authState } = useNostrAuth();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const externalAuth = auth !== undefined;
  const isAuthed = externalAuth ? auth.authenticated : authState.isConnected;

  const defaultLogo = (
    <img
      src={CLOISTR_WORDMARK}
      alt="Cloistr"
      className="cloistr-header-wordmark"
      style={{ height: 26, width: 'auto', display: 'block' }}
    />
  );

  return (
    <>
      <header className="cloistr-header">
        <div className="cloistr-header-left">
          <a href={logoHref} className="cloistr-header-logo">
            {logo || defaultLogo}
          </a>
          <ServiceMenu services={defaultServices} activeServiceId={activeServiceId} />
        </div>

        <div className="cloistr-header-right">
          {children}
          {isAuthed ? (
            <UserMenu
              profileUrl={profileUrl}
              settingsUrl={settingsUrl}
              pubkey={auth?.pubkey}
              method={auth?.method}
              onLogout={auth?.onLogout}
            />
          ) : externalAuth && !auth?.onSignIn ? (
            // Login screens for backend-auth apps pass auth={{ authenticated: false }}
            // with no onSignIn: the page IS the login form, so render no redundant
            // Sign In control (just the logo + service menu).
            null
          ) : (
            <button
              className="cloistr-btn cloistr-btn-primary"
              onClick={externalAuth ? auth?.onSignIn : () => setShowLoginModal(true)}
            >
              Sign In
            </button>
          )}
        </div>
      </header>

      {!externalAuth && (
        <LoginModal
          isOpen={showLoginModal}
          onClose={() => setShowLoginModal(false)}
          signerUrl={signerUrl}
        />
      )}
    </>
  );
}
