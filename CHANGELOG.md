# Changelog

## 0.50.8

- Fix: `wrapSignerWithReauth` now forwards `sendRequest` when the wrapped signer has one, through the same recovery path as every other call. It was dropped since 0.47.0, so custom NIP-46 methods (Space's `cloistr_ecdh_tag`, which finds thread key hand-offs) silently never ran and Threads showed "No threads yet" for every shared-sign-in user.

## 0.48.0

- "Stay signed in" (needs cloistr-signer's stay-signed-in release; on a signer without it nothing changes). The sign-in form offers the durations the signer allows (this session only by default, 1 day, 30 days, until I sign out) and, where offered, "only this browser can keep me signed in" (split mode). After sign-in it says what was actually granted, including when that is shorter than asked.
- Split mode: the browser's half of the seal is an HttpOnly cookie the signer sets on its own unseal path; no script reads or stores it. On a locked key the client unseals first, then the one silent retry, then the prompt.
- `StaySignedInManager`: lists where the user stays signed in and revokes them all.
- `SharedAuthProvider` keeps a sliding "until I sign out" session alive in an open tab (`/users/me`, at most hourly).
- New exports: `fetchStaySignedInOptions`, `stayFieldsForLogin`, `describeGrant`, `unsealSession`, `listStaySignedIn`, `revokeAllStaySignedIn`, `touchSession`, `useSessionKeepAlive`, `STAY_LABELS`.

## 0.47.1

- Fix: deploy recovery now also covers sessions opened through the sign-in form. 0.47.0 attached it only to sessions restored on page load, so a user who signed in and kept working got a bare timeout after the next signer deploy. The provider now adopts a form-opened NIP-46 session once it confirms the key is in the user's Cloistr signer account (a session with the user's own bunker is never adopted, even for a key also imported into Cloistr: an identity with a `bunkerUrl`, or a bunker address remembered by `@cloistr/auth`, is left alone).

## 0.47.0

- Signer session recovery after a signer deploy (operator ruling 2026-10-12). When the signer is healthy but no replica holds the user's key (409 `key_locked`, or an unanswered NIP-46 request while the signer API answers), apps retry once silently and only then show "Your signer session needs you to sign in again". After signing in, the original request completes; the app stays mounted and open work is kept. An unreachable signer is unchanged: the "try again" screen, never a credential prompt.
- New exports: `SignerReauthPrompt`, `wrapSignerWithReauth`, `probeSignerApi`, `decideAfterSignerFailure`, `connectWithLockedKeyRecovery`, `SIGNER_SESSION_ENDED`.
- A relay outage never prompts: the prompt appears only when the signer answers `key_locked` or the session has ended (401). A silent retry that times out keeps the "try again" screen. A session displaced by a newer one (the signer keeps one live grant per key) recovers silently on its next request.
- `SharedAuthProvider` apps get this with no code change. Proved live against two real signer restarts (20/20 browser checks).

## 0.46.0

- Identity-change event: `useIdentityChange(callback)` fires on every pubkey or signer change (sign-in, key switch, cross-tab sync, SSO restore, pin restore). Pure detection logic in `shouldFireIdentityChange()` for testability.
- Write gate: `useWriteGate(loadFn)` blocks writes until an identity-keyed load succeeds. Resets and re-runs on identity change, surfaces loading/loaded/failed status. Pure state machine in `createWriteGateState()`/`writeGateTransition()`.

## 0.45.0

- Environment-aware cookie names: staging environments use `cloistr_staging_` prefixed cookie names so browsers on `*.staging.cloistr.xyz` never read or write production session cookies that leak in via the parent `.cloistr.xyz` domain scope. Production cookie names are unchanged.
- Add `getEnvironment()` to runtime config, reads from `window.__CLOISTR_CONFIG__.environment` with hostname fallback.

## 0.44.2

- Fix import cycle between `ServiceMenu` and `lib/services` that caused "Cannot access 'defaultServices' before initialization" when `ServiceMenu` was the first module loaded. **0.44.0 and 0.44.1 blank any app importing ServiceMenu first; do not use.**

## 0.44.1

- `LoginModal` shows the actual signer hostname from runtime config / prop instead of hardcoded "signer.cloistr.xyz".

## 0.44.0

- Add `ServiceMenu` app-switcher component.
- **Broken**: circular import causes TDZ crash — use 0.44.2 instead.
