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

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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

  it('is set to white in the root', () => {
    expect(VARS).toContain('--cloistr-primary-fg: #ffffff');
  });

  it('actually clears WCAG AA against --cloistr-primary', () => {
    // COMPUTED, not asserted in a comment. A previous version of this file
    // claimed "~9:1" for this pairing and was wrong by roughly 60%: the real
    // ratio is 5.70:1. A hand-written number in a comment cannot fail, so the
    // ratio is derived from the tokens themselves and checked here.
    const hexOf = (name: string) => {
      const m = VARS.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
      if (!m) throw new Error(`token ${name} not found in variables.css`);
      return m[1];
    };

    // WCAG 2.x relative luminance.
    const luminance = (hex: string) => {
      const channel = (v: number) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      const r = channel(parseInt(hex.slice(1, 3), 16));
      const g = channel(parseInt(hex.slice(3, 5), 16));
      const b = channel(parseInt(hex.slice(5, 7), 16));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };

    const bg = luminance(hexOf('--cloistr-primary'));
    const fg = luminance(hexOf('--cloistr-primary-fg'));
    const ratio = (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05);

    // AA for normal text. If someone darkens --cloistr-primary this still
    // passes; if they lighten it toward white, this fails and the token needs
    // a dark foreground instead.
    expect(ratio).toBeGreaterThanOrEqual(4.5);

    // Pin the current value so a token change is a deliberate, visible edit
    // rather than a silent drift.
    expect(ratio).toBeCloseTo(5.7, 1);
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

describe('100dvh sweep across the whole package', () => {
  // Mobile browsers show and hide their URL bar, shrinking the viewport below
  // what 100vh resolves to at initial load, which clips bottom content. 100dvh
  // tracks the DYNAMIC viewport height and always matches the visible area.
  //
  // This scans EVERY source file, not just components.css. The first version of
  // this test only read components.css, so it passed while an inline
  // `minHeight: '100vh'` survived in AuthRestoreGate.tsx — the full-screen auth
  // gate, which is exactly the kind of element the bug ruins on a phone.
  const SRC = join(__dirname, '..');

  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(path);
      return /\.(ts|tsx|css)$/.test(entry.name) ? [path] : [];
    });

  it('has no remaining 100vh occurrences in any source file', () => {
    const offenders = walk(SRC)
      // This file necessarily contains the literal it is searching for.
      .filter((path) => !path.endsWith('Button.test.ts'))
      .filter((path) => /\b100vh\b/.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(SRC.length + 1));

    expect(offenders, `100vh still present in: ${offenders.join(', ')}`).toEqual([]);
  });
});
