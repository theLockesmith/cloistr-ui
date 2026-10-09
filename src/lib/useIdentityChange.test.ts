import { describe, it, expect } from 'vitest';

/**
 * Tests for the identity-change detection logic.
 *
 * The core function (shouldFireIdentityChange) is pure and testable without
 * React. The hook is a thin wrapper that watches authState.activePubkey and
 * authState.method via useEffect.
 */
import { shouldFireIdentityChange } from './useIdentityChange.js';

describe('shouldFireIdentityChange', () => {
  it('fires on first sign-in (null → pubkey)', () => {
    const result = shouldFireIdentityChange(
      { pubkey: null, method: null },
      { pubkey: 'abc', method: 'nip46' },
    );
    expect(result).toEqual({
      pubkey: 'abc',
      previousPubkey: null,
      method: 'nip46',
    });
  });

  it('fires on key switch (pubkey1 → pubkey2)', () => {
    const result = shouldFireIdentityChange(
      { pubkey: 'abc', method: 'nip46' },
      { pubkey: 'def', method: 'nip46' },
    );
    expect(result).toEqual({
      pubkey: 'def',
      previousPubkey: 'abc',
      method: 'nip46',
    });
  });

  it('fires on method change (same pubkey, nip46 → nip07)', () => {
    const result = shouldFireIdentityChange(
      { pubkey: 'abc', method: 'nip46' },
      { pubkey: 'abc', method: 'nip07' },
    );
    expect(result).toEqual({
      pubkey: 'abc',
      previousPubkey: 'abc',
      method: 'nip07',
    });
  });

  it('does not fire when nothing changed', () => {
    const result = shouldFireIdentityChange(
      { pubkey: 'abc', method: 'nip46' },
      { pubkey: 'abc', method: 'nip46' },
    );
    expect(result).toBeNull();
  });

  it('does not fire when current pubkey is null (signed out)', () => {
    const result = shouldFireIdentityChange(
      { pubkey: 'abc', method: 'nip46' },
      { pubkey: null, method: null },
    );
    expect(result).toBeNull();
  });

  it('does not fire when both are null (never signed in)', () => {
    const result = shouldFireIdentityChange(
      { pubkey: null, method: null },
      { pubkey: null, method: null },
    );
    expect(result).toBeNull();
  });
});
