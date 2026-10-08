# Changelog

## 0.44.2

- Fix import cycle between `ServiceMenu` and `lib/services` that caused "Cannot access 'defaultServices' before initialization" when `ServiceMenu` was the first module loaded. **0.44.0 and 0.44.1 blank any app importing ServiceMenu first; do not use.**

## 0.44.1

- `LoginModal` shows the actual signer hostname from runtime config / prop instead of hardcoded "signer.cloistr.xyz".

## 0.44.0

- Add `ServiceMenu` app-switcher component.
- **Broken**: circular import causes TDZ crash — use 0.44.2 instead.
