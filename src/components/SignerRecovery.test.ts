/**
 * Guards the one thing this component must never do: ask for credentials.
 *
 * The bug it exists to prevent is a signing failure being presented as a
 * sign-out. The tempting future edit — "the user is stuck, let's offer sign-in
 * here" — recreates exactly that, so it is pinned rather than left to review.
 *
 * These are SOURCE assertions. This package has vitest but no DOM environment
 * (no jsdom, no @testing-library/react), so the component cannot be rendered
 * here; adding one is a Renovate-governed dependency change and out of scope.
 * The behaviour that CAN be tested properly — the classification and retry
 * policy driving this UI — is covered directly in lib/signerRetry.test.ts.
 */
import { describe, it, expect } from 'vitest';

const SOURCE = (await import('node:fs')).readFileSync(
  new URL('./SignerRecovery.tsx', import.meta.url),
  'utf8',
);

describe('SignerRecovery', () => {
  it('offers no way to sign in', () => {
    // Word-bounded on purpose. A bare substring check fails on the legitimate
    // word "signing" ("sign" + "ing" contains "signin"), which this component
    // uses constantly and correctly — caught by this test's first run.
    // \b after "in" means "signing" cannot match, while "sign in", "sign-in"
    // and "signIn" all do.
    expect(SOURCE).not.toMatch(/\bsign[-\s]?in\b/i);
    expect(SOURCE).not.toMatch(/\blog[-\s]?in\b/i);
  });

  it('does not reference a signer URL or auth route', () => {
    // Sending the user to signer.cloistr.xyz from an error screen is the same
    // mistake wearing a different hat.
    expect(SOURCE).not.toContain('signer.cloistr.xyz');
    expect(SOURCE).not.toContain('/login');
  });

  it('never touches session or token state', () => {
    // A recovery screen that can clear auth would reintroduce the very bug it
    // exists to fix.
    for (const forbidden of ['logout', 'clearAuth', 'localStorage', 'clearSharedSession', 'token']) {
      expect(SOURCE).not.toContain(forbidden);
    }
  });

  it('tells the user they are still signed in', () => {
    expect(SOURCE).toContain('You are still signed in.');
  });

  it('offers both a retry and a way back', () => {
    expect(SOURCE).toContain('Try again');
    expect(SOURCE).toContain('Go back');
  });

  it('demotes retry to secondary when the signer refused', () => {
    // Retrying a refusal will not change the answer, so "go back" should lead.
    expect(SOURCE).toContain("kind !== 'terminal'");
    expect(SOURCE).toContain('retryIsPrimary');
  });

  it('disables its actions while a retry is in flight', () => {
    // Otherwise an impatient tap queues a second signing request behind the
    // first, and the signer prompts twice.
    expect(SOURCE).toContain('disabled={retrying}');
  });

  it('announces itself to assistive technology', () => {
    expect(SOURCE).toContain('role="alert"');
    expect(SOURCE).toContain('aria-live');
  });
});
