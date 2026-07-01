/**
 * Type-level contract test for the shared Header (the "smoke gate").
 *
 * Type-checked in CI (via `npm run typecheck`, which `npm run build` runs before
 * publish) but never emitted to dist. It encodes the ONE invariant that keeps the
 * nav uniform across all Cloistr apps:
 *
 *   The Header takes `activeServiceId` only. There is NO `services` prop — the
 *   service catalog lives solely in `defaultServices` inside @cloistr/ui.
 *
 * If someone re-adds a `services` prop to HeaderProps, the `@ts-expect-error`
 * below becomes unused and `tsc` fails (TS2578), blocking the publish. That is
 * the gate that makes Renovate auto-merge of this package safe.
 */
import { Header } from '../src/components/Header.js';

// Valid usage: activeServiceId is the only menu customization. Must compile.
const valid = <Header activeServiceId="docs" />;

// Also valid: no activeServiceId (renders with no active highlight).
const validNoActive = <Header />;

// @ts-expect-error — a custom `services` catalog must NOT be accepted. Passing
// one would fragment the nav across apps; the catalog is owned by @cloistr/ui.
const rejected = <Header activeServiceId="docs" services={[]} />;

// Reference the bindings so noUnusedLocals doesn't fire before @ts-expect-error.
void valid;
void validNoActive;
void rejected;
