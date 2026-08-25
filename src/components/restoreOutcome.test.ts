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
