/**
 * ThemeProvider - shared light/dark/system theming for all Cloistr apps.
 *
 * Sets `data-theme="light|dark"` on <html> (or removes it for 'system', letting
 * the design tokens' prefers-color-scheme rule take over). The token values live
 * in @cloistr/ui/styles/variables.css. Persists the user's choice in localStorage.
 *
 * Usage:
 *   <ThemeProvider>
 *     <App />              // somewhere inside: <ThemeToggle />
 *   </ThemeProvider>
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeContextValue {
  /** The user's selected mode. */
  theme: ThemeMode;
  /** The theme actually applied right now ('light' | 'dark'), resolving 'system'. */
  resolvedTheme: 'light' | 'dark';
  setTheme: (mode: ThemeMode) => void;
  /** Cycle light -> dark -> system -> light. */
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'cloistr-theme';

/**
 * Theme is shared across every *.cloistr.xyz app via a cookie, NOT localStorage.
 *
 * localStorage is per-ORIGIN, so docs.cloistr.xyz and sheets.cloistr.xyz each
 * kept their own copy and a theme change in one app was invisible in every
 * other. This mirrors how SSO already shares auth state in src/lib/session.ts:
 * a cookie scoped to the parent domain is the one mechanism the browser will
 * carry between subdomains.
 *
 * localStorage is still written as a same-origin fast path so the first paint
 * does not flash before the cookie is read, but the COOKIE IS AUTHORITATIVE and
 * is read first.
 */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function readCookieTheme(): ThemeMode | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)cloistr-theme=([^;]*)/);
  if (!match) return null;
  const v = decodeURIComponent(match[1]);
  return v === 'light' || v === 'dark' || v === 'system' ? v : null;
}

function writeTheme(mode: ThemeMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // localStorage can throw in a private window or with site data blocked.
    // The cookie below is what actually matters, so keep going.
  }
  try {
    // Not HttpOnly: the client must read it. SameSite=Lax is enough because a
    // theme preference is not a credential. On a non-cloistr host (local dev,
    // preview) the domain attribute is omitted so the cookie still applies.
    const onCloistr =
      typeof location !== 'undefined' && location.hostname.endsWith('cloistr.xyz');
    const domain = onCloistr ? '; domain=.cloistr.xyz' : '';
    const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; secure' : '';
    document.cookie = `${STORAGE_KEY}=${encodeURIComponent(mode)}${domain}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax${secure}`;
  } catch {
    // Cookies unavailable; the localStorage write above still covers this app.
  }
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true; // dark-first default
  return !window.matchMedia('(prefers-color-scheme: light)').matches;
}

function readStored(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  // Cookie first: it is the cross-subdomain source of truth.
  const shared = readCookieTheme();
  if (shared) return shared;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(mode: ThemeMode): 'light' | 'dark' {
  const root = document.documentElement;
  const resolved: 'light' | 'dark' =
    mode === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : mode;
  if (mode === 'system') {
    // Remove the attribute so the prefers-color-scheme token rule applies.
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', mode);
  }
  // Backward-compat alias used by older token rules.
  root.classList.toggle('cloistr-light', resolved === 'light');
  return resolved;
}

export interface ThemeProviderProps {
  children: ReactNode;
  /** Mode to use before the user has chosen one. Defaults to 'system'. */
  defaultTheme?: ThemeMode;
}

export function ThemeProvider({ children, defaultTheme = 'system' }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeMode>(() =>
    typeof window === 'undefined' ? defaultTheme : readStored()
  );
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('dark');

  // Apply on mount and whenever the mode changes.
  useEffect(() => {
    setResolvedTheme(applyTheme(theme));
  }, [theme]);

  // When in 'system' mode, react to OS theme changes live.
  useEffect(() => {
    if (theme !== 'system' || typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => setResolvedTheme(applyTheme('system'));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((mode: ThemeMode) => {
    writeTheme(mode);
    setThemeState(mode);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: ThemeMode = prev === 'light' ? 'dark' : prev === 'dark' ? 'system' : 'light';
      writeTheme(next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}

/**
 * Like useTheme, but returns null instead of throwing when no ThemeProvider is
 * mounted. Lets shared components (e.g. Header/ThemeToggle) render gracefully in
 * apps that haven't adopted ThemeProvider yet.
 */
export function useThemeOptional(): ThemeContextValue | null {
  return useContext(ThemeContext);
}
