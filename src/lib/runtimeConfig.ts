/**
 * Reads the container runtime config (window.__CLOISTR_CONFIG__) written by
 * each image's nginx at startup. Every function falls back to production
 * values, so an unconfigured image behaves identically to today.
 *
 * The shape matches @cloistr/collab-common/config's RuntimeConfig, but we
 * read the global directly to avoid a package dependency.
 */

const RUNTIME_CONFIG_GLOBAL = '__CLOISTR_CONFIG__';

interface CloistrRuntimeConfig {
  relayUrl?: string;
  signerUrl?: string;
  baseDomain?: string;
  cookieDomain?: string;
  environment?: string;
  services?: Record<string, string>;
}

function getRuntimeConfig(): CloistrRuntimeConfig {
  if (typeof window === 'undefined') return {};
  const raw = (window as any)[RUNTIME_CONFIG_GLOBAL];
  if (!raw || typeof raw !== 'object') return {};
  return raw;
}

export function getSignerUrl(): string {
  const cfg = getRuntimeConfig();
  if (typeof cfg.signerUrl === 'string' && cfg.signerUrl !== '') return cfg.signerUrl;
  return 'https://signer.cloistr.xyz';
}

export function getSignerHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

export function getCookieDomain(): string {
  const cfg = getRuntimeConfig();
  if (typeof cfg.cookieDomain === 'string' && cfg.cookieDomain !== '') return cfg.cookieDomain;
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname.endsWith('.staging.cloistr.xyz') || hostname === 'staging.cloistr.xyz') {
      return '.staging.cloistr.xyz';
    }
    if (hostname.endsWith('.cloistr.xyz') || hostname === 'cloistr.xyz') {
      return '.cloistr.xyz';
    }
  }
  return '';
}

export function isCloistrHostname(): boolean {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname;
  return hostname.endsWith('cloistr.xyz') || hostname === 'cloistr.xyz';
}

export function getBaseDomain(): string {
  const cfg = getRuntimeConfig();
  if (typeof cfg.baseDomain === 'string' && cfg.baseDomain !== '') return cfg.baseDomain;
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname.endsWith('.staging.cloistr.xyz') || hostname === 'staging.cloistr.xyz') {
      return 'staging.cloistr.xyz';
    }
  }
  return 'cloistr.xyz';
}

export function getEnvironment(): string {
  const cfg = getRuntimeConfig();
  if (typeof cfg.environment === 'string' && cfg.environment !== '') return cfg.environment;
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname.endsWith('.staging.cloistr.xyz') || hostname === 'staging.cloistr.xyz') {
      return 'staging';
    }
  }
  return 'production';
}

export function getServiceUrlOverrides(): Record<string, string> {
  const cfg = getRuntimeConfig();
  if (cfg.services && typeof cfg.services === 'object') return cfg.services;
  return {};
}
