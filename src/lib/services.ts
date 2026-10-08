import type { Service } from './service-data.js';
import { defaultServices } from './service-data.js';

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
