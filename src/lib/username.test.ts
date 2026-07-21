import { describe, it, expect } from 'vitest';
import {
  VALID_PATTERN,
  AUTO_ASSIGNED_PATTERN,
  isValid,
  isAutoAssigned,
  isValidHumanName,
} from './username.js';

describe('VALID_PATTERN', () => {
  it('matches the canonical DB CHECK pattern string', () => {
    expect(VALID_PATTERN.source).toBe('^[a-z0-9_-]{2,50}$');
  });
});

describe('AUTO_ASSIGNED_PATTERN', () => {
  it('matches the reserved auto-assign pattern string', () => {
    expect(AUTO_ASSIGNED_PATTERN.source).toBe('^[a-z]+-[a-z]+-[0-9]{4}$');
  });
});

describe('isValid', () => {
  it('accepts a simple lowercase name', () => {
    expect(isValid('alice')).toBe(true);
  });

  it('accepts names with digits', () => {
    expect(isValid('alice99')).toBe(true);
  });

  it('accepts names with underscores', () => {
    expect(isValid('alice_bob')).toBe(true);
  });

  it('accepts names with hyphens', () => {
    expect(isValid('alice-bob')).toBe(true);
  });

  it('accepts exactly 2-char name (lower boundary)', () => {
    expect(isValid('ab')).toBe(true);
  });

  it('accepts exactly 50-char name (upper boundary)', () => {
    expect(isValid('a'.repeat(50))).toBe(true);
  });

  it('rejects a 1-char name (below lower boundary)', () => {
    expect(isValid('a')).toBe(false);
  });

  it('rejects a 51-char name (above upper boundary)', () => {
    expect(isValid('a'.repeat(51))).toBe(false);
  });

  it('rejects uppercase letters', () => {
    expect(isValid('Alice')).toBe(false);
    expect(isValid('ALICE')).toBe(false);
  });

  it('rejects spaces', () => {
    expect(isValid('alice bob')).toBe(false);
  });

  it('rejects dots', () => {
    expect(isValid('alice.bob')).toBe(false);
  });

  it('rejects @ symbol', () => {
    expect(isValid('alice@cloistr')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValid('')).toBe(false);
  });

  it('accepts an auto-assigned name (it is valid format)', () => {
    expect(isValid('happy-otter-1234')).toBe(true);
  });
});

describe('isAutoAssigned', () => {
  it('recognises a canonical auto-assigned name', () => {
    expect(isAutoAssigned('happy-otter-1234')).toBe(true);
  });

  it('recognises multi-letter adjective and noun', () => {
    expect(isAutoAssigned('elegant-sparrow-5678')).toBe(true);
  });

  it('rejects a name with 3-digit suffix', () => {
    expect(isAutoAssigned('happy-otter-123')).toBe(false);
  });

  it('rejects a name with 5-digit suffix', () => {
    expect(isAutoAssigned('happy-otter-12345')).toBe(false);
  });

  it('rejects a name with underscore instead of hyphen', () => {
    expect(isAutoAssigned('happy_otter_1234')).toBe(false);
  });

  it('rejects a plain human name', () => {
    expect(isAutoAssigned('alice')).toBe(false);
  });

  it('rejects when adjective segment contains digit', () => {
    expect(isAutoAssigned('h4ppy-otter-1234')).toBe(false);
  });
});

describe('isValidHumanName', () => {
  it('accepts a regular human name', () => {
    expect(isValidHumanName('alice')).toBe(true);
  });

  it('accepts a human name with hyphen', () => {
    expect(isValidHumanName('alice-bob')).toBe(true);
  });

  it('blocks an auto-assigned name (prevents squatting)', () => {
    expect(isValidHumanName('happy-otter-1234')).toBe(false);
  });

  it('blocks any auto-assigned shape', () => {
    expect(isValidHumanName('elegant-sparrow-9999')).toBe(false);
  });

  it('rejects invalid formats (short)', () => {
    expect(isValidHumanName('a')).toBe(false);
  });

  it('rejects invalid formats (uppercase)', () => {
    expect(isValidHumanName('Alice')).toBe(false);
  });

  it('accepts 2-char name', () => {
    expect(isValidHumanName('ab')).toBe(true);
  });
});
