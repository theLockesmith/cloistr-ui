/**
 * "Stay signed in": the browser side of the signer's sealed sessions.
 *
 * A user's signing key is unlocked in the memory of the signer replica that
 * served their sign-in, so every signer deploy used to lock everyone out. The
 * signer now seals the unlocked key at sign-in for a duration the user picks,
 * and any replica unseals it after a deploy. This module is everything an app
 * needs for that, and nothing it does is required: a signer without the feature
 * answers 404 to the options call, and the sign-in form then looks and behaves
 * exactly as before.
 *
 * SPLIT MODE (ruled 2026-10-12): half of the seal lives in the browser, so the
 * server alone cannot unseal. That half is an HttpOnly cookie the signer sets on
 * its own unseal path. No script ever reads or stores it; after a deploy the
 * client just POSTs the unseal endpoint with credentials and no body, and the
 * browser attaches the cookie. Storing it in JS would expose it to any XSS in
 * any Cloistr app and send it to every *.cloistr.xyz server.
 *
 * Signer API (cloistr-signer feat/stay-signed-in):
 *   GET    /api/v1/users/stay-signed-in/options   no auth
 *   POST   /api/v1/users/login                    + stay_signed_in, stay_signed_in_split
 *   POST   /api/v1/users/session/unseal           cookie
 *   GET    /api/v1/users/stay-signed-in           cookie: list
 *   DELETE /api/v1/users/stay-signed-in           cookie: revoke all (keeps web sign-in)
 *   GET    /api/v1/users/me                       cookie: renews a sliding session
 */

export type StayChoice = 'session' | '1d' | '30d' | 'until_signout';

const KNOWN: readonly StayChoice[] = ['session', '1d', '30d', 'until_signout'];

export const STAY_LABELS: Record<StayChoice, string> = {
  session: 'This session only',
  '1d': '1 day',
  '30d': '30 days',
  until_signout: 'Until I sign out',
};

export interface StaySignedInOptions {
  sealer: 'vault' | 'keyfile' | 'none';
  choices: StayChoice[];
  split: boolean;
  split_choices: StayChoice[];
  max_days: number;
}

export interface StayGrant {
  granted: string;
  mode?: string;
  expires_at?: string;
}

export interface StaySignedInRow {
  id: string;
  pubkey: string;
  mode: string;
  expires_at: string;
  created_at: string;
  current: boolean;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: FetchLike = (i, init) => fetch(i, init);

const base = (signerUrl: string) => `${signerUrl.replace(/\/$/, '')}/api/v1/users`;

function known(list: unknown): StayChoice[] {
  return Array.isArray(list) ? list.filter((c): c is StayChoice => KNOWN.includes(c as StayChoice)) : [];
}

/**
 * The durations this signer offers, or null when there is nothing to offer (an
 * older signer, an unreachable one, or one with no sealer). Null means: render
 * the form exactly as before and send no new fields.
 */
export async function fetchStaySignedInOptions(
  signerUrl: string,
  fetchFn: FetchLike = defaultFetch,
): Promise<StaySignedInOptions | null> {
  try {
    const r = await fetchFn(`${base(signerUrl)}/stay-signed-in/options`, { credentials: 'omit' });
    if (!r.ok) return null;
    const b = (await r.json()) as Partial<StaySignedInOptions>;
    const choices = known(b.choices);
    if (choices.filter((c) => c !== 'session').length === 0) return null;
    return {
      sealer: b.sealer ?? 'none',
      choices,
      split: !!b.split,
      split_choices: known(b.split_choices),
      max_days: typeof b.max_days === 'number' ? b.max_days : 0,
    };
  } catch {
    return null;
  }
}

/** The extra login fields for the user's choice. Never sends a value the signer did not offer (it answers 400). */
export function stayFieldsForLogin(
  options: StaySignedInOptions | null,
  choice: StayChoice,
  split = false,
): { stay_signed_in?: StayChoice; stay_signed_in_split?: true } {
  if (!options) return {};
  const chosen: StayChoice = options.choices.includes(choice) ? choice : 'session';
  const fields: { stay_signed_in: StayChoice; stay_signed_in_split?: true } = { stay_signed_in: chosen };
  if (split && options.split && chosen !== 'session' && options.split_choices.includes(chosen)) {
    fields.stay_signed_in_split = true;
  }
  return fields;
}

const RANK: Record<string, number> = { session: 0, '1d': 1, '30d': 2, until_signout: 3 };

/** What to tell the user after sign-in. The signer may grant less than asked; say so. */
export function describeGrant(
  grant: StayGrant | undefined,
  requested: StayChoice,
  now: Date = new Date(),
): { text: string; reduced: boolean } {
  const granted = grant?.granted ?? 'session';
  // No grant at all means a signer without the feature: nothing was offered,
  // so nothing was reduced.
  const reduced = !!grant && (RANK[granted] ?? 0) < (RANK[requested] ?? 0);
  let text: string;
  if (granted === 'session' || !grant?.expires_at) {
    text = 'Signed in for this session only.';
  } else if (granted === 'until_signout') {
    text = 'You will stay signed in until you sign out, as long as you use Cloistr at least every few months.';
  } else {
    const end = new Date(grant.expires_at);
    const when = end.toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      ...(end.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' as const }),
    });
    text = `You will stay signed in until ${when}.`;
  }
  if (reduced) text += ' That is shorter than you asked for: this signer allows no longer.';
  return { text, reduced };
}

/**
 * Hand the browser's half back after a deploy (split mode). The half travels as
 * the signer's HttpOnly cookie, so there is no body.
 *
 *   'restored'    the key is unsealed again: retry the original call.
 *   'nothing'     no split seal, a mismatch, an ended session, or an older
 *                 signer: carry on to the silent retry, then the prompt.
 *   'unreachable' the signer could not be reached: NEVER a reason to prompt.
 */
export async function unsealSession(
  signerUrl: string,
  fetchFn: FetchLike = defaultFetch,
): Promise<'restored' | 'nothing' | 'unreachable'> {
  try {
    const r = await fetchFn(`${base(signerUrl)}/session/unseal`, { method: 'POST', credentials: 'include' });
    if (!r.ok) return r.status >= 500 ? 'unreachable' : 'nothing';
    const b = (await r.json().catch(() => ({}))) as { restored?: number };
    return (b.restored ?? 0) > 0 ? 'restored' : 'nothing';
  } catch {
    return 'unreachable';
  }
}

export async function listStaySignedIn(
  signerUrl: string,
  fetchFn: FetchLike = defaultFetch,
): Promise<StaySignedInRow[]> {
  const r = await fetchFn(`${base(signerUrl)}/stay-signed-in`, { credentials: 'include' });
  if (r.status === 401) throw new Error('Sign in to see where you stay signed in');
  if (!r.ok) throw new Error(`Could not load your sign-ins (${r.status})`);
  const rows = (await r.json()) as unknown;
  return Array.isArray(rows) ? (rows as StaySignedInRow[]) : [];
}

/** Revoke every "stay signed in" seal. The current web sign-in is kept. */
export async function revokeAllStaySignedIn(signerUrl: string, fetchFn: FetchLike = defaultFetch): Promise<number> {
  const r = await fetchFn(`${base(signerUrl)}/stay-signed-in`, { method: 'DELETE', credentials: 'include' });
  if (r.status === 401) throw new Error('Sign in to manage where you stay signed in');
  if (!r.ok) throw new Error(`Could not revoke (${r.status})`);
  const b = (await r.json()) as { revoked?: number };
  return b.revoked ?? 0;
}

/**
 * The signer renews a sliding ("until I sign out") session at most about
 * hourly, on GET /users/me with the shared cookie. An open tab that never
 * reloads would otherwise reach the fixed expiry while in use.
 */
export const KEEPALIVE_INTERVAL_MS = 60 * 60 * 1000;

export function shouldTouchSession(lastTouchMs: number | null, nowMs: number): boolean {
  return lastTouchMs === null || nowMs - lastTouchMs >= KEEPALIVE_INTERVAL_MS;
}

/** One renewal touch. Errors are ignored: a missed touch is retried next interval. */
export async function touchSession(signerUrl: string, fetchFn: FetchLike = defaultFetch): Promise<void> {
  try {
    await fetchFn(`${base(signerUrl)}/me`, { credentials: 'include' });
  } catch {
    // next interval
  }
}
