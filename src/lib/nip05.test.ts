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

describe('resolveNip05', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __clearNip05Cache();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const wellKnown = (names: Record<string, string>) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ names }) } as Response);

  it('returns the address when the domain maps the name back to this pubkey', async () => {
    fetchMock.mockReturnValue(wellKnown({ 'alice-example': PUBKEY }));
    await expect(resolveNip05(PUBKEY, 'Alice Example', SIGNER))
      .resolves.toBe('alice-example@signer.cloistr.xyz');
  });

  it('refuses a name that maps to a DIFFERENT pubkey', async () => {
    // This is the whole point of verifying rather than composing the string
    // locally: showing it would label this user with someone else's address.
    fetchMock.mockReturnValue(wellKnown({ 'alice-example': OTHER }));
    await expect(resolveNip05(PUBKEY, 'Alice Example', SIGNER)).resolves.toBeNull();
  });

  it('falls back to null when the signer errors, so the menu keeps the pubkey', async () => {
    fetchMock.mockResolvedValue({ ok: false } as Response);
    await expect(resolveNip05(PUBKEY, 'Alice Example', SIGNER)).resolves.toBeNull();
  });

  it('falls back to null when the network throws', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(resolveNip05(PUBKEY, 'Alice Example', SIGNER)).resolves.toBeNull();
  });

  it('caches, so a header on every page does not refetch per render', async () => {
    fetchMock.mockReturnValue(wellKnown({ 'alice-example': PUBKEY }));
    await resolveNip05(PUBKEY, 'Alice Example', SIGNER);
    await resolveNip05(PUBKEY, 'Alice Example', SIGNER);
    await resolveNip05(PUBKEY, 'Alice Example', SIGNER);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches the NEGATIVE answer too', async () => {
    // Without this, a key that has no NIP-05 re-asks on every mount forever.
    fetchMock.mockReturnValue(wellKnown({}));
    await resolveNip05(PUBKEY, 'Alice Example', SIGNER);
    await resolveNip05(PUBKEY, 'Alice Example', SIGNER);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('makes ONE request when several rows ask for the same key at once', async () => {
    fetchMock.mockReturnValue(wellKnown({ 'alice-example': PUBKEY }));
    await Promise.all([
      resolveNip05(PUBKEY, 'Alice Example', SIGNER),
      resolveNip05(PUBKEY, 'Alice Example', SIGNER),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks the signer for a name when the caller has none (backend-auth apps)', async () => {
    // cloistr-tasks drives the header with its own JWT session and never
    // populates a key list, so without this the feature is a no-op there.
    fetchMock.mockImplementation((url: string) =>
      url.includes('/api/v1/keys')
        ? Promise.resolve({ ok: true, json: () => Promise.resolve([
            { id: 'k1', pubkey: PUBKEY, name: 'Alice Example' },
          ]) } as Response)
        : wellKnown({ 'alice-example': PUBKEY }));

    await expect(resolveNip05(PUBKEY, undefined, SIGNER))
      .resolves.toBe('alice-example@signer.cloistr.xyz');
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/v1/keys'))).toBe(true);
  });
});
