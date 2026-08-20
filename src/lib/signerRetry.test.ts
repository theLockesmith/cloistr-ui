import { describe, it, expect, vi } from 'vitest';
import {
  classifySignerError,
  isRetryableSignerError,
  retryDelay,
  signerFailureMessage,
  withSignerRetry,
} from './signerRetry';

/** Mimics @cloistr/auth's Nip46Error shape without importing it. */
function signerError(code: string, message = 'boom') {
  return Object.assign(new Error(message), { code });
}

describe('classifySignerError', () => {
  it.each(['NO_RELAYS', 'CONNECTION_FAILED', 'DISCONNECTED'])(
    '%s is retryable — nobody decided anything',
    code => {
      expect(classifySignerError(signerError(code))).toBe('retryable');
      expect(isRetryableSignerError(signerError(code))).toBe(true);
    },
  );

  it('TIMEOUT needs the user, and must not auto-retry', () => {
    // The request REACHED the signer. A prompt may be sitting on a screen the
    // user is not looking at; firing more requests at it is not help.
    expect(classifySignerError(signerError('TIMEOUT'))).toBe('needs-user');
    expect(isRetryableSignerError(signerError('TIMEOUT'))).toBe(false);
  });

  it.each(['CANCELLED', 'REMOTE_ERROR'])('%s is terminal — the signer said no', code => {
    expect(classifySignerError(signerError(code))).toBe('terminal');
    expect(isRetryableSignerError(signerError(code))).toBe(false);
  });

  it('treats unknown and code-less errors as terminal', () => {
    // Defaulting the unknown to "retryable" would hammer the signer for causes
    // we do not understand. A bug should surface, not loop.
    expect(classifySignerError(new Error('who knows'))).toBe('terminal');
    expect(classifySignerError(signerError('SOMETHING_NEW'))).toBe('terminal');
    expect(classifySignerError(null)).toBe('terminal');
    expect(classifySignerError('a string')).toBe('terminal');
    expect(classifySignerError({ code: 42 })).toBe('terminal');
  });
});

describe('withSignerRetry', () => {
  const noSleep = async () => {};

  it('returns the value without retrying when the call succeeds', async () => {
    const fn = vi.fn().mockResolvedValue('signed');
    await expect(withSignerRetry(fn, { sleep: noSleep })).resolves.toBe('signed');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a reach failure and succeeds on a later attempt', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(signerError('NO_RELAYS'))
      .mockRejectedValueOnce(signerError('DISCONNECTED'))
      .mockResolvedValue('signed');

    await expect(withSignerRetry(fn, { sleep: noSleep })).resolves.toBe('signed');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('NEVER retries a refusal', async () => {
    // The headline rule: retrying a denial re-prompts a user who said no.
    const fn = vi.fn().mockRejectedValue(signerError('CANCELLED'));
    await expect(withSignerRetry(fn, { sleep: noSleep })).rejects.toMatchObject({
      code: 'CANCELLED',
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('NEVER silently retries an approval timeout', async () => {
    const fn = vi.fn().mockRejectedValue(signerError('TIMEOUT'));
    await expect(withSignerRetry(fn, { sleep: noSleep })).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after the attempt budget and rethrows the last error', async () => {
    const fn = vi.fn().mockRejectedValue(signerError('NO_RELAYS', 'still down'));
    await expect(withSignerRetry(fn, { attempts: 3, sleep: noSleep })).rejects.toThrow('still down');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('honours a single-attempt budget', async () => {
    const fn = vi.fn().mockRejectedValue(signerError('NO_RELAYS'));
    await expect(withSignerRetry(fn, { attempts: 1, sleep: noSleep })).rejects.toBeDefined();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('waits between attempts, with growing ceilings', async () => {
    const delays: number[] = [];
    const fn = vi.fn().mockRejectedValue(signerError('NO_RELAYS'));

    await expect(
      withSignerRetry(fn, {
        attempts: 4,
        baseDelayMs: 100,
        random: () => 1, // full jitter at its ceiling, so the growth is visible
        sleep: async ms => {
          delays.push(ms);
        },
      }),
    ).rejects.toBeDefined();

    expect(delays).toEqual([100, 200, 400]);
  });

  it('reports each retry to onRetry', async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(signerError('NO_RELAYS'))
      .mockResolvedValue('ok');

    await withSignerRetry(fn, { sleep: noSleep, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0]).toBe(1);
  });

  it('does not sleep after the final failure', async () => {
    // Sleeping before giving up just delays the error the user is waiting for.
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockRejectedValue(signerError('NO_RELAYS'));
    await expect(withSignerRetry(fn, { attempts: 2, sleep })).rejects.toBeDefined();
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});

describe('retryDelay', () => {
  it('grows exponentially and is capped', () => {
    expect(retryDelay(1, 100, 4000, () => 1)).toBe(100);
    expect(retryDelay(2, 100, 4000, () => 1)).toBe(200);
    expect(retryDelay(5, 100, 4000, () => 1)).toBe(1600);
    expect(retryDelay(20, 100, 4000, () => 1)).toBe(4000);
  });

  it('applies FULL jitter, so simultaneous clients do not retry in lockstep', () => {
    // Every backgrounded tab wakes at the same instant. Without jitter they all
    // hit the relay together and the retry storm becomes the outage.
    expect(retryDelay(3, 100, 4000, () => 0)).toBe(0);
    expect(retryDelay(3, 100, 4000, () => 0.5)).toBe(200);
    expect(retryDelay(3, 100, 4000, () => 1)).toBe(400);
  });
});

describe('signerFailureMessage', () => {
  it('never tells the user they are signed out', () => {
    // The whole point: a signing failure is not an auth failure, and the copy
    // must not imply otherwise or the user will go hunting for credentials.
    for (const code of ['NO_RELAYS', 'TIMEOUT', 'CANCELLED']) {
      const { title, detail } = signerFailureMessage(signerError(code));
      const text = `${title} ${detail}`.toLowerCase();
      expect(text).not.toContain('signed out');
      expect(text).not.toContain('log in again');
      expect(text).not.toContain('session expired');
    }
  });

  it('says the session is still valid for a connection failure', () => {
    expect(signerFailureMessage(signerError('NO_RELAYS')).detail).toContain('still valid');
  });

  it('points at the signing device when nothing answered', () => {
    expect(signerFailureMessage(signerError('TIMEOUT')).detail).toContain('signing device');
  });
});
