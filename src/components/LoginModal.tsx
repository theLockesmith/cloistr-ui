import React, { useState } from 'react';
import { useNostrAuth, useAuthHelpers, isValidBunkerUrl } from '../auth';

export interface LoginModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Custom signer URL (defaults to signer.cloistr.xyz) */
  signerUrl?: string;
}

/**
 * Login modal with NIP-07 and NIP-46 options
 */
export function LoginModal({ isOpen, onClose, signerUrl = 'https://signer.cloistr.xyz' }: LoginModalProps) {
  const { connectNip07, connectNip46, authState } = useNostrAuth();
  const { isNip07Available } = useAuthHelpers();
  const [bunkerUrl, setBunkerUrl] = useState('');
  const [showBunkerInput, setShowBunkerInput] = useState(false);

  if (!isOpen) return null;

  const handleNip07 = async () => {
    await connectNip07();
    if (!authState.error) {
      onClose();
    }
  };

  const handleBunkerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isValidBunkerUrl(bunkerUrl)) {
      await connectNip46({ bunkerUrl });
      if (!authState.error) {
        onClose();
      }
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="cloistr-modal-backdrop" onClick={handleBackdropClick}>
      <div className="cloistr-modal">
        <div className="cloistr-modal-header">
          <h2>Sign In</h2>
          <button className="cloistr-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="cloistr-modal-content">
          {authState.error && (
            <div className="cloistr-error">{authState.error}</div>
          )}

          {!showBunkerInput ? (
            <>
              <div className="cloistr-login-options">
                {isNip07Available && (
                  <button
                    className="cloistr-btn cloistr-btn-primary"
                    onClick={handleNip07}
                    disabled={authState.isConnecting}
                  >
                    {authState.isConnecting ? 'Connecting...' : 'Use Browser Extension'}
                  </button>
                )}

                <button
                  className="cloistr-btn cloistr-btn-secondary"
                  onClick={() => setShowBunkerInput(true)}
                  disabled={authState.isConnecting}
                >
                  Use Bunker URL
                </button>

                <a
                  href={signerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cloistr-btn cloistr-btn-outline"
                >
                  Login With Cloistr
                </a>
              </div>

              <p className="cloistr-login-help">
                Don't have a Nostr identity?{' '}
                <a href={signerUrl} target="_blank" rel="noopener noreferrer">
                  Get started at signer.cloistr.xyz
                </a>
              </p>
            </>
          ) : (
            <form onSubmit={handleBunkerSubmit} className="cloistr-bunker-form">
              <label htmlFor="bunker-url">Bunker URL</label>
              <input
                id="bunker-url"
                type="text"
                value={bunkerUrl}
                onChange={(e) => setBunkerUrl(e.target.value)}
                placeholder="bunker://..."
                className="cloistr-input"
              />
              <div className="cloistr-form-actions">
                <button
                  type="button"
                  className="cloistr-btn cloistr-btn-secondary"
                  onClick={() => setShowBunkerInput(false)}
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="cloistr-btn cloistr-btn-primary"
                  disabled={!isValidBunkerUrl(bunkerUrl) || authState.isConnecting}
                >
                  {authState.isConnecting ? 'Connecting...' : 'Connect'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
