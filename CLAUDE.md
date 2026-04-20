# CLAUDE.md - Cloistr UI

**Shared React UI component library for all Cloistr applications.**

## Project Information

- **Company:** Coldforge (Cloistr brand)
- **Type:** React Component Library
- **Purpose:** Unified header, footer, auth, and navigation across all Cloistr web apps

**Global Rules:** See [global CLAUDE.md](../../arbiter/CLAUDE.md)

## Overview

This package provides:
- **AuthProvider** - React context for NIP-07/NIP-46 authentication
- **Header** - Unified header with logo, service menu, auth
- **Footer** - Standard footer with copyright and links
- **LoginModal** - NIP-07 (browser extension) and NIP-46 (bunker) login
- **ServiceMenu** - Dropdown to switch between Cloistr services
- **UserMenu** - Authenticated user dropdown

## Usage

```tsx
import { AuthProvider, Header, Footer } from '@cloistr/ui';
import '@cloistr/ui/styles';

function App() {
  return (
    <AuthProvider>
      <Header activeServiceId="files" />
      <main>{/* Your app content */}</main>
      <Footer />
    </AuthProvider>
  );
}
```

## Auth Hooks

```tsx
import { useAuth, useSigner, usePubkey, useIsConnected } from '@cloistr/ui';

function MyComponent() {
  const { state, connectNip07, connectNip46, disconnect } = useAuth();
  const signer = useSigner();
  const pubkey = usePubkey();
  const isConnected = useIsConnected();

  // Use signer to sign events
  if (signer) {
    const event = await signer.signEvent(unsignedEvent);
  }
}
```

## Customization

### Custom Services

```tsx
import { Header, Service } from '@cloistr/ui';

const myServices: Service[] = [
  { id: 'app1', name: 'My App', url: 'https://app1.example.com', icon: '📱' },
  { id: 'app2', name: 'Another', url: 'https://app2.example.com', icon: '🔧' },
];

<Header services={myServices} activeServiceId="app1" />
```

### Self-Hosted Domain

```tsx
import { createServicesForDomain } from '@cloistr/ui';

const services = createServicesForDomain('my-domain.com');
```

## File Structure

```
src/
├── auth/
│   ├── types.ts        # SignerInterface, AuthState
│   ├── nip07.ts        # Browser extension signer
│   ├── nip46.ts        # Bunker signer
│   ├── context.tsx     # AuthProvider, useAuth hooks
│   └── index.ts
├── components/
│   ├── Header.tsx
│   ├── Footer.tsx
│   ├── LoginModal.tsx
│   ├── UserMenu.tsx
│   ├── ServiceMenu.tsx
│   └── index.ts
├── lib/
│   ├── services.ts     # Service configuration
│   └── index.ts
├── styles/
│   ├── variables.css   # Design tokens
│   ├── components.css  # Component styles
│   └── index.css
└── index.ts
```

## Build

```bash
npm install
npm run build    # TypeScript compile + copy styles
npm run dev      # Watch mode
```

## Integration

All Cloistr web apps should:
1. Add `@cloistr/ui` as dependency
2. Wrap app in `<AuthProvider>`
3. Use `<Header>` and `<Footer>` components
4. Import `@cloistr/ui/styles`

---

**Last Updated:** 2026-04-20
