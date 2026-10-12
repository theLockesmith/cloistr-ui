import { describe, it, expect, vi } from 'vitest';
import type { SignerInterface } from '@cloistr/auth';
import {
  SIGNER_SESSION_ENDED,
  isKeyLockedError,
  probeSignerApi,
  decideAfterSignerFailure,
  wrapSignerWithReauth,
  connectWithLockedKeyRecovery,
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
  // /health sends no CORS headers, so a browser on an app origin cannot read it
  // and would report a healthy signer as down. /api/v1/keys is CORS-enabled and
  // already called by every app, and it also says whether the session is alive.
  it('2xx from the keys API is healthy', async () => {
    const f = vi.fn(async () => new Response('[]', { status: 200 }));
    expect(await probeSignerApi('https://s', f)).toBe('healthy');
    expect(f).toHaveBeenCalledWith('https://s/api/v1/keys', { credentials: 'include' });
  });
  it('401 means the session itself has ended', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 401 }));
    expect(await probeSignerApi('https://s', f)).toBe('session-expired');
  });
  it('5xx or a network error is unreachable', async () => {
    expect(await probeSignerApi('https://s', async () => new Response('', { status: 503 }))).toBe('unreachable');
    expect(await probeSignerApi('https://s', async () => { throw new TypeError('fetch failed'); })).toBe('unreachable');
  });
});

describe('decideAfterSignerFailure', () => {
  it('a timeout WRAPPED by @cloistr/auth (code SIGN_EVENT_FAILED) is still a timeout', () => {
    // nip46.js signEvent catches the TIMEOUT and rethrows with its own code,
    // keeping only the message. Measured live 2026-10-12: this exact text.
    const wrapped = signerError(
      'SIGN_EVENT_FAILED',
      'Failed to sign event: Request timed out after 30000ms (relays: wss://relay.cloistr.xyz)',
    );
    expect(decideAfterSignerFailure(wrapped, 'healthy')).toBe('reauth');
    expect(decideAfterSignerFailure(wrapped, 'unreachable')).toBe('unreachable');
    // A real refusal wrapped the same way is NOT a timeout.
    expect(decideAfterSignerFailure(signerError('SIGN_EVENT_FAILED', 'Failed to sign event: denied'), 'healthy')).toBe('passthrough');
  });

  it('key_locked from a healthy signer is a re-sign-in candidate', () => {
    expect(decideAfterSignerFailure(keyLocked(), 'healthy')).toBe('reauth');
  });
  it('a timeout from a healthy signer is a re-sign-in candidate', () => {
    expect(decideAfterSignerFailure(timeout(), 'healthy')).toBe('reauth');
  });
  it('an unreachable signer NEVER asks for credentials (operator, 2026-08-25)', () => {
    expect(decideAfterSignerFailure(timeout(), 'unreachable')).toBe('unreachable');
    expect(decideAfterSignerFailure(keyLocked(), 'unreachable')).toBe('unreachable');
  });
  it('an ended session is a re-sign-in too', () => {
    expect(decideAfterSignerFailure(timeout(), 'session-expired')).toBe('reauth');
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
      probe: vi.fn(async () => 'healthy' as const),
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

  it('timeout on a healthy signer: ONE silent retry on a fresh session, no prompt when it works', async () => {
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

  it('silent retry fails with key_locked: prompt, then re-mint and retry the SAME call', async () => {
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
