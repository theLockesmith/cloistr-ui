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

describe('classifyRestoreOutcome / key-locked', () => {
  // Every key in the signer is user-held, so it exists only in the memory of
  // the replica that handled that user's login. After a pod restart — or, before
  // sticky sessions, a request that simply landed on the other pod — the key
  // genuinely needs the passphrase again.
  //
  // Before the signer returned 409 key_locked, that case answered 200, published
  // no ack, and the browser waited out a 30s timeout and reported "Could not
  // reach your signer" about a signer that was healthy the whole time.
  it('a locked key is its own outcome, not signer-unreachable', () => {
    expect(
      classifyRestoreOutcome({ connected: false, hasSession: true, keyLocked: true }),
    ).toBe('key-locked');
  });

  it('a locked key is never reported as logged-out', () => {
    // The session is valid; only the KEY is locked. Clearing the session here
    // is what made a relay hiccup look like "this app randomly logs me out".
    expect(
      classifyRestoreOutcome({ connected: false, hasSession: false, keyLocked: true }),
    ).not.toBe('logged-out');
  });

  it('connected still wins over a stale locked flag', () => {
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
