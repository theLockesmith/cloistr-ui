import { describe, it, expect } from 'vitest';
import { classifyRestoreOutcome } from './SharedAuthProvider.js';

/**
 * The rule this pins, from the signer-failure design:
 *
 *   "Session and signer reachability are two different things and were being
 *    conflated. A NIP-46 approval timeout is the SECOND thing, so treating it
 *    as the first means a relay hiccup dumps the user at a login screen."
 *
 * Before this, a failed SSO bootstrap called onAutoConnectComplete(false),
 * which every app renders as its login UI. The operator reported exactly that:
 * being asked to sign in via extension over a valid session.
 */
describe('classifyRestoreOutcome', () => {
  it('connected wins regardless of session state', () => {
    expect(classifyRestoreOutcome({ connected: true, hasSession: true })).toBe('connected');
    expect(classifyRestoreOutcome({ connected: true, hasSession: false })).toBe('connected');
  });

  it('a VALID session we could not use is signer-unreachable, NOT logged out', () => {
    // The whole point. Returning 'logged-out' here is the bug.
    expect(classifyRestoreOutcome({ connected: false, hasSession: true })).toBe('signer-unreachable');
  });

  it('no session at all is genuinely logged out', () => {
    // The ONLY case that may show a credential prompt.
    expect(classifyRestoreOutcome({ connected: false, hasSession: false })).toBe('logged-out');
  });

  it('never returns logged-out while a session exists', () => {
    for (const connected of [true, false]) {
      expect(classifyRestoreOutcome({ connected, hasSession: true })).not.toBe('logged-out');
    }
  });
});

describe('classifyRestoreOutcome / key-locked is RETRYABLE', () => {
  // Corrected 2026-08-25 after the operator pushed back:
  //
  //   "when the connection times out, that's not a need to reenter
  //    credentials, I can reload the page for a fresh try without them."
  //
  // 409 key_locked means the replica serving the request did not hold this
  // user's unlocked key. That is a server-side routing problem — another
  // replica may hold it, and a plain reload can succeed with no credentials at
  // all. Treating it as "enter your password" was wrong.
  it('is signer-unreachable, so the user gets retry + "try again"', () => {
    expect(
      classifyRestoreOutcome({ connected: false, hasSession: true, keyLocked: true }),
    ).toBe('signer-unreachable');
  });

  it('is NOT logged-out even with no session cookie visible', () => {
    // A locked key proves a session existed server-side; clearing the user out
    // here is exactly the false-logout this whole design forbids.
    expect(
      classifyRestoreOutcome({ connected: false, hasSession: false, keyLocked: true }),
    ).toBe('signer-unreachable');
  });

  it('never yields an outcome that would prompt for credentials', () => {
    for (const hasSession of [true, false]) {
      const out = classifyRestoreOutcome({ connected: false, hasSession, keyLocked: true });
      expect(out).not.toBe('logged-out');
    }
  });

  it('connected still wins', () => {
    expect(
      classifyRestoreOutcome({ connected: true, hasSession: true, keyLocked: true }),
    ).toBe('connected');
  });

  it('without the flag, behaviour is unchanged', () => {
    expect(classifyRestoreOutcome({ connected: false, hasSession: true })).toBe(
      'signer-unreachable',
    );
    expect(classifyRestoreOutcome({ connected: false, hasSession: false })).toBe('logged-out');
  });
});
