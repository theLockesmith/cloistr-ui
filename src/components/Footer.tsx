import React from 'react';

export interface FooterLink {
  /** Link text */
  label: string;
  /** Link URL */
  href: string;
  /** Open in new tab */
  external?: boolean;
}

export interface FooterProps {
  /** Copyright holder name */
  copyrightHolder?: string;
  /** Starting year for copyright */
  copyrightYear?: number;
  /** Links to show in footer */
  links?: FooterLink[];
  /** Additional footer content */
  children?: React.ReactNode;
}

const defaultLinks: FooterLink[] = [
  { label: 'Privacy', href: 'https://cloistr.xyz/privacy' },
  { label: 'Terms', href: 'https://cloistr.xyz/terms' },
  { label: 'Source', href: 'https://git.aegis-hq.xyz/coldforge', external: true },
];

/**
 * Shared footer component
 */
export function Footer({
  copyrightHolder = 'Cloistr',
  copyrightYear = 2026,
  links = defaultLinks,
  children,
}: FooterProps) {
  const currentYear = new Date().getFullYear();
  const yearDisplay = copyrightYear === currentYear
    ? String(currentYear)
    : `${copyrightYear}–${currentYear}`;

  return (
    <footer className="cloistr-footer">
      <div className="cloistr-footer-content">
        <div className="cloistr-footer-copyright">
          © {yearDisplay} {copyrightHolder}
        </div>

        {links.length > 0 && (
          <nav className="cloistr-footer-links">
            {links.map(link => (
              <a
                key={link.href}
                href={link.href}
                className="cloistr-footer-link"
                {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              >
                {link.label}
              </a>
            ))}
          </nav>
        )}

        {children && <div className="cloistr-footer-extra">{children}</div>}
      </div>
    </footer>
  );
}
