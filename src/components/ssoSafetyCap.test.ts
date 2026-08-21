import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

/**
 * The SSO backstop must never fire during a legitimate handshake.
 *
 * The NIP-46 restore is TWO sequential relay handshakes: bootstrapKeys ->
 * startNostrConnect waits up to @cloistr/auth's CONNECT_TIMEOUT_MS (10s), and
 * the ack triggers a second connectNip46 round-trip with the same ceiling. So
 * ~20s can pass with nothing wrong.
 *
 * The cap was 12000 — below that ceiling — so on a slow or mobile network it
 * fired mid-handshake and flipped the app to logged-out while a valid session
 * was still resolving. Measured on stash: connecting at 8s and 16s, signed-out
 * at 26s. The comment beside the value already stated the requirement; only the
 * number was wrong, which is precisely the kind of drift a test should hold.
 */
const SRC = readFileSync(new URL('./SharedAuthProvider.tsx', import.meta.url), 'utf8');

const CONNECT_TIMEOUT_MS = 10_000; // @cloistr/auth DEFAULT_RELAY_CONFIG
const HANDSHAKES = 2;              // initial connect + the ack round-trip

describe('SSO safety cap', () => {
  it('is defined as a named constant, not a bare literal', () => {
    expect(SRC).toContain('const SSO_SAFETY_CAP_MS');
    expect(SRC).toContain('SSO_SAFETY_CAP_MS)');
  });

  it('sits ABOVE the two-handshake ceiling', () => {
    const m = SRC.match(/const SSO_SAFETY_CAP_MS = (\d+);/);
    expect(m, 'SSO_SAFETY_CAP_MS must be a numeric literal so this test can check it').toBeTruthy();
    const cap = Number(m![1]);
    expect(cap).toBeGreaterThan(CONNECT_TIMEOUT_MS * HANDSHAKES);
  });

  it('no longer uses the old 12s value anywhere', () => {
    expect(SRC).not.toMatch(/setIsResolving\(false\), ?12000/);
  });
});
