import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * The profile dropdown opened BEHIND page content, reported on mobile.
 *
 * ROOT CAUSE (verified in Chrome 149, not inferred): `.cloistr-header` is
 * position:sticky WITH a z-index, so it creates a stacking context. The
 * dropdown rendered inside it was painted within that context at the header's
 * layer (50), and its own z-index was only ever compared against its header
 * siblings — so any app content above 50 covered it.
 *
 * Hit-testing the open menu with document.elementFromPoint over content at
 * `position: relative; z-index: 60`:
 *
 *   z-index 100            -> COVERED
 *   z-index 99999          -> COVERED
 *   position: fixed        -> COVERED
 *   portaled to <body>     -> on top, at 375x667 AND 1280x900
 *
 * Two of those matter more than the fix: RAISING THE NUMBER DOES NOTHING, and
 * neither does `fixed` (it escapes overflow clipping, not a stacking context).
 * Four apps hand-rolled ever-larger z-indexes at this bug; every one was inert.
 *
 * AppShell.test.ts pins the drawer/scrim layering after four apps independently
 * got that wrong. This is the equivalent guard for the escape hatch: a future
 * change that "simplifies" the portal away restores the bug silently, because
 * the CSS still looks correct.
 */
const src = () =>
  readFileSync(resolve(__dirname, './UserMenu.tsx'), 'utf8');
const css = () =>
  readFileSync(resolve(__dirname, '../styles/components.css'), 'utf8');

describe('profile dropdown escapes the header stacking context', () => {
  it('portals the dropdown out of the header', () => {
    const s = src();
    expect(s, 'UserMenu must import createPortal').toMatch(/createPortal/);
    expect(
      s,
      'the dropdown must be portaled to document.body — rendering it inside ' +
        'the header puts it back inside the header stacking context',
    ).toMatch(/createPortal\(\s*dropdown\s*,\s*document\.body\s*\)/);
  });

  it('anchors the dropdown to the trigger instead of the header box', () => {
    // Once portaled it has no shared offset parent, so `top: 100%; right: 0`
    // would place it against the viewport corner rather than under the avatar.
    expect(src()).toMatch(/anchorBelow/);
  });

  it('does not position the dropdown inside the header in CSS', () => {
    const rule = /\.cloistr-user-menu-dropdown\s*\{([^}]*)\}/.exec(css());
    expect(rule).toBeTruthy();
    expect(
      rule![1],
      'position:absolute would anchor it to the header again, fighting the ' +
        'inline fixed coordinates the portal sets',
    ).not.toMatch(/position:\s*absolute/);
  });

  it('still carries the shared dropdown z token', () => {
    // The token is only meaningful now that the menu lands in the ROOT stacking
    // context. Keep it on the scale rather than hand-rolling a number.
    const rule = /\.cloistr-user-menu-dropdown\s*\{([^}]*)\}/.exec(css());
    expect(rule![1]).toMatch(/z-index:\s*var\(--cloistr-z-dropdown\)/);
  });

  it('treats clicks on the portaled menu as INSIDE the menu', () => {
    // The dropdown is no longer a DOM descendant of the trigger wrapper, so an
    // outside-click handler that only checks the wrapper closes the menu on its
    // own items — it would look like the menu ignores every click.
    expect(src()).toMatch(/dropdownRef\.current\?\.contains/);
  });
});

describe('identity line prefers a verified NIP-05', () => {
  it('falls back to the pubkey rather than blanking the identity', () => {
    // A user who cannot see who they are logged in as is worse off than one
    // seeing hex, so every NIP-05 read is `?? <pubkey form>`.
    const s = src();
    expect(s).toMatch(/activeNip05 \?\? shortPubkey/);
    expect(s).toMatch(/activeNip05 \?\? `\$\{effectivePubkey\.slice\(0, 16\)\}\.\.\.`/);
  });

  it('gives the account switcher the same treatment as the header line', () => {
    // The switcher showed raw hex from a separate code path; fixing only the
    // header line would leave half the menu on pubkeys.
    expect(src()).toMatch(/nip05 \?\? identity\.name \?\?/);
  });

  it('keeps the full pubkey reachable when a NIP-05 is shown', () => {
    // The pubkey is the identity; the NIP-05 is a label for it. Users need to
    // be able to recover the hex without signing out.
    expect(src()).toMatch(/title=\{effectivePubkey\}/);
  });
});
