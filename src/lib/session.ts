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
 * Session TTL options in seconds
 */
export const SESSION_TTL_OPTIONS = {
  '1d': 60 * 60 * 24,           // 1 day
  '7d': 60 * 60 * 24 * 7,       // 7 days
  '30d': 60 * 60 * 24 * 30,     // 30 days
  'never': 60 * 60 * 24 * 400,  // 400 days (browser max)
} as const;

export type SessionTTL = keyof typeof SESSION_TTL_OPTIONS;

export const SESSION_TTL_LABELS: Record<SessionTTL, string> = {
  '1d': '1 day',
  '7d': '7 days',
  '30d': '30 days',
  'never': 'Does not expire',
};

const DEFAULT_TTL: SessionTTL = '30d';

/**
 * Cookie keys
 */
const COOKIE_KEYS = {
  METHOD: 'cloistr_auth_method',
  PUBKEY: 'cloistr_auth_pubkey',
  BUNKER: 'cloistr_auth_bunker',
  TTL: 'cloistr_session_ttl',
} as const;

/**
 * Get current TTL preference or default
 */
export function getSessionTTL(): SessionTTL {
  const stored = getCookie(COOKIE_KEYS.TTL);
  if (stored && stored in SESSION_TTL_OPTIONS) {
    return stored as SessionTTL;
  }
  return DEFAULT_TTL;
}

/**
 * Set session TTL preference
 */
export function setSessionTTL(ttl: SessionTTL): void {
  if (!isBrowser()) return;
  const maxAge = SESSION_TTL_OPTIONS[ttl];
  document.cookie = buildCookieWithMaxAge(COOKIE_KEYS.TTL, ttl, maxAge);

  // Refresh other session cookies with new TTL
  const session = getSharedSession();
  if (session) {
    saveSharedSession(session);
  }
}

/**
 * Get cookie configuration with current TTL
 */
function getCookieConfig() {
  const ttl = getSessionTTL();
  return {
    domain: '.cloistr.xyz',
    path: '/',
    maxAge: SESSION_TTL_OPTIONS[ttl],
    secure: true,
    sameSite: 'lax' as const,
  };
}

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
 * Build cookie string with specific maxAge
 */
function buildCookieWithMaxAge(name: string, value: string, maxAge: number): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (isCloistrDomain()) {
    parts.push('domain=.cloistr.xyz');
  }

  parts.push('path=/');
  parts.push(`max-age=${maxAge}`);
  parts.push('secure');
  parts.push('samesite=lax');

  return parts.join('; ');
}

/**
 * Build cookie string with user's TTL preference
 */
function buildCookie(name: string, value: string): string {
  const config = getCookieConfig();
  return buildCookieWithMaxAge(name, value, config.maxAge);
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
 * Set a cookie with user's TTL preference
 */
function setCookie(name: string, value: string): void {
  if (!isBrowser()) return;
  document.cookie = buildCookie(name, value);
}

/**
 * Delete a cookie
 */
function deleteCookie(name: string): void {
  if (!isBrowser()) return;

  // Delete with domain (for cloistr.xyz)
  if (isCloistrDomain()) {
    document.cookie = `${name}=; domain=.cloistr.xyz; path=/; max-age=0`;
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
  deleteCookie(COOKIE_KEYS.TTL);
}

/**
 * Renew session cookies with fresh TTL
 * Call this on token refresh for auto-renewal
 */
export function renewSession(): void {
  const session = getSharedSession();
  if (session) {
    saveSharedSession(session);
  }
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
