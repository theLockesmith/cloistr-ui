import { describe, it, expect, vi } from 'vitest';
import { approveAfterListening } from './approveAfterListening';

function deferred() {
  let resolve!: () => void, reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('approveAfterListening', () => {
  it('does not ask for approval until the listener is subscribed', async () => {
    const sub = deferred();
    const approve = vi.fn(async () => 'ok');
    const run = approveAfterListening({ subscribed: sub.promise }, approve);
    await new Promise((r) => setTimeout(r, 20));
    expect(approve).not.toHaveBeenCalled();
    sub.resolve();
    await expect(run).resolves.toBe('ok');
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it('asks straight away when the session has no subscribed signal (older auth)', async () => {
    const approve = vi.fn(async () => 'ok');
    await expect(approveAfterListening({}, approve)).resolves.toBe('ok');
    await expect(approveAfterListening(null, approve)).resolves.toBe('ok');
    expect(approve).toHaveBeenCalledTimes(2);
  });

  it('never asks for approval if subscribing fails', async () => {
    const sub = deferred();
    const approve = vi.fn(async () => 'ok');
    const run = approveAfterListening({ subscribed: sub.promise }, approve);
    sub.reject(new Error('relay refused the subscription'));
    await expect(run).rejects.toThrow('relay refused the subscription');
    expect(approve).not.toHaveBeenCalled();
  });
});
