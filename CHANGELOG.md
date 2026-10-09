# Changelog

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
