import { useCallback, useEffect, useState } from 'react';
import { listStaySignedIn, revokeAllStaySignedIn } from '../lib/staySignedIn.js';
import type { StaySignedInRow } from '../lib/staySignedIn.js';
import { getSignerUrl } from '../lib/runtimeConfig.js';

/**
 * Where the user stays signed in, and a way to end all of it.
 *
 * Each row is one "stay signed in" seal: a sign-in that survives signer
 * updates. Revoking removes every seal; the current web sign-in stays, so the
 * user is not thrown out of the page they are on, but after the next signer
 * update every device signs in again. Signing out also revokes all of them.
 *
 * For an account or security settings page. Renders nothing extra on a signer
 * without the feature: the list call fails and the component says so plainly.
 */
export interface StaySignedInManagerProps {
  signerUrl?: string;
}

const MODE_LABELS: Record<string, string> = {
  vault: 'Kept by Cloistr',
  keyfile: 'Kept by Cloistr',
  split: 'Only on the browser that signed in',
};

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export function StaySignedInManager({ signerUrl: signerUrlProp }: StaySignedInManagerProps) {
  const signerUrl = signerUrlProp || getSignerUrl();
  const [rows, setRows] = useState<StaySignedInRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await listStaySignedIn(signerUrl));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [signerUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const revokeAll = async () => {
    setBusy(true);
    setError(null);
    try {
      const n = await revokeAllStaySignedIn(signerUrl);
      setNotice(n === 1 ? 'Ended 1 sign-in.' : `Ended ${n} sign-ins.`);
      setConfirming(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="cloistr-stay-manager" aria-labelledby="cloistr-stay-manager-title">
      <h3 id="cloistr-stay-manager-title">Where you stay signed in</h3>
      {error && <p role="alert" className="cloistr-login-error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {rows === null && !error && <p>Loading…</p>}
      {rows !== null && rows.length === 0 && (
        <p>Nowhere. You sign in again whenever Cloistr's signer is updated.</p>
      )}
      {rows !== null && rows.length > 0 && (
        <ul className="cloistr-stay-list">
          {rows.map((r) => (
            <li key={r.id} data-current={r.current || undefined}>
              <strong>{r.current ? 'This browser' : `Signed in ${fmt(r.created_at)}`}</strong>
              {' · '}
              {MODE_LABELS[r.mode] ?? r.mode}
              {' · '}until {fmt(r.expires_at)}
            </li>
          ))}
        </ul>
      )}
      {rows !== null && rows.length > 0 && !confirming && (
        <button type="button" className="cloistr-btn cloistr-btn-secondary" onClick={() => setConfirming(true)}>
          Stop staying signed in everywhere
        </button>
      )}
      {confirming && (
        <div className="cloistr-form-actions">
          <p>
            Every device, this one included, will need to sign in again after Cloistr's signer is next updated.
            You stay signed in here until then.
          </p>
          <button type="button" className="cloistr-btn cloistr-btn-secondary" onClick={() => setConfirming(false)} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="cloistr-btn cloistr-btn-primary" onClick={() => void revokeAll()} disabled={busy}>
            {busy ? 'Ending…' : 'End them all'}
          </button>
        </div>
      )}
    </section>
  );
}
