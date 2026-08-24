/**
 * @cloistr/ui/testing — shared test helpers.
 *
 * Kept out of the main entry point so app bundles never pull it in.
 */
export {
  findNavAffordances,
  assertMobileNavModel,
  stubViewport,
} from './navAffordance.js';
export type { NavTrigger, NavAffordanceReport } from './navAffordance.js';
