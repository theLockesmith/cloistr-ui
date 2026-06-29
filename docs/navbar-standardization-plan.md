# Cloistr Shared Navbar — Standardization Plan

**Status:** Ready to execute (audited 2026-06-29). Goal: every Cloistr app's top navbar looks/behaves
identically, driven by the shared `@cloistr/ui` `Header`. ~5–6h across the library + 13+ app repos.

## Current state
The shared `Header` (`cloistr-ui/src/components/Header.tsx`, props: `logo`/`logoHref`/`services`/
`signerUrl` + `activeServiceId`, pairs with `SharedAuthProvider`) is **already used by 13 apps**:
sanctuary, discovery-ui, docs, me-ui, photos, sheets, slides, space, whiteboard, workspace,
email (`ui/`), tasks (`frontend/`), stash (`web/`). Outliers: **signer** (custom header), **vault**
(no @cloistr/ui — different product/auth), **relay** (no React frontend).

`@cloistr/ui` current = **0.4.5**. `defaultServices` (8) is missing `identity` + `relay`, and there's
no default `signerUrl`. sanctuary is the only app passing its own inline `services` array.

## Execution (release-driven — Wave 1 is the keystone)

| Wave | Work | Effort |
|---|---|---|
| **1** | **`@cloistr/ui` library:** rewrite `defaultServices` to the canonical 10 (add `identity`→me, `relay`; keep home/space/docs/sheets/whiteboard/slides/files/discover); add a default `signerUrl='https://signer.cloistr.xyz'` param to `Header` (flows to `LoginModal`). **Cut & publish 0.5.0** to the @cloistr npm registry. | 1h |
| **2** | Bump all consumers to `^0.5.0` (stale `^0.3.0`: sanctuary, discovery-ui, me-ui, sheets; `^0.4.4`: space, workspace, email, tasks), `pnpm install`. Fix `me-ui` `activeServiceId` `"me"`→`"identity"`. | 1h |
| **3** | **Migrate signer to the shared `Header`** (`cloistr-signer/ui/src/components/Layout.tsx`): replace the bespoke `<header class="signer-header">`; fix bare `@cloistr/ui` import → `/components`; add `signer` to `defaultServices`; keep `SignerLoginModal` (backend auth, not Nostr). | 2h |
| **4** | **sanctuary** (`src/App.tsx`): drop `services={cloistrServices}` + the const; add `activeServiceId="home"`. Now uses the full `defaultServices` like everyone else. | 15m |
| **5** | Migrate `file:` dev-link deps → `^0.5.0`: docs, slides, whiteboard, signer (CI safety). | 30m |
| **6** | Cleanups: delete dead `cloistr-photos/src/components/Header.tsx`; remove duplicate `@cloistr/ui/styles` import in `cloistr-discovery-ui/src/index.tsx`; decide space's local sub-header (notifications bar) → shared `Header` children slot or rename to `SubHeader`. | 15m |
| **7** | Add `email`/`workspace`/`tasks`/`photos` to `defaultServices` once their public domains are confirmed; set their `activeServiceId` to the new ids. | 30m |

## Decisions baked in
- **Centralize the service catalog:** apps should NOT pass their own `services` prop — only
  `activeServiceId`. `defaultServices` in `@cloistr/ui` is the single source of truth. Adding a service
  becomes a one-commit library change, not an N-app edit. (sanctuary is the only current offender.)
- **`signerUrl` as a library default**, not 13 per-app props.
- **vault** = separate product call (password manager, non-Nostr auth) — not in this effort unless
  product wants the visual unification.

## Notes / gotchas
- No app has CSS overriding the shared header's namespaced classes (the stray `.header` rules in
  discovery-ui/me-ui/photos target unrelated DOM). So no CSS conflicts to untangle.
- Each app deploys via GitLab CI → ArgoCD (per cloistr CLAUDE.md); after bumps, push and let CI build/
  ArgoCD sync. Don't hand-build/push images.
- Verify each app's navbar renders the full 10-item menu + correct active highlight after its bump.
