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
} from './session';
export type { SharedSession } from './session';
// Note: AuthMethod type is exported from './auth' (via collab-common)
