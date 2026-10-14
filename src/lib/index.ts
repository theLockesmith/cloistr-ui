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
export {
  KEY_LOCKED,
  SIGNER_SESSION_ENDED,
  isKeyLockedError,
  probeSignerApi,
  decideAfterSignerFailure,
  wrapSignerWithReauth,
  connectWithLockedKeyRecovery,
} from './signerReauth.js';
export type { SignerApiHealth, FailureDecision, ReauthDeps } from './signerReauth.js';

export { useRelayReconnect } from './useRelayReconnect.js';
export type { RelayReconnectOptions } from './useRelayReconnect.js';

// NIP-05 resolution for the shared header identity line.
export { nip05LocalPart, nip05Domain, resolveNip05, useNip05 } from './nip05.js';

// Anchoring for header overlays that must escape the header's stacking context.
export { anchorBelow, OVERLAY_GAP_PX } from './overlayAnchor.js';
export type { OverlayAnchor } from './overlayAnchor.js';

export { shouldFireIdentityChange, useIdentityChange } from './useIdentityChange.js';
export type { IdentityChangeEvent } from './useIdentityChange.js';

export {
  createWriteGateState,
  writeGateTransition,
  useWriteGate,
} from './useWriteGate.js';
export type { WriteGateStatus, WriteGate } from './useWriteGate.js';

// "Stay signed in" (signer sealed sessions; see staySignedIn.ts)
export {
  fetchStaySignedInOptions,
  stayFieldsForLogin,
  describeGrant,
  unsealSession,
  listStaySignedIn,
  revokeAllStaySignedIn,
  touchSession,
  shouldTouchSession,
  STAY_LABELS,
  KEEPALIVE_INTERVAL_MS,
} from './staySignedIn.js';
export type { StayChoice, StayGrant, StaySignedInOptions, StaySignedInRow } from './staySignedIn.js';
export { useSessionKeepAlive } from './useSessionKeepAlive.js';

export {
  registerServiceWorker,
  browserPwaDeps,
  holdBusy,
  whileBusy,
  busyWhileRunning,
  hasBusyHolders,
  hasUnsavedInput,
  FRESH_LOAD_WINDOW_MS,
  UPDATE_CHECK_INTERVAL_MS,
} from './pwaUpdate.js';
export type { PwaDeps, InputScanRoot } from './pwaUpdate.js';
