import type { AuthMethod } from '@cloistr/auth';

/**
 * What a PAGE LOAD is allowed to do to restore a session.
 *
 * THE INVARIANT: a page load never touches the extension.
 *
 * `window.nostr` is a user-present signer. Reading it makes Alby/nos2x prompt
 * immediately, so any automatic access turns an ordinary page load into a modal
 * the user did not ask for. keySwitcher already enforces this for cross-tab key
 * switches ("NEVER auto-switch INTO a NIP-07 key"), but the two restore paths
 * did not, and they are the ones that run on every single load.
 *
 * WHAT THIS FIXES
 *
 * `cloistr_auth_method` is a 30-day cookie on `.cloistr.xyz`. One extension
 * sign-in sets it to `nip07` for every app on every subdomain, and both
 * providers keyed their behaviour off it:
 *
 *   - BackendAuthProvider called connectNip07() on load whenever the cookie said
 *     nip07, before anything else, and then RETURNED — and its bootstrap effect
 *     separately skipped bootstrapKeys() for the same reason. So the signer
 *     session was never even attempted.
 *   - SharedAuthProvider tried the signer session first (correct) but still fell
 *     into connectNip07() automatically when that failed.
 *
 * On a browser that has never established a signer session — which is exactly a
 * browser where you once clicked "extension" — the signer path cannot succeed,
 * so every load prompted the extension, and dismissing it left the user with no
 * way back. The cookie was a one-way door.
 *
 * Operator, 2026-08-25: "I logged in ONE TIME with the extension and now the
 * default behavior is force extension login and when I exit that, fail login
 * altogether."
 *
 * The escape is to always attempt the signer session (it costs one request and
 * returns false harmlessly when there is no signer-session cookie) and to leave
 * the extension to the login UI, where using it is a click the user makes.
 */
export interface PageLoadRestorePlan {
  /** Try the signer session (GET /api/v1/keys → nostrconnect mint). */
  attemptSignerSession: boolean;
  /**
   * Always false. Typed as the literal so a future edit that tries to set it
   * fails to compile rather than quietly reintroducing the prompt-on-load.
   */
  attemptExtension: false;
  /**
   * True when the user's last method was the extension AND one is present, so
   * the login UI can offer it as the obvious choice — a button, not a prompt.
   */
  offerExtensionInLoginUi: boolean;
}

export function planPageLoadRestore(input: {
  /** `cloistr_auth_method` from the shared session cookie, if any. */
  method: AuthMethod | null | undefined;
  /** Whether this origin can drive the signer flow at all (*.cloistr.xyz). */
  onCloistrDomain: boolean;
  /** Whether window.nostr exists right now. */
  nip07Available: boolean;
}): PageLoadRestorePlan {
  return {
    // Deliberately NOT conditioned on `method`. Keying this off the cookie is
    // what made a nip07 browser unable to ever reach its signer session, and a
    // pointless call here is one fetch that returns false.
    attemptSignerSession: input.onCloistrDomain,
    attemptExtension: false,
    offerExtensionInLoginUi: input.method === 'nip07' && input.nip07Available,
  };
}
