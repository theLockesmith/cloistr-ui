import React, { useState } from 'react';
import { useAuth } from '../auth';
import { isNip07Available, isValidBunkerUrl } from '../auth';

export interface LoginModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Custom signer URL (defaults to signer.cloistr.xyz) */
  signerUrl?: string;
}

type Screen = 'method' | 'bunker' | 'login' | 'signup' | 'pending';

interface LoginForm {
  username: string;
  password: string;
}

interface SignupForm {
  username: string;
  password: string;
  passwordConfirm: string;
  importNsec: string;
  showImportKey: boolean;
}

const emptyLoginForm = (): LoginForm => ({ username: '', password: '' });
const emptySignupForm = (): SignupForm => ({
  username: '', password: '', passwordConfirm: '', importNsec: '', showImportKey: false,
});

/**
 * Login modal with NIP-07, NIP-46, password login, and signup options.
 * Every sub-state has a Back/Cancel that returns to method selection.
 */
export function LoginModal({ isOpen, onClose, signerUrl = 'https://signer.cloistr.xyz' }: LoginModalProps) {
  const { connectNip07, connectNip46, connectViaNostrConnect, state } = useAuth();
  const [screen, setScreen] = useState<Screen>('method');
  const [bunkerUrl, setBunkerUrl] = useState('');
  const [loginForm, setLoginForm] = useState<LoginForm>(emptyLoginForm());
  const [signupForm, setSignupForm] = useState<SignupForm>(emptySignupForm());
  const [nostrConnectUri, setNostrConnectUri] = useState('');
  const [copied, setCopied] = useState(false);
  const [localError, setLocalError] = useState('');

  if (!isOpen) return null;

  const goBack = () => {
    setScreen('method');
    setBunkerUrl('');
    setLoginForm(emptyLoginForm());
    setSignupForm(emptySignupForm());
    setNostrConnectUri('');
    setCopied(false);
    setLocalError('');
  };

  const handleNip07 = async () => {
    setLocalError('');
    await connectNip07();
    if (!state.error) {
      onClose();
    }
  };

  const handleBunkerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');
    if (isValidBunkerUrl(bunkerUrl)) {
      await connectNip46(bunkerUrl);
      if (!state.error) {
        onClose();
      }
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');

    try {
      // POST /users/login → token
      const loginRes = await fetch(`${signerUrl}/api/v1/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginForm.username, password: loginForm.password }),
      });
      if (!loginRes.ok) {
        const err = await loginRes.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? 'Login failed');
      }
      const { token } = await loginRes.json() as { token: string };

      // GET /keys → first key id
      const keysRes = await fetch(`${signerUrl}/api/v1/keys`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!keysRes.ok) throw new Error('Failed to fetch keys');
      const keys = await keysRes.json() as Array<{ id: string }>;
      if (!keys.length) throw new Error('No keys found for this account');
      const keyId = keys[0].id;

      // connectViaNostrConnect — auto-approved via signer API
      await connectViaNostrConnect(undefined, async (uri) => {
        setNostrConnectUri(uri);
        setScreen('pending');
        const approveRes = await fetch(`${signerUrl}/api/v1/nostrconnect`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ uri, key_id: keyId }),
        });
        if (!approveRes.ok) throw new Error('Failed to authorize nostrconnect');
      });

      onClose();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Login failed');
      if (screen === 'pending') setScreen('login');
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');

    if (signupForm.password !== signupForm.passwordConfirm) {
      setLocalError('Passwords do not match');
      return;
    }

    try {
      const body: Record<string, string> = {
        username: signupForm.username,
        password: signupForm.password,
      };
      if (signupForm.showImportKey && signupForm.importNsec) {
        body.import_nsec = signupForm.importNsec;
      }

      // POST /users/register → token
      const registerRes = await fetch(`${signerUrl}/api/v1/users/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!registerRes.ok) {
        const err = await registerRes.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? 'Registration failed');
      }
      const { token } = await registerRes.json() as { token: string };

      // GET /keys → first key id
      const keysRes = await fetch(`${signerUrl}/api/v1/keys`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!keysRes.ok) throw new Error('Failed to fetch keys');
      const keys = await keysRes.json() as Array<{ id: string }>;
      if (!keys.length) throw new Error('No keys found after registration');
      const keyId = keys[0].id;

      // connectViaNostrConnect — auto-approved via signer API
      await connectViaNostrConnect(undefined, async (uri) => {
        setNostrConnectUri(uri);
        setScreen('pending');
        const approveRes = await fetch(`${signerUrl}/api/v1/nostrconnect`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ uri, key_id: keyId }),
        });
        if (!approveRes.ok) throw new Error('Failed to authorize nostrconnect');
      });

      onClose();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Registration failed');
      if (screen === 'pending') setScreen('signup');
    }
  };

  const handleCopyUri = () => {
    navigator.clipboard.writeText(nostrConnectUri).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => { /* ignore */ });
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const displayError = localError || state.error;

  const title: Record<Screen, string> = {
    method: 'Sign In',
    bunker: 'Bunker URL',
    login: 'Log In',
    signup: 'Create Account',
    pending: 'Connecting…',
  };

  return (
    <div className="cloistr-modal-backdrop" onClick={handleBackdropClick}>
      <div className="cloistr-modal">
        <div className="cloistr-modal-header">
          <h2>{title[screen]}</h2>
          <button className="cloistr-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="cloistr-modal-content">
          {displayError && (
            <div className="cloistr-error">{displayError}</div>
          )}

          {screen === 'method' && (
            <div className="cloistr-login-options">
              {isNip07Available() && (
                <button
                  className="cloistr-btn cloistr-btn-primary"
                  onClick={handleNip07}
                  disabled={state.isLoading}
                >
                  {state.isLoading ? 'Connecting...' : 'Use Browser Extension'}
                </button>
              )}
              <button
                className="cloistr-btn cloistr-btn-secondary"
                onClick={() => { setLocalError(''); setScreen('bunker'); }}
                disabled={state.isLoading}
              >
                Use Bunker URL
              </button>
              <button
                className="cloistr-btn cloistr-btn-secondary"
                onClick={() => { setLocalError(''); setScreen('login'); }}
                disabled={state.isLoading}
              >
                Log In with Password
              </button>
              <button
                className="cloistr-btn cloistr-btn-outline"
                onClick={() => { setLocalError(''); setScreen('signup'); }}
                disabled={state.isLoading}
              >
                Create Account
              </button>
            </div>
          )}

          {screen === 'bunker' && (
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
                <button type="button" className="cloistr-btn cloistr-btn-secondary" onClick={goBack}>
                  Back
                </button>
                <button
                  type="submit"
                  className="cloistr-btn cloistr-btn-primary"
                  disabled={!isValidBunkerUrl(bunkerUrl) || state.isLoading}
                >
                  {state.isLoading ? 'Connecting...' : 'Connect'}
                </button>
              </div>
            </form>
          )}

          {screen === 'login' && (
            <form onSubmit={handleLogin} className="cloistr-login-form">
              <label htmlFor="login-username">Username</label>
              <input
                id="login-username"
                type="text"
                value={loginForm.username}
                onChange={(e) => setLoginForm(f => ({ ...f, username: e.target.value }))}
                autoComplete="username"
                className="cloistr-input"
              />
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                value={loginForm.password}
                onChange={(e) => setLoginForm(f => ({ ...f, password: e.target.value }))}
                autoComplete="current-password"
                className="cloistr-input"
              />
              <div className="cloistr-form-actions">
                <button type="button" className="cloistr-btn cloistr-btn-secondary" onClick={goBack}>
                  Back
                </button>
                <button
                  type="submit"
                  className="cloistr-btn cloistr-btn-primary"
                  disabled={!loginForm.username || !loginForm.password || state.isLoading}
                >
                  {state.isLoading ? 'Connecting...' : 'Log In'}
                </button>
              </div>
            </form>
          )}

          {screen === 'signup' && (
            <form onSubmit={handleSignup} className="cloistr-signup-form">
              <label htmlFor="signup-username">Username</label>
              <input
                id="signup-username"
                type="text"
                value={signupForm.username}
                onChange={(e) => setSignupForm(f => ({ ...f, username: e.target.value }))}
                autoComplete="username"
                className="cloistr-input"
              />
              <label htmlFor="signup-password">Password</label>
              <input
                id="signup-password"
                type="password"
                value={signupForm.password}
                onChange={(e) => setSignupForm(f => ({ ...f, password: e.target.value }))}
                autoComplete="new-password"
                className="cloistr-input"
              />
              <label htmlFor="signup-password-confirm">Confirm Password</label>
              <input
                id="signup-password-confirm"
                type="password"
                value={signupForm.passwordConfirm}
                onChange={(e) => setSignupForm(f => ({ ...f, passwordConfirm: e.target.value }))}
                autoComplete="new-password"
                className="cloistr-input"
              />
              <div className="cloistr-toggle">
                <button
                  type="button"
                  className="cloistr-btn cloistr-btn-link"
                  onClick={() => setSignupForm(f => ({ ...f, showImportKey: !f.showImportKey, importNsec: '' }))}
                >
                  {signupForm.showImportKey ? 'Use a new key instead' : 'I already have a key'}
                </button>
              </div>
              {signupForm.showImportKey && (
                <>
                  <label htmlFor="signup-import-nsec">Your nsec or hex private key</label>
                  <input
                    id="signup-import-nsec"
                    type="password"
                    value={signupForm.importNsec}
                    onChange={(e) => setSignupForm(f => ({ ...f, importNsec: e.target.value }))}
                    placeholder="nsec1... or hex"
                    className="cloistr-input"
                  />
                </>
              )}
              <div className="cloistr-form-actions">
                <button type="button" className="cloistr-btn cloistr-btn-secondary" onClick={goBack}>
                  Back
                </button>
                <button
                  type="submit"
                  className="cloistr-btn cloistr-btn-primary"
                  disabled={
                    !signupForm.username ||
                    !signupForm.password ||
                    signupForm.password !== signupForm.passwordConfirm ||
                    state.isLoading
                  }
                >
                  {state.isLoading ? 'Creating account...' : 'Create Account'}
                </button>
              </div>
            </form>
          )}

          {screen === 'pending' && (
            <div className="cloistr-pending">
              <p>Waiting for signer to connect&hellip;</p>
              {nostrConnectUri && (
                <>
                  <p className="cloistr-pending-label">Nostrconnect URI:</p>
                  <code className="cloistr-pending-uri">{nostrConnectUri}</code>
                  <button
                    type="button"
                    className="cloistr-btn cloistr-btn-secondary"
                    onClick={handleCopyUri}
                  >
                    {copied ? 'Copied!' : 'Copy URI'}
                  </button>
                </>
              )}
              <div className="cloistr-form-actions">
                <button type="button" className="cloistr-btn cloistr-btn-secondary" onClick={goBack}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
