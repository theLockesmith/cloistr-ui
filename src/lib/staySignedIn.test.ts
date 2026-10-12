import { describe, it, expect, vi } from 'vitest';
import type { StaySignedInOptions } from './staySignedIn.js';
import {
  fetchStaySignedInOptions,
  stayFieldsForLogin,
  describeGrant,
  listStaySignedIn,
  revokeAllStaySignedIn,
  shouldTouchSession,
  STAY_LABELS,
  KEEPALIVE_INTERVAL_MS,
  unsealSession,
} from './staySignedIn.js';

const res = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe('fetchStaySignedInOptions', () => {
  it('returns the options when the signer offers them', async () => {
    const f = vi.fn(async () =>
      res(200, { sealer: 'vault', choices: ['session', '1d', '30d', 'until_signout'], split: true, split_choices: ['session', '1d'], max_days: 0 }),
    );
    const o = await fetchStaySignedInOptions('https://s', f);
    expect(f).toHaveBeenCalledWith('https://s/api/v1/users/stay-signed-in/options', expect.anything());
    expect(o?.choices).toEqual(['session', '1d', '30d', 'until_signout']);
    expect(o?.sealer).toBe('vault');
  });

  it('is null on a signer without the feature (404), so the form looks as before', async () => {
    expect(await fetchStaySignedInOptions('https://s', async () => res(404, {}))).toBeNull();
  });

  it('is null when the signer cannot be reached', async () => {
    expect(await fetchStaySignedInOptions('https://s', async () => { throw new Error('net'); })).toBeNull();
  });

  it('drops choices it does not know, so an unknown value never reaches login (400)', async () => {
    const o = await fetchStaySignedInOptions('https://s', async () =>
      res(200, { sealer: 'vault', choices: ['session', '7y', '30d'], split: false }),
    );
    expect(o?.choices).toEqual(['session', '30d']);
  });

  it('is null when only "session" is offered: there is nothing to choose', async () => {
    expect(
      await fetchStaySignedInOptions('https://s', async () => res(200, { sealer: 'none', choices: ['session'], split: false })),
    ).toBeNull();
  });
});

describe('stayFieldsForLogin', () => {
  it('sends nothing when the signer has no options (older signer keeps working)', () => {
    expect(stayFieldsForLogin(null, '30d')).toEqual({});
  });

  it('sends the chosen duration', () => {
    const o = { sealer: 'vault' as const, choices: ['session', '30d'] as const, split: false, split_choices: [], max_days: 0 };
    expect(stayFieldsForLogin({ ...o, choices: [...o.choices] }, '30d')).toEqual({ stay_signed_in: '30d' });
  });

  it('falls back to "session" for a choice the signer does not offer', () => {
    const o: StaySignedInOptions = { sealer: 'vault', choices: ['session', '1d'], split: false, split_choices: [], max_days: 0 };
    expect(stayFieldsForLogin(o, 'until_signout')).toEqual({ stay_signed_in: 'session' });
  });
});

describe('describeGrant', () => {
  const now = new Date('2026-10-12T12:00:00Z');

  it('says plainly when the sign-in lasts only this session', () => {
    expect(describeGrant({ granted: 'session' }, 'session', now)).toEqual({
      text: 'Signed in for this session only.',
      reduced: false,
    });
  });

  it('names the end date for a fixed duration', () => {
    const d = describeGrant({ granted: '30d', mode: 'vault', expires_at: '2026-11-11T12:00:00Z' }, '30d', now);
    expect(d.reduced).toBe(false);
    expect(d.text).toMatch(/^You will stay signed in until \S.*\.$/);
    expect(d.text).toMatch(/11/);
  });

  it('flags a grant shorter than asked, so the user is told rather than surprised later', () => {
    const d = describeGrant({ granted: '1d', mode: 'vault', expires_at: '2026-10-13T12:00:00Z' }, '30d', now);
    expect(d.reduced).toBe(true);
    expect(d.text).toContain('shorter than you asked');
  });

  it('describes until_signout as lasting while in use', () => {
    const d = describeGrant({ granted: 'until_signout', mode: 'vault', expires_at: '2027-01-10T12:00:00Z' }, 'until_signout', now);
    expect(d.text).toBe('You will stay signed in until you sign out, as long as you use Cloistr at least every few months.');
  });

  it('a missing grant (older signer) is this session only', () => {
    expect(describeGrant(undefined, '30d', now).text).toBe('Signed in for this session only.');
  });
});

describe('list and revoke', () => {
  it('lists with the shared cookie', async () => {
    const f = vi.fn(async () =>
      res(200, [{ id: 'a', pubkey: 'p', mode: 'vault', expires_at: '2026-11-11T00:00:00Z', created_at: '2026-10-12T00:00:00Z', current: true }]),
    );
    const rows = await listStaySignedIn('https://s', f);
    expect(rows).toHaveLength(1);
    expect(f).toHaveBeenCalledWith('https://s/api/v1/users/stay-signed-in', expect.objectContaining({ credentials: 'include' }));
  });

  it('list throws on 401 so the caller can ask the user to sign in', async () => {
    await expect(listStaySignedIn('https://s', async () => res(401, {}))).rejects.toThrow(/sign in/i);
  });

  it('revoke-all sends DELETE and returns the count', async () => {
    const f = vi.fn(async () => res(200, { revoked: 3 }));
    expect(await revokeAllStaySignedIn('https://s', f)).toBe(3);
    expect(f).toHaveBeenCalledWith('https://s/api/v1/users/stay-signed-in', expect.objectContaining({ method: 'DELETE', credentials: 'include' }));
  });
});

describe('keep-alive timing', () => {
  it('touches when never touched', () => {
    expect(shouldTouchSession(null, 0)).toBe(true);
  });

  it('does not touch again within the interval (the signer renews at most hourly)', () => {
    expect(shouldTouchSession(1000, 1000 + KEEPALIVE_INTERVAL_MS - 1)).toBe(false);
  });

  it('touches once the interval has passed', () => {
    expect(shouldTouchSession(1000, 1000 + KEEPALIVE_INTERVAL_MS)).toBe(true);
  });
});

describe('labels', () => {
  it('has a plain label for every duration', () => {
    expect(STAY_LABELS).toEqual({
      session: 'This session only',
      '1d': '1 day',
      '30d': '30 days',
      until_signout: 'Until I sign out',
    });
  });
});

describe('split mode: unseal', () => {
  it('POSTs with the cookie and NO body: the half lives in an HttpOnly cookie scripts never see', async () => {
    const f = vi.fn(async () => res(200, { restored: 1 }));
    expect(await unsealSession('https://s', f)).toBe('restored');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://s/api/v1/users/session/unseal');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.body).toBeUndefined();
  });

  it('restored 0 is not a restore', async () => {
    expect(await unsealSession('https://s', async () => res(200, { restored: 0 }))).toBe('nothing');
  });

  it.each([
    [404, 'no_split_seal'],
    [403, 'seal_mismatch'],
    [401, undefined],
    [400, 'bad_split_half'],
  ])('%i %s means nothing to restore: fall through to the silent retry, then the prompt', async (status, code) => {
    expect(await unsealSession('https://s', async () => res(status, { code }))).toBe('nothing');
  });

  it('a 404 from a signer without the endpoint is nothing to restore, not an error', async () => {
    expect(await unsealSession('https://s', async () => res(404, 'not found'))).toBe('nothing');
  });

  it('an unreachable signer is reported as such, never as a reason to prompt', async () => {
    expect(await unsealSession('https://s', async () => { throw new Error('net'); })).toBe('unreachable');
  });
});

describe('split option on the form', () => {
  const o: StaySignedInOptions = { sealer: 'vault', choices: ['session', '30d'], split: true, split_choices: ['30d'], max_days: 0 };

  it('sends stay_signed_in_split when chosen and offered for that duration', () => {
    expect(stayFieldsForLogin(o, '30d', true)).toEqual({ stay_signed_in: '30d', stay_signed_in_split: true });
  });

  it('does not send split for a duration the signer does not offer it with', () => {
    expect(stayFieldsForLogin({ ...o, split_choices: ['1d'] }, '30d', true)).toEqual({ stay_signed_in: '30d' });
  });

  it('never sends split with "session": there is nothing to seal', () => {
    expect(stayFieldsForLogin(o, 'session', true)).toEqual({ stay_signed_in: 'session' });
  });
});
