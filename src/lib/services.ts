import type { Service } from '../components/ServiceMenu.js';
import { defaultServices } from '../components/ServiceMenu.js';

/**
 * Canonical Cloistr services list. The single source of truth is
 * `defaultServices` in ServiceMenu (the list the app-switcher renders); this is
 * a re-export so lib consumers and the grid can never drift. They HAD drifted —
 * this list used to still show Relay/Photos, point Files at the wrong host, use
 * emoji icons, and omit Tasks/Vault/Space/Sheets/Slides/Whiteboard/Email.
 * Icons are supplied by ServiceMenu's SVG glyph set, keyed by service id.
 */
export const cloistrServices: Service[] = defaultServices;

/**
 * Get a service by ID
 */
export function getServiceById(id: string): Service | undefined {
  return cloistrServices.find(s => s.id === id);
}

/**
 * Build service URL for a custom domain
 * Useful for self-hosted instances
 */
export function buildServiceUrl(
  serviceId: string,
  baseDomain: string,
  useSubdomains: boolean = true
): string {
  const service = getServiceById(serviceId);
  if (!service) return `https://${baseDomain}`;

  if (useSubdomains) {
    // e.g., files.example.com
    return `https://${serviceId}.${baseDomain}`;
  } else {
    // e.g., example.com/files
    return `https://${baseDomain}/${serviceId}`;
  }
}

/**
 * Create services array for a custom domain
 */
export function createServicesForDomain(
  baseDomain: string,
  useSubdomains: boolean = true
): Service[] {
  return cloistrServices.map(service => ({
    ...service,
    url: buildServiceUrl(service.id, baseDomain, useSubdomains),
  }));
}
