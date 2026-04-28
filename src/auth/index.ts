/**
 * Re-export auth from @cloistr/collab-common
 * This provides a unified auth system across all Cloistr applications.
 */
export {
  // React context and hooks
  AuthProvider,
  useNostrAuth,
  useAuthHelpers,
  // NIP-07
  connectNip07,
  detectExtension,
  isNip07Supported,
  // NIP-46
  connectNip46,
  isNip46Supported,
  isValidBunkerUrl,
  restoreNip46Session,
  hasNip46Session,
  clearNip46Session,
  // Errors
  AuthError,
  Nip07Error,
  Nip46Error,
} from '@cloistr/collab-common/auth';

export type {
  AuthState,
  SignerInterface,
  EnhancedSignerInterface,
  AuthMethod,
  AuthContextValue,
  Nip46Config,
  AuthProviderProps,
} from '@cloistr/collab-common/auth';
