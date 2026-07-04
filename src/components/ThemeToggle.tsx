/**
 * ThemeToggle - a small button that cycles light -> dark -> system.
 * Must be rendered inside a <ThemeProvider>.
 */

import { useTheme, type ThemeMode } from './ThemeProvider.js';

const ICON: Record<ThemeMode, string> = {
  light: '☀️',
  dark: '🌙',
  system: '🖥️',
};

const LABEL: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

export interface ThemeToggleProps {
  /** Show the text label next to the icon. Default false (icon only). */
  showLabel?: boolean;
  className?: string;
}

export function ThemeToggle({ showLabel = false, className }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={className}
      aria-label={`Theme: ${LABEL[theme]} (click to change)`}
      title={`Theme: ${LABEL[theme]}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        background: 'var(--cloistr-bg-elevated)',
        color: 'var(--cloistr-text)',
        border: '1px solid var(--cloistr-border)',
        borderRadius: 'var(--cloistr-radius-md)',
        padding: '0.35rem 0.6rem',
        cursor: 'pointer',
        font: 'inherit',
        lineHeight: 1,
      }}
    >
      <span aria-hidden="true">{ICON[theme]}</span>
      {showLabel && <span>{LABEL[theme]}</span>}
    </button>
  );
}
