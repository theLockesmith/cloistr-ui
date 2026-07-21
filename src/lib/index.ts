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
