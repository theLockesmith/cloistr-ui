/**
 * Canonical username validation for Cloistr.
 *
 * Mirrors the Go package cloistr-common/username/username.go EXACTLY.
 * Keep in lockstep with the DB CHECK constraint on addresses.username.
 *
 * Canonical rule: ^[a-z0-9_-]{2,50}$
 *
 * Auto-assigned addresses (handed to nameless extension/NIP-07 identities)
 * use a reserved shape that humans are NOT allowed to claim:
 *   ^[a-z]+-[a-z]+-[0-9]{4}$  e.g. "happy-otter-1234"
 */

/** Canonical username format — mirrors the DB CHECK constraint. */
export const VALID_PATTERN = /^[a-z0-9_-]{2,50}$/;

/** Reserved shape for auto-assigned addresses (adjective-noun-NNNN). */
export const AUTO_ASSIGNED_PATTERN = /^[a-z]+-[a-z]+-[0-9]{4}$/;

/** Reports whether name satisfies the canonical username format. */
export function isValid(name: string): boolean {
  return VALID_PATTERN.test(name);
}

/**
 * Reports whether name has the reserved auto-assigned shape (adjective-noun-NNNN).
 * Auto-assigned addresses never confer the named tier.
 */
export function isAutoAssigned(name: string): boolean {
  return AUTO_ASSIGNED_PATTERN.test(name);
}

/**
 * Reports whether name is a valid username that a human may claim.
 * Equivalent to isValid(name) && !isAutoAssigned(name) — blocks squatting
 * the auto-assign namespace.
 */
export function isValidHumanName(name: string): boolean {
  return isValid(name) && !isAutoAssigned(name);
}
