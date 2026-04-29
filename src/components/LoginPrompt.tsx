import React from 'react';

export interface LoginPromptProps {
  /** Service title (e.g., "Cloistr Docs") */
  title: string;
  /** Subtitle describing the service (e.g., "Collaborative document editing powered by Nostr") */
  subtitle?: string;
  /** Call to action text (e.g., "Sign in to create or edit documents.") */
  callToAction?: string;
  /** Custom class name */
  className?: string;
  /** Custom styles */
  style?: React.CSSProperties;
  /** Optional children for additional content */
  children?: React.ReactNode;
}

/**
 * Standard login prompt component for Cloistr apps.
 * Displays a centered message prompting users to sign in.
 *
 * @example
 * ```tsx
 * <LoginPrompt
 *   title="Cloistr Docs"
 *   subtitle="Collaborative document editing powered by Nostr"
 *   callToAction="Sign in to create or edit documents."
 * />
 * ```
 */
export function LoginPrompt({
  title,
  subtitle,
  callToAction = 'Sign in to get started.',
  className = '',
  style,
  children,
}: LoginPromptProps) {
  return (
    <div
      className={`login-prompt ${className}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: '300px',
        ...style,
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: '500px', padding: '2rem' }}>
        <h2 style={{ marginBottom: '0.5rem' }}>Welcome to {title}</h2>
        {subtitle && (
          <p style={{ color: 'var(--text-secondary, #666)', marginBottom: '1rem' }}>
            {subtitle}
          </p>
        )}
        <p style={{ color: 'var(--text-secondary, #666)' }}>
          {callToAction}
        </p>
        {children}
      </div>
    </div>
  );
}

export default LoginPrompt;
