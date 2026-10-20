/**
 * Source-level tests for the LoginModal session probe.
 *
 * The probe was switched from GET /api/v1/keys (which returns 401 on a
 * signed-out page, logging a console error on every sign-in screen) to
 * GET /api/v1/session (which always returns 200).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const src = () =>
  readFileSync(resolve(__dirname, './LoginModal.tsx'), 'utf8');

describe('LoginModal session probe uses /api/v1/session', () => {
  it('probes via GET /api/v1/session, not GET /api/v1/keys', () => {
    const s = src();
    expect(s).toContain('/api/v1/session');
  });

  it('does NOT probe with GET /api/v1/keys as the first call', () => {
    const s = src();
    // The keys endpoint may still be called AFTER the probe confirms a
    // session, but the initial probe line must be /api/v1/session.
    const probeSection = s.slice(
      s.indexOf('Side-effect-free session probe'),
      s.indexOf('Session confirmed'),
    );
    expect(
      probeSection,
      'the probe section must not call /api/v1/keys',
    ).not.toContain('/api/v1/keys');
  });

  it('checks the authenticated field before calling /api/v1/keys', () => {
    const s = src();
    const probeIdx = s.indexOf('/api/v1/session');
    const authCheckIdx = s.indexOf('probe.authenticated', probeIdx);
    const keysIdx = s.indexOf('/api/v1/keys', probeIdx);
    expect(
      authCheckIdx,
      'authenticated check must appear in the source',
    ).toBeGreaterThan(-1);
    expect(
      keysIdx,
      '/api/v1/keys must appear after the session probe',
    ).toBeGreaterThan(probeIdx);
    expect(
      authCheckIdx,
      'authenticated check must come before the keys call',
    ).toBeLessThan(keysIdx);
  });
});
