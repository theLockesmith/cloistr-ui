export {
  cloistrServices,
  getServiceById,
  buildServiceUrl,
  createServicesForDomain,
} from './services.js';

export { useKeySwitcherBootstrap } from './keySwitcher.js';
export type { KeySwitcherBootstrap, SignerKey, PinState } from './keySwitcher.js';

export {
  saveSharedSession,
  getSharedSession,
  hasSharedSession,
  clearSharedSession,
  syncToSharedSession,
  isCloistrDomain,
  renewSession,
  getSessionTTL,
  setSessionTTL,
  SESSION_TTL_OPTIONS,
  SESSION_TTL_LABELS,
  getActivePubkeyCookie,
  setActivePubkeyCookie,
} from './session.js';
export type { SharedSession, SessionTTL } from './session.js';
// Note: AuthMethod type is exported from './auth' (via collab-common)

// Canonical username validation (mirrors Go cloistr-common/username; DB CHECK is authoritative).
export {
  VALID_PATTERN,
  AUTO_ASSIGNED_PATTERN,
  isValid,
  isAutoAssigned,
  isValidHumanName,
} from './username.js';

// Lightning address / invoice validation helpers.
export * from './lightning.js';

export { installDebugConsole, isDebugRequested, formatArg } from './debugConsole.js';

export {
  classifySignerError,
  isRetryableSignerError,
  withSignerRetry,
  retryDelay,
  signerFailureMessage,
  RETRYABLE_CODES,
  NEEDS_USER_CODES,
  TERMINAL_CODES,
} from './signerRetry.js';
export type { SignerFailureKind, SignerRetryOptions } from './signerRetry.js';

export { useRelayReconnect } from './useRelayReconnect.js';
export type { RelayReconnectOptions } from './useRelayReconnect.js';

// NIP-05 resolution for the shared header identity line.
export { nip05LocalPart, nip05Domain, resolveNip05, useNip05 } from './nip05.js';

// Anchoring for header overlays that must escape the header's stacking context.
export { anchorBelow, OVERLAY_GAP_PX } from './overlayAnchor.js';
export type { OverlayAnchor } from './overlayAnchor.js';
