import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const css = () =>
  readFileSync(resolve(__dirname, './components.css'), 'utf8');

describe('.cloistr-login-help a uses --cloistr-primary-text', () => {
  it('uses --cloistr-primary-text, not --cloistr-primary-light', () => {
    const s = css();
    const rule = /\.cloistr-login-help a\s*\{([^}]*)\}/.exec(s);
    expect(rule, '.cloistr-login-help a rule must exist').toBeTruthy();
    expect(
      rule![1],
      'footer link must use the AA-compliant text token',
    ).toMatch(/color:\s*var\(--cloistr-primary-text\)/);
    expect(
      rule![1],
      'footer link must NOT use --cloistr-primary-light (2.49:1 on light bg)',
    ).not.toMatch(/--cloistr-primary-light/);
  });
});
