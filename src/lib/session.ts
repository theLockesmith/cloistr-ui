/**
 * Cross-subdomain session management for Cloistr
 *
 * Uses cookies on .cloistr.xyz domain to share auth state across all services.
 * This allows single sign-on: login once on any service, authenticated everywhere.
 */

import type { AuthMethod } from '@cloistr/collab-common/auth';

export interface SharedSession {
  method: AuthMethod;
  pubkey: string;
  bunkerUrl?: string; // Only for NIP-46
}

/**
 * Cookie configuration
 */
const COOKIE_CONFIG = {
  domain: '.cloistr.xyz',
  path: '/',
  maxAge: 60 * 60 * 24 * 30, // 30 days
  secure: true,
  sameSite: 'lax' as const,
};

/**
 * Cookie keys
 */
const COOKIE_KEYS = {
  METHOD: 'cloistr_auth_method',
  PUBKEY: 'cloistr_auth_pubkey',
  BUNKER: 'cloistr_auth_bunker',
} as const;

/**
 * Check if running in browser
 */
function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * Check if running on a cloistr.xyz domain
 */
export function isCloistrDomain(): boolean {
  if (!isBrowser()) return false;
  return window.location.hostname.endsWith('cloistr.xyz') ||
         window.location.hostname === 'cloistr.xyz';
}

/**
 * Build cookie string with proper attributes
 */
function buildCookie(name: string, value: string, options: typeof COOKIE_CONFIG): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  // Only set domain cookie on cloistr.xyz domains
  if (isCloistrDomain()) {
    parts.push(`domain=${options.domain}`);
  }

  parts.push(`path=${options.path}`);
  parts.push(`max-age=${options.maxAge}`);

  if (options.secure) {
    parts.push('secure');
  }

  parts.push(`samesite=${options.sameSite}`);

  return parts.join('; ');
}

/**
 * Get a cookie value by name
 */
function getCookie(name: string): string | null {
  if (!isBrowser()) return null;

  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.trim().split('=');
    if (key === name) {
      return decodeURIComponent(valueParts.join('='));
    }
  }
  return null;
}

/**
 * Set a cookie
 */
function setCookie(name: string, value: string): void {
  if (!isBrowser()) return;
  document.cookie = buildCookie(name, value, COOKIE_CONFIG);
}

/**
 * Delete a cookie
 */
function deleteCookie(name: string): void {
  if (!isBrowser()) return;

  // Delete with domain (for cloistr.xyz)
  if (isCloistrDomain()) {
    document.cookie = `${name}=; domain=${COOKIE_CONFIG.domain}; path=/; max-age=0`;
  }
  // Also delete without domain (for local dev)
  document.cookie = `${name}=; path=/; max-age=0`;
}

/**
 * Save session to cross-domain cookies
 */
export function saveSharedSession(session: SharedSession): void {
  setCookie(COOKIE_KEYS.METHOD, session.method);
  setCookie(COOKIE_KEYS.PUBKEY, session.pubkey);

  if (session.method === 'nip46' && session.bunkerUrl) {
    setCookie(COOKIE_KEYS.BUNKER, session.bunkerUrl);
  } else {
    deleteCookie(COOKIE_KEYS.BUNKER);
  }
}

/**
 * Get shared session from cookies
 */
export function getSharedSession(): SharedSession | null {
  const method = getCookie(COOKIE_KEYS.METHOD) as AuthMethod | null;
  const pubkey = getCookie(COOKIE_KEYS.PUBKEY);

  if (!method || !pubkey) {
    return null;
  }

  const session: SharedSession = { method, pubkey };

  if (method === 'nip46') {
    const bunkerUrl = getCookie(COOKIE_KEYS.BUNKER);
    if (bunkerUrl) {
      session.bunkerUrl = bunkerUrl;
    }
  }

  return session;
}

/**
 * Check if a shared session exists
 */
export function hasSharedSession(): boolean {
  return getSharedSession() !== null;
}

/**
 * Clear shared session cookies
 */
export function clearSharedSession(): void {
  deleteCookie(COOKIE_KEYS.METHOD);
  deleteCookie(COOKIE_KEYS.PUBKEY);
  deleteCookie(COOKIE_KEYS.BUNKER);
}

/**
 * Sync local auth state to shared session
 * Call this after successful login
 */
export function syncToSharedSession(
  method: AuthMethod,
  pubkey: string,
  bunkerUrl?: string
): void {
  saveSharedSession({
    method,
    pubkey,
    bunkerUrl: method === 'nip46' ? bunkerUrl : undefined,
  });
}
