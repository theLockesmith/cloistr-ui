import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { nip05LocalPart, nip05Domain, resolveNip05, __clearNip05Cache } from './nip05.js';

const PUBKEY = 'ab'.repeat(32);
const OTHER = 'cd'.repeat(32);
const SIGNER = 'https://signer.cloistr.xyz';

describe('nip05LocalPart', () => {
  // Mirrors cloistr-signer handleNIP05:
  //   keyName := strings.ToLower(strings.ReplaceAll(key.Name, " ", "-"))
  // If these drift, the UI looks up a name the signer never published and every
  // user silently falls back to hex.
  it('lowercases and hyphenates, matching what the signer publishes', () => {
    expect(nip05LocalPart('Alice Example')).toBe('alice-example');
  });

  it('has no local part for an unnamed key', () => {
    // The signer omits unnamed keys from .well-known entirely, so there is
    // nothing to look up and no request worth making.
    expect(nip05LocalPart(undefined)).toBeNull();
    expect(nip05LocalPart('')).toBeNull();
    expect(nip05LocalPart('   ')).toBeNull();
  });
});

describe('nip05Domain', () => {
  it('is the signer host, which is what serves .well-known', () => {
    expect(nip05Domain(SIGNER)).toBe('signer.cloistr.xyz');
  });

  it('is null for junk rather than throwing into the header', () => {
    expect(nip05Domain('not a url')).toBeNull();
  });
});

describe('resolveNip05 precedence', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __clearNip05Cache();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const json = (body: unknown) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);

  /**
   * Routes the three calls the resolver can make. Mirrors the real world:
   * cloistr.xyz maps the USERNAME, signer.cloistr.xyz maps the KEY NAME, and
   * both legitimately resolve to the same pubkey.
   */
  const world = (opts: {
    me?: { username: string; pubkey: string } | null;
    identityNames?: Record<string, string>;
    signerNames?: Record<string, string>;
    keys?: Array<{ pubkey: string; name: string }>;
    session?: boolean;
  }) => (url: string) => {
    if (url.includes('/api/v1/session') && opts.session !== undefined) {
      return json({ authenticated: opts.session });
    }
    if (url.includes('/api/v1/users/me')) {
      return opts.me ? json(opts.me) : Promise.resolve({ ok: false } as Response);
    }
    if (url.includes('/api/v1/keys')) return json(opts.keys ?? []);
    if (url.startsWith('https://cloistr.xyz/.well-known')) {
      return json({ names: opts.identityNames ?? {} });
    }
    return json({ names: opts.signerNames ?? {} });
  };

  it('prefers the USER identity address over the signer-issued one', async () => {
    // The bug this exists for: 0.39.0 rendered `primary@signer.cloistr.xyz`,
    // which verifies and is real, but is not who the user is.
    fetchMock.mockImplementation(world({
      me: { username: 'fraiyr', pubkey: PUBKEY },
      identityNames: { fraiyr: PUBKEY },
      signerNames: { primary: PUBKEY },
    }));
    await expect(resolveNip05(PUBKEY, 'primary', SIGNER))
      .resolves.toBe('fraiyr@cloistr.xyz');
  });

  it('falls back to the signer address when the user has no identity address', async () => {
    // Operator: "it probably should still show the signer name if there is one."
    fetchMock.mockImplementation(world({
      me: { username: 'fraiyr', pubkey: PUBKEY },
      identityNames: {},
      signerNames: { primary: PUBKEY },
    }));
    await expect(resolveNip05(PUBKEY, 'primary', SIGNER))
      .resolves.toBe('primary@signer.cloistr.xyz');
  });

  it('falls back to the signer address when there is no signed-in signer user', async () => {
    fetchMock.mockImplementation(world({ me: null, signerNames: { primary: PUBKEY } }));
    await expect(resolveNip05(PUBKEY, 'primary', SIGNER))
      .resolves.toBe('primary@signer.cloistr.xyz');
  });

  it('does not lend one key the OTHER key\'s identity address', async () => {
    // OTHER is a second key of the same user. cloistr.xyz maps `fraiyr` to the
    // FIRST key, so the identity candidate must not match here.
    fetchMock.mockImplementation(world({
      me: { username: 'fraiyr', pubkey: PUBKEY },
      identityNames: { fraiyr: PUBKEY },
      signerNames: { secondary: OTHER },
    }));
    await expect(resolveNip05(OTHER, 'secondary', SIGNER))
      .resolves.toBe('secondary@signer.cloistr.xyz');
  });

  it('returns null when nothing verifies, so the menu keeps the pubkey', async () => {
    fetchMock.mockImplementation(world({ me: null, signerNames: {} }));
    await expect(resolveNip05(PUBKEY, 'primary', SIGNER)).resolves.toBeNull();
  });

  it('refuses a name that maps to a DIFFERENT pubkey', async () => {
    fetchMock.mockImplementation(world({
      me: { username: 'fraiyr', pubkey: PUBKEY },
      identityNames: { fraiyr: OTHER },
      signerNames: {},
    }));
    await expect(resolveNip05(PUBKEY, 'primary', SIGNER)).resolves.toBeNull();
  });

  it('survives the network throwing at every step', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(resolveNip05(PUBKEY, 'primary', SIGNER)).resolves.toBeNull();
  });

  it('caches, so a header on every page does not refetch per render', async () => {
    fetchMock.mockImplementation(world({
      me: { username: 'fraiyr', pubkey: PUBKEY }, identityNames: { fraiyr: PUBKEY },
    }));
    await resolveNip05(PUBKEY, 'primary', SIGNER);
    const after = fetchMock.mock.calls.length;
    await resolveNip05(PUBKEY, 'primary', SIGNER);
    await resolveNip05(PUBKEY, 'primary', SIGNER);
    expect(fetchMock.mock.calls.length).toBe(after);
  });

  it('caches the NEGATIVE answer too', async () => {
    fetchMock.mockImplementation(world({ me: null, signerNames: {} }));
    await resolveNip05(PUBKEY, 'primary', SIGNER);
    const after = fetchMock.mock.calls.length;
    await resolveNip05(PUBKEY, 'primary', SIGNER);
    expect(fetchMock.mock.calls.length).toBe(after);
  });

  it('asks the signer for a key name when the caller has none (backend-auth apps)', async () => {
    fetchMock.mockImplementation(world({
      me: null,
      keys: [{ pubkey: PUBKEY, name: 'primary' }],
      signerNames: { primary: PUBKEY },
    }));
    await expect(resolveNip05(PUBKEY, undefined, SIGNER))
      .resolves.toBe('primary@signer.cloistr.xyz');
  });

  it('a signed-out page never asks the signer for its key list (0.50.6)', async () => {
    // /api/v1/keys answers a signed-out browser with a 401 console error.
    fetchMock.mockImplementation(world({
      me: null,
      session: false,
      keys: [{ pubkey: PUBKEY, name: 'primary' }],
      signerNames: { primary: PUBKEY },
    }));
    await expect(resolveNip05(PUBKEY, undefined, SIGNER)).resolves.toBeNull();
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => u.includes('/api/v1/keys'))).toBe(false);
    expect(urls.some((u) => u.includes('/api/v1/session'))).toBe(true);
  });

  it('uses the runtime baseDomain for identity lookups on staging', async () => {
    (globalThis as any).window = {
      location: { hostname: 'tasks.staging.cloistr.xyz', protocol: 'https:' },
      document: { cookie: '' },
      __CLOISTR_CONFIG__: { baseDomain: 'staging.cloistr.xyz' },
    };

    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/api/v1/users/me')) {
        return json({ username: 'fraiyr', pubkey: PUBKEY });
      }
      if (url.startsWith('https://staging.cloistr.xyz/.well-known')) {
        return json({ names: { fraiyr: PUBKEY } });
      }
      if (url.startsWith('https://cloistr.xyz/.well-known')) {
        return json({ names: { fraiyr: PUBKEY } });
      }
      return json({ names: {} });
    });

    __clearNip05Cache();
    const result = await resolveNip05(PUBKEY, 'primary', SIGNER);
    expect(result).toBe('fraiyr@staging.cloistr.xyz');

    const identityFetchUrls = fetchMock.mock.calls
      .map((c: any) => c[0] as string)
      .filter((u: string) => u.includes('.well-known/nostr.json'));
    expect(identityFetchUrls.some((u: string) => u.startsWith('https://staging.cloistr.xyz/'))).toBe(true);
    expect(identityFetchUrls.some((u: string) => u.startsWith('https://cloistr.xyz/'))).toBe(false);

    delete (globalThis as any).window;
  });
});
