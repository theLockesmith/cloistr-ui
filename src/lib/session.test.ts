import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getSharedSession,
  saveSharedSession,
  clearSharedSession,
  setActivePubkeyCookie,
} from './session.js';

function setWindowWith(hostname: string, config?: unknown, initialCookies?: string): void {
  const cookies = new Map<string, string>();
  if (initialCookies) {
    for (const part of initialCookies.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k) cookies.set(k, v.join('='));
    }
  }

  const doc: any = {};
  Object.defineProperty(doc, 'cookie', {
    get() {
      return Array.from(cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set(val: string) {
      const [pair] = val.split(';');
      const [k, ...v] = pair.split('=');
      const name = k.trim();
      if (val.includes('max-age=0')) {
        cookies.delete(name);
      } else {
        cookies.set(name, v.join('='));
      }
    },
    configurable: true,
  });

  (globalThis as any).window = {
    location: { hostname, protocol: 'https:' },
    ...(config !== undefined ? { __CLOISTR_CONFIG__: config } : {}),
  };
  (globalThis as any).document = doc;
}

beforeEach(() => {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
});

afterEach(() => {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
});

describe('cookie name isolation', () => {
  it('production uses unprefixed cookie names', () => {
    setWindowWith('space.cloistr.xyz');
    saveSharedSession({ method: 'nip46', pubkey: 'abc123', bunkerUrl: 'bunker://abc123' });
    const raw = (globalThis as any).document.cookie;
    expect(raw).toContain('cloistr_auth_method=');
    expect(raw).not.toContain('cloistr_staging_');
  });

  it('staging uses staging-prefixed cookie names', () => {
    setWindowWith('space.staging.cloistr.xyz');
    saveSharedSession({ method: 'nip46', pubkey: 'abc123', bunkerUrl: 'bunker://abc123' });
    const raw = (globalThis as any).document.cookie;
    expect(raw).toContain('cloistr_staging_auth_method=');
    expect(raw).toContain('cloistr_staging_auth_pubkey=');
    expect(raw).toContain('cloistr_staging_auth_bunker=');
  });

  it('staging does not read production cookies', () => {
    setWindowWith('space.staging.cloistr.xyz', undefined, 'cloistr_auth_method=nip46; cloistr_auth_pubkey=prodkey123');
    const session = getSharedSession();
    expect(session).toBeNull();
  });

  it('staging login writes only staging names when production cookies exist', () => {
    setWindowWith('space.staging.cloistr.xyz', undefined, 'cloistr_auth_method=nip46; cloistr_auth_pubkey=prodkey123');
    saveSharedSession({ method: 'nip46', pubkey: 'stagingkey456', bunkerUrl: 'bunker://stagingkey456' });
    const raw = (globalThis as any).document.cookie;
    // Production cookies should still be there (we don't touch them)
    expect(raw).toContain('cloistr_auth_method=nip46');
    expect(raw).toContain('cloistr_auth_pubkey=prodkey123');
    // Staging cookies should be written alongside
    expect(raw).toContain('cloistr_staging_auth_method=');
    expect(raw).toContain('cloistr_staging_auth_pubkey=');
  });

  it('staging getSharedSession reads only staging cookies', () => {
    setWindowWith(
      'space.staging.cloistr.xyz', undefined,
      'cloistr_auth_method=nip46; cloistr_auth_pubkey=prodkey123; cloistr_staging_auth_method=nip46; cloistr_staging_auth_pubkey=stagingkey456'
    );
    const session = getSharedSession();
    expect(session).not.toBeNull();
    expect(session!.pubkey).toBe('stagingkey456');
  });

  it('production getSharedSession ignores staging cookies', () => {
    setWindowWith(
      'space.cloistr.xyz', undefined,
      'cloistr_staging_auth_method=nip46; cloistr_staging_auth_pubkey=stagingkey456; cloistr_auth_method=nip46; cloistr_auth_pubkey=prodkey123'
    );
    const session = getSharedSession();
    expect(session).not.toBeNull();
    expect(session!.pubkey).toBe('prodkey123');
  });

  it('clearSharedSession on staging only clears staging cookies', () => {
    setWindowWith(
      'space.staging.cloistr.xyz', undefined,
      'cloistr_auth_method=nip46; cloistr_auth_pubkey=prodkey123; cloistr_staging_auth_method=nip46; cloistr_staging_auth_pubkey=stagingkey456'
    );
    clearSharedSession();
    const raw = (globalThis as any).document.cookie;
    // Production cookies untouched
    expect(raw).toContain('cloistr_auth_method=nip46');
    expect(raw).toContain('cloistr_auth_pubkey=prodkey123');
  });

  it('runtime config environment override controls cookie names', () => {
    setWindowWith('custom.example.com', { environment: 'staging' });
    saveSharedSession({ method: 'nip07', pubkey: 'customkey789' });
    const raw = (globalThis as any).document.cookie;
    expect(raw).toContain('cloistr_staging_auth_method=');
  });

  it('active pubkey cookie uses environment-specific name', () => {
    setWindowWith('space.staging.cloistr.xyz');
    setActivePubkeyCookie('stagingpubkey');
    const raw = (globalThis as any).document.cookie;
    expect(raw).toContain('cloistr_staging_auth_active_pubkey=');
    expect(raw).not.toContain('cloistr_auth_active_pubkey=');
  });
});
