/**
 * Button component tests.
 *
 * This package has vitest but no DOM environment (no jsdom, no
 * @testing-library/react), so component rendering is not possible here. The
 * tests that CAN run without a DOM are:
 *
 *   BEHAVIOURAL (class-name helpers): buttonClasses() is a pure function —
 *   its output is exactly what gets applied to the element. Asserting it here
 *   is equivalent to asserting the rendered class attribute.
 *
 *   SOURCE-LEVEL: invariants about what the source must contain. These pin
 *   decisions that are easy to accidentally revert: the disabled+aria-busy
 *   contract on loading, the default type="button", and the presence of the
 *   expected CSS identifiers in components.css.
 *
 * Both kinds are documented explicitly so a future contributor knows what each
 * test is actually proving.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { buttonClasses, type ButtonVariant } from './Button.js';

const SRC = readFileSync(new URL('./Button.tsx', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../styles/components.css', import.meta.url), 'utf8');
const VARS = readFileSync(new URL('../styles/variables.css', import.meta.url), 'utf8');

// --- CLASS-NAME HELPER (behavioural) -----------------------------------------

describe('buttonClasses', () => {
  const variants: ButtonVariant[] = ['primary', 'secondary', 'danger', 'icon'];

  it('always includes the base cloistr-btn class', () => {
    for (const v of variants) {
      expect(buttonClasses(v)).toContain('cloistr-btn');
    }
  });

  it('applies the correct variant modifier for each variant', () => {
    expect(buttonClasses('primary')).toBe('cloistr-btn cloistr-btn-primary');
    expect(buttonClasses('secondary')).toBe('cloistr-btn cloistr-btn-secondary');
    expect(buttonClasses('danger')).toBe('cloistr-btn cloistr-btn-danger');
    expect(buttonClasses('icon')).toBe('cloistr-btn cloistr-btn-icon');
  });

  it('appends an extra class without double-spacing', () => {
    const result = buttonClasses('primary', 'my-custom-class');
    expect(result).toBe('cloistr-btn cloistr-btn-primary my-custom-class');
    expect(result).not.toMatch(/\s{2,}/);
  });

  it('tolerates an empty extra class without trailing whitespace', () => {
    const result = buttonClasses('secondary', '');
    expect(result).toBe('cloistr-btn cloistr-btn-secondary');
    expect(result).not.toMatch(/\s$/);
  });
});

// --- SOURCE-LEVEL: BUTTON BEHAVIOUR ------------------------------------------

describe('Button source', () => {
  it('defaults type to "button" to avoid accidental form submission', () => {
    // An <button> with no explicit type defaults to "submit" in HTML, which
    // submits the nearest ancestor <form>. Every Button inside a form but
    // outside the submit path needs type="button". Defaulting it in the
    // component means callers get the safe behaviour without knowing the spec.
    expect(SRC).toContain("type = 'button'");
  });

  it('disables the element when loading', () => {
    // A loading button must reject clicks. Checking `disabled || loading`
    // ensures both the prop and the loading flag gate interaction.
    expect(SRC).toContain('disabled={disabled || loading}');
  });

  it('sets aria-busy when loading', () => {
    // aria-busy announces to screen readers that the control is processing.
    // Without it a screen reader user gets no feedback that anything changed
    // after they activated the button.
    expect(SRC).toContain('aria-busy={loading || undefined}');
  });
});

// --- CSS PRESENCE ------------------------------------------------------------

describe('Button CSS', () => {
  it('defines cloistr-btn-icon in components.css', () => {
    expect(CSS).toContain('.cloistr-btn-icon');
  });

  it('cloistr-btn-primary uses --cloistr-primary-fg for text colour', () => {
    // Hardcoded "white" cannot respond to a future theme change where a
    // different primary colour needs a dark foreground. The token is the
    // contract; this pins that it is actually used.
    expect(CSS).toMatch(/\.cloistr-btn-primary\s*\{[^}]*color:\s*var\(--cloistr-primary-fg\)/s);
  });

  it('cloistr-btn-danger hover uses filter brightness, not a repeated background', () => {
    // The old rule set background: var(--cloistr-error) in BOTH the base and
    // the hover — producing no visible hover feedback. filter:brightness gives
    // a perceivable response without duplicating the colour value.
    const dangerHoverBlock = CSS.slice(
      CSS.indexOf('.cloistr-btn-danger:hover:not(:disabled)'),
    ).slice(0, 120);
    expect(dangerHoverBlock).toContain('filter: brightness');
    expect(dangerHoverBlock).not.toContain('background:');
  });
});

// --- TOKEN PRESENCE ----------------------------------------------------------

describe('--cloistr-primary-fg token', () => {
  it('is defined in variables.css', () => {
    expect(VARS).toContain('--cloistr-primary-fg');
  });

  it('is set to white in the root (readable on #7c3aed)', () => {
    // #7c3aed has relative luminance ~0.09 → contrast against #ffffff is ~9:1,
    // exceeding WCAG AA (4.5:1) for normal text and AAA (7:1) for large text.
    expect(VARS).toContain('--cloistr-primary-fg: #ffffff');
  });

  it('is not overridden in the light theme block', () => {
    // --cloistr-primary does not change between dark and light themes, so
    // --cloistr-primary-fg does not need overriding. If the primary ever
    // changes to a light colour the token will need an override; this test
    // is the reminder to add it then.
    const lightBlock = VARS.slice(VARS.indexOf(':root[data-theme="light"]'));
    expect(lightBlock).not.toContain('--cloistr-primary-fg');
  });
});

// --- 100dvh SWEEP ------------------------------------------------------------

describe('100vh sweep in components.css', () => {
  it('has no remaining 100vh occurrences', () => {
    // Mobile browsers show/hide their URL bar, shrinking the viewport below
    // what 100vh resolves to at initial load — clipping bottom content. 100dvh
    // tracks the DYNAMIC viewport height and always matches the visible area.
    expect(CSS).not.toContain('100vh');
  });
});
