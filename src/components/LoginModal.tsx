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

type Screen = 'method' | 'bunker' | 'login' | 'signup' | 'pending';

/**
 * Login modal with NIP-07, NIP-46, password login, and signup options.
 * Every sub-state (bunker, login, signup, pending) has Back/Cancel to return
 * to method selection.
 */
export function LoginModal({ isOpen, onClose, signerUrl = 'https://signer.cloistr.xyz' }: LoginModalProps) {
  const { connectNip07, connectNip46, connectViaNostrConnect, authState } = useNostrAuth();
  const { isNip07Available } = useAuthHelpers();

  // Navigation
  const [screen, setScreen] = useState<Screen>('method');
  // true = "Login With Cloistr" (manual, user pastes URI into signer)
  // false = password-login or signup (auto-approved via API)
  const [pendingIsManual, setPendingIsManual] = useState(false);

  // Shared pending state (nostrconnect URI)
  const [nostrConnectUri, setNostrConnectUri] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Bunker form
  const [bunkerUrl, setBunkerUrl] = useState('');

  // Password login form (existing accounts)
  const [lf, setLf] = useState({ username: '', password: '' });
  const [lfBusy, setLfBusy] = useState(false);

  // Signup form
  const [su, setSu] = useState({
    username: '', password: '', passwordConfirm: '', importNsec: '', showImportKey: false,
  });
  const [suBusy, setSuBusy] = useState(false);
  const [suStatus, setSuStatus] = useState<string | null>(null);

  // Local error (form-level; distinct from authState.error which is auth-layer)
  const [localError, setLocalError] = useState<string | null>(null);

  if (!isOpen) return null;

  // ── Navigation ────────────────────────────────────────────────────────────

  const goBack = () => {
    setScreen('method');
    setBunkerUrl('');
    setLf({ username: '', password: '' });
    setLfBusy(false);
    setSu({ username: '', password: '', passwordConfirm: '', importNsec: '', showImportKey: false });
    setSuBusy(false);
    setSuStatus(null);
    setNostrConnectUri(null);
    setCopied(false);
    setLocalError(null);
    setPendingIsManual(false);
  };

  // ── Auth handlers ─────────────────────────────────────────────────────────

  const handleNip07 = async () => {
    setLocalError(null);
    await connectNip07();
    if (!authState.error) onClose();
  };

  const handleBunkerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (isValidBunkerUrl(bunkerUrl)) {
      await connectNip46({ bunkerUrl });
      if (!authState.error) onClose();
    }
  };

  // "Login With Cloistr": client-generated nostrconnect://, user manually
  // approves it in their signer app.
  const handleLoginWithCloistr = async () => {
    setLocalError(null);
    setNostrConnectUri(null);
    setCopied(false);
    setPendingIsManual(true);
    await connectViaNostrConnect(undefined, (uri) => {
      setNostrConnectUri(uri);
      setScreen('pending');
    });
    if (!authState.error) onClose();
  };

  // Password login for existing Cloistr accounts:
  // POST /users/login → GET /keys → connectViaNostrConnect auto-approved.
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setLfBusy(true);
    try {
      const api = `${signerUrl}/api/v1`;

      const loginRes = await fetch(`${api}/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: lf.username, password: lf.password }),
      });
      if (!loginRes.ok) {
        const b = await loginRes.json().catch(() => ({}));
        throw new Error((b as { error?: string }).error || `Login failed (${loginRes.status})`);
      }
      const token = ((await loginRes.json()) as { token?: string }).token;

      const keysRes = await fetch(`${api}/keys`, { headers: { Authorization: `Bearer ${token}` } });
      if (!keysRes.ok) throw new Error('Failed to fetch signing keys');
      const keysBody = (await keysRes.json()) as unknown;
      const keys = Array.isArray(keysBody)
        ? keysBody
        : ((keysBody as { keys?: Array<{ id: string }> }).keys ?? []);
      if (!keys.length) throw new Error('No signing key found for this account');
      const keyId = (keys[0] as { id: string }).id;

      setPendingIsManual(false);
      await connectViaNostrConnect(undefined, async (uri) => {
        setNostrConnectUri(uri);
        setScreen('pending');
        try {
          const approveRes = await fetch(`${api}/nostrconnect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ uri, key_id: keyId }),
          });
          if (!approveRes.ok) {
            const b = await approveRes.json().catch(() => ({}));
            setLocalError((b as { error?: string }).error ?? 'Approval failed');
          }
        } catch {
          setLocalError('Network error during approval');
        }
      });

      if (!authState.error) onClose();
    } catch (err) {
      setLocalError((err as Error).message);
    } finally {
      setLfBusy(false);
    }
  };

  // Signup: register → login → GET /keys → connectViaNostrConnect auto-approved.
  // Supports optional import_nsec for users who already have a Nostr key.
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (su.password !== su.passwordConfirm) {
      setLocalError('Passwords do not match');
      return;
    }
    setSuBusy(true);
    try {
      const api = `${signerUrl}/api/v1`;

      setSuStatus('Creating your account…');
      const regBody: Record<string, string> = { username: su.username, password: su.password };
      if (su.showImportKey && su.importNsec) regBody.import_nsec = su.importNsec;
      const reg = await fetch(`${api}/users/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(regBody),
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
      const keys = Array.isArray(keysBody)
        ? keysBody
        : ((keysBody as { keys?: Array<{ id: string }> }).keys ?? []);
      if (!keys.length) throw new Error('No signing key was created for the account');
      const keyId = (keys[0] as { id: string }).id;

      setSuStatus('Connecting your new identity…');
      setPendingIsManual(false);
      await connectViaNostrConnect(undefined, async (uri) => {
        setNostrConnectUri(uri);
        setScreen('pending');
        try {
          const approveRes = await fetch(`${api}/nostrconnect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ uri, key_id: keyId }),
          });
          if (!approveRes.ok) {
            const b = await approveRes.json().catch(() => ({}));
            setLocalError((b as { error?: string }).error ?? 'Approval failed');
          }
        } catch {
          setLocalError('Network error during approval');
        }
      });

      if (!authState.error) onClose();
    } catch (err) {
      setLocalError((err as Error).message);
    } finally {
      setSuBusy(false);
      setSuStatus(null);
    }
  };

  const copyUri = () => {
    if (nostrConnectUri && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(nostrConnectUri);
      setCopied(true);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const displayError = localError ?? authState.error;

  const titleMap: Record<Screen, string> = {
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
          <h2>{titleMap[screen]}</h2>
          <button className="cloistr-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="cloistr-modal-content">
          {displayError && <div className="cloistr-error">{displayError}</div>}

          {/* ── Method selection ───────────────────────────────────────────── */}
          {screen === 'method' && (
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
                  onClick={() => { setLocalError(null); setScreen('bunker'); }}
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
                  className="cloistr-btn cloistr-btn-secondary"
                  onClick={() => { setLocalError(null); setScreen('login'); }}
                  disabled={authState.isConnecting}
                >
                  Log In with Password
                </button>
                <button
                  className="cloistr-btn cloistr-btn-ghost"
                  onClick={() => { setLocalError(null); setScreen('signup'); }}
                  disabled={authState.isConnecting}
                >
                  New here? Create an account
                </button>
              </div>
              <p className="cloistr-login-help">
                Don&apos;t have a Nostr identity?{' '}
                <a href={signerUrl} target="_blank" rel="noopener noreferrer">
                  Get started at signer.cloistr.xyz
                </a>
              </p>
            </>
          )}

          {/* ── Bunker form ────────────────────────────────────────────────── */}
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
                  disabled={!isValidBunkerUrl(bunkerUrl) || authState.isConnecting}
                >
                  {authState.isConnecting ? 'Connecting...' : 'Connect'}
                </button>
              </div>
            </form>
          )}

          {/* ── Password login (existing accounts) ────────────────────────── */}
          {screen === 'login' && (
            <form onSubmit={handleLogin} className="cloistr-login-form">
              <label htmlFor="lf-username">Username</label>
              <input
                id="lf-username"
                type="text"
                value={lf.username}
                onChange={(e) => setLf(f => ({ ...f, username: e.target.value }))}
                autoComplete="username"
                className="cloistr-input"
              />
              <label htmlFor="lf-password">Password</label>
              <input
                id="lf-password"
                type="password"
                value={lf.password}
                onChange={(e) => setLf(f => ({ ...f, password: e.target.value }))}
                autoComplete="current-password"
                className="cloistr-input"
              />
              <div className="cloistr-form-actions">
                <button
                  type="button"
                  className="cloistr-btn cloistr-btn-secondary"
                  onClick={goBack}
                  disabled={lfBusy}
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="cloistr-btn cloistr-btn-primary"
                  disabled={!lf.username || !lf.password || lfBusy || authState.isConnecting}
                >
                  {lfBusy || authState.isConnecting ? 'Connecting...' : 'Log In'}
                </button>
              </div>
            </form>
          )}

          {/* ── Signup form ────────────────────────────────────────────────── */}
          {screen === 'signup' && (
            <form onSubmit={handleSignup} className="cloistr-signup-form">
              <p className="cloistr-login-help">
                Create a Cloistr identity — a signing key is set up for you automatically.
              </p>
              <label htmlFor="su-username">Username</label>
              <input
                id="su-username"
                className="cloistr-input"
                type="text"
                value={su.username}
                onChange={(e) => setSu(s => ({ ...s, username: e.target.value }))}
                placeholder="yourname"
                autoComplete="username"
              />
              <label htmlFor="su-password">Password</label>
              <input
                id="su-password"
                className="cloistr-input"
                type="password"
                value={su.password}
                onChange={(e) => setSu(s => ({ ...s, password: e.target.value }))}
                placeholder="at least 8 characters"
                autoComplete="new-password"
              />
              <label htmlFor="su-password-confirm">Confirm Password</label>
              <input
                id="su-password-confirm"
                className="cloistr-input"
                type="password"
                value={su.passwordConfirm}
                onChange={(e) => setSu(s => ({ ...s, passwordConfirm: e.target.value }))}
                placeholder="repeat password"
                autoComplete="new-password"
              />
              <div className="cloistr-toggle">
                <button
                  type="button"
                  className="cloistr-btn cloistr-btn-link"
                  onClick={() => setSu(s => ({ ...s, showImportKey: !s.showImportKey, importNsec: '' }))}
                  disabled={suBusy}
                >
                  {su.showImportKey ? 'Use a new key instead' : 'I already have a key'}
                </button>
              </div>
              {su.showImportKey && (
                <>
                  <label htmlFor="su-import-nsec">Your nsec or hex private key</label>
                  <input
                    id="su-import-nsec"
                    className="cloistr-input"
                    type="password"
                    value={su.importNsec}
                    onChange={(e) => setSu(s => ({ ...s, importNsec: e.target.value }))}
                    placeholder="nsec1… or hex"
                    autoComplete="off"
                  />
                </>
              )}
              {suStatus && <p className="cloistr-login-help">{suStatus}</p>}
              <div className="cloistr-form-actions">
                <button
                  type="button"
                  className="cloistr-btn cloistr-btn-secondary"
                  onClick={goBack}
                  disabled={suBusy}
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="cloistr-btn cloistr-btn-primary"
                  disabled={
                    suBusy ||
                    su.username.length < 3 ||
                    su.password.length < 8 ||
                    su.password !== su.passwordConfirm
                  }
                >
                  {suBusy ? 'Creating…' : 'Create account'}
                </button>
              </div>
            </form>
          )}

          {/* ── Pending: nostrconnect URI waiting ─────────────────────────── */}
          {screen === 'pending' && (
            <div className="cloistr-pending">
              {pendingIsManual ? (
                <>
                  <p>Approve this connection in your Cloistr signer:</p>
                  {nostrConnectUri && (
                    <code
                      className="cloistr-nostrconnect-uri"
                      style={{
                        display: 'block',
                        wordBreak: 'break-all',
                        fontSize: '12px',
                        padding: '8px',
                        background: 'rgba(0,0,0,0.05)',
                        borderRadius: '4px',
                      }}
                    >
                      {nostrConnectUri}
                    </code>
                  )}
                  <div className="cloistr-form-actions" style={{ marginTop: '8px' }}>
                    <button type="button" className="cloistr-btn cloistr-btn-secondary" onClick={copyUri}>
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
                    Paste the link into the signer&apos;s &quot;Connect an App&quot;, pick a key, and approve.
                    This window signs in automatically once approved.
                  </p>
                </>
              ) : (
                <>
                  <p>Connecting your identity&hellip;</p>
                  {nostrConnectUri && (
                    <>
                      <p className="cloistr-login-help" style={{ fontSize: '12px', marginBottom: '4px' }}>
                        Nostrconnect URI:
                      </p>
                      <code
                        className="cloistr-nostrconnect-uri"
                        style={{
                          display: 'block',
                          wordBreak: 'break-all',
                          fontSize: '11px',
                          padding: '6px',
                          background: 'rgba(0,0,0,0.05)',
                          borderRadius: '4px',
                        }}
                      >
                        {nostrConnectUri}
                      </code>
                      <div className="cloistr-form-actions" style={{ marginTop: '8px' }}>
                        <button type="button" className="cloistr-btn cloistr-btn-secondary" onClick={copyUri}>
                          {copied ? 'Copied' : 'Copy URI'}
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
              <div className="cloistr-form-actions" style={{ marginTop: '12px' }}>
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
