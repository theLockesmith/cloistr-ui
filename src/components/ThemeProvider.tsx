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

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true; // dark-first default
  return !window.matchMedia('(prefers-color-scheme: light)').matches;
}

function readStored(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
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
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, mode);
    setThemeState(mode);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: ThemeMode = prev === 'light' ? 'dark' : prev === 'dark' ? 'system' : 'light';
      if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, next);
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
