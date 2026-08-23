/**
 * Button — the shared interactive control for Cloistr apps.
 *
 * WHY THIS EXISTS
 *
 * @cloistr/ui shipped CSS for .cloistr-btn-* variants from day one, and
 * ConfirmModal already used those classes internally. What was missing was a
 * React component, so whiteboard, vault and signer each built their own — with
 * different class names, different disabled handling, and different loading
 * states. This component unifies the four implementations.
 *
 * VARIANTS (matching what the three apps actually use)
 *
 *   primary    — filled primary colour, primary-fg text. Default.
 *   secondary  — elevated background, border, content-colour text.
 *   danger     — error colour, white text. Destructive actions only.
 *   icon       — square with equal padding; no visible label expected. Pass an
 *               SVG or emoji as children. Add aria-label for screen readers.
 *
 * LOADING
 *
 * When loading=true the button is disabled and the children are replaced by
 * a spinner. The spinner size and colour are fixed at sm/white because all
 * button backgrounds (primary, danger, and the elevated secondary) are dark
 * enough for a white indicator in every theme.
 *
 * Callers that want to show the original label alongside the spinner should
 * manage that themselves via children, and pass disabled={true} directly.
 */

import { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style variant. Defaults to 'primary'. */
  variant?: ButtonVariant;
  /**
   * When true the button is disabled and a spinner replaces the children.
   * Use this for async actions where the UI should block until the operation
   * resolves.
   */
  loading?: boolean;
  children?: ReactNode;
}

/**
 * Build the CSS class string for a button. Exported so tests can assert the
 * class mapping without rendering.
 */
export function buttonClasses(variant: ButtonVariant, extra?: string): string {
  const parts = ['cloistr-btn', `cloistr-btn-${variant}`];
  if (extra) parts.push(extra);
  return parts.join(' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * @cloistr/ui Button component.
 *
 * @example
 * ```tsx
 * // Primary (default)
 * <Button onClick={save}>Save</Button>
 *
 * // Destructive
 * <Button variant="danger" onClick={deleteItem}>Delete</Button>
 *
 * // Async: shows spinner and blocks while in flight
 * <Button loading={isSaving}>Save</Button>
 *
 * // Icon-only: always add aria-label
 * <Button variant="icon" aria-label="Close">✕</Button>
 * ```
 */
export function Button({
  variant = 'primary',
  loading = false,
  className = '',
  disabled,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className="cloistr-btn-loading-indicator" aria-hidden="true">
          {/* Inline spinner — avoids a circular import on Spinner.tsx which
              itself may one day use Button. The animation is identical to
              .cloistr-spinner-head defined in components.css. */}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            style={{ width: '1em', height: '1em', verticalAlign: 'middle', animation: 'cloistr-spin 0.8s linear infinite' }}
          >
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </span>
      ) : (
        children
      )}
    </button>
  );
}
