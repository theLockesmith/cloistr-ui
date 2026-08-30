import { describe, it, expect } from 'vitest';
import { anchorBelow, OVERLAY_GAP_PX } from './overlayAnchor.js';

const rect = (o: Partial<DOMRect>): DOMRect => ({
  top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0,
  toJSON: () => ({}), ...o,
}) as DOMRect;

describe('anchorBelow', () => {
  it('sits just under the trigger', () => {
    expect(anchorBelow(rect({ bottom: 56, right: 360 }), 375).top).toBe(56 + OVERLAY_GAP_PX);
  });

  it('right-aligns to the trigger, measured from the viewport edge', () => {
    // Portaled overlays have no positioned ancestor to be `right: 0` against,
    // so the offset has to be computed against the viewport instead.
    expect(anchorBelow(rect({ bottom: 56, right: 360 }), 375).right).toBe(15);
  });

  it('never produces a negative offset', () => {
    // A trigger extending past the viewport edge would otherwise push the menu
    // off-screen instead of clamping it to the edge.
    expect(anchorBelow(rect({ bottom: 56, right: 400 }), 375).right).toBe(0);
  });
});
