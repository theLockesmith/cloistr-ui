import { describe, it, expect, vi } from 'vitest';
import type { SignerInterface } from '@cloistr/auth';
import {
  SIGNER_SESSION_ENDED,
  isKeyLockedError,
  probeSignerApi,
  decideAfterSignerFailure,
  wrapSignerWithReauth,
  connectWithLockedKeyRecovery,
  isReauthWrapped,
  shouldAdoptForReauth,
  cloistrKeyIdFor,
  activeBunkerUrl,
} from './signerReauth.js';

/** Mimics @cloistr/auth's Nip46Error shape without importing it. */
function signerError(code: string, message = 'boom') {
  return Object.assign(new Error(message), { code });
}

const keyLocked = () => signerError('key_locked', 'KEY_LOCKED: locked');
const timeout = () => signerError('TIMEOUT', 'request timed out');

function fakeSigner(over: Partial<SignerInterface> = {}): SignerInterface {
  return {
    getPublicKey: vi.fn(async () => 'pk'),
    signEvent: vi.fn(async (e) => ({ ...e, id: 'id', sig: 'sig', pubkey: 'pk' }) as never),
    encrypt: vi.fn(async () => 'ct04'),
    decrypt: vi.fn(async () => 'pt04'),
    nip44Encrypt: vi.fn(async () => 'ct44'),
    nip44Decrypt: vi.fn(async () => 'pt44'),
    ...over,
  };
}

const ev = { kind: 1, content: 'x', tags: [], created_at: 1, pubkey: 'pk' };

describe('isKeyLockedError', () => {
  it('matches the signer code, and nothing else', () => {
    expect(isKeyLockedError(keyLocked())).toBe(true);
    expect(isKeyLockedError(timeout())).toBe(false);
    expect(isKeyLockedError(new Error('key_locked'))).toBe(false);
    expect(isKeyLockedError(null)).toBe(false);
  });
});

describe('probeSignerApi', () => {
  it('state:live from the session endpoint is healthy', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ state: 'live', signing_pubkey: 'pk' }), { status: 200 }));
    expect(await probeSignerApi('https://s', f)).toBe('healthy');
    expect(f).toHaveBeenCalledWith('https://s/api/v1/users/session', { credentials: 'include' });
  });
  it('state:key_locked is key-locked', async () => {
    const body = JSON.stringify({ state: 'key_locked', signing_pubkey: 'pk', needs_split_half: true });
    expect(await probeSignerApi('https://s', async () => new Response(body, { status: 200 }))).toBe('key-locked');
  });
  it('a 200 with no JSON body is healthy (forward compat)', async () => {
    expect(await probeSignerApi('https://s', async () => new Response('ok', { status: 200 }))).toBe('healthy');
  });
  it('401 means the session itself has ended', async () => {
    const body = JSON.stringify({ code: 'session_gone', reason: 'expired' });
    expect(await probeSignerApi('https://s', async () => new Response(body, { status: 401 }))).toBe('session-expired');
  });
  it('5xx or a network error is unreachable', async () => {
    expect(await probeSignerApi('https://s', async () => new Response('', { status: 503 }))).toBe('unreachable');
    expect(await probeSignerApi('https://s', async () => { throw new TypeError('fetch failed'); })).toBe('unreachable');
  });
});

describe('decideAfterSignerFailure', () => {
  it('a timeout WRAPPED by @cloistr/auth (code SIGN_EVENT_FAILED) is still a timeout', () => {
    const wrapped = signerError(
      'SIGN_EVENT_FAILED',
      'Failed to sign event: Request timed out after 30000ms (relays: wss://relay.cloistr.xyz)',
    );
    // Session is live: the relay failed, not the key.
    expect(decideAfterSignerFailure(wrapped, 'healthy')).toBe('passthrough');
    // Key is locked: recovery needed.
    expect(decideAfterSignerFailure(wrapped, 'key-locked')).toBe('reauth');
    expect(decideAfterSignerFailure(wrapped, 'unreachable')).toBe('unreachable');
    // A real refusal wrapped the same way is NOT a timeout.
    expect(decideAfterSignerFailure(signerError('SIGN_EVENT_FAILED', 'Failed to sign event: denied'), 'healthy')).toBe('passthrough');
  });

  it('key_locked from any reachable signer is always a re-sign-in candidate', () => {
    expect(decideAfterSignerFailure(keyLocked(), 'healthy')).toBe('reauth');
    expect(decideAfterSignerFailure(keyLocked(), 'key-locked')).toBe('reauth');
    expect(decideAfterSignerFailure(keyLocked(), 'session-expired')).toBe('reauth');
  });
  it('no reply + session live → passthrough (relay issue, not session issue)', () => {
    expect(decideAfterSignerFailure(timeout(), 'healthy')).toBe('passthrough');
  });
  it('no reply + key-locked → reauth', () => {
    expect(decideAfterSignerFailure(timeout(), 'key-locked')).toBe('reauth');
  });
  it('no reply + session gone → reauth', () => {
    expect(decideAfterSignerFailure(timeout(), 'session-expired')).toBe('reauth');
  });
  it('an unreachable signer NEVER asks for credentials (operator, 2026-08-25)', () => {
    expect(decideAfterSignerFailure(timeout(), 'unreachable')).toBe('unreachable');
    expect(decideAfterSignerFailure(keyLocked(), 'unreachable')).toBe('unreachable');
  });
  it('a refusal or any other error passes through untouched', () => {
    expect(decideAfterSignerFailure(signerError('CANCELLED'), 'healthy')).toBe('passthrough');
    expect(decideAfterSignerFailure(signerError('REMOTE_ERROR'), 'healthy')).toBe('passthrough');
    expect(decideAfterSignerFailure(new Error('x'), 'healthy')).toBe('passthrough');
  });
});

describe('wrapSignerWithReauth', () => {
  function deps(over: Partial<Parameters<typeof wrapSignerWithReauth>[1]> = {}) {
    return {
      probe: vi.fn(async () => 'key-locked' as const),
      remint: vi.fn(async () => fakeSigner()),
      requestReauth: vi.fn(async () => {}),
      ...over,
    };
  }

  it('passes calls straight through when nothing fails', async () => {
    const inner = fakeSigner();
    const d = deps();
    const s = wrapSignerWithReauth(inner, d);
    await s.signEvent(ev);
    expect(inner.signEvent).toHaveBeenCalledOnce();
    expect(d.probe).not.toHaveBeenCalled();
    expect(d.remint).not.toHaveBeenCalled();
  });

  it('no reply + session live: rethrows with no recovery (the relay failed, not the key)', async () => {
    const err = timeout();
    const inner = fakeSigner({ signEvent: vi.fn(async () => { throw err; }) });
    const d = deps({ probe: vi.fn(async () => 'healthy' as const) });
    const s = wrapSignerWithReauth(inner, d);
    await expect(s.signEvent(ev)).rejects.toBe(err);
    expect(d.remint).not.toHaveBeenCalled();
    expect(d.requestReauth).not.toHaveBeenCalled();
  });

  it('no reply + key-locked: ONE silent retry on a fresh session, no prompt when it works', async () => {
    const inner = fakeSigner({ signEvent: vi.fn(async () => { throw timeout(); }) });
    const fresh = fakeSigner();
    const d = deps({ remint: vi.fn(async () => fresh) });
    const s = wrapSignerWithReauth(inner, d);
    const out = await s.signEvent(ev);
    expect(out.sig).toBe('sig');
    expect(d.remint).toHaveBeenCalledOnce();
    expect(fresh.signEvent).toHaveBeenCalledOnce();
    expect(d.requestReauth).not.toHaveBeenCalled();
  });

  it('no reply + session gone: silent retry fails, prompt, then re-mint and retry', async () => {
    const inner = fakeSigner({ signEvent: vi.fn(async () => { throw timeout(); }) });
    const after = fakeSigner();
    const remint = vi.fn()
      .mockRejectedValueOnce(keyLocked())
      .mockResolvedValueOnce(after);
    const d = deps({
      probe: vi.fn(async () => 'session-expired' as const),
      remint,
    });
    const s = wrapSignerWithReauth(inner, d);
    const out = await s.signEvent(ev);
    expect(d.requestReauth).toHaveBeenCalledOnce();
    expect(remint).toHaveBeenCalledTimes(2);
    expect(after.signEvent).toHaveBeenCalledWith(ev);
    expect(out.sig).toBe('sig');
  });

  it('silent retry fails with key_locked + key-locked probe: prompt, then re-mint', async () => {
    const inner = fakeSigner({ signEvent: vi.fn(async () => { throw timeout(); }) });
    const after = fakeSigner();
    const remint = vi.fn()
      .mockRejectedValueOnce(keyLocked())
      .mockResolvedValueOnce(after);
    const d = deps({ remint });
    const s = wrapSignerWithReauth(inner, d);
    const out = await s.signEvent(ev);
    expect(d.requestReauth).toHaveBeenCalledOnce();
    expect(remint).toHaveBeenCalledTimes(2);
    expect(after.signEvent).toHaveBeenCalledWith(ev);
    expect(out.sig).toBe('sig');
  });

  it('after a successful re-sign-in, later calls use the new session', async () => {
    const inner = fakeSigner({ signEvent: vi.fn(async () => { throw timeout(); }) });
    const after = fakeSigner();
    const d = deps({ remint: vi.fn().mockRejectedValueOnce(keyLocked()).mockResolvedValue(after) });
    const s = wrapSignerWithReauth(inner, d);
    await s.signEvent(ev);
    await s.nip44Encrypt!('peer', 'hi');
    expect(after.nip44Encrypt).toHaveBeenCalledWith('peer', 'hi');
    expect(inner.nip44Encrypt).not.toHaveBeenCalled();
  });

  it('an unreachable signer rethrows the original error with no prompt and no retry', async () => {
    const err = timeout();
    const inner = fakeSigner({ signEvent: vi.fn(async () => { throw err; }) });
    const d = deps({ probe: vi.fn(async () => 'unreachable' as const) });
    const s = wrapSignerWithReauth(inner, d);
    await expect(s.signEvent(ev)).rejects.toBe(err);
    expect(d.remint).not.toHaveBeenCalled();
    expect(d.requestReauth).not.toHaveBeenCalled();
  });

  it('a refusal is never retried and never probes', async () => {
    const err = signerError('CANCELLED');
    const inner = fakeSigner({ signEvent: vi.fn(async () => { throw err; }) });
    const d = deps();
    const s = wrapSignerWithReauth(inner, d);
    await expect(s.signEvent(ev)).rejects.toBe(err);
    expect(d.probe).not.toHaveBeenCalled();
    expect(d.remint).not.toHaveBeenCalled();
  });

  it('declining the prompt fails the call with SIGNER_SESSION_ENDED', async () => {
    const inner = fakeSigner({ signEvent: vi.fn(async () => { throw timeout(); }) });
    const d = deps({
      remint: vi.fn(async () => { throw keyLocked(); }),
      requestReauth: vi.fn(async () => { throw new Error('dismissed'); }),
    });
    const s = wrapSignerWithReauth(inner, d);
    await expect(s.signEvent(ev)).rejects.toMatchObject({ code: SIGNER_SESSION_ENDED });
  });

  it('concurrent failures share ONE recovery, not one prompt each', async () => {
    const inner = fakeSigner({ signEvent: vi.fn(async () => { throw timeout(); }) });
    const after = fakeSigner();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const d = deps({
      remint: vi.fn().mockRejectedValueOnce(keyLocked()).mockResolvedValue(after),
      requestReauth: vi.fn(() => gate),
    });
    const s = wrapSignerWithReauth(inner, d);
    const a = s.signEvent(ev);
    const b = s.signEvent(ev);
    await vi.waitFor(() => expect(d.requestReauth).toHaveBeenCalled());
    release();
    await Promise.all([a, b]);
    expect(d.requestReauth).toHaveBeenCalledOnce();
  });

  it('keeps optional methods optional', () => {
    const bare = fakeSigner();
    delete bare.nip44Encrypt;
    delete bare.nip44Decrypt;
    const s = wrapSignerWithReauth(bare, deps());
    expect(s.nip44Encrypt).toBeUndefined();
    expect(s.nip44Decrypt).toBeUndefined();
  });
});

describe('connectWithLockedKeyRecovery (page-load restore)', () => {
  const healthy = async () => 'healthy' as const;

  it('connects normally with no retry, probe or prompt', async () => {
    const connect = vi.fn(async () => true);
    const requestReauth = vi.fn(async () => {});
    expect(await connectWithLockedKeyRecovery({ connect, probe: healthy, requestReauth })).toBe(true);
    expect(connect).toHaveBeenCalledOnce();
    expect(requestReauth).not.toHaveBeenCalled();
  });

  it('key_locked once: the silent retry succeeds and nobody is asked', async () => {
    const connect = vi.fn().mockRejectedValueOnce(keyLocked()).mockResolvedValueOnce(true);
    const requestReauth = vi.fn(async () => {});
    expect(await connectWithLockedKeyRecovery({ connect, probe: healthy, requestReauth })).toBe(true);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(requestReauth).not.toHaveBeenCalled();
  });

  it('key_locked twice on a healthy signer: ask, then connect again', async () => {
    const connect = vi.fn()
      .mockRejectedValueOnce(keyLocked())
      .mockRejectedValueOnce(keyLocked())
      .mockResolvedValueOnce(true);
    const requestReauth = vi.fn(async () => {});
    expect(await connectWithLockedKeyRecovery({ connect, probe: healthy, requestReauth })).toBe(true);
    expect(requestReauth).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledTimes(3);
  });

  it('key_locked with the signer unreachable: rethrow, never ask', async () => {
    const err = keyLocked();
    const connect = vi.fn().mockRejectedValue(err);
    const requestReauth = vi.fn(async () => {});
    await expect(
      connectWithLockedKeyRecovery({ connect, probe: async () => 'unreachable' as const, requestReauth }),
    ).rejects.toBe(err);
    expect(requestReauth).not.toHaveBeenCalled();
  });

  it('any other failure is rethrown unchanged with no retry (the unreachable path is untouched)', async () => {
    const err = signerError('CONNECTION_FAILED');
    const connect = vi.fn().mockRejectedValue(err);
    const probe = vi.fn(healthy);
    const requestReauth = vi.fn(async () => {});
    await expect(connectWithLockedKeyRecovery({ connect, probe, requestReauth })).rejects.toBe(err);
    expect(connect).toHaveBeenCalledOnce();
    expect(probe).not.toHaveBeenCalled();
  });

  it('declining the prompt fails with SIGNER_SESSION_ENDED', async () => {
    const connect = vi.fn().mockRejectedValue(keyLocked());
    await expect(
      connectWithLockedKeyRecovery({
        connect,
        probe: healthy,
        requestReauth: async () => { throw new Error('no'); },
      }),
    ).rejects.toMatchObject({ code: SIGNER_SESSION_ENDED });
  });
});

describe('review !67: a relay outage must never prompt', () => {
  it('timeout + session live: no re-mint, no prompt, rethrows immediately', async () => {
    const inner = fakeSigner({ signEvent: vi.fn(async () => { throw timeout(); }) });
    const remint = vi.fn(async () => fakeSigner());
    const requestReauth = vi.fn(async () => {});
    const s = wrapSignerWithReauth(inner, { probe: vi.fn(async () => 'healthy' as const), remint, requestReauth });
    await expect(s.signEvent(ev)).rejects.toThrow();
    expect(remint).not.toHaveBeenCalled();
    expect(requestReauth).not.toHaveBeenCalled();
  });

  it('timeout + key-locked, re-mint ALSO times out: rethrow, no prompt', async () => {
    const inner = fakeSigner({ signEvent: vi.fn(async () => { throw timeout(); }) });
    const remint = vi.fn(async () => { throw timeout(); });
    const requestReauth = vi.fn(async () => {});
    const s = wrapSignerWithReauth(inner, { probe: vi.fn(async () => 'key-locked' as const), remint, requestReauth });
    await expect(s.signEvent(ev)).rejects.toThrow();
    expect(remint).toHaveBeenCalledOnce();
    expect(requestReauth).not.toHaveBeenCalled();
  });

  it('a 401 from the probe (session ended) prompts even though the re-mint fails for another reason', async () => {
    const inner = fakeSigner({ signEvent: vi.fn(async () => { throw timeout(); }) });
    const after = fakeSigner();
    const remint = vi.fn()
      .mockRejectedValueOnce(signerError('', 'nostrconnect/session failed: 401'))
      .mockResolvedValueOnce(after);
    const requestReauth = vi.fn(async () => {});
    const s = wrapSignerWithReauth(inner, { probe: vi.fn(async () => 'session-expired' as const), remint, requestReauth });
    await s.signEvent(ev);
    expect(requestReauth).toHaveBeenCalledOnce();
    expect(after.signEvent).toHaveBeenCalledOnce();
  });

  it('swapping the inner session disconnects the old one (no leaked relay subscription)', async () => {
    const disconnect = vi.fn(async () => {});
    const inner = fakeSigner({ signEvent: vi.fn(async () => { throw keyLocked(); }), disconnect });
    const s = wrapSignerWithReauth(inner, {
      probe: vi.fn(async () => 'healthy' as const),
      remint: vi.fn(async () => fakeSigner()),
      requestReauth: vi.fn(async () => {}),
    });
    await s.signEvent(ev);
    expect(disconnect).toHaveBeenCalledOnce();
  });
});

describe('review !67: closing the old session does not fail calls still waiting on it', () => {
  it('a concurrent call rejected with DISCONNECTED by the swap reruns on the new session', async () => {
    let rejectSecond: (e: Error) => void = () => {};
    let calls = 0;
    const inner = fakeSigner({
      signEvent: vi.fn(() => {
        calls += 1;
        if (calls === 1) return Promise.reject(keyLocked());
        return new Promise((_, rej) => { rejectSecond = rej; }) as never;
      }),
      disconnect: vi.fn(async () => { rejectSecond(signerError('DISCONNECTED', 'Connection closed')); }),
    });
    const fresh = fakeSigner();
    const s = wrapSignerWithReauth(inner, {
      probe: vi.fn(async () => 'healthy' as const),
      remint: vi.fn(async () => fresh),
      requestReauth: vi.fn(async () => {}),
    });
    const second = s.signEvent(ev);
    const first = s.signEvent(ev);
    await expect(first).resolves.toBeTruthy();
    await expect(second).resolves.toBeTruthy();
    expect(fresh.signEvent).toHaveBeenCalledTimes(2);
  });

  it('a refusal from an already-replaced session is still passed through, not re-asked', async () => {
    const inner = fakeSigner({ signEvent: vi.fn(async () => { throw signerError('CANCELLED', 'user said no'); }) });
    const s = wrapSignerWithReauth(inner, {
      probe: vi.fn(async () => 'healthy' as const),
      remint: vi.fn(async () => fakeSigner()),
      requestReauth: vi.fn(async () => {}),
    });
    await expect(s.signEvent(ev)).rejects.toThrow('user said no');
  });
});

describe('a replaced session (signer: one live grant per key) recovers silently', () => {
  // Measured live 2026-10-12: during a relay outage the silent re-mint's POST
  // reaches the signer (displacing the old grant) but its ack is lost. When the
  // relay returns, the old session's next request is refused "unauthorized".
  const grantGone = () => signerError('SIGN_EVENT_FAILED', 'Failed to sign event: unauthorized');

  it('is a recovery candidate on a healthy signer, never a passthrough', () => {
    expect(decideAfterSignerFailure(grantGone(), 'healthy')).toBe('reauth');
  });

  it('re-mints silently and completes the call, with no prompt', async () => {
    const inner = fakeSigner({ signEvent: vi.fn(async () => { throw grantGone(); }) });
    const fresh = fakeSigner();
    const requestReauth = vi.fn(async () => {});
    const s = wrapSignerWithReauth(inner, { probe: vi.fn(async () => 'healthy' as const), remint: vi.fn(async () => fresh), requestReauth });
    await s.signEvent(ev);
    expect(fresh.signEvent).toHaveBeenCalledOnce();
    expect(requestReauth).not.toHaveBeenCalled();
  });

  it('a policy refusal that merely mentions authorization is still passed through', () => {
    expect(decideAfterSignerFailure(signerError('REMOTE_ERROR', 'kind 4 not authorized by policy'), 'healthy')).toBe('passthrough');
  });
});

describe('sessions opened through the sign-in form get recovery too', () => {
  // Measured live 2026-10-12: recovery was attached only by the page-load
  // restore, so a user who signed in through the form and kept working got a
  // bare 30s timeout after the next signer deploy: no unseal, no prompt.
  const base = { isConnected: true, method: 'nip46' as const, pubkey: 'pk', onCloistrDomain: true };

  it('a wrapped signer is recognisable, so it is never wrapped twice', () => {
    const w = wrapSignerWithReauth(fakeSigner(), { probe: vi.fn(), remint: vi.fn(), requestReauth: vi.fn() });
    expect(isReauthWrapped(w)).toBe(true);
    expect(isReauthWrapped(fakeSigner())).toBe(false);
    expect(isReauthWrapped(null)).toBe(false);
  });

  it('adopts a connected NIP-46 signer that is not wrapped yet', () => {
    expect(shouldAdoptForReauth({ ...base, signer: fakeSigner() })).toBe(true);
  });

  it.each([
    ['already wrapped', { signer: wrapSignerWithReauth(fakeSigner(), { probe: vi.fn(), remint: vi.fn(), requestReauth: vi.fn() }) }],
    ['no signer', { signer: null }],
    ['not connected', { signer: fakeSigner(), isConnected: false }],
    ['an extension (NIP-07): we do not control that key', { signer: fakeSigner(), method: 'nip07' as const }],
    ['off a Cloistr host', { signer: fakeSigner(), onCloistrDomain: false }],
    ['no pubkey', { signer: fakeSigner(), pubkey: null }],
    ['the user\'s OWN bunker, even for a key also imported into Cloistr (review of !68)', { signer: fakeSigner(), bunkerUrl: 'bunker://abc?relay=wss://r' }],
    ['a bunker address remembered by @cloistr/auth', { signer: fakeSigner(), rememberedBunker: true }],
  ])('does not adopt: %s', (_n, over) => {
    expect(shouldAdoptForReauth({ ...base, ...over })).toBe(false);
  });

  it('finds the Cloistr key for the pubkey, and nothing for a key that lives elsewhere (a bunker)', () => {
    const keys = [{ id: 'k1', pubkey: 'aa' }, { id: 'k2', pubkey: 'pk' }];
    expect(cloistrKeyIdFor(keys, 'pk')).toBe('k2');
    expect(cloistrKeyIdFor(keys, 'zz')).toBeNull();
    expect(cloistrKeyIdFor([{ id: 'k3' }], 'pk')).toBeNull();
  });

  // Board #314. The bunker's pubkey IS in the Cloistr key list here, so the
  // key-list check alone would adopt it. Composed exactly as SharedAuthProvider
  // composes it; the control proves the bunker address is what refuses.
  describe('a bunker identity whose key is also in the Cloistr account', () => {
    const cloistrKeys = [{ id: 'k1', pubkey: 'aa' }, { id: 'k2', pubkey: 'pk' }];
    const guard = (identities: Array<{ pubkey: string; bunkerUrl?: string }>) =>
      shouldAdoptForReauth({
        ...base,
        signer: fakeSigner(),
        bunkerUrl: activeBunkerUrl(identities, base.pubkey),
        rememberedBunker: false,
      });

    it('is in the Cloistr key list (so the second check would not stop it)', () => {
      expect(cloistrKeyIdFor(cloistrKeys, 'pk')).toBe('k2');
    });

    it('is NOT adopted', () => {
      expect(guard([{ pubkey: 'aa' }, { pubkey: 'pk', bunkerUrl: 'bunker://pk?relay=wss://r' }])).toBe(false);
    });

    it('control: the same key opened through the Cloistr form IS adopted', () => {
      expect(guard([{ pubkey: 'aa' }, { pubkey: 'pk' }])).toBe(true);
    });

    it('reads the ACTIVE identity, not another identity that happens to be a bunker', () => {
      expect(guard([{ pubkey: 'aa', bunkerUrl: 'bunker://aa' }, { pubkey: 'pk' }])).toBe(true);
      expect(activeBunkerUrl(null, 'pk')).toBeUndefined();
      expect(activeBunkerUrl([{ pubkey: 'pk', bunkerUrl: 'bunker://pk' }], null)).toBeUndefined();
    });
  });
});



describe('split mode: unseal comes FIRST (ruled 2026-10-12)', () => {
  it('wrapper: unseal, then the one silent retry, and nobody is asked when the unseal worked', async () => {
    const order: string[] = [];
    const inner = fakeSigner({ signEvent: vi.fn(async () => { throw keyLocked(); }) });
    const fresh = fakeSigner();
    const s = wrapSignerWithReauth(inner, {
      probe: vi.fn(async () => 'healthy' as const),
      unseal: vi.fn(async () => { order.push('unseal'); return 'restored' as const; }),
      remint: vi.fn(async () => { order.push('remint'); return fresh; }),
      requestReauth: vi.fn(async () => { order.push('prompt'); }),
    });
    await s.signEvent(ev);
    expect(order).toEqual(['unseal', 'remint']);
  });

  it('wrapper: nothing to unseal still gets the silent retry, then the prompt', async () => {
    const order: string[] = [];
    const inner = fakeSigner({ signEvent: vi.fn(async () => { throw keyLocked(); }) });
    const s = wrapSignerWithReauth(inner, {
      probe: vi.fn(async () => 'healthy' as const),
      unseal: vi.fn(async () => { order.push('unseal'); return 'nothing' as const; }),
      remint: vi.fn()
        .mockImplementationOnce(async () => { order.push('remint'); throw keyLocked(); })
        .mockImplementationOnce(async () => { order.push('remint'); return fakeSigner(); }),
      requestReauth: vi.fn(async () => { order.push('prompt'); }),
    });
    await s.signEvent(ev);
    expect(order).toEqual(['unseal', 'remint', 'prompt', 'remint']);
  });

  it('wrapper: an unreachable signer is never unsealed nor prompted', async () => {
    const inner = fakeSigner({ signEvent: vi.fn(async () => { throw timeout(); }) });
    const unseal = vi.fn(async () => 'restored' as const);
    const requestReauth = vi.fn(async () => {});
    const s = wrapSignerWithReauth(inner, {
      probe: vi.fn(async () => 'unreachable' as const),
      unseal,
      remint: vi.fn(async () => fakeSigner()),
      requestReauth,
    });
    await expect(s.signEvent(ev)).rejects.toThrow();
    expect(unseal).not.toHaveBeenCalled();
    expect(requestReauth).not.toHaveBeenCalled();
  });

  it('page load: key_locked, unseal, then the silent retry connects', async () => {
    const order: string[] = [];
    const connect = vi.fn()
      .mockImplementationOnce(async () => { order.push('connect'); throw keyLocked(); })
      .mockImplementationOnce(async () => { order.push('connect'); return true; });
    const ok = await connectWithLockedKeyRecovery({
      connect,
      probe: async () => 'healthy' as const,
      unseal: async () => { order.push('unseal'); return 'restored' as const; },
      requestReauth: async () => { order.push('prompt'); },
    });
    expect(ok).toBe(true);
    expect(order).toEqual(['connect', 'unseal', 'connect']);
  });
});
