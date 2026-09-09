import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const src = () =>
  readFileSync(resolve(__dirname, './Header.tsx'), 'utf8');

describe('HeaderAuth passes nip05 through to UserMenu', () => {
  it('declares nip05 on the HeaderAuth interface', () => {
    const s = src();
    // The interface must carry the field so callers can supply it.
    const iface = /export interface HeaderAuth\s*\{([\s\S]*?)\}/m.exec(s);
    expect(iface, 'HeaderAuth interface must exist').toBeTruthy();
    expect(
      iface![1],
      'HeaderAuth must have a nip05 field for kind:0 identity pass-through',
    ).toMatch(/nip05\?:\s*string/);
  });

  it('forwards auth.nip05 to the UserMenu component', () => {
    const s = src();
    // The UserMenu JSX must receive the nip05 prop from auth.
    expect(
      s,
      'Header must pass nip05={auth?.nip05} to UserMenu so the kind:0 ' +
        'address reaches the display layer',
    ).toMatch(/nip05=\{auth\?\.nip05\}/);
  });

  it('does not hardcode a NIP-05 value', () => {
    const s = src();
    // A hardcoded address would mask future kind:0 updates.
    expect(s).not.toMatch(/nip05=["'][^"']+@[^"']+["']/);
  });
});
