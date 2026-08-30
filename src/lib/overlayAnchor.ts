/**
 * Anchoring for header overlays that must escape the header.
 *
 * THE BUG THIS EXISTS TO PREVENT
 * `.cloistr-header` is `position: sticky` with `z-index: var(--cloistr-z-header)`.
 * A positioned element with a z-index other than `auto` CREATES A STACKING
 * CONTEXT. Every descendant is then painted INSIDE that context, and its
 * z-index is resolved only against its siblings there — not against the page.
 *
 * So the profile dropdown's `z-index: var(--cloistr-z-dropdown)` (100) never
 * competed with page content at all. The whole header subtree, dropdown
 * included, paints at the header's 50. Any app content above 50 covers it.
 *
 * VERIFIED IN CHROME 149, not reasoned about (375x667 and 1280x900, page
 * content at `position: relative; z-index: 60`, hit-tested with
 * `document.elementFromPoint` over the open dropdown):
 *
 *   dropdown z-index 100  -> COVERED by page content
 *   dropdown z-index 99999 -> STILL COVERED
 *   dropdown position:fixed -> STILL COVERED
 *   dropdown portaled to <body> -> on top, at both viewports
 *
 * The middle two are the important ones. RAISING THE NUMBER CANNOT FIX THIS,
 * and neither can `position: fixed` — `fixed` escapes overflow clipping, not a
 * stacking context. That is why this kept getting hand-rolled into ever-larger
 * numbers in app after app: every one of those changes was inert.
 *
 * The fix is structural: portal the overlay to `document.body` so it lands in
 * the ROOT stacking context, where its z-index token finally means what the
 * scale says it means, and anchor it to the trigger with fixed coordinates
 * because it no longer shares an offset parent with the trigger.
 *
 * It was reported on mobile but reproduces identically on desktop; a narrow
 * viewport just puts more page content under the dropdown.
 */

/** Viewport coordinates for an overlay anchored under a trigger. */
export interface OverlayAnchor {
  /** Distance from the viewport top, in px. */
  top: number;
  /** Distance from the viewport RIGHT edge, in px — the menu is right-aligned. */
  right: number;
}

/** Gap between the trigger and the overlay, matching --cloistr-space-xs. */
export const OVERLAY_GAP_PX = 4;

/**
 * Anchor an overlay below a trigger, right-aligned to it.
 *
 * Pure, and takes the viewport width rather than reading `window`, so the
 * mapping can be pinned in tests. Right-alignment is preserved from the
 * original `right: 0` rule: once portaled the overlay has no positioned
 * ancestor to be right-aligned against, so the offset is computed against the
 * viewport instead.
 */
export function anchorBelow(rect: DOMRect, viewportWidth: number): OverlayAnchor {
  return {
    top: rect.bottom + OVERLAY_GAP_PX,
    // Clamped at 0: a trigger extending past the viewport edge would otherwise
    // produce a negative offset and push the menu off-screen.
    right: Math.max(0, viewportWidth - rect.right),
  };
}
