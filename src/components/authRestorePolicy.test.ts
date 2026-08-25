import { describe, it, expect } from 'vitest';
import { planPageLoadRestore } from './authRestorePolicy.js';

/**
 * These pin the two behaviours that trapped a real browser: keying the signer
 * attempt off the sticky method cookie, and invoking the extension on load.
 */

describe('planPageLoadRestore', () => {
  it('attempts the signer session even when the cookie says nip07', () => {
    // THE BUG. BackendAuthProvider skipped bootstrapKeys() whenever the cookie
    // said nip07, so a browser pinned by one extension sign-in could never
    // reach the signer session that would unpin it.
    const plan = planPageLoadRestore({
      method: 'nip07',
      onCloistrDomain: true,
      nip07Available: true,
    });
    expect(plan.attemptSignerSession).toBe(true);
  });

  it('never attempts the extension, whatever the inputs', () => {
    for (const method of ['nip07', 'nip46', null, undefined] as const) {
      for (const nip07Available of [true, false]) {
        for (const onCloistrDomain of [true, false]) {
          const plan = planPageLoadRestore({ method, onCloistrDomain, nip07Available });
          expect(
            plan.attemptExtension,
            `method=${method} ext=${nip07Available} domain=${onCloistrDomain}`,
          ).toBe(false);
        }
      }
    }
  });

  it('does not attempt the signer session off a cloistr origin', () => {
    // dev/test origins cannot drive the nostrconnect flow at all.
    expect(
      planPageLoadRestore({ method: 'nip46', onCloistrDomain: false, nip07Available: false })
        .attemptSignerSession,
    ).toBe(false);
  });

  it('offers the extension in the login UI when that was the last method used', () => {
    // Not a prompt — a button. Genuine extension users stay one click away.
    expect(
      planPageLoadRestore({ method: 'nip07', onCloistrDomain: true, nip07Available: true })
        .offerExtensionInLoginUi,
    ).toBe(true);
  });

  it('does not offer an extension that is not installed', () => {
    expect(
      planPageLoadRestore({ method: 'nip07', onCloistrDomain: true, nip07Available: false })
        .offerExtensionInLoginUi,
    ).toBe(false);
  });

  it('does not offer the extension to a nip46 user who happens to have one', () => {
    expect(
      planPageLoadRestore({ method: 'nip46', onCloistrDomain: true, nip07Available: true })
        .offerExtensionInLoginUi,
    ).toBe(false);
  });
});
