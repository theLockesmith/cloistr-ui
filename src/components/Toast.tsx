/**
 * Toast notification system for Cloistr
 *
 * Provides toast notifications with auto-dismiss, multiple variants,
 * and a context-based API for triggering toasts from anywhere.
 */

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  message: string;
  variant: ToastVariant;
  duration: number;
  dismissible: boolean;
}

export interface ToastOptions {
  /** Toast variant/type */
  variant?: ToastVariant;
  /** Auto-dismiss duration in ms (0 = no auto-dismiss) */
  duration?: number;
  /** Whether toast can be manually dismissed */
  dismissible?: boolean;
}

interface ToastContextValue {
  /** Show a toast notification */
  toast: (message: string, options?: ToastOptions) => string;
  /** Show a success toast */
  success: (message: string, options?: Omit<ToastOptions, 'variant'>) => string;
  /** Show an error toast */
  error: (message: string, options?: Omit<ToastOptions, 'variant'>) => string;
  /** Show a warning toast */
  warning: (message: string, options?: Omit<ToastOptions, 'variant'>) => string;
  /** Show an info toast */
  info: (message: string, options?: Omit<ToastOptions, 'variant'>) => string;
  /** Dismiss a specific toast by ID */
  dismiss: (id: string) => void;
  /** Dismiss all toasts */
  dismissAll: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Hook to access toast functionality
 */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}

/**
 * Generate unique ID for toast
 */
function generateId(): string {
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Default durations by variant
 */
const DEFAULT_DURATIONS: Record<ToastVariant, number> = {
  success: 3000,
  error: 5000,
  warning: 4000,
  info: 3000,
};

/**
 * Individual Toast component
 */
function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (toast.duration > 0) {
      const timer = setTimeout(() => {
        setIsExiting(true);
        setTimeout(() => onDismiss(toast.id), 200);
      }, toast.duration);
      return () => clearTimeout(timer);
    }
  }, [toast.id, toast.duration, onDismiss]);

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => onDismiss(toast.id), 200);
  }, [toast.id, onDismiss]);

  const variantIcons: Record<ToastVariant, string> = {
    success: '\u2713', // checkmark
    error: '\u2717',   // X
    warning: '\u26A0', // warning triangle
    info: '\u2139',    // info circle
  };

  return (
    <div
      className={`cloistr-toast cloistr-toast-${toast.variant} ${isExiting ? 'cloistr-toast-exit' : ''}`}
      role="alert"
      aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
    >
      <span className="cloistr-toast-icon">{variantIcons[toast.variant]}</span>
      <span className="cloistr-toast-message">{toast.message}</span>
      {toast.dismissible && (
        <button
          className="cloistr-toast-dismiss"
          onClick={handleDismiss}
          aria-label="Dismiss"
        >
          \u00D7
        </button>
      )}
    </div>
  );
}

export interface ToastProviderProps {
  children: ReactNode;
  /** Maximum number of toasts to show at once */
  maxToasts?: number;
  /** Position of toast container */
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center' | 'bottom-center';
}

/**
 * Toast provider component
 *
 * Wrap your app with this to enable toast notifications.
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <ToastProvider>
 *       <YourApp />
 *     </ToastProvider>
 *   );
 * }
 *
 * function SomeComponent() {
 *   const { success, error } = useToast();
 *
 *   const handleSave = async () => {
 *     try {
 *       await save();
 *       success('Saved successfully!');
 *     } catch (e) {
 *       error('Failed to save');
 *     }
 *   };
 * }
 * ```
 */
export function ToastProvider({
  children,
  maxToasts = 5,
  position = 'top-right',
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  const toast = useCallback(
    (message: string, options: ToastOptions = {}): string => {
      const id = generateId();
      const variant = options.variant ?? 'info';
      const newToast: ToastMessage = {
        id,
        message,
        variant,
        duration: options.duration ?? DEFAULT_DURATIONS[variant],
        dismissible: options.dismissible ?? true,
      };

      setToasts((prev) => {
        const updated = [...prev, newToast];
        // Remove oldest if exceeding max
        if (updated.length > maxToasts) {
          return updated.slice(-maxToasts);
        }
        return updated;
      });

      return id;
    },
    [maxToasts]
  );

  const success = useCallback(
    (message: string, options?: Omit<ToastOptions, 'variant'>) =>
      toast(message, { ...options, variant: 'success' }),
    [toast]
  );

  const error = useCallback(
    (message: string, options?: Omit<ToastOptions, 'variant'>) =>
      toast(message, { ...options, variant: 'error' }),
    [toast]
  );

  const warning = useCallback(
    (message: string, options?: Omit<ToastOptions, 'variant'>) =>
      toast(message, { ...options, variant: 'warning' }),
    [toast]
  );

  const info = useCallback(
    (message: string, options?: Omit<ToastOptions, 'variant'>) =>
      toast(message, { ...options, variant: 'info' }),
    [toast]
  );

  return (
    <ToastContext.Provider
      value={{ toast, success, error, warning, info, dismiss, dismissAll }}
    >
      {children}
      {toasts.length > 0 && (
        <div className={`cloistr-toast-container cloistr-toast-${position}`}>
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
