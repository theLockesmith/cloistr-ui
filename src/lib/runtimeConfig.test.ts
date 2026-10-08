import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getSignerUrl,
  getSignerHostname,
  getCookieDomain,
  isCloistrHostname,
  getBaseDomain,
  getServiceUrlOverrides,
} from './runtimeConfig.js';

function setWindowWith(hostname: string, config?: unknown): void {
  (globalThis as any).window = {
    location: { hostname, protocol: 'https:' },
    document: { cookie: '' },
    ...(config !== undefined ? { __CLOISTR_CONFIG__: config } : {}),
  };
}

beforeEach(() => {
  delete (globalThis as any).window;
});

afterEach(() => {
  delete (globalThis as any).window;
});

describe('getSignerUrl', () => {
  it('defaults to production', () => {
    expect(getSignerUrl()).toBe('https://signer.cloistr.xyz');
  });

  it('reads from runtime config', () => {
    setWindowWith('space.staging.cloistr.xyz', {
      signerUrl: 'https://signer.staging.cloistr.xyz',
    });
    expect(getSignerUrl()).toBe('https://signer.staging.cloistr.xyz');
  });
});

describe('getSignerHostname', () => {
  it('extracts hostname from production signer URL', () => {
    expect(getSignerHostname('https://signer.cloistr.xyz')).toBe('signer.cloistr.xyz');
  });

  it('extracts hostname from staging signer URL', () => {
    expect(getSignerHostname('https://signer.staging.cloistr.xyz')).toBe('signer.staging.cloistr.xyz');
  });

  it('extracts hostname from custom URL with port', () => {
    expect(getSignerHostname('http://localhost:3000')).toBe('localhost');
  });

  it('returns the input unchanged when URL is malformed', () => {
    expect(getSignerHostname('not-a-url')).toBe('not-a-url');
  });
});

describe('getCookieDomain', () => {
  it('defaults to .cloistr.xyz on production hostnames', () => {
    setWindowWith('space.cloistr.xyz');
    expect(getCookieDomain()).toBe('.cloistr.xyz');
  });

  it('returns .staging.cloistr.xyz on staging hostnames', () => {
    setWindowWith('space.staging.cloistr.xyz');
    expect(getCookieDomain()).toBe('.staging.cloistr.xyz');
  });

  it('uses explicit cookieDomain from runtime config', () => {
    setWindowWith('whatever.example.com', { cookieDomain: '.example.com' });
    expect(getCookieDomain()).toBe('.example.com');
  });

  it('returns empty string when not on a cloistr hostname and no config', () => {
    setWindowWith('localhost');
    expect(getCookieDomain()).toBe('');
  });
});

describe('isCloistrHostname', () => {
  it('true for production', () => {
    setWindowWith('space.cloistr.xyz');
    expect(isCloistrHostname()).toBe(true);
  });

  it('true for staging', () => {
    setWindowWith('space.staging.cloistr.xyz');
    expect(isCloistrHostname()).toBe(true);
  });

  it('false for localhost', () => {
    setWindowWith('localhost');
    expect(isCloistrHostname()).toBe(false);
  });
});

describe('getBaseDomain', () => {
  it('defaults to cloistr.xyz', () => {
    expect(getBaseDomain()).toBe('cloistr.xyz');
  });

  it('returns staging.cloistr.xyz on staging hostnames', () => {
    setWindowWith('space.staging.cloistr.xyz');
    expect(getBaseDomain()).toBe('staging.cloistr.xyz');
  });

  it('uses explicit baseDomain from runtime config', () => {
    setWindowWith('something.example.com', { baseDomain: 'example.com' });
    expect(getBaseDomain()).toBe('example.com');
  });
});

describe('getServiceUrlOverrides', () => {
  it('returns empty object by default', () => {
    expect(getServiceUrlOverrides()).toEqual({});
  });

  it('returns the services map from runtime config', () => {
    setWindowWith('space.staging.cloistr.xyz', {
      services: { home: 'https://staging.cloistr.xyz' },
    });
    expect(getServiceUrlOverrides()).toEqual({ home: 'https://staging.cloistr.xyz' });
  });
});
