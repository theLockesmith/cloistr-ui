import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

/**
 * A re-mint must never touch the app's sign-in state.
 *
 * Measured live 2026-10-12 after a real signer restart: the re-mint went through
 * connectViaNostrConnect, whose failure path clears the context's signer. The
 * silent retry answering key_locked therefore signed the app out, and the
 * re-mint after the user signed in again raised the full-screen restore gate,
 * which unmounted the app and lost whatever was open.
 *
 * Source assertions: this package has no DOM environment, so the hook cannot be
 * driven here. The behaviour itself is proved by the live browser run.
 */
const SRC = readFileSync(new URL('./keySwitcher.ts', import.meta.url), 'utf8');
const code = SRC.split('\n')
  .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
  .join('\n');

describe('re-mint is detached from the auth context', () => {
  it('the wrapper re-mints in detached mode', () => {
    expect(code).toMatch(/remint: \(\) => rawMintSignerForKey\(keyId, pubkey, true\)/);
  });

  it('detached mode opens the session itself, not through connectViaNostrConnect', () => {
    const block = code.slice(code.indexOf('const start = detached'));
    const detachedArm = block.slice(0, block.indexOf(': connectViaNostrConnect'));
    expect(detachedArm).toContain('startNostrConnect()');
    expect(detachedArm).not.toContain('connectViaNostrConnect');
  });

  it('a re-mint does not re-register anything with the context', () => {
    const mint = code.slice(code.indexOf('const mintSignerForKey'), code.indexOf('const resolveSigner'));
    expect(mint).not.toMatch(/registerKey/);
  });
});
