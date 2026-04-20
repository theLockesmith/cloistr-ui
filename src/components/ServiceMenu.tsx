import { useState, useRef, useEffect } from 'react';

export interface Service {
  /** Service identifier */
  id: string;
  /** Display name */
  name: string;
  /** URL to the service */
  url: string;
  /** Optional icon (emoji or URL) */
  icon?: string;
  /** Whether this is the current service */
  active?: boolean;
}

export interface ServiceMenuProps {
  /** List of services to display */
  services: Service[];
  /** Currently active service ID */
  activeServiceId?: string;
  /** Base domain for services (e.g., 'cloistr.xyz') */
  baseDomain?: string;
}

/**
 * Default Cloistr services
 */
export const defaultServices: Service[] = [
  { id: 'home', name: 'Home', url: 'https://cloistr.xyz', icon: '🏠' },
  { id: 'relay', name: 'Relay', url: 'https://relay.cloistr.xyz', icon: '📡' },
  { id: 'files', name: 'Files', url: 'https://files.cloistr.xyz', icon: '📁' },
  { id: 'docs', name: 'Documents', url: 'https://docs.cloistr.xyz', icon: '📄' },
  { id: 'photos', name: 'Photos', url: 'https://photos.cloistr.xyz', icon: '📷' },
  { id: 'discover', name: 'Discover', url: 'https://discover.cloistr.xyz', icon: '🔍' },
];

/**
 * Service switcher dropdown menu
 */
export function ServiceMenu({
  services = defaultServices,
  activeServiceId,
  baseDomain: _baseDomain = 'cloistr.xyz',
}: ServiceMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeService = services.find(s => s.id === activeServiceId) || services[0];

  return (
    <div className="cloistr-service-menu" ref={menuRef}>
      <button
        className="cloistr-service-menu-trigger"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <span className="cloistr-service-icon">{activeService?.icon || '📱'}</span>
        <span className="cloistr-service-name">{activeService?.name || 'Services'}</span>
        <span className="cloistr-service-chevron">{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div className="cloistr-service-menu-dropdown" role="menu">
          {services.map(service => (
            <a
              key={service.id}
              href={service.url}
              className={`cloistr-service-menu-item ${service.id === activeServiceId ? 'active' : ''}`}
              role="menuitem"
              onClick={() => setIsOpen(false)}
            >
              <span className="cloistr-service-icon">{service.icon || '📱'}</span>
              <span className="cloistr-service-name">{service.name}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
