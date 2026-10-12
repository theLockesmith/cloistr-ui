import { useState } from 'react';
import { Modal } from './Modal.js';
import { LoginModal } from './LoginModal.js';

/**
 * Shown ONLY when the signer is healthy but no longer holds this user's key
 * (typically after a signer deploy), and one silent retry has already failed.
 * See lib/signerReauth.ts for the rule.
 *
 * This is the one place a credential prompt is correct: the session really has
 * ended, and no amount of "try again" can bring the key back. An unreachable
 * signer never reaches this component; it keeps the SignerRecovery screen,
 * which must never ask for credentials.
 *
 * Signing in goes through the standard LoginModal in 'session' mode: the
 * password login unlocks the key on the replica that serves it, and the caller
 * then mints a fresh session and retries whatever the user was doing.
 */
export interface SignerReauthPromptProps {
  isOpen: boolean;
  signerUrl?: string;
  /** The user signed in again. */
  onSignedIn: () => void;
  /** The user chose not to sign in now. */
  onDismiss: () => void;
}

export const SIGNER_REAUTH_TITLE = 'Your signer session needs you to sign in again';

export function SignerReauthPrompt({ isOpen, signerUrl, onSignedIn, onDismiss }: SignerReauthPromptProps) {
  const [loginOpen, setLoginOpen] = useState(false);

  return (
    <>
      <Modal
        isOpen={isOpen && !loginOpen}
        onClose={onDismiss}
        title={SIGNER_REAUTH_TITLE}
        size="sm"
        closeOnBackdrop={false}
        className="cloistr-signer-reauth"
        footer={
          <div className="cloistr-signer-recovery-actions">
            <button type="button" className="cloistr-signer-recovery-btn" onClick={onDismiss}>
              Not now
            </button>
            <button
              type="button"
              className="cloistr-signer-recovery-btn cloistr-signer-recovery-btn--primary"
              onClick={() => setLoginOpen(true)}
              autoFocus
            >
              Sign in again
            </button>
          </div>
        }
      >
        <p className="cloistr-signer-recovery-detail">
          Your signing session ended, usually because the signer was updated. Sign in again and
          we will pick up where you left off. Nothing you were doing has been lost.
        </p>
      </Modal>
      <LoginModal
        isOpen={isOpen && loginOpen}
        mode="session"
        signerUrl={signerUrl}
        onClose={() => setLoginOpen(false)}
        onSession={() => {
          setLoginOpen(false);
          onSignedIn();
        }}
      />
    </>
  );
}
