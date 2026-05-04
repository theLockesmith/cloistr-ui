export { Header } from './Header.js';
export type { HeaderProps } from './Header.js';

export { Footer } from './Footer.js';
export type { FooterProps, FooterLink } from './Footer.js';

export { LoginModal } from './LoginModal.js';
export type { LoginModalProps } from './LoginModal.js';

export { LoginPrompt } from './LoginPrompt.js';
export type { LoginPromptProps } from './LoginPrompt.js';

export { UserMenu } from './UserMenu.js';
export type { UserMenuProps } from './UserMenu.js';

export { SettingsModal } from './SettingsModal.js';
export type { SettingsModalProps } from './SettingsModal.js';

export { ServiceMenu, defaultServices } from './ServiceMenu.js';
export type { ServiceMenuProps, Service } from './ServiceMenu.js';

export { SharedAuthProvider, useSharedSession } from './SharedAuthProvider.js';
export type { SharedAuthProviderProps } from './SharedAuthProvider.js';

export { BackendAuthProvider, useBackendAuth } from './BackendAuthProvider.js';
export type {
  BackendAuthProviderProps,
  BackendAuthConfig,
  BackendAuthState,
  BackendAuthContextValue,
  BackendUser,
} from './BackendAuthProvider.js';

export { ToastProvider, useToast } from './Toast.js';
export type { ToastProviderProps, ToastOptions, ToastMessage, ToastVariant } from './Toast.js';

export { Spinner, LoadingOverlay, Skeleton } from './Spinner.js';
export type { SpinnerProps, SpinnerSize, SpinnerVariant, LoadingOverlayProps, SkeletonProps } from './Spinner.js';

export { Modal, ConfirmModal } from './Modal.js';
export type { ModalProps, ModalSize, ConfirmModalProps } from './Modal.js';
