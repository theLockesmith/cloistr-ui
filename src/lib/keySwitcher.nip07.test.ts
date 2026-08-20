import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

/**
 * An extension may only be invoked by EXPLICIT user intent.
 *
 * resolveSigner() answers a nip07 identity by calling connectNip07(), which
 * touches window.nostr — and an extension prompts the instant it is touched.
 * The cross-tab reconciliation effect runs on a 2s interval, on focus and on
 * storage events, so an active-pubkey cookie naming an extension key made Alby
 * demand authorisation repeatedly, on a session the user had established with a
 * password on another app entirely.
 *
 * Source assertions: this package has no DOM environment, so the effect cannot
 * be driven here. Stated plainly rather than dressed up — the guard itself is
 * one line, and what matters is that it does not quietly disappear.
 */
const SRC = readFileSync(new URL('./keySwitcher.ts', import.meta.url), 'utf8');

describe('never auto-invoke a NIP-07 extension', () => {
  it('the cookie-sync effect refuses to switch INTO a nip07 key', () => {
    expect(SRC).toContain("target?.method === 'nip07'");
    expect(SRC).toContain("authState.method !== 'nip07'");
  });

  it('the guard returns before setActiveKey rather than after', () => {
    // Guarding after the call would prompt first and decide second.
    const block = SRC.slice(SRC.indexOf('const checkCookieSwitch'));
    const guard = block.indexOf("target?.method === 'nip07'");
    const call = block.indexOf('void setActiveKey(cookiePubkey)');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(call);
  });

  it('still allows auto-switching when the session ITSELF is nip07', () => {
    // A user who signed in with the extension has already granted it; keeping
    // their tabs in sync is expected and prompts nothing new.
    expect(SRC).toMatch(/authState\.method !== 'nip07'\s*\)\s*return/);
  });

  it('resolveSigner is still the only place that mints an extension signer', () => {
    // Count CODE, not prose: the comments here mention connectNip07() several
    // times, and a naive match counted those too — the test's own first run
    // failed 3-vs-1 on its own documentation.
    const code = SRC.split('\n')
      .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    const calls = code.match(/connectNip07\(\)/g) ?? [];
    expect(calls.length).toBe(1);
  });
});
