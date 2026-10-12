/**
 * Recovering a signer session that has genuinely ended, without hanging.
 *
 * WHY THIS EXISTS
 *
 * A user's signing key is unlocked in the memory of the signer replica that
 * served their sign-in. A signer deploy replaces every replica, so afterwards no
 * replica holds the key: the session API answers 409 key_locked, and NIP-46
 * requests are silently dropped, so the browser waits out a timeout. Measured
 * across a real rollout, 2026-10-10: zero failures while any replica held the
 * key, then every request unanswered until the account signed in again.
 *
 * Before this, the apps treated that like a network blip forever, and "try
 * again" cannot succeed when no replica has the key.
 *
 * THE RULE (operator ruling 2026-10-12, keeping the 2026-08-25 rule intact):
 *
 *   - key_locked, or a timeout while the signer API is healthy: retry ONCE,
 *     silently, on a fresh session. Only if that also fails, ask the user to
 *     sign in again, then retry the original call.
 *   - a timeout while the signer is NOT reachable: unchanged. The existing
 *     "try again" path, never a credential prompt. "When the connection times
 *     out, that's not a need to reenter credentials."
 *   - a refusal (CANCELLED, REMOTE_ERROR, ...) is never retried.
 *
 * Health is read from GET /api/v1/keys, not /health: /health sends no CORS
 * headers, so a browser on an app origin cannot read it and would report a
 * healthy signer as down. The keys API is CORS-enabled, is already called by
 * every app, and its 401 also tells us when the session itself has ended.
 */
import type { SignerInterface } from '@cloistr/auth';

/**
 * The signer refuses a nostrconnect session with this code when no replica holds
 * the user's unlocked key. Re-exported by keySwitcher under the same name.
 */
export const KEY_LOCKED = 'key_locked';

/** Error code for a call that failed because the user declined to sign in again. */
export const SIGNER_SESSION_ENDED = 'SIGNER_SESSION_ENDED';

export type SignerApiHealth = 'healthy' | 'session-expired' | 'unreachable';
export type FailureDecision = 'reauth' | 'unreachable' | 'passthrough';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function codeOf(err: unknown): string {
  if (typeof err !== 'object' || err === null) return '';
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : '';
}

export function isKeyLockedError(err: unknown): boolean {
  return codeOf(err) === KEY_LOCKED;
}

/**
 * An unanswered NIP-46 request. @cloistr/auth's signEvent (and its siblings)
 * catch the TIMEOUT and rethrow with their own code (SIGN_EVENT_FAILED, ...),
 * keeping only the message, so the message is the one signal that survives.
 * Measured live 2026-10-12: "Failed to sign event: Request timed out after
 * 30000ms (relays: ...)". Matching the code alone made the whole recovery
 * unreachable for the one call it matters most for.
 */
const TIMEOUT_MESSAGE = /Request timed out after \d+ms/;

function isTimeout(err: unknown): boolean {
  if (codeOf(err) === 'TIMEOUT') return true;
  return err instanceof Error && TIMEOUT_MESSAGE.test(err.message);
}

/**
 * The signer refused the request because this session no longer has a grant.
 * The signer keeps ONE live grant per key, so opening any newer session for
 * the same key revokes this one. Measured live 2026-10-12: a silent re-mint
 * during a relay outage reached the signer (displacing the old grant) but lost
 * its ack, and the old session's next request came back "unauthorized". The
 * user is still signed in; a fresh session fixes it with no prompt. Matched on
 * the whole trailing word, because @cloistr/auth rewraps the code and keeps
 * only the message, and a policy refusal ("not authorized by policy") must
 * still pass through.
 */
const GRANT_GONE_MESSAGE = /(^|: )unauthorized$/;

function isGrantGone(err: unknown): boolean {
  return err instanceof Error && GRANT_GONE_MESSAGE.test(err.message);
}

/** Is the signer API up, and is this browser's session still alive? */
export async function probeSignerApi(
  signerUrl: string,
  fetchFn: FetchLike = (i, init) => fetch(i, init),
): Promise<SignerApiHealth> {
  try {
    const res = await fetchFn(`${signerUrl}/api/v1/keys`, { credentials: 'include' });
    if (res.ok) return 'healthy';
    if (res.status === 401) return 'session-expired';
    return 'unreachable';
  } catch {
    return 'unreachable';
  }
}

/**
 * Decide what a failed signer call means. Pure, so the rule is pinned by test.
 *
 * Only a key_locked refusal, an unanswered request, or a replaced session can
 * be recovered; every other error (including a refusal) passes through
 * untouched. Among those, an unreachable signer is NEVER a reason to ask for
 * credentials. 'reauth' starts recovery; whether it ends in a prompt is decided
 * there, and only a key_locked re-mint or an ended session (401) gets one.
 */
export function decideAfterSignerFailure(err: unknown, health: SignerApiHealth): FailureDecision {
  if (!isKeyLockedError(err) && !isTimeout(err) && !isGrantGone(err)) return 'passthrough';
  if (health === 'unreachable') return 'unreachable';
  return 'reauth';
}

export interface ReauthDeps {
  /** Probe the signer API (see probeSignerApi). */
  probe: () => Promise<SignerApiHealth>;
  /** Mint a fresh NIP-46 session for the same key. Throws key_locked if no replica holds it. */
  remint: () => Promise<SignerInterface>;
  /** Ask the user to sign in again. Resolves once they have; rejects if they decline. */
  requestReauth: () => Promise<void>;
}

function sessionEnded(): Error {
  return Object.assign(
    new Error('Your signer session has ended and sign-in was not completed'),
    { code: SIGNER_SESSION_ENDED },
  );
}

/** Marks a signer produced by wrapSignerWithReauth. */
const REAUTH_WRAPPED = Symbol.for('cloistr.signerReauth.wrapped');

export function isReauthWrapped(signer: unknown): boolean {
  return typeof signer === 'object' && signer !== null && REAUTH_WRAPPED in signer;
}

/**
 * Should the provider attach recovery to the signer the app is using now?
 *
 * The page-load restore wraps the signers it mints. A session opened through
 * the sign-in form is installed raw by @cloistr/auth, so without this a user who
 * signed in and kept working got a bare timeout after the next signer deploy.
 * Measured live 2026-10-12. Only a connected NIP-46 session on a Cloistr host,
 * not already wrapped; an extension (NIP-07) holds its own key and is never
 * ours to re-mint.
 *
 * NEVER a bunker session (review of !68): a user may connect their OWN bunker
 * for a key they have also imported into Cloistr, so "the key is in the
 * Cloistr account" does not make the session Cloistr's. Adopting it would
 * re-mint their signing through the Cloistr signer, a custody path they did not
 * choose, or show a Cloistr prompt for a bunker session. @cloistr/auth records
 * bunkerUrl on a bunker identity and remembers it in storage; a session opened
 * through the Cloistr sign-in form has neither. Any doubt leaves the signer
 * alone, which is 0.47.0's behaviour. cloistrKeyIdFor is the second check.
 */
export function shouldAdoptForReauth(s: {
  signer: unknown;
  isConnected: boolean;
  method: string | null | undefined;
  pubkey: string | null | undefined;
  onCloistrDomain: boolean;
  /** bunkerUrl on the active KeyIdentity, if any. */
  bunkerUrl?: string | null;
  /** @cloistr/auth has a bunker address in storage. */
  rememberedBunker?: boolean;
}): boolean {
  return (
    !s.bunkerUrl &&
    !s.rememberedBunker &&
    !!s.signer &&
    s.isConnected &&
    s.method === 'nip46' &&
    !!s.pubkey &&
    s.onCloistrDomain &&
    !isReauthWrapped(s.signer)
  );
}

/**
 * The Cloistr signer key id for a pubkey, or null when the user's Cloistr
 * account has no such key (a session with the user's own bunker). Null means
 * leave the signer alone: re-minting through Cloistr would be wrong, and a
 * Cloistr sign-in prompt would be absurd.
 */
export function cloistrKeyIdFor(keys: ReadonlyArray<{ id: string; pubkey?: string }>, pubkey: string): string | null {
  return keys.find((k) => k.pubkey === pubkey)?.id ?? null;
}

/**
 * Wrap a signer so a locked key is recovered instead of hanging.
 *
 * The wrapper owns a mutable inner signer: a successful re-mint swaps it, so
 * every later call (and every other holder of this wrapper) uses the new
 * session without anyone re-registering anything.
 */
export function wrapSignerWithReauth(initial: SignerInterface, deps: ReauthDeps): SignerInterface {
  let inner = initial;
  // One recovery at a time: concurrent failures wait on the same one, so a
  // burst of failed calls produces one prompt, not one each.
  let recovering: Promise<void> | null = null;

  // Swap in a fresh session and close the old one, or its relay subscription
  // stays open for the life of the page (one leak per recovery).
  const swap = (next: SignerInterface) => {
    const old = inner;
    inner = next;
    if (old !== next) void old.disconnect?.().catch(() => {});
  };

  const recover = (health: SignerApiHealth): Promise<void> => {
    if (!recovering) {
      recovering = (async () => {
        try {
          // The one silent retry: a fresh session. The signer forwards it to
          // whichever replica holds the key, and answers key_locked quickly
          // when none does, so the user does not wait out a second timeout
          // before being asked.
          swap(await deps.remint());
          return;
        } catch (err) {
          // Prompt ONLY when the signer said no replica holds the key, or the
          // session itself has ended (401 from the probe). A re-mint that
          // TIMES OUT means the relay path is failing while the signer API is
          // up: that is 'try again', never a credential prompt. Review of !67
          // reproduced exactly that: relay down, prompt shown.
          if (!isKeyLockedError(err) && health !== 'session-expired') throw err;
        }
        try {
          await deps.requestReauth();
        } catch {
          throw sessionEnded();
        }
        swap(await deps.remint());
      })().finally(() => {
        recovering = null;
      });
    }
    return recovering;
  };

  const call = async <T>(op: (s: SignerInterface) => Promise<T>): Promise<T> => {
    if (recovering) await recovering;
    const used = inner;
    try {
      return await op(used);
    } catch (err) {
      // Another call already recovered while this one was in flight. Closing
      // the old session (see swap) rejects its waiting calls with
      // DISCONNECTED; those rerun on the new session like any other failure
      // a recovery fixes.
      if (inner !== used && codeOf(err) === 'DISCONNECTED') return op(inner);
      if (decideAfterSignerFailure(err, 'healthy') === 'passthrough') throw err;
      if (inner !== used) return op(inner);
      const health = await deps.probe();
      if (decideAfterSignerFailure(err, health) !== 'reauth') throw err;
      await recover(health);
      return op(inner);
    }
  };

  // NIP-44 never falls back to NIP-04: key wrapping requires NIP-44's integrity
  // check (see @cloistr/auth's SignerInterface). A replacement signer without
  // it is an error, not a downgrade.
  const nip44 = (name: 'nip44Encrypt' | 'nip44Decrypt') => (pk: string, text: string) =>
    call((s) => {
      const fn = s[name];
      if (!fn) return Promise.reject(new Error(`signer does not support ${name}`));
      return fn.call(s, pk, text);
    });

  const wrapped: SignerInterface = {
    getPublicKey: () => call((s) => s.getPublicKey()),
    signEvent: (e) => call((s) => s.signEvent(e)),
    encrypt: (pk, pt) => call((s) => s.encrypt(pk, pt)),
    decrypt: (pk, ct) => call((s) => s.decrypt(pk, ct)),
  };
  Object.defineProperty(wrapped, REAUTH_WRAPPED, { value: true });
  if (initial.nip44Encrypt) wrapped.nip44Encrypt = nip44('nip44Encrypt');
  if (initial.nip44Decrypt) wrapped.nip44Decrypt = nip44('nip44Decrypt');
  if (initial.disconnect) wrapped.disconnect = () => inner.disconnect?.() ?? Promise.resolve();
  if (initial.getClientSecretKey) wrapped.getClientSecretKey = () => inner.getClientSecretKey?.() ?? '';
  return wrapped;
}

/**
 * The page-load restore's version of the same rule. `connect` is the existing
 * restore (which throws key_locked when no replica holds the key). ONE silent
 * retry; then, only if the signer API is healthy and the key is still locked,
 * ask the user to sign in and connect once more. Any other failure is rethrown
 * unchanged, so the unreachable path is exactly as it was.
 */
export async function connectWithLockedKeyRecovery(deps: {
  connect: () => Promise<boolean>;
  probe: () => Promise<SignerApiHealth>;
  requestReauth: () => Promise<void>;
}): Promise<boolean> {
  try {
    return await deps.connect();
  } catch (first) {
    if (!isKeyLockedError(first)) throw first;
  }
  try {
    return await deps.connect();
  } catch (second) {
    if (!isKeyLockedError(second)) throw second;
    if (decideAfterSignerFailure(second, await deps.probe()) !== 'reauth') throw second;
  }
  try {
    await deps.requestReauth();
  } catch {
    throw sessionEnded();
  }
  return deps.connect();
}
