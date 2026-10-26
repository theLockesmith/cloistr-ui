import { useEffect, useState } from 'react';

import { probeSignerSession } from './signerReauth.js';

/**
 * Whether the signer holds a session for this browser, asked once on mount.
 *
 * The first-render gate keys off the shared JS-readable cookies, but those are
 * written by an APP once it connects. A browser that signed in on the signer
 * itself has only the signer's HttpOnly `auth_token`, which page code cannot
 * see, so the gate stayed down and the signed-out page rendered for the ~2.5s
 * the silent restore took (cloistr.xyz, reported by cloistr-sanctuary 3/3).
 *
 * 'pending' while the probe is in flight, then 'signed-in' or 'none'. Capped
 * at SIGNER_SESSION_HINT_CAP_MS so a slow signer never blanks a page for an
 * anonymous visitor. When disabled it is 'none' from the first render.
 */
export type SignerSessionHint = 'pending' | 'signed-in' | 'none';

export const SIGNER_SESSION_HINT_CAP_MS = 1000;

export function useSignerSessionHint(signerUrl: string, enabled: boolean): SignerSessionHint {
  const [hint, setHint] = useState<SignerSessionHint>(() => (enabled ? 'pending' : 'none'));

  useEffect(() => {
    if (hint !== 'pending') return;
    let done = false;
    const finish = (next: SignerSessionHint) => {
      if (done) return;
      done = true;
      clearTimeout(cap);
      setHint(next);
    };
    const cap = setTimeout(() => finish('none'), SIGNER_SESSION_HINT_CAP_MS);
    probeSignerSession(signerUrl).then(
      (s) => finish(s === 'signed-in' ? 'signed-in' : 'none'),
      () => finish('none'),
    );
    return () => {
      done = true;
      clearTimeout(cap);
    };
  }, [hint, signerUrl]);

  return hint;
}
