export { Button, buttonClasses } from './Button.js';
export type { ButtonProps, ButtonVariant } from './Button.js';

export { Toggle, toggleClasses } from './Toggle.js';
export type { ToggleProps } from './Toggle.js';

export { Header } from './Header.js';
export type { HeaderProps } from './Header.js';

export { Footer } from './Footer.js';
export type { FooterProps, FooterLink } from './Footer.js';

export { LoginModal } from './LoginModal.js';
export type { LoginModalProps, SessionData } from './LoginModal.js';

export { LoginPrompt } from './LoginPrompt.js';
export type { LoginPromptProps } from './LoginPrompt.js';

export { UserMenu } from './UserMenu.js';
export type { UserMenuProps } from './UserMenu.js';

export { SettingsModal } from './SettingsModal.js';
export type { SettingsModalProps } from './SettingsModal.js';

export { ServiceMenu, defaultServices } from './ServiceMenu.js';
export type { ServiceMenuProps, Service } from './ServiceMenu.js';

export { SharedAuthProvider, useSharedSession, useSharedSessionMaybe } from './SharedAuthProvider.js';
export type { SharedAuthProviderProps } from './SharedAuthProvider.js';

export { BackendAuthProvider, useBackendAuth } from './BackendAuthProvider.js';
export { AuthRestoreGate } from './AuthRestoreGate.js';
export { Sidebar, SidebarToggle } from './Sidebar.js';
export { SignerRecovery } from './SignerRecovery.js';
export type { SignerRecoveryProps } from './SignerRecovery.js';
export { SignerReauthPrompt, SIGNER_REAUTH_TITLE } from './SignerReauthPrompt.js';
export type { SignerReauthPromptProps } from './SignerReauthPrompt.js';
export type { SidebarProps, SidebarItem } from './Sidebar.js';
export type { AuthRestoreGateProps } from './AuthRestoreGate.js';
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

export { ThemeProvider, useTheme, useThemeOptional } from './ThemeProvider.js';
export type { ThemeProviderProps, ThemeContextValue, ThemeMode } from './ThemeProvider.js';
/** @deprecated ThemeToggle is no longer a public API. Use the theme control
 * inside ServiceMenu instead. This re-export will be removed in the next major. */
export { ThemeToggle } from './ThemeToggle.js';
export type { ThemeToggleProps } from './ThemeToggle.js';

export { NotificationProvider, useNotifications } from './NotificationProvider.js';
export type { NotificationProviderProps, NotificationState } from './NotificationProvider.js';
export { NotificationBell } from './NotificationBell.js';

export { AppShell, AppShellToggle, toggleExpanded, appShellChrome, menuItemState, isSeparator, nextMenuIndex, useIsMobile, APPSHELL_BREAKPOINT } from './AppShell.js';
export type { AppShellProps, MenuSection, MenuItem, MenuEntry, MenuSeparator } from './AppShell.js';

export { classifyRestoreOutcome, shouldGateRestore } from './SharedAuthProvider.js';
export type { RestoreOutcome } from './SharedAuthProvider.js';

export {
  ContextMenu,
  useContextMenu,
  useContextMenuTrigger,
  contextMenuClasses,
  contextMenuItemClasses,
  clampToViewport,
} from './ContextMenu.js';
export type {
  ContextMenuEntry,
  ContextMenuPosition,
  ContextMenuProps,
  UseContextMenuReturn,
  ContextMenuTriggerOptions,
  ContextMenuTriggerHandlers,
} from './ContextMenu.js';
export { StaySignedInManager } from './StaySignedInManager.js';
export type { StaySignedInManagerProps } from './StaySignedInManager.js';
