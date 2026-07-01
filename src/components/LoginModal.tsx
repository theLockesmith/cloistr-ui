import React, { useState } from 'react';
import { useNostrAuth, useAuthHelpers, isValidBunkerUrl } from '../auth/index.js';

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
  const { connectNip07, connectNip46, connectViaNostrConnect, authState } = useNostrAuth();
  const { isNip07Available } = useAuthHelpers();
  const [bunkerUrl, setBunkerUrl] = useState('');
  const [showBunkerInput, setShowBunkerInput] = useState(false);
  const [nostrConnectUri, setNostrConnectUri] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showSignup, setShowSignup] = useState(false);
  const [su, setSu] = useState({ username: '', password: '', email: '' });
  const [suBusy, setSuBusy] = useState(false);
  const [suError, setSuError] = useState<string | null>(null);
  const [suStatus, setSuStatus] = useState<string | null>(null);

  if (!isOpen) return null;

  // Inline signup: create a Cloistr account (username/password), which provisions
  // a signing key automatically, then auto-approve this app's nostrconnect with the
  // fresh session so the user is signed in one-click — no separate signer visit.
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuError(null);
    setSuBusy(true);
    try {
      const api = `${signerUrl}/api/v1`;
      setSuStatus('Creating your account…');
      const reg = await fetch(`${api}/users/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: su.username, password: su.password, email: su.email || undefined }),
      });
      if (!reg.ok) {
        const b = await reg.json().catch(() => ({}));
        throw new Error((b as { error?: string }).error || `Registration failed (${reg.status})`);
      }
      setSuStatus('Signing you in…');
      const login = await fetch(`${api}/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: su.username, password: su.password }),
      });
      if (!login.ok) throw new Error('Account created, but auto sign-in failed — try signing in.');
      const token = ((await login.json()) as { token?: string }).token;
      const keysRes = await fetch(`${api}/keys`, { headers: { Authorization: `Bearer ${token}` } });
      const keysBody = (await keysRes.json()) as unknown;
      const keys = Array.isArray(keysBody) ? keysBody : ((keysBody as { keys?: Array<{ id: string }> }).keys || []);
      if (!keys.length) throw new Error('No signing key was created for the account');
      const keyId = (keys[0] as { id: string }).id;
      setSuStatus('Connecting your new identity…');
      await connectViaNostrConnect(undefined, async (uri) => {
        await fetch(`${api}/nostrconnect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ uri, key_id: keyId }),
        });
      });
      if (!authState.error) onClose();
    } catch (err) {
      setSuError((err as Error).message);
    } finally {
      setSuBusy(false);
      setSuStatus(null);
    }
  };

  // "Login With Cloistr": client-initiated nostrconnect://. We generate the URI,
  // show it for the user to approve in their signer (Connect an App), and resolve
  // once the signer sends the approval over the relay.
  const handleLoginWithCloistr = async () => {
    setNostrConnectUri(null);
    setCopied(false);
    await connectViaNostrConnect(undefined, (uri) => setNostrConnectUri(uri));
    if (!authState.error) {
      onClose();
    }
  };

  const copyUri = () => {
    if (nostrConnectUri && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(nostrConnectUri);
      setCopied(true);
    }
  };

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

          {showSignup ? (
            <form onSubmit={handleSignup} className="cloistr-signup-form">
              <p className="cloistr-login-help">
                Create a Cloistr identity — a signing key is set up for you automatically.
              </p>
              {suError && <div className="cloistr-error">{suError}</div>}
              <label htmlFor="su-username">Username</label>
              <input
                id="su-username"
                className="cloistr-input"
                type="text"
                value={su.username}
                onChange={(e) => setSu({ ...su, username: e.target.value })}
                placeholder="yourname"
                autoComplete="username"
              />
              <label htmlFor="su-password">Password</label>
              <input
                id="su-password"
                className="cloistr-input"
                type="password"
                value={su.password}
                onChange={(e) => setSu({ ...su, password: e.target.value })}
                placeholder="at least 8 characters"
                autoComplete="new-password"
              />
              <label htmlFor="su-email">Email (optional)</label>
              <input
                id="su-email"
                className="cloistr-input"
                type="email"
                value={su.email}
                onChange={(e) => setSu({ ...su, email: e.target.value })}
                placeholder="for account recovery"
                autoComplete="email"
              />
              {suStatus && <p className="cloistr-login-help">{suStatus}</p>}
              <div className="cloistr-form-actions">
                <button
                  type="button"
                  className="cloistr-btn cloistr-btn-secondary"
                  onClick={() => setShowSignup(false)}
                  disabled={suBusy}
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="cloistr-btn cloistr-btn-primary"
                  disabled={suBusy || su.username.length < 3 || su.password.length < 8}
                >
                  {suBusy ? 'Creating…' : 'Create account'}
                </button>
              </div>
            </form>
          ) : !showBunkerInput ? (
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

                <button
                  className="cloistr-btn cloistr-btn-outline"
                  onClick={handleLoginWithCloistr}
                  disabled={authState.isConnecting}
                >
                  {authState.isConnecting ? 'Waiting for approval…' : 'Login With Cloistr'}
                </button>

                <button
                  className="cloistr-btn cloistr-btn-ghost"
                  onClick={() => setShowSignup(true)}
                  disabled={authState.isConnecting}
                >
                  New here? Create an account
                </button>
              </div>

              {nostrConnectUri && (
                <div className="cloistr-nostrconnect">
                  <p>Approve this connection in your Cloistr signer:</p>
                  <code
                    className="cloistr-nostrconnect-uri"
                    style={{ display: 'block', wordBreak: 'break-all', fontSize: '12px', padding: '8px', background: 'rgba(0,0,0,0.05)', borderRadius: '4px' }}
                  >
                    {nostrConnectUri}
                  </code>
                  <div className="cloistr-form-actions" style={{ marginTop: '8px' }}>
                    <button className="cloistr-btn cloistr-btn-secondary" onClick={copyUri}>
                      {copied ? 'Copied' : 'Copy link'}
                    </button>
                    <a
                      href={`${signerUrl}/apps`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="cloistr-btn cloistr-btn-primary"
                    >
                      Open signer → Connect an App
                    </a>
                  </div>
                  <p className="cloistr-login-help">
                    Paste the link into the signer's "Connect an App", pick a key, and approve. This
                    window signs in automatically once approved.
                  </p>
                </div>
              )}

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
