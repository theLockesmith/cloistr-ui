/**
 * Theme persistence must be CROSS-SUBDOMAIN.
 *
 * The bug: theme was stored only in localStorage, which is per-ORIGIN. Changing
 * the theme in docs.cloistr.xyz left sheets.cloistr.xyz on the old theme,
 * because the browser gives every subdomain its own localStorage. The operator
 * reported it as "if I change my theme on one app, it only changes for that
 * app".
 *
 * The fix mirrors how SSO already shares auth in src/lib/session.ts: a cookie
 * scoped to .cloistr.xyz, which IS carried between subdomains.
 *
 * These are SOURCE-LEVEL assertions. This package has vitest but no DOM
 * environment, so the provider cannot be mounted here. They pin the mechanism,
 * not the rendered behaviour, and they fail if someone reverts to a
 * localStorage-only implementation.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync(new URL('./ThemeProvider.tsx', import.meta.url), 'utf8');

describe('theme persistence is shared across subdomains', () => {
  it('writes a cookie scoped to the parent domain', () => {
    expect(SRC).toContain('domain=.cloistr.xyz');
  });

  it('reads the cookie BEFORE localStorage, so the shared value wins', () => {
    const readStored = SRC.slice(SRC.indexOf('function readStored'));
    const body = readStored.slice(0, readStored.indexOf('}\n'));
    expect(body.indexOf('readCookieTheme')).toBeGreaterThan(-1);
    expect(body.indexOf('readCookieTheme')).toBeLessThan(body.indexOf('localStorage'));
  });

  it('does not set the domain attribute off cloistr.xyz', () => {
    // Local dev and preview hosts must still get a working cookie; a domain
    // attribute naming a domain you are not on is rejected outright.
    expect(SRC).toContain("location.hostname.endsWith('cloistr.xyz')");
  });

  it('survives storage being unavailable', () => {
    // Private windows and blocked site data make localStorage and cookies throw
    // on ACCESS, not just return null.
    const writeTheme = SRC.slice(SRC.indexOf('function writeTheme'));
    expect(writeTheme.slice(0, 1200)).toContain('catch');
  });

  it('every persistence path goes through writeTheme', () => {
    // A direct localStorage.setItem outside writeTheme would silently reopen
    // the per-origin bug for that code path.
    const setItems = SRC.match(/localStorage\.setItem/g) ?? [];
    expect(setItems.length).toBe(1);
  });
});
