import { useState, useEffect } from 'react';

/**
 * NIP-05 resolution for the shared header.
 *
 * WHY THIS EXISTS
 * The user menu showed raw hex on every page. Operator: "I would also like that
 * profile drop-down to show a NIP-05 address rather than pubkey if one is
 * assigned to a key."
 *
 * A PUBKEY CAN HAVE MORE THAN ONE VALID NIP-05, AND THE FIRST VERSION PICKED
 * THE WRONG ONE. Both of these resolve, and both verify against the operator's
 * pubkey ac16282f...5f62:
 *
 *   fraiyr@cloistr.xyz          <- the USER's identity. cloistr.xyz maps the
 *                                  signer USERNAME to their pubkey.
 *   primary@signer.cloistr.xyz  <- the SIGNER's per-key address. signer maps the
 *                                  KEY NAME to the same pubkey.
 *
 * 0.39.0 resolved only the second, so the header confidently rendered a real,
 * verifiable address that was not the user's. Inside an identity product a
 * confident wrong name is worse than an obviously unresolved one: raw hex reads
 * as "not known yet", `primary@signer...` reads as a claim.
 *
 * The user's address wins. The signer-issued one is kept as the fallback rather
 * than dropped -- operator: "it should show the NIP-05 name first and foremost,
 * but it probably should still show the signer name IF THERE IS ONE."
 *
 * WHERE A NIP-05 COMES FROM IN THIS STACK
 * The signer serves `/.well-known/nostr.json` itself
 * (cloistr-signer internal/api/handler.go handleNIP05). A key is discoverable
 * there only when its owner has NAMED it and it is not in disposable mode, and
 * the published local part is the key's name lowercased with spaces hyphenated:
 *
 *     keyName := strings.ToLower(strings.ReplaceAll(key.Name, " ", "-"))
 *
 * So `KeyIdentity.name` gives us a CANDIDATE local part with no network call.
 * We still resolve it, because a candidate is a guess: the signer skips
 * disposable keys and unnamed keys, and the header must not assert an identity
 * that the domain does not actually vouch for. Resolution is what turns the
 * guess into a NIP-05, and per NIP-05 the check is that the domain maps the
 * name back to THIS pubkey.
 *
 * DEGRADATION RULES (this renders on every page, on every app)
 *   - never blocks first paint: callers render the pubkey and upgrade on resolve
 *   - never refetches per render: results are cached per pubkey for the tab
 *   - a failed, slow, or absent lookup resolves to null, and null means
 *     "show the pubkey". A user who cannot see who they are logged in as is
 *     worse off than one seeing hex.
 */

/** How long to wait before giving up and staying on the pubkey. */
const RESOLVE_TIMEOUT_MS = 4000;

/**
 * Resolved values, keyed by pubkey. `null` is a real, cached answer meaning
 * "this key has no NIP-05" — caching it stops us re-asking on every mount.
 */
const cache = new Map<string, string | null>();

/** In-flight requests, so N mounts of the same key make ONE network call. */
const inFlight = new Map<string, Promise<string | null>>();

/**
 * pubkey -> key name, from the signer's key list. One fetch per signer per tab.
 *
 * WHY THIS IS NEEDED
 * The candidate local part comes from the key's NAME, and apps on the Nostr auth
 * context already have it in `authState.keys`. Apps with their OWN session do
 * not: cloistr-tasks drives the header with
 * `auth={{ authenticated: true, pubkey, onLogout }}` and never populates a key
 * list, so its key has no name in the UI and there would be nothing to resolve.
 * Without this the feature would ship and silently do nothing in exactly the app
 * it was reported from.
 *
 * `credentials: 'include'` against the shared signer session — the same call
 * useKeySwitcherBootstrap already makes, and the same cookie the menu's central
 * logout uses.
 */
/** Where user identity addresses live. ServiceMenu already defaults the same way. */
export const DEFAULT_IDENTITY_DOMAIN = 'cloistr.xyz';

/**
 * signerUrl -> the signed-in user's { username, pubkey }, or null.
 *
 * `GET /api/v1/users/me` is reachable from ANY cloistr app with the shared
 * session: the signer's validateAuthHeader tries the Authorization header and
 * then falls back to the `auth_token` cookie, and it is the same function
 * guarding /api/v1/keys -- which this module already calls cross-origin with
 * credentials. So this needs no bearer token, no relay access and no kind:0
 * fetch, which matters because @cloistr/ui has no nostr-tools dependency and
 * should not grow one to render a header.
 *
 * One request per signer per tab.
 */
const userIdentities = new Map<string, Promise<{ username: string; pubkey: string } | null>>();

function signerUser(signerUrl: string): Promise<{ username: string; pubkey: string } | null> {
  const existing = userIdentities.get(signerUrl);
  if (existing) return existing;

  const task = (async () => {
    try {
      const res = await fetch(`${signerUrl.replace(/\/$/, '')}/api/v1/users/me`, {
        credentials: 'include',
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { username?: string; pubkey?: string };
      if (!body?.username || !body?.pubkey) return null;
      return { username: body.username, pubkey: body.pubkey };
    } catch {
      return null;
    }
  })();

  userIdentities.set(signerUrl, task);
  return task;
}

const nameLists = new Map<string, Promise<Map<string, string>>>();

function signerKeyNames(signerUrl: string): Promise<Map<string, string>> {
  const existing = nameLists.get(signerUrl);
  if (existing) return existing;

  const task = (async () => {
    const names = new Map<string, string>();
    try {
      const res = await fetch(`${signerUrl.replace(/\/$/, '')}/api/v1/keys`, {
        credentials: 'include',
      });
      if (!res.ok) return names;
      const body = (await res.json()) as unknown;
      const keys = (
        Array.isArray(body) ? body : ((body as { keys?: unknown[] })?.keys ?? [])
      ) as Array<{ id?: string; pubkey?: string; name?: string }>;
      for (const k of keys) {
        const pk = k.pubkey ?? k.id;
        if (pk && k.name) names.set(pk.toLowerCase(), k.name);
      }
    } catch {
      // Not signed in to the signer, cross-origin, offline. Stay on the pubkey.
    }
    return names;
  })();

  nameLists.set(signerUrl, task);
  return task;
}

/**
 * The local part the signer would publish for this key name, or null when the
 * key has no name (the signer omits unnamed keys from .well-known entirely, so
 * there is nothing to look up).
 *
 * Mirrors handleNIP05's sanitisation. Kept pure and exported so the mapping can
 * be pinned in tests without a network.
 */
export function nip05LocalPart(name: string | undefined | null): string | null {
  if (!name) return null;
  const local = name.trim().toLowerCase().replace(/ /g, '-');
  return local === '' ? null : local;
}

/**
 * The NIP-05 domain for a signer base URL. The signer serves .well-known on its
 * own host, so the address a user sees is `<name>@<signer host>`.
 */
export function nip05Domain(signerUrl: string): string | null {
  try {
    return new URL(signerUrl).host;
  } catch {
    return null;
  }
}

/**
 * Resolve the verified NIP-05 for a key, or null.
 *
 * Verification is the NIP-05 contract: the domain must map the name back to the
 * same pubkey. A name that resolves to a DIFFERENT pubkey is not this user's
 * address and must not be shown, which is why this compares rather than
 * assuming success on a 200.
 */
/**
 * Verify one candidate address: the domain must map `local` back to THIS pubkey.
 *
 * This is the NIP-05 contract and it is also what keeps the precedence honest.
 * A user's second key asking for `fraiyr@cloistr.xyz` gets the FIRST key's
 * pubkey back, does not match, and correctly falls through to that key's own
 * signer address rather than borrowing the user's identity.
 */
async function verifyNip05(
  pubkey: string,
  local: string,
  domain: string,
  origin: string,
): Promise<string | null> {
  try {
    // AbortSignal.timeout is not in every runtime this ships to; drive the
    // controller by hand so an unresponsive host cannot pin the request open.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(
        `${origin.replace(/\/$/, '')}/.well-known/nostr.json?name=${encodeURIComponent(local)}`,
        { signal: controller.signal },
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;

    const body = (await res.json()) as { names?: Record<string, string> };
    const mapped = body?.names?.[local];
    if (typeof mapped !== 'string') return null;
    // Case-insensitive: hex pubkeys are the same key in either case.
    if (mapped.toLowerCase() !== pubkey.toLowerCase()) return null;

    return `${local}@${domain}`;
  } catch {
    // Offline, CORS, abort, malformed JSON -- all mean "try the next candidate".
    return null;
  }
}

/**
 * Resolve the address to show for a key, or null to fall back to the pubkey.
 *
 * Precedence, highest first:
 *   1. the USER's identity address   <username>@<identityDomain>
 *   2. the SIGNER's per-key address  <key name>@<signer host>
 *   3. null -> caller renders the truncated pubkey
 */
export async function resolveNip05(
  pubkey: string,
  name: string | undefined | null,
  signerUrl: string,
  identityDomain: string = DEFAULT_IDENTITY_DOMAIN,
): Promise<string | null> {
  if (cache.has(pubkey)) return cache.get(pubkey)!;

  const existing = inFlight.get(pubkey);
  if (existing) return existing;

  const signerHost = nip05Domain(signerUrl);

  const task = (async (): Promise<string | null> => {
    // 1. The user's own identity address. Checked FIRST: this is who the person
    //    is, as opposed to how one of their keys is filed on a signer.
    const me = await signerUser(signerUrl);
    const userLocal = nip05LocalPart(me?.username);
    if (userLocal && identityDomain) {
      const hit = await verifyNip05(pubkey, userLocal, identityDomain, `https://${identityDomain}`);
      if (hit) return hit;
    }

    // 2. The signer-issued address for this specific key. Kept rather than
    //    dropped, so a key with no user identity still shows a real name.
    if (!signerHost) return null;
    const resolvedName =
      name ?? (await signerKeyNames(signerUrl)).get(pubkey.toLowerCase());
    const keyLocal = nip05LocalPart(resolvedName);
    if (!keyLocal) return null;
    return await verifyNip05(pubkey, keyLocal, signerHost, signerUrl);
  })();

  inFlight.set(pubkey, task);
  try {
    const result = await task;
    cache.set(pubkey, result);
    return result;
  } finally {
    inFlight.delete(pubkey);
  }
}

/** Test seam: drop cached answers so a suite can assert fetch behaviour. */
export function __clearNip05Cache(): void {
  cache.clear();
  inFlight.clear();
  nameLists.clear();
  userIdentities.clear();
}

/**
 * React binding: returns the verified NIP-05 for a key, or null while unknown.
 *
 * Deliberately starts at null on every mount and never suspends, so the header
 * paints the pubkey immediately and swaps to the NIP-05 only once the domain has
 * vouched for it. A cached answer resolves on the first effect tick, so a second
 * mount does not flash.
 */
export function useNip05(
  pubkey: string | undefined | null,
  name: string | undefined | null,
  signerUrl: string,
  identityDomain: string = DEFAULT_IDENTITY_DOMAIN,
): string | null {
  const [address, setAddress] = useState<string | null>(() =>
    pubkey ? cache.get(pubkey) ?? null : null,
  );

  useEffect(() => {
    if (!pubkey) {
      setAddress(null);
      return;
    }

    // A cached answer is authoritative and synchronous — take it and skip the
    // round trip entirely.
    if (cache.has(pubkey)) {
      setAddress(cache.get(pubkey)!);
      return;
    }

    let live = true;
    setAddress(null);
    void resolveNip05(pubkey, name, signerUrl, identityDomain).then((result) => {
      // Unmounted, or the active key changed while we were resolving. Dropping
      // the result is correct: writing it would label one key with another's
      // address.
      if (live) setAddress(result);
    });
    return () => {
      live = false;
    };
  }, [pubkey, name, signerUrl, identityDomain]);

  return address;
}
