import React, { useState, useRef, useEffect } from 'react';
import QRCode from 'qrcode';
import { useNostrAuth, useAuthHelpers, isValidBunkerUrl } from '../auth/index.js';

/** Data passed to onSession callback in session mode */
export interface SessionData {
  token: string;
  expiresAt: string;
  user: unknown;
  /** Cleartext password — needed for FROST share-storage unlock on the signer */
  password: string;
  username: string;
}

export interface LoginModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Custom signer URL (defaults to signer.cloistr.xyz) */
  signerUrl?: string;
  /**
   * Mode: 'connect' (default) performs the full nostrconnect flow after login.
   * 'session' stops after password auth and calls onSession — used by the signer
   * which needs a JWT session, not a Nostr connect.
   */
  mode?: 'connect' | 'session';
  /** Called in session mode on successful password login or signup */
  onSession?: (data: SessionData) => void | Promise<void>;
}

type Screen = 'method' | 'bunker' | 'login' | 'signup' | 'pending' | 'consent' | 'lightning';

/**
 * Login modal with NIP-07, NIP-46, password login, Lightning login, and signup options.
 * Every sub-state (bunker, login, signup, pending, consent, lightning) has Back/Cancel
 * to return to method selection.
 *
 * "Login With Cloistr" is SSO-aware: when an active signer session cookie
 * exists, nostrconnect is auto-approved (or first-time consent is requested)
 * via POST /api/v1/nostrconnect/session. Falls back to manual URI-paste when
 * no session is present.
 *
 * IMPORTANT: every fetch to the signer uses credentials:'include' so the
 * parent-domain .cloistr.xyz session cookie is both sent and received.
 */
// ── WebAuthn base64url helpers (browser ArrayBuffer ⇄ base64url) ────────────
function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlToArrayBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// Passkeys are available only where the WebAuthn API exists.
const isPasskeyAvailable =
  typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined';

// ── Lightning QR canvas sub-component ────────────────────────────────────────
// Renders the bech32 LNURL as a QR code into a <canvas> via qrcode.toCanvas.
// Isolated so the useEffect has a clean, minimal scope.
interface LightningQrProps {
  lnurl: string;
}

function LightningQr({ lnurl }: LightningQrProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, lnurl, {
      width: 220,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    }).catch(() => {
      // Silently ignore render errors; the text link fallback is always present.
    });
  }, [lnurl]);

  return <canvas ref={canvasRef} className="cloistr-lightning-qr" />;
}

export function LoginModal({ isOpen, onClose, signerUrl = 'https://signer.cloistr.xyz', mode = 'connect', onSession }: LoginModalProps) {
  const { connectNip07, connectNip46, connectViaNostrConnect, authState } = useNostrAuth();
  const { isNip07Available } = useAuthHelpers();

  // Navigation
  const [screen, setScreen] = useState<Screen>('method');
  // Progressive disclosure: keep the method screen normie-simple (password +
  // "Login With Cloistr"); advanced methods (extension, bunker, passkey,
  // lightning) live behind an "Other login methods" toggle.
  const [showAdvanced, setShowAdvanced] = useState(false);
  // true = "Login With Cloistr" manual fallback (no session; user pastes URI)
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
    username: '', password: '', passwordConfirm: '', importNsec: '', showImportKey: false, inviteCode: '',
  });
  const [suBusy, setSuBusy] = useState(false);
  const [suStatus, setSuStatus] = useState<string | null>(null);

  // Consent screen (first-time SSO per-app consent)
  const [consentAppName, setConsentAppName] = useState<string | null>(null);
  const [consentAppId, setConsentAppId] = useState<string | null>(null);
  const [consentUri, setConsentUri] = useState<string | null>(null);
  const [consentKeyId, setConsentKeyId] = useState<string | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);

  // Lightning login state
  const [lightningLnurl, setLightningLnurl] = useState<string | null>(null);
  const [lightningCopied, setLightningCopied] = useState(false);
  const lightningPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Local error (form-level; distinct from authState.error which is auth-layer)
  const [localError, setLocalError] = useState<string | null>(null);

  // Ref to the active nostrconnect session so goBack() can abort it.
  const nostrConnectSessionRef = useRef<{ cancel(): void } | null>(null);

  // ── Lightning poll cleanup on unmount ─────────────────────────────────────
  useEffect(() => {
    return () => {
      if (lightningPollRef.current !== null) {
        clearInterval(lightningPollRef.current);
        lightningPollRef.current = null;
      }
    };
  }, []);

  if (!isOpen) return null;

  // ── Navigation ────────────────────────────────────────────────────────────

  const stopLightningPoll = () => {
    if (lightningPollRef.current !== null) {
      clearInterval(lightningPollRef.current);
      lightningPollRef.current = null;
    }
  };

  const goBack = () => {
    nostrConnectSessionRef.current?.cancel();
    nostrConnectSessionRef.current = null;
    stopLightningPoll();
    setScreen('method');
    setBunkerUrl('');
    setLf({ username: '', password: '' });
    setLfBusy(false);
    setSu({ username: '', password: '', passwordConfirm: '', importNsec: '', showImportKey: false, inviteCode: '' });
    setSuBusy(false);
    setSuStatus(null);
    setNostrConnectUri(null);
    setCopied(false);
    setLocalError(null);
    setShowAdvanced(false);
    setPendingIsManual(false);
    setConsentAppName(null);
    setConsentAppId(null);
    setConsentUri(null);
    setConsentKeyId(null);
    setConsentBusy(false);
    setLightningLnurl(null);
    setLightningCopied(false);
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

  // "Login With Cloistr": SSO-aware nostrconnect flow.
  //
  // 1. Probe for an active session via GET /api/v1/keys (credentials:'include').
  //    - 200 → session exists, keyId obtained → proceed to auto-approval path.
  //    - 401 or error → no session → fall back to manual URI-paste (unchanged UX).
  // 2. Auto-approval: generate nostrconnect URI, POST /api/v1/nostrconnect/session.
  //    - {success:true}          → silently signed in, onClose().
  //    - {consent_required:true} → show consent screen for first-time app approval.
  //    - 401                     → session expired mid-flight → show manual paste.
  //    - error                   → surface error message.
  const handleLoginWithCloistr = async () => {
    setLocalError(null);
    setNostrConnectUri(null);
    setCopied(false);

    // Session mode (the signer's own console): this helper is only reached as
    // the post-cookie tail of passkey/lightning here. The credential already
    // set the signer's .cloistr.xyz session, so just close — the signer's own
    // auth resolves from the session. (Never fall back to a browser extension.)
    if (mode === 'session') {
      onClose();
      return;
    }

    // 1. Probe for active session cookie
    let sessionKeyId: string | null = null;
    try {
      const keysRes = await fetch(`${signerUrl}/api/v1/keys`, {
        credentials: 'include',
      });
      if (keysRes.ok) {
        const keysBody = (await keysRes.json()) as unknown;
        const keys = Array.isArray(keysBody)
          ? keysBody
          : ((keysBody as { keys?: Array<{ id: string }> }).keys ?? []);
        if (keys.length) sessionKeyId = (keys[0] as { id: string }).id;
      }
      // 401 = no session → sessionKeyId remains null → fall back to manual
    } catch {
      // Network error → fall back to manual
    }

    if (!sessionKeyId) {
      // No active session — show the existing manual URI-paste flow unchanged
      setPendingIsManual(true);
      await connectViaNostrConnect(undefined, (uri, session) => {
        nostrConnectSessionRef.current = session;
        setNostrConnectUri(uri);
        setScreen('pending');
      });
      if (!authState.error) onClose();
      return;
    }

    // 2. Active session found — generate URI and attempt session connect
    setPendingIsManual(false);
    const capturedKeyId = sessionKeyId;
    await connectViaNostrConnect(undefined, async (uri, session) => {
      nostrConnectSessionRef.current = session;
      setNostrConnectUri(uri);
      setScreen('pending');
      try {
        const sessionRes = await fetch(`${signerUrl}/api/v1/nostrconnect/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ uri, key_id: capturedKeyId }),
        });
        if (sessionRes.status === 401) {
          // Session expired between the probe and now — show manual paste
          setPendingIsManual(true);
          return;
        }
        if (!sessionRes.ok) {
          const b = await sessionRes.json().catch(() => ({}));
          setLocalError((b as { error?: string }).error ?? 'Session connect failed');
          return;
        }
        const body = (await sessionRes.json()) as {
          success?: boolean;
          consent_required?: boolean;
          app_id?: string;
          app_name?: string;
        };
        if (body.consent_required) {
          setConsentAppName(body.app_name ?? 'this app');
          setConsentAppId(body.app_id ?? null);
          setConsentUri(uri);
          setConsentKeyId(capturedKeyId);
          setScreen('consent');
        } else if (body.success) {
          // SSO win — signed in silently
          onClose();
        }
      } catch {
        setLocalError('Network error during session connect');
      }
    });
    if (!authState.error) onClose();
  };

  // Passkey (WebAuthn) discoverable login. Authenticates the account, which
  // sets the shared .cloistr.xyz cookie; the SSO tail (handleLoginWithCloistr)
  // then resolves the signing key + auto-approves nostrconnect — identical to
  // the password path, no key material handled client-side.
  const handlePasskeyLogin = async () => {
    setLocalError(null);
    if (!isPasskeyAvailable) {
      setLocalError('Passkeys are not supported in this browser');
      return;
    }
    try {
      const api = `${signerUrl}/api/v1`;
      const beginRes = await fetch(`${api}/users/passkey/login/begin`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!beginRes.ok) throw new Error('Could not start passkey login');
      const { publicKey, session_id: sessionId } = (await beginRes.json()) as {
        publicKey: PublicKeyCredentialRequestOptions & { challenge: string; allowCredentials?: Array<{ id: string }> };
        session_id: string;
      };

      // Decode base64url fields the browser needs as ArrayBuffers.
      const requestOptions: PublicKeyCredentialRequestOptions = {
        ...publicKey,
        challenge: base64UrlToArrayBuffer(publicKey.challenge as unknown as string),
        allowCredentials: publicKey.allowCredentials?.map((c) => ({
          ...(c as PublicKeyCredentialDescriptor),
          id: base64UrlToArrayBuffer((c as unknown as { id: string }).id),
        })),
      };

      const credential = (await navigator.credentials.get({
        publicKey: requestOptions,
        mediation: 'optional',
      })) as PublicKeyCredential | null;
      if (!credential) throw new Error('No passkey selected');

      const resp = credential.response as AuthenticatorAssertionResponse;
      const finishRes = await fetch(`${api}/users/passkey/login/finish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          session_id: sessionId,
          id: credential.id,
          rawId: arrayBufferToBase64Url(credential.rawId),
          type: credential.type,
          response: {
            authenticatorData: arrayBufferToBase64Url(resp.authenticatorData),
            clientDataJSON: arrayBufferToBase64Url(resp.clientDataJSON),
            signature: arrayBufferToBase64Url(resp.signature),
            userHandle: resp.userHandle ? arrayBufferToBase64Url(resp.userHandle) : null,
          },
        }),
      });
      if (!finishRes.ok) {
        const b = await finishRes.json().catch(() => ({}));
        throw new Error((b as { error?: string }).error ?? 'Passkey login failed');
      }

      // Cookie is set. In session mode the caller resolves auth itself; in
      // connect mode reuse the SSO path to finish the nostrconnect handshake.
      if (mode === 'session') {
        onClose();
        return;
      }
      await handleLoginWithCloistr();
    } catch (err) {
      // User cancelling the passkey prompt throws NotAllowedError — treat as a
      // quiet no-op rather than a scary error.
      if ((err as Error).name === 'NotAllowedError') return;
      setLocalError((err as Error).message);
    }
  };

  // Lightning (LNURL-auth) login.
  // 1. POST /users/lightning/challenge → get lnurl + session_id
  // 2. Show QR + link for wallet to scan/open
  // 3. Poll GET /users/lightning/status?session_id=<id> every 2s
  //    - pending  → keep polling
  //    - success  → cookie is set; run SSO tail (or onClose in session mode)
  //    - expired  → stop, show inline error
  const handleLightningStart = async () => {
    setLocalError(null);
    try {
      const api = `${signerUrl}/api/v1`;
      const challengeRes = await fetch(`${api}/users/lightning/challenge`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!challengeRes.ok) {
        const b = await challengeRes.json().catch(() => ({}));
        throw new Error((b as { error?: string }).error ?? 'Could not start Lightning login');
      }
      const { lnurl, session_id: sessionId } = (await challengeRes.json()) as {
        lnurl: string;
        k1: string;
        session_id: string;
      };

      setLightningLnurl(lnurl);
      setLightningCopied(false);
      setScreen('lightning');

      // Start polling — captured sessionId is stable for this login attempt.
      const capturedSessionId = sessionId;
      const interval = setInterval(() => {
        void (async () => {
          try {
            const statusRes = await fetch(
              `${api}/users/lightning/status?session_id=${encodeURIComponent(capturedSessionId)}`,
              { credentials: 'include' },
            );
            if (!statusRes.ok) {
              // 400 = expired (or unknown error)
              const b = await statusRes.json().catch(() => ({}));
              const status = (b as { status?: string }).status;
              stopLightningPoll();
              setLocalError(status === 'expired' ? 'QR code expired — try again' : 'Lightning login failed');
              return;
            }
            const body = (await statusRes.json()) as { success: boolean; status?: string; username?: string };
            if (!body.success) return; // pending — keep polling

            // success: cookie is set by the signer
            stopLightningPoll();
            if (mode === 'session') {
              onClose();
              return;
            }
            await handleLoginWithCloistr();
          } catch {
            // transient network error — keep polling
          }
        })();
      }, 2000);

      lightningPollRef.current = interval;
    } catch (err) {
      setLocalError((err as Error).message);
    }
  };

  const copyLightningUri = () => {
    if (lightningLnurl && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(`lightning:${lightningLnurl}`).catch(() => {
        // clipboard write rejected (non-secure context, permissions) — ignore
      });
      setLightningCopied(true);
    }
  };

  // Consent approval: re-POST to /nostrconnect/session with consent:true.
  const handleConsentApprove = async () => {
    if (!consentUri || !consentKeyId) return;
    setConsentBusy(true);
    setLocalError(null);
    try {
      const sessionRes = await fetch(`${signerUrl}/api/v1/nostrconnect/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ uri: consentUri, key_id: consentKeyId, consent: true }),
      });
      if (!sessionRes.ok) {
        const b = await sessionRes.json().catch(() => ({}));
        setLocalError((b as { error?: string }).error ?? 'Approval failed');
        return;
      }
      const body = (await sessionRes.json()) as { success?: boolean };
      if (body.success) {
        onClose();
      } else {
        setLocalError('Approval did not succeed');
      }
    } catch {
      setLocalError('Network error during consent approval');
    } finally {
      setConsentBusy(false);
    }
  };

  // Password login for existing Cloistr accounts.
  // In 'session' mode: returns the JWT to the caller via onSession().
  // In 'connect' mode: POST /users/login → GET /keys → connectViaNostrConnect auto-approved.
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setLfBusy(true);
    try {
      const api = `${signerUrl}/api/v1`;

      const loginRes = await fetch(`${api}/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: lf.username, password: lf.password }),
      });
      if (!loginRes.ok) {
        const b = await loginRes.json().catch(() => ({}));
        throw new Error((b as { error?: string }).error || `Login failed (${loginRes.status})`);
      }
      const loginBody = (await loginRes.json()) as { token?: string; expires_at?: string; user?: unknown };
      const token = loginBody.token;
      if (!token) throw new Error('Login response missing token');

      if (mode === 'session') {
        await onSession?.({
          token,
          expiresAt: loginBody.expires_at ?? '',
          user: loginBody.user ?? null,
          password: lf.password,
          username: lf.username,
        });
        onClose();
        return;
      }

      // 'connect' mode: continue with keys + nostrconnect
      const keysRes = await fetch(`${api}/keys`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (!keysRes.ok) throw new Error('Failed to fetch signing keys');
      const keysBody = (await keysRes.json()) as unknown;
      const keys = Array.isArray(keysBody)
        ? keysBody
        : ((keysBody as { keys?: Array<{ id: string }> }).keys ?? []);
      if (!keys.length) throw new Error('No signing key found for this account');
      const keyId = (keys[0] as { id: string }).id;

      setPendingIsManual(false);
      await connectViaNostrConnect(undefined, async (uri, session) => {
        nostrConnectSessionRef.current = session;
        setNostrConnectUri(uri);
        setScreen('pending');
        try {
          const approveRes = await fetch(`${api}/nostrconnect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            credentials: 'include',
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

  // Signup: register → login (credentials:'include' → session cookie).
  // In 'session' mode: returns the JWT to the caller via onSession().
  // In 'connect' mode: → GET /keys → connectViaNostrConnect auto-approved.
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
      if (mode === 'session' && su.inviteCode.trim()) regBody.invite_code = su.inviteCode.trim();
      const reg = await fetch(`${api}/users/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
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
        credentials: 'include',
        body: JSON.stringify({ username: su.username, password: su.password }),
      });
      if (!login.ok) throw new Error('Account created, but auto sign-in failed — try signing in.');
      const loginBody = (await login.json()) as { token?: string; expires_at?: string; user?: unknown };
      const token = loginBody.token;
      if (!token) throw new Error('Login response missing token');

      if (mode === 'session') {
        await onSession?.({
          token,
          expiresAt: loginBody.expires_at ?? '',
          user: loginBody.user ?? null,
          password: su.password,
          username: su.username,
        });
        onClose();
        return;
      }

      // 'connect' mode: continue with keys + nostrconnect
      const keysRes = await fetch(`${api}/keys`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      const keysBody = (await keysRes.json()) as unknown;
      const keys = Array.isArray(keysBody)
        ? keysBody
        : ((keysBody as { keys?: Array<{ id: string }> }).keys ?? []);
      if (!keys.length) throw new Error('No signing key was created for the account');
      const keyId = (keys[0] as { id: string }).id;

      setSuStatus('Connecting your new identity…');
      setPendingIsManual(false);
      await connectViaNostrConnect(undefined, async (uri, session) => {
        nostrConnectSessionRef.current = session;
        setNostrConnectUri(uri);
        setScreen('pending');
        try {
          const approveRes = await fetch(`${api}/nostrconnect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            credentials: 'include',
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
    login: 'Sign in with Cloistr',
    signup: 'Create Account',
    pending: 'Connecting…',
    consent: 'Confirm Access',
    lightning: 'Sign in with Lightning',
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
              {/* Primary method: "Sign in with Cloistr" IS username/password —
                  the same Cloistr account everywhere. Extension / bunker /
                  passkey / lightning are separate options under "Other login
                  methods". (Same in session mode: the signer's own login is
                  also un/pw via this button.) */}
              <div className="cloistr-login-options">
                <button
                  className="cloistr-btn cloistr-btn-primary"
                  onClick={() => { setLocalError(null); setScreen('login'); }}
                  disabled={authState.isConnecting}
                >
                  Sign in with Cloistr
                </button>
                <button
                  className="cloistr-btn cloistr-btn-ghost"
                  onClick={() => { setLocalError(null); setScreen('signup'); }}
                  disabled={authState.isConnecting}
                >
                  New here? Create an account
                </button>
              </div>

              {/* Advanced methods — progressive disclosure so the default view
                  stays uncluttered for non-technical users. */}
              <button
                type="button"
                className="cloistr-login-more-toggle"
                aria-expanded={showAdvanced}
                onClick={() => { setLocalError(null); setShowAdvanced((v) => !v); }}
                disabled={authState.isConnecting}
              >
                {showAdvanced ? 'Fewer options' : 'Other login methods'}
              </button>
              {showAdvanced && (
                <div className="cloistr-login-options cloistr-login-options-advanced">
                  {isPasskeyAvailable && (
                    <button
                      className="cloistr-btn cloistr-btn-secondary"
                      onClick={handlePasskeyLogin}
                      disabled={authState.isConnecting}
                    >
                      Passkey
                    </button>
                  )}
                  {isNip07Available && (
                    <button
                      className="cloistr-btn cloistr-btn-secondary"
                      onClick={handleNip07}
                      disabled={authState.isConnecting}
                    >
                      {authState.isConnecting ? 'Connecting...' : 'Browser Extension (NIP-07)'}
                    </button>
                  )}
                  <button
                    className="cloistr-btn cloistr-btn-secondary"
                    onClick={() => { setLocalError(null); setScreen('bunker'); }}
                    disabled={authState.isConnecting}
                  >
                    Bunker URL (NIP-46)
                  </button>
                  <button
                    className="cloistr-btn cloistr-btn-secondary"
                    onClick={handleLightningStart}
                    disabled={authState.isConnecting}
                  >
                    Lightning
                  </button>
                </div>
              )}

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
              {mode === 'session' && (
                <>
                  <label htmlFor="su-invite-code">Invite Code (optional)</label>
                  <input
                    id="su-invite-code"
                    className="cloistr-input"
                    type="text"
                    value={su.inviteCode}
                    onChange={(e) => setSu(s => ({ ...s, inviteCode: e.target.value }))}
                    placeholder="Enter invite code if you have one"
                    disabled={suBusy}
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

          {/* ── Consent: first-time per-app SSO approval ──────────────────── */}
          {screen === 'consent' && (
            <div className="cloistr-consent">
              <p>
                Allow <strong>{consentAppName}</strong> to use your Cloistr identity?
              </p>
              {consentAppId && (
                <p className="cloistr-login-help" style={{ fontSize: '12px' }}>
                  App: {consentAppId}
                </p>
              )}
              <div className="cloistr-form-actions" style={{ marginTop: '16px' }}>
                <button
                  type="button"
                  className="cloistr-btn cloistr-btn-secondary"
                  onClick={goBack}
                  disabled={consentBusy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="cloistr-btn cloistr-btn-primary"
                  onClick={handleConsentApprove}
                  disabled={consentBusy}
                >
                  {consentBusy ? 'Approving…' : 'Approve'}
                </button>
              </div>
            </div>
          )}

          {/* ── Lightning: QR + wallet link ───────────────────────────────── */}
          {screen === 'lightning' && lightningLnurl && (
            <div className="cloistr-lightning">
              <div className="cloistr-lightning-qr-wrapper">
                <LightningQr lnurl={lightningLnurl} />
              </div>
              <p className="cloistr-login-help" style={{ marginTop: '12px' }}>
                Scan with a Lightning wallet that supports LNURL-auth,{' '}
                or{' '}
                <a
                  href={`lightning:${lightningLnurl}`}
                  className="cloistr-lightning-open"
                >
                  open in wallet
                </a>
                .
              </p>
              <div className="cloistr-form-actions" style={{ marginTop: '8px' }}>
                <button
                  type="button"
                  className="cloistr-btn cloistr-btn-secondary"
                  onClick={copyLightningUri}
                >
                  {lightningCopied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="cloistr-login-help" style={{ marginTop: '12px' }}>
                Waiting for your wallet&hellip;
              </p>
              <div className="cloistr-form-actions" style={{ marginTop: '4px' }}>
                <button type="button" className="cloistr-btn cloistr-btn-secondary" onClick={goBack}>
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
