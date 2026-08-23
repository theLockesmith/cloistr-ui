/**
 * Toggle component tests.
 *
 * No DOM environment is available in this package (no jsdom, no
 * @testing-library/react). Tests are therefore split into:
 *
 *   BEHAVIOURAL (pure helpers): toggleClasses() is a pure function.
 *   Asserting its output is equivalent to asserting the rendered className.
 *
 *   SOURCE-LEVEL: invariants that pin the accessibility contract and CSS
 *   presence. These are the decisions most likely to be accidentally dropped
 *   in a future edit.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { toggleClasses } from './Toggle.js';

const SRC = readFileSync(new URL('./Toggle.tsx', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../styles/components.css', import.meta.url), 'utf8');

// --- CLASS-NAME HELPER (behavioural) -----------------------------------------

describe('toggleClasses', () => {
  it('returns the base class when enabled', () => {
    expect(toggleClasses(false)).toBe('cloistr-toggle');
  });

  it('adds the disabled modifier when disabled', () => {
    expect(toggleClasses(true)).toBe('cloistr-toggle cloistr-toggle--disabled');
  });

  it('appends an extra class without double-spacing', () => {
    const result = toggleClasses(false, 'my-toggle');
    expect(result).toBe('cloistr-toggle my-toggle');
    expect(result).not.toMatch(/\s{2,}/);
  });

  it('handles disabled + extra class', () => {
    const result = toggleClasses(true, 'extra');
    expect(result).toBe('cloistr-toggle cloistr-toggle--disabled extra');
  });

  it('tolerates empty extra class without trailing whitespace', () => {
    const result = toggleClasses(false, '');
    expect(result).toBe('cloistr-toggle');
    expect(result).not.toMatch(/\s$/);
  });
});

// --- SOURCE-LEVEL: ACCESSIBILITY CONTRACT ------------------------------------

describe('Toggle source', () => {
  it('uses input type="checkbox" so the native control is in the a11y tree', () => {
    // A visually hidden native checkbox is the correct host for a toggle.
    // A pure div with click handlers works in pointing devices but is opaque
    // to screen readers and keyboard navigation. The native checkbox gives
    // both for free.
    expect(SRC).toContain('type="checkbox"');
  });

  it('carries role="switch" on the input', () => {
    // role="switch" is the correct ARIA role for a binary on/off control.
    // Without it, screen readers describe it as a checkbox (correct but less
    // precise) — and some narrate it as "checked/unchecked" rather than
    // "on/off", which is confusing for toggles that control settings.
    expect(SRC).toContain('role="switch"');
  });

  it('sets aria-checked from the checked prop', () => {
    // aria-checked mirrors the visual state for screen readers.
    // Both the native checked attribute and aria-checked must agree.
    expect(SRC).toContain('aria-checked={checked}');
  });

  it('passes disabled to the native input', () => {
    // Disabling the native input blocks keyboard interaction as well as
    // pointer events. A purely CSS disabled state (opacity + pointer-events)
    // would still be activatable by keyboard.
    expect(SRC).toContain('disabled={disabled}');
  });

  it('guards onChange so disabled toggles cannot fire', () => {
    // The disabled prop on the input blocks browser events, but a direct
    // programmatic call could still reach onChange. The guard is the
    // defensive belt-and-braces.
    expect(SRC).toContain('if (!disabled) onChange');
  });

  it('renders the thumb inside the track, not outside it', () => {
    // The thumb must be a child of the track so the :checked + .track .thumb
    // CSS selector chain works. A sibling relationship would require a
    // different (less readable) selector.
    const trackOpenIdx = SRC.indexOf('cloistr-toggle-track"');
    const thumbIdx = SRC.indexOf('cloistr-toggle-thumb"');
    const trackCloseIdx = SRC.indexOf('</span>', trackOpenIdx);
    expect(trackOpenIdx, 'cloistr-toggle-track class must appear in source').toBeGreaterThan(-1);
    expect(thumbIdx, 'cloistr-toggle-thumb class must appear in source').toBeGreaterThan(-1);
    expect(thumbIdx).toBeGreaterThan(trackOpenIdx);
    expect(thumbIdx).toBeLessThan(trackCloseIdx);
  });

  it('wraps everything in a <label> linked to the input by id', () => {
    // htmlFor on the label and id on the input must match so clicking the label
    // (including the visible track and label text) activates the hidden checkbox.
    expect(SRC).toContain('htmlFor={id}');
    expect(SRC).toContain('id={id}');
  });
});

// --- CSS PRESENCE ------------------------------------------------------------

describe('Toggle CSS', () => {
  it('defines .cloistr-toggle in components.css', () => {
    expect(CSS).toContain('.cloistr-toggle');
  });

  it('defines .cloistr-toggle-track', () => {
    expect(CSS).toContain('.cloistr-toggle-track');
  });

  it('defines .cloistr-toggle-thumb', () => {
    expect(CSS).toContain('.cloistr-toggle-thumb');
  });

  it('changes track background when :checked', () => {
    // Without this the switch looks the same on and off.
    expect(CSS).toContain('.cloistr-toggle-input:checked + .cloistr-toggle-track');
  });

  it('translates the thumb to the right when :checked', () => {
    // The thumb slides to indicate "on". translateX with a positive value
    // moves it right.
    expect(CSS).toContain('.cloistr-toggle-input:checked + .cloistr-toggle-track .cloistr-toggle-thumb');
    const checkedThumbBlock = CSS.slice(
      CSS.indexOf('.cloistr-toggle-input:checked + .cloistr-toggle-track .cloistr-toggle-thumb'),
    ).slice(0, 150);
    expect(checkedThumbBlock).toContain('translateX');
  });

  it('defines a focus-visible ring', () => {
    // Keyboard users need to see where focus is. focus-visible (not focus)
    // avoids showing the ring on pointer activation.
    expect(CSS).toContain('.cloistr-toggle-input:focus-visible');
  });

  it('has base styles before the :checked variant (source order)', () => {
    // The known CSS source-order bug on this project: a mobile-only override
    // in an early @media block lost to a later unscoped rule at equal
    // specificity. For toggles: the base track must be defined before
    // :checked overrides it, so the cascade is deterministic at equal
    // specificity.
    const trackIdx = CSS.indexOf('.cloistr-toggle-track {');
    const checkedIdx = CSS.indexOf('.cloistr-toggle-input:checked');
    expect(trackIdx).toBeGreaterThan(-1);
    expect(checkedIdx).toBeGreaterThan(-1);
    expect(trackIdx).toBeLessThan(checkedIdx);
  });
});
