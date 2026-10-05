import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * The app-switcher panel opened BEHIND page content, reported as "the app menu
 * doesn't open dynamically" -- it did open, you just could not see it.
 *
 * Same root cause as the profile dropdown: `.cloistr-header` is position:sticky
 * WITH a z-index, so it creates a stacking context, and a panel rendered inside
 * it painted at the HEADER's layer (50) regardless of asking for 150.
 *
 * Measured against page content at z-index 60, at 375x667 AND 1280x900:
 *   before: everything below the panel's top ~8px was covered
 *   after:  on top at every sampled height
 *
 * The panel already used position:fixed, and the comment on the component used
 * to claim that made it float above app content. It does not -- `fixed` escapes
 * overflow clipping, not a stacking context. That wrong comment is why this
 * survived the round of fixes that caught the dropdown.
 */
const src = () => readFileSync(resolve(__dirname, './ServiceMenu.tsx'), 'utf8');

describe('defaultServices launcher entries', () => {
  it('includes Pages', async () => {
    const { defaultServices } = await import('./ServiceMenu.js');
    const ids = defaultServices.map((s: { id: string }) => s.id);
    expect(ids).toContain('pages');
  });

  it('does not include the removed office apps (Docs, Sheets, Slides, Whiteboard)', async () => {
    const { defaultServices } = await import('./ServiceMenu.js');
    const ids = defaultServices.map((s: { id: string }) => s.id);
    expect(ids).not.toContain('docs');
    expect(ids).not.toContain('sheets');
    expect(ids).not.toContain('slides');
    expect(ids).not.toContain('whiteboard');
  });

  it('Pages points to pages.cloistr.xyz', async () => {
    const { defaultServices } = await import('./ServiceMenu.js');
    const pages = defaultServices.find((s: { id: string }) => s.id === 'pages');
    expect(pages).toBeDefined();
    expect(pages!.url).toBe('https://pages.cloistr.xyz');
  });
});

describe('app switcher escapes the header stacking context', () => {
  it('portals the panel to document.body', () => {
    expect(src()).toMatch(/createPortal\([\s\S]*?document\.body/);
  });

  it('does not rely on position:fixed alone to escape', () => {
    // Guard against someone "simplifying" the portal away because the panel is
    // already fixed. It was already fixed when it was broken.
    expect(src()).toMatch(/createPortal/);
  });

  it('anchors with the shared helper, so both header overlays agree', () => {
    // Also gives the clamp: a trigger near the viewport edge must not produce a
    // negative offset and push the panel off-screen.
    expect(src()).toMatch(/anchorBelow\(/);
  });
});
