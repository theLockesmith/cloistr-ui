/**
 * Loading spinner component for Cloistr
 *
 * Provides various loading indicators with size and color variants.
 */

import { CSSProperties } from 'react';

export type SpinnerSize = 'sm' | 'md' | 'lg' | 'xl';
export type SpinnerVariant = 'primary' | 'secondary' | 'white';

export interface SpinnerProps {
  /** Size of the spinner */
  size?: SpinnerSize;
  /** Color variant */
  variant?: SpinnerVariant;
  /** Custom className */
  className?: string;
  /** Accessible label */
  label?: string;
}

const SIZE_MAP: Record<SpinnerSize, number> = {
  sm: 16,
  md: 24,
  lg: 32,
  xl: 48,
};

/**
 * Animated loading spinner
 *
 * @example
 * ```tsx
 * // Basic usage
 * <Spinner />
 *
 * // Sizes
 * <Spinner size="sm" />
 * <Spinner size="lg" />
 *
 * // In a button
 * <button disabled={loading}>
 *   {loading ? <Spinner size="sm" variant="white" /> : 'Submit'}
 * </button>
 * ```
 */
export function Spinner({
  size = 'md',
  variant = 'primary',
  className = '',
  label = 'Loading...',
}: SpinnerProps) {
  const sizeValue = SIZE_MAP[size];
  const style: CSSProperties = {
    width: sizeValue,
    height: sizeValue,
  };

  return (
    <div
      className={`cloistr-spinner cloistr-spinner-${variant} ${className}`}
      style={style}
      role="status"
      aria-label={label}
    >
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle
          className="cloistr-spinner-track"
          cx="12"
          cy="12"
          r="10"
          strokeWidth="3"
        />
        <circle
          className="cloistr-spinner-head"
          cx="12"
          cy="12"
          r="10"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      <span className="cloistr-sr-only">{label}</span>
    </div>
  );
}

export interface LoadingOverlayProps {
  /** Whether the overlay is visible */
  visible: boolean;
  /** Loading message to display */
  message?: string;
  /** Spinner size */
  size?: SpinnerSize;
  /** Whether to blur the background */
  blur?: boolean;
}

/**
 * Full-screen or container loading overlay
 *
 * @example
 * ```tsx
 * <div style={{ position: 'relative' }}>
 *   <YourContent />
 *   <LoadingOverlay visible={isLoading} message="Saving..." />
 * </div>
 * ```
 */
export function LoadingOverlay({
  visible,
  message,
  size = 'lg',
  blur = true,
}: LoadingOverlayProps) {
  if (!visible) return null;

  return (
    <div className={`cloistr-loading-overlay ${blur ? 'cloistr-loading-blur' : ''}`}>
      <div className="cloistr-loading-content">
        <Spinner size={size} />
        {message && <p className="cloistr-loading-message">{message}</p>}
      </div>
    </div>
  );
}

export interface SkeletonProps {
  /** Width of skeleton (CSS value) */
  width?: string | number;
  /** Height of skeleton (CSS value) */
  height?: string | number;
  /** Border radius variant */
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'full';
  /** Custom className */
  className?: string;
}

/**
 * Skeleton placeholder for loading content
 *
 * @example
 * ```tsx
 * // Text line
 * <Skeleton width="80%" height={16} />
 *
 * // Avatar
 * <Skeleton width={40} height={40} rounded="full" />
 *
 * // Card
 * <Skeleton width="100%" height={200} rounded="lg" />
 * ```
 */
export function Skeleton({
  width = '100%',
  height = 16,
  rounded = 'md',
  className = '',
}: SkeletonProps) {
  const style: CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
  };

  return (
    <div
      className={`cloistr-skeleton cloistr-skeleton-${rounded} ${className}`}
      style={style}
      aria-hidden="true"
    />
  );
}
