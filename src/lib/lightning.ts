/**
 * Shared validation helpers for Lightning addresses.
 *
 * Extracted from cloistr-me-ui's LightningConfig and CreditBalance components
 * to eliminate duplication. Both components contained an identical inline regex.
 */

/** Regex for a valid Lightning Address (localpart@domain.tld). */
export const LIGHTNING_ADDRESS_PATTERN =
  /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/**
 * Reports whether addr is a valid Lightning Address (e.g. name@wallet.com).
 * Accepts the same set as the LNURL-pay spec localpart rules.
 */
export function isValidLightningAddress(addr: string): boolean {
  return LIGHTNING_ADDRESS_PATTERN.test(addr);
}
