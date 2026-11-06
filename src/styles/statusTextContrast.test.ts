import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// Status colours used as TEXT must reach WCAG AA (4.5:1) on every page
// background, in both themes. The base tokens are fills: text-cloistr-success
// (#10b981) on the light elevated background is 2.33:1 (cloistr-vault, /settings).

const css = readFileSync(resolve(__dirname, './variables.css'), 'utf8');

function block(selectorStart: string): string {
  const i = css.indexOf(selectorStart);
  if (i < 0) throw new Error(`no block starting ${selectorStart}`);
  const open = css.indexOf('{', i);
  return css.slice(open + 1, css.indexOf('}', open));
}

function token(body: string, name: string): string | undefined {
  return new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(body)?.[1];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const themes = {
  dark: block(':root {'),
  'light (data-theme)': block(':root[data-theme="light"]'),
  'light (system)': block(':root:not([data-theme="dark"])'),
};

const backgrounds = ['cloistr-bg', 'cloistr-bg-elevated'];

describe.each(['success', 'warning', 'error'])('--cloistr-%s-text', (status) => {
  for (const [theme, body] of Object.entries(themes)) {
    it(`reaches 4.5:1 on every background in ${theme}`, () => {
      const fg = token(body, `cloistr-${status}-text`);
      expect(fg, `--cloistr-${status}-text missing in ${theme}`).toBeDefined();
      for (const bg of backgrounds) {
        const bgHex = token(body, bg) ?? token(themes.dark, bg)!;
        expect(contrast(fg!, bgHex), `${fg} on ${bg} ${bgHex}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
