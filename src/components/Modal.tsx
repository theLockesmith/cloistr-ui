/**
 * Generic modal component for Cloistr
 *
 * Provides accessible modal dialogs with various sizes and variants.
 */

import { useEffect, useCallback, useRef, ReactNode, MouseEvent, KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface ModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Modal title */
  title?: string;
  /** Modal content */
  children: ReactNode;
  /** Size variant */
  size?: ModalSize;
  /** Whether clicking backdrop closes the modal */
  closeOnBackdrop?: boolean;
  /** Whether pressing Escape closes the modal */
  closeOnEscape?: boolean;
  /** Whether to show the close button */
  showCloseButton?: boolean;
  /** Footer content (buttons, etc.) */
  footer?: ReactNode;
  /** Custom className for the modal */
  className?: string;
}

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'cloistr-modal-sm',
  md: 'cloistr-modal-md',
  lg: 'cloistr-modal-lg',
  xl: 'cloistr-modal-xl',
  full: 'cloistr-modal-full',
};

/**
 * Generic modal component
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const [isOpen, setIsOpen] = useState(false);
 *
 *   return (
 *     <>
 *       <button onClick={() => setIsOpen(true)}>Open Modal</button>
 *       <Modal
 *         isOpen={isOpen}
 *         onClose={() => setIsOpen(false)}
 *         title="Confirm Action"
 *         footer={
 *           <>
 *             <button onClick={() => setIsOpen(false)}>Cancel</button>
 *             <button onClick={handleConfirm}>Confirm</button>
 *           </>
 *         }
 *       >
 *         <p>Are you sure you want to proceed?</p>
 *       </Modal>
 *     </>
 *   );
 * }
 * ```
 */
export function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  closeOnBackdrop = true,
  closeOnEscape = true,
  showCloseButton = true,
  footer,
  className = '',
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // Handle escape key
  const handleKeyDown = useCallback(
    (event: globalThis.KeyboardEvent) => {
      if (closeOnEscape && event.key === 'Escape') {
        onClose();
      }
    },
    [closeOnEscape, onClose]
  );

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (closeOnBackdrop && event.target === event.currentTarget) {
        onClose();
      }
    },
    [closeOnBackdrop, onClose]
  );

  // Trap focus and manage body scroll
  useEffect(() => {
    if (isOpen) {
      // Store currently focused element
      previousActiveElement.current = document.activeElement as HTMLElement;

      // Focus the modal
      modalRef.current?.focus();

      // Prevent body scroll
      document.body.style.overflow = 'hidden';

      // Add escape key listener
      document.addEventListener('keydown', handleKeyDown);

      return () => {
        document.body.style.overflow = '';
        document.removeEventListener('keydown', handleKeyDown);

        // Restore focus
        previousActiveElement.current?.focus();
      };
    }
  }, [isOpen, handleKeyDown]);

  // Handle tab key for focus trapping
  const handleModalKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;

    const modal = modalRef.current;
    if (!modal) return;

    const focusableElements = modal.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }, []);

  if (!isOpen) return null;

  const modalContent = (
    <div
      className="cloistr-modal-backdrop"
      onClick={handleBackdropClick}
      aria-modal="true"
      role="dialog"
      aria-labelledby={title ? 'modal-title' : undefined}
    >
      <div
        ref={modalRef}
        className={`cloistr-modal ${SIZE_CLASSES[size]} ${className}`}
        onKeyDown={handleModalKeyDown}
        tabIndex={-1}
      >
        {(title || showCloseButton) && (
          <div className="cloistr-modal-header">
            {title && <h2 id="modal-title">{title}</h2>}
            {showCloseButton && (
              <button
                className="cloistr-modal-close"
                onClick={onClose}
                aria-label="Close modal"
              >
                &times;
              </button>
            )}
          </div>
        )}

        <div className="cloistr-modal-content">{children}</div>

        {footer && <div className="cloistr-modal-footer">{footer}</div>}
      </div>
    </div>
  );

  // Render into portal
  return createPortal(modalContent, document.body);
}

export interface ConfirmModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Callback when user confirms */
  onConfirm: () => void;
  /** Modal title */
  title?: string;
  /** Confirmation message */
  message: string;
  /** Confirm button text */
  confirmText?: string;
  /** Cancel button text */
  cancelText?: string;
  /** Whether confirm action is destructive (red button) */
  destructive?: boolean;
  /** Whether confirm is in progress */
  loading?: boolean;
}

/**
 * Pre-built confirmation modal
 *
 * @example
 * ```tsx
 * <ConfirmModal
 *   isOpen={showDelete}
 *   onClose={() => setShowDelete(false)}
 *   onConfirm={handleDelete}
 *   title="Delete Item"
 *   message="Are you sure you want to delete this item? This action cannot be undone."
 *   confirmText="Delete"
 *   destructive
 * />
 * ```
 */
export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirm',
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  destructive = false,
  loading = false,
}: ConfirmModalProps) {
  const handleConfirm = useCallback(() => {
    onConfirm();
  }, [onConfirm]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div className="cloistr-modal-actions">
          <button
            className="cloistr-btn cloistr-btn-secondary"
            onClick={onClose}
            disabled={loading}
          >
            {cancelText}
          </button>
          <button
            className={`cloistr-btn ${destructive ? 'cloistr-btn-danger' : 'cloistr-btn-primary'}`}
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading ? 'Loading...' : confirmText}
          </button>
        </div>
      }
    >
      <p className="cloistr-confirm-message">{message}</p>
    </Modal>
  );
}
