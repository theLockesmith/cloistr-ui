import type { Service } from '../components/ServiceMenu.js';

/**
 * Default Cloistr services configuration
 */
export const cloistrServices: Service[] = [
  {
    id: 'home',
    name: 'Home',
    url: 'https://cloistr.xyz',
    icon: '🏠',
  },
  {
    id: 'relay',
    name: 'Relay',
    url: 'https://relay.cloistr.xyz',
    icon: '📡',
  },
  {
    id: 'files',
    name: 'Files',
    url: 'https://files.cloistr.xyz',
    icon: '📁',
  },
  {
    id: 'docs',
    name: 'Documents',
    url: 'https://docs.cloistr.xyz',
    icon: '📄',
  },
  {
    id: 'photos',
    name: 'Photos',
    url: 'https://photos.cloistr.xyz',
    icon: '📷',
  },
  {
    id: 'discover',
    name: 'Discover',
    url: 'https://discover.cloistr.xyz',
    icon: '🔍',
  },
  {
    id: 'identity',
    name: 'Identity',
    url: 'https://me.cloistr.xyz',
    icon: '🪪',
  },
];

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
