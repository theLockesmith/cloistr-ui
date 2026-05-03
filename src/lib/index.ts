export {
  cloistrServices,
  getServiceById,
  buildServiceUrl,
  createServicesForDomain,
} from './services';

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
} from './session';
export type { SharedSession, SessionTTL } from './session';
// Note: AuthMethod type is exported from './auth' (via collab-common)
