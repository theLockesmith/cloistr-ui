# Common Tools Governance — Cloistr Frontend

**Path:** `cloistr-ui/docs/common-tools-governance.md`
**Audience:** Engineers building Cloistr frontend apps

---

## TL;DR — Five Governing Principles

1. **The service catalog lives in one place.** `defaultServices` in `@cloistr/ui` is the single source of truth for the nav menu. Apps pass `activeServiceId` only. This is enforced by the type system, not by convention.
2. **Version uniformity is a bot's job.** Renovate opens MRs, CI gates auto-merge. Engineers should never hand-bump `@cloistr/*` versions.
3. **Build correctness is inherited, not configured.** Every app `include:`s the shared CI template. Infra drift (runner tags, registry maps, pnpm pin) cannot happen if the template is the only source.
4. **The Header renders outside every auth gate.** Users see navigation before they log in. Any exception requires a documented, reviewed rationale.
5. **New apps start from the scaffold.** `create-cloistr-app` produces a repo that satisfies the full checklist on day zero.

---

## 1. Problem Statement and Drift Taxonomy

The "standardize the navbar" push revealed four distinct failure modes. Each requires a different governance mechanism.

| Drift type | Symptom observed | Root cause | Governing fix |
|---|---|---|---|
| **Version drift** | 14 repos on `^0.3.0 / ^0.4.4 / file: / ^0.5.x`; hand-bumped 4x | No automated update mechanism | Renovate (section 3) |
| **Consumption drift** | Same version, different usage — `sanctuary` passed own `services` array; `signer` had a bespoke header; `space/tasks/email` hid the header behind auth | No enforcement of the correct API surface | Typed wrapper + ESLint rule (section 4a) |
| **Integration drift** | Legitimate per-app differences — `email` needs `BackendAuthProvider` / JWT; `signer` uses `go:embed` to bake the UI into the binary | Missing documentation of valid exceptions | Documented exception registry (section 2.4) |
| **Build/infra drift** | Jobs ran on wrong runner (untagged then flaky k8s runner); Docker Hub pulls instead of Harbor; `pnpm@latest` broke builds | No shared CI source of truth | Shared CI template (section 3.3) |

The "standardize" effort fixed symptoms. This document fixes the systems that allow the symptoms to recur.

---

## 2. New-App Onboarding — Definition of a Cloistr Frontend App

### 2.1 The Checklist

Every Cloistr frontend repo must satisfy all items before its first production deployment. The scaffold (section 2.5) produces a passing repo on day zero.

**Identity and Registry**
- [ ] Repo is in the `coldforge` GitLab group, named `cloistr-<service>-ui` (web UI) or `cloistr-<service>` (Go backend with embedded UI)
- [ ] Repo is **public** (AGPL-3.0; "Freedom as a Service" starts with the code)
- [ ] `.npmrc` resolves `@cloistr/*` from the GitLab group-level npm registry (groups/9); CI auth via `${CI_JOB_TOKEN}`
- [ ] `package.json` specifies `"packageManager": "pnpm@10.29.3"` — no floating version

**Dependencies**
- [ ] `@cloistr/ui` and `@cloistr/collab-common` on the **current stable major**
- [ ] `react` / `react-dom` match `@cloistr/ui`'s `peerDependencies`
- [ ] Renovate onboarded (autodiscovered by the runner filter `coldforge/cloistr-*`)

**Header Usage**
- [ ] `Header` imported from `@cloistr/ui`, not re-implemented
- [ ] `Header` receives `activeServiceId` only — no `services` prop
- [ ] `Header` rendered **outside** the authentication gate so logged-out users see navigation
- [ ] Any documented exception recorded in `docs/integration-exceptions.md` AND section 2.4 here

**CI / Build**
- [ ] `.gitlab-ci.yml` includes the shared template (`coldforge/ci-templates` → `/templates/kaniko-build.yml`)
- [ ] Build job `extends: .kaniko-build` — does not redefine `tags`, registry flags, or pnpm version
- [ ] GitLab project has runner 29 (`localhost-docker`, tag `local`) enabled under Settings → CI/CD → Runners
- [ ] ArgoCD Image Updater annotation present in the app's cloistr-config overlay

**Observability**
- [ ] Backend (if any) exposes `/metrics` and `/healthz`
- [ ] Frontend served with SPA-appropriate `Cache-Control` (immutable hashed assets, `no-cache` on `index.html`)

### 2.2 Standalone SPA vs Go-embedded UI

| Shape | Example | Header requirement | CI image |
|---|---|---|---|
| **Standalone SPA** | `cloistr-me-ui`, `sanctuary`, `docs`, `sheets` | Header outside auth gate | Nginx container serving `dist/` |
| **Go-embedded UI** | `signer` | Header outside auth gate; `go:embed` bakes the `dist/`; JS must not assume a separate API host | Go binary container; UI is a build artifact, not a separate image |

For Go-embedded UIs the `dist/` is produced by a Vite build step in the same pipeline before `go build`; the binary is the sole deployable.

### 2.3 TypeScript and Tooling Baseline

All apps SHOULD inherit tooling from shared base packages (section 5.4). Target state:

| Tool | Config source | Override policy |
|---|---|---|
| TypeScript | `@cloistr/tsconfig` base | Extend, never relax `strict` |
| ESLint | `@cloistr/eslint-config` | Add rules, never remove |
| Prettier | `@cloistr/prettier-config` | No project-level overrides |
| pnpm | 10.29.3 (pinned in `packageManager`) | Bumped centrally only |
| Vite | `@cloistr/vite-config` base | Extend; don't change target/output path |

Projects still on CRA (notably `tasks`) migrate to Vite before new feature work. CRA is not a target.

### 2.4 Documented Integration Exceptions (canonical registry)

| App | Exception | Rationale |
|---|---|---|
| `cloistr-email` | Uses `BackendAuthProvider` (JWT) alongside NIP-07/46; Header takes the backend-auth prop | Email needs a server-side session for IMAP/SMTP; "dumb auth" backend contract (RFC-004) |
| `cloistr-signer` | UI embedded in the Go binary via `go:embed`; deploying the signer redeploys the UI | The signer IS the key daemon; single-binary prevents config mismatch |

Any deviation not in this table is a bug, not a design decision.

### 2.5 The Scaffold: `create-cloistr-app`

A `coldforge/create-cloistr-app` GitLab **project template** (served via GitLab "Create from template") is the only permitted starting point for new apps. It ships: correct `package.json` (`packageManager`, `@cloistr/*` current), `.npmrc`, `.gitlab-ci.yml` (include + `extends: .kaniko-build`), `src/App.tsx` with `activeServiceId`-only Header usage (the `services` prop does not appear anywhere to copy), `tsconfig`/eslint/prettier extending the shared configs, `renovate.json` extending the shared preset, an empty `docs/integration-exceptions.md`, and a `CLAUDE.md` pointing at this doc. When policy changes, the scaffold changes first.

---

## 3. Staying Current — The Automated Update Pipeline

### 3.1 Release/Publish Flow for `@cloistr/ui`

```
PR merged to main
  → CI runs unit tests + behavioral smoke test (section 4d)
  → pnpm version <patch|minor|major> + pnpm publish to the GitLab registry
  → git tag vX.Y.Z
  → Renovate detects the new version (next scheduled run)
  → Renovate opens MRs across all consumer repos
  → each app's CI runs; auto-merge fires on green for patch/minor
```

Publishing is manual today (Maintainer on project 59). Tag-on-merge automation is a Phase 2 improvement. The smoke test is the gate, not a person.

### 3.2 Renovate Policy (actual preset: `coldforge/ci-templates` → `/renovate/base.json`)

- **`@cloistr/*` patch/minor: auto-merge on green**, "at any time" (not batched) — this is how every app tracks the latest shared implementation with no hand-bump. Consume via `{ "extends": ["local>coldforge/ci-templates//renovate/base"] }`.
- **`@cloistr/*` major: never auto-merge** (labelled `breaking`/`needs-migration`) — a major is a coordinated migration (3.4).
- **pnpm: reviewable PR only, `rangeStrategy: pin`** — floating `pnpm@latest` broke builds (10.30 regression).
- **Third-party majors: dashboard-gated, manual** — no silent React/Vite/TS major across 25 repos.
- **Dockerfile digests: auto-merge.**
- **Dependency Dashboard on** — the single "who's on what" view.

The runner is a scheduled pipeline in `coldforge/ci-templates` (`.gitlab-ci.yml`, `renovate` job, `tags:[local]`) that autodiscovers `coldforge/cloistr-*`. It needs a masked `RENOVATE_TOKEN` (bot PAT) — an operator action — and a pipeline schedule.

### 3.3 Shared CI Template (`coldforge/ci-templates` → `/templates/kaniko-build.yml`)

Every app's CI is one `include:` + one `extends: .kaniko-build`. The template OWNS (apps cannot override without changing the template): `tags:[local]` (runner 29), the kaniko `--registry-map` Harbor rewrites, Harbor + CI-registry auth, and pushing both `:$CI_COMMIT_SHORT_SHA` and `:latest`. Apps configure only which Dockerfile (`KANIKO_DOCKERFILE_SUBPATH` / `KANIKO_CONTEXT_SUBDIR`) and their own rules. Runner-tag/registry/pnpm are not app-level knobs.

### 3.4 Breaking Changes in Shared Libraries

**Default: additive and back-compatible.** Add the new surface in a minor, `@deprecated` the old, let Renovate fan the minor out, apps migrate at their pace, remove the deprecated surface a couple minors later.

**When a major is unavoidable:** (1) tracking issue + migration guide; (2) publish `vN.0.0-rc.1` under a `next` dist-tag (Renovate ignores pre-releases); (3) run the cross-app audit (4b) against the RC; (4) write a codemod under `codemods/`; (5) apply it across repos in a coordinated batch; (6) publish `vN.0.0` only after ≥3 apps are green in prod; (7) Renovate opens the (non-auto) majors for the rest. This bounds blast radius — the RC catches API problems before 25 apps are blocked.

---

## 4. Uniformity Validation — Proving, Not Assuming

Version alignment is necessary but not sufficient — apps can be on the same version and still render wrong. Build these in order.

### 4a. Typed API Wrapper — "Uniform by Construction" (build FIRST)

Highest-leverage single change. Make `HeaderProps` expose `activeServiceId` only; do **not** export `defaultServices`. Passing a custom `services` array becomes a compile error, not a review comment.

```ts
export interface HeaderProps {
  activeServiceId: string;
  // no 'services' prop — defaultServices is module-private
}
```

Ship a `no-restricted-imports` rule in `@cloistr/eslint-config` banning `@cloistr/ui/internal*`. Inherited by all apps, zero per-app config. **~1 day. Eliminates the `services` consumption drift entirely.**

### 4b. Cross-App Behavioral Audit (build SECOND)

A scheduled Playwright pipeline (reusing the existing site-tester pattern) loads every live app **unauthenticated** and asserts: header present; service links match `defaultServices`; the active link carries the active indicator; wordmark present; service count matches expected. Runs daily; posts drift to a Loki stream (`{from="cloistr-audit"}`) + a Grafana panel + a GitLab issue tagging the offending app. Catches consumption drift that version checks cannot. **~2–3 days.**

### 4c. Renovate Dependency Dashboard (FREE)

The single view of version state across all repos. Governance rule: zero open `@cloistr/*` MRs at sprint start; a stalled MR (red CI / conflict) is a blocker, not noise.

### 4d. CI Smoke Gate on the Shared Lib (build THIRD)

Before any `@cloistr/ui` publish, a behavioral smoke suite (`smoke/`) must pass: header renders; `activeServiceId` highlights correctly; a `tsc --noEmit` fixture proving the `services` prop is rejected; header visible logged-out. Publish is blocked on failure. **This is the gate that makes auto-merge safe. ~1–2 days.**

### 4e. Build Priority

| Priority | Mechanism | Prevents | Effort |
|---|---|---|---|
| 1 | Typed `HeaderProps` (no `services`) | Consumption drift (structural) | 1 day |
| 2 | CI smoke gate on `@cloistr/ui` | Bad releases fanning out via Renovate | 1–2 days |
| 3 | Cross-app behavioral audit | Consumption + integration drift (runtime) | 2–3 days |
| 4 | Renovate Dependency Dashboard | Version drift visibility | 0 (built-in) |

---

## 5. Cross-Platform Standards — React, React Native, Tauri

### 5.1 The Web App Is the Source of Truth
Cloistr is web-first. The web app is the canonical implementation of every feature; all other surfaces are secondary derivatives. Feature work lands in web first, always. Shared components live in `@cloistr/ui` as React DOM components.

### 5.2 Tauri — Desktop Is a Thin Shell
The Tauri desktop wrapper (`coldforge/cloistr-desktop`) is a shell over the web app, chosen over Electron for smaller binaries / Rust / potato-grade design. It adds native window chrome, OS notifications, native FS import/export, and single-binary distribution — via `window.__TAURI__` from the web app. It does **not** render its own UI components, import `@cloistr/ui` directly, or fork any business logic. Dev loads the Vite dev server; prod bundles the web app's `dist/`. Desktop releases are version-locked to the web release (same commit). The scaffold offers a `--tauri` variant.

### 5.3 React Native — Deprecated, Mobile Deferred
RN was used in `cloistr-hub` (archived). It is in no active app. **Mobile is deferred, not abandoned.** When revisited:
- **Preferred — PWA + Tauri Mobile:** Tauri 2.x builds iOS/Android with the same shell pattern; the web app becomes an installable PWA. No separate UI codebase.
- **Escalation only if native UX is required** (camera/biometrics/NFC tap-to-sign): a `@cloistr/ui-rn` package sharing tokens/logic from `@cloistr/collab-common` but with RN-native components. This is a standing two-library maintenance cost — do not start it without a documented feature requirement.

**Consequence for `@cloistr/ui`:** it stays DOM-only. No `Platform.OS`, `StyleSheet.create`, or RN primitives. A component that needs RN does not belong in `@cloistr/ui`.

### 5.4 TypeScript Everywhere + Shared Tooling Packages
Every frontend and every shared package is TypeScript; no `allowJs` in any `@cloistr/*` package. Target shared tooling packages (published to the same registry, Renovate-managed):

| Package | Contents |
|---|---|
| `@cloistr/tsconfig` | base `tsconfig` with `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` |
| `@cloistr/eslint-config` | `@typescript-eslint` type-checked rules, the `no-restricted-imports` rule (4a), import order |
| `@cloistr/prettier-config` | Prettier config (no project overrides) |
| `@cloistr/vite-config` | base Vite config (targets, chunking, sourcemaps) |

No `strict: false`; no `any` in new code.

---

## 6. The `@cloistr/ui` Component Contract

### 6.1 Header
```tsx
import { Header } from '@cloistr/ui';
<Header activeServiceId="docs" />          // correct
<Header activeServiceId="docs" services={[...]} /> // must NOT compile
<Header />                                  // must NOT compile (no activeServiceId)
```
`activeServiceId` values are the `defaultServices` keys (v0.5.x: `signer, relay, discovery, files, search, photos, docs, sheets, slides, whiteboard, space, tasks, email, stash, calendar, vault, chat`). An unknown value renders with no active highlight (does not throw). **Placement rule:** `<Header/>` is the first element in the app root — never inside a route guard, auth check, `Suspense`, or conditional.

### 6.2 BackendAuthProvider (email)
```tsx
function App() {
  return (
    <>
      <Header activeServiceId="email" />     {/* outside the auth gate */}
      <BackendAuthProvider>
        <EmailApp />                          {/* inside the auth gate */}
      </BackendAuthProvider>
    </>
  );
}
```

### 6.3 Adding a Service to the Catalog
PR to `@cloistr/ui` adding the `defaultServices` entry → minor bump → Renovate fans it out within a scheduled run → every app's nav gains the service with no per-app PR. That automatic propagation is the whole payoff of the centralized catalog.

---

## 7. Governance Process — Who Does What

| Role | Responsibility |
|---|---|
| `@cloistr/ui` maintainer | Reviews/merges shared-lib PRs; publishes releases; writes codemods for majors |
| App engineers | Consume shared packages; merge Renovate MRs; never fork the shared lib |
| Any engineer | May PR the scaffold or add a `defaultServices` entry |

No approval committee: shared-package PRs need one non-author review; the smoke-test CI gate is the real quality control.

**Where does a change go?** Header bug / new nav service / shared design token → `@cloistr/ui`. Shared Nostr helper → `@cloistr/collab-common`. App-specific auth or layout → the app (+ exception doc if it deviates).

**Renovate MR discipline:** `@cloistr/*` MRs don't sit open >1 week; fix red CI / rebase conflicts. Auto-merged MRs need no post-merge review.

---

## 8. Phased Rollout

**Phase 0 — done in the navbar push:** all apps on a consistent `@cloistr/ui`; sanctuary → `activeServiceId` only; signer bespoke header removed; space/tasks/email header moved outside the auth gate (email login-screen navbar shipped + verified); pnpm pinned 10.29.3; runner 29 enabled + `tags:[local]` across the fleet; shared CI template + Renovate preset/runner created (this doc's companion artifacts).

**Phase 1 — enforcement (Sprint +1, ~1 wk):** remove `services` from `HeaderProps` + add the `no-restricted-imports` rule → publish patches → Renovate fans out; write the `@cloistr/ui` smoke suite; create `create-cloistr-app`. *Exit:* `tsc` fails in any app passing `services`; scaffold exists. Also: finish onboarding all repos onto the shared CI template + Renovate, and set the runner's `RENOVATE_TOKEN` + pipeline schedule.

**Phase 2 — visibility (Sprint +2, ~1 wk):** cross-app Playwright audit (daily 06:00) → Grafana panel; publish `@cloistr/tsconfig|eslint-config|prettier-config|vite-config` as first-class packages; migrate CRA (`tasks`) to Vite. *Exit:* Grafana shows daily header-conformance for all live apps; no CRA left.

**Phase 3 — hardening (Sprint +3–4):** MR template with the §2.1 checklist; approval rule blocking feature MRs when a `breaking` Renovate MR is >2 wks stale; document the Tauri shell template; exercise the breaking-change process once with an RC. *Exit:* patch release runs end-to-end (PR→publish→Renovate→auto-merge) with no manual step; breaking-change process exercised once.

---

## 9. Anti-Patterns (prohibited — these caused the drift)

| Anti-pattern | Instead |
|---|---|
| `<Header services={[...]} />` | `activeServiceId` only |
| `<Header>` inside an auth check | render at top level, outside any gate |
| bespoke navbar | use `@cloistr/ui` Header; PR features into it |
| `pnpm@latest` in CI | pin `packageManager`; template handles it |
| Docker Hub pulls in Dockerfile | Harbor pullthrough / kaniko `--registry-map` |
| hand-bumping `@cloistr/*` | let Renovate open the MR |
| `file:` dep on `@cloistr/ui` | publish + consume from the registry |
| `react-native` deps in `@cloistr/ui` | keep it DOM-only |
| `strict: false` | inherit `strict` from `@cloistr/tsconfig` |
| per-app Renovate disabling `@cloistr/*` automerge | extend the central preset; no automerge override |

---

## 10. Summary Reference Card

```
CLOISTR FRONTEND APP — REQUIRED
Registry:   .npmrc → @cloistr from GitLab group-level registry (groups/9)
Deps:       @cloistr/* on current stable (Renovate manages bumps)
pnpm:       "packageManager": "pnpm@10.29.3"
Header:     <Header activeServiceId="<id>" /> — no services prop, outside auth gate
CI:         include coldforge/ci-templates /templates/kaniko-build.yml + extends: .kaniko-build
Runner:     Settings → CI/CD → enable runner 29 (localhost-docker, tag: local)
TypeScript: extend @cloistr/tsconfig; strict; no allowJs
Renovate:   autodiscovered as coldforge/cloistr-*; extends renovate/base
Scaffold:   start from coldforge/create-cloistr-app — not from scratch
Exceptions: document in docs/integration-exceptions.md and update this file
```

**Document owner:** `@cloistr/ui` maintainer · **Source of truth:** this file — if reality disagrees, this doc wins and reality gets a PR.
