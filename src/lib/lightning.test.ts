import { describe, it, expect } from 'vitest';
import { LIGHTNING_ADDRESS_PATTERN, isValidLightningAddress } from './lightning.js';

describe('LIGHTNING_ADDRESS_PATTERN', () => {
  it('exposes the expected regex source', () => {
    expect(LIGHTNING_ADDRESS_PATTERN.source).toBe(
      '^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$'
    );
  });
});

describe('isValidLightningAddress', () => {
  // Valid cases
  it('accepts a standard Lightning Address', () => {
    expect(isValidLightningAddress('alice@getalby.com')).toBe(true);
  });

  it('accepts an address with subdomains', () => {
    expect(isValidLightningAddress('alice@wallet.example.co.uk')).toBe(true);
  });

  it('accepts an address with hyphens in localpart', () => {
    expect(isValidLightningAddress('alice-bob@getalby.com')).toBe(true);
  });

  it('accepts an address with dots in localpart', () => {
    expect(isValidLightningAddress('alice.bob@getalby.com')).toBe(true);
  });

  it('accepts an address with underscores in localpart', () => {
    expect(isValidLightningAddress('alice_bob@getalby.com')).toBe(true);
  });

  it('accepts an address with digits in localpart', () => {
    expect(isValidLightningAddress('alice99@getalby.com')).toBe(true);
  });

  it('accepts a Cloistr Lightning Address', () => {
    expect(isValidLightningAddress('alice@cloistr.xyz')).toBe(true);
  });

  // Invalid cases
  it('rejects an address with no @ symbol', () => {
    expect(isValidLightningAddress('alicegetalby.com')).toBe(false);
  });

  it('rejects an address with no domain', () => {
    expect(isValidLightningAddress('alice@')).toBe(false);
  });

  it('rejects an address with no TLD', () => {
    expect(isValidLightningAddress('alice@getalby')).toBe(false);
  });

  it('rejects an address with a single-char TLD', () => {
    expect(isValidLightningAddress('alice@getalby.c')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidLightningAddress('')).toBe(false);
  });

  it('rejects plain text', () => {
    expect(isValidLightningAddress('not an address')).toBe(false);
  });

  it('rejects multiple @ symbols', () => {
    expect(isValidLightningAddress('alice@@getalby.com')).toBe(false);
  });
});
