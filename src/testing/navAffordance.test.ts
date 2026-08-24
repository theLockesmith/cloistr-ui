import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { findNavAffordances, assertMobileNavModel, stubViewport } from './navAffordance.js';

/**
 * These are REGRESSION tests built from markup that actually shipped.
 *
 * A detector that passes hand-written happy-path fixtures is worthless here:
 * the previous detector did exactly that and still missed sheets entirely,
 * because it tested `aria-label + " " + text` against an anchored /^menu$/ and
 * sheets' string is "Open menu Menu". So each case below reproduces the real
 * markup, measured in production on 2026-08-24, and asserts the detector fails
 * on it.
 */

function dom(body: string): { doc: Document; win: Window } {
  const d = new JSDOM(`<!doctype html><html><body>${body}</body></html>`);
  return { doc: d.window.document, win: d.window as unknown as Window };
}

const SHARED_HEADER = `
  <header class="cloistr-header">
    <button class="cloistr-apps-trigger" aria-label="Apps"></button>
    <button class="cloistr-user-menu-trigger">CB cbba…5c31</button>
  </header>`;

describe('findNavAffordances / the three apps that actually shipped this', () => {
  it('catches docs: button.menubar-hamburger, outside the header', () => {
    const { doc, win } = dom(`${SHARED_HEADER}
      <div class="menubar-mobile" aria-label="Application menu">
        <button class="menubar-hamburger" aria-label="Open menu">Menu</button>
      </div>`);
    const r = findNavAffordances(doc, win);
    expect(r.appOwned.map((t) => t.className)).toContain('menubar-hamburger');
  });

  it('catches slides: button.slides-menubar-hamburger', () => {
    const { doc, win } = dom(`${SHARED_HEADER}
      <nav class="slides-menubar" aria-label="Application menu">
        <button class="slides-menubar-hamburger" aria-label="Open menu"></button>
      </nav>`);
    const r = findNavAffordances(doc, win);
    expect(r.appOwned.map((t) => t.className)).toContain('slides-menubar-hamburger');
  });

  it('catches sheets: a button with NO CLASS AT ALL', () => {
    // The case the previous detector missed. It has no class to match on, and
    // its aria-label + text concatenates to "Open menu Menu".
    const { doc, win } = dom(`${SHARED_HEADER}
      <button aria-label="Open menu">Menu</button>`);
    const r = findNavAffordances(doc, win);
    expect(r.triggers).toHaveLength(1);
    expect(r.appOwned).toHaveLength(1);
    expect(r.appOwned[0].label).toBe('Open menu');
  });
});

describe('findNavAffordances / what must NOT be flagged', () => {
  it('does not treat the 9-dot ServiceMenu as a hamburger', () => {
    // "It is NOT a hamburger and must not be restyled into one." Counting it
    // would make every app fail forever and the gate would be turned off.
    const { doc, win } = dom(SHARED_HEADER);
    expect(findNavAffordances(doc, win).triggers).toHaveLength(0);
  });

  it('does not flag a trigger that lives INSIDE the shared header', () => {
    const { doc, win } = dom(`
      <header class="cloistr-header">
        <button class="cloistr-sidebar-toggle" aria-label="Open navigation"></button>
      </header>`);
    const r = findNavAffordances(doc, win);
    expect(r.triggers).toHaveLength(1);
    expect(r.appOwned).toHaveLength(0);
  });

  it('ignores third-party chrome (Excalidraw, Univer)', () => {
    // Whiteboard correctly EXTENDS Excalidraw's MainMenu. Flagging that would
    // punish the one app following the model.
    const { doc, win } = dom(`${SHARED_HEADER}
      <button class="dropdown-menu-button main-menu-trigger"></button>
      <div class="sidebar-trigger default-sidebar-trigger">Library</div>
      <button class="univer-box-border univer-flex">Start</button>`);
    expect(findNavAffordances(doc, win).triggers).toHaveLength(0);
  });

  it('does not count a hidden element as visible', () => {
    const { doc, win } = dom(`${SHARED_HEADER}
      <button class="menubar-hamburger" aria-label="Open menu" style="display:none">Menu</button>`);
    expect(findNavAffordances(doc, win).appOwned).toHaveLength(0);
  });
});

describe('findNavAffordances / expanded commands', () => {
  it('counts commands that are SIBLINGS of the menubar, not just children', () => {
    // docs' toolbar buttons sit outside .menubar. A menubar-scoped count
    // reported 0 while 17 were on screen.
    const { doc, win } = dom(`${SHARED_HEADER}
      <button class="menubar-hamburger" aria-label="Open menu">Menu</button>
      <div class="menubar" aria-label="Menu bar"></div>
      <div class="editor-toolbar">
        <button>Bold</button><button>Italic</button><button>Underline</button>
        <button>Link</button><button>Table</button>
      </div>`);
    const r = findNavAffordances(doc, win);
    expect(r.expandedCommands).toBe(5);
    expect(r.commandSample).toContain('Bold');
  });

  it('does not count document chrome (Back, Save) as app commands', () => {
    const { doc, win } = dom(`${SHARED_HEADER}
      <button class="menubar-hamburger" aria-label="Open menu">Menu</button>
      <button class="editor-back-btn">← Back</button>
      <button class="save-clean">Saved</button>`);
    expect(findNavAffordances(doc, win).expandedCommands).toBe(0);
  });
});

describe('findNavAffordances / honesty about what it can see', () => {
  it('reports structure mode in jsdom rather than faking measurements', () => {
    // jsdom lays nothing out, so every box is 0x0. Reporting tooSmall from
    // those zeroes would fail every app for a fake reason; reporting them as
    // "fine" would be a silent green. It says which mode it ran in instead.
    const { doc, win } = dom(`${SHARED_HEADER}<button aria-label="Open menu">Menu</button>`);
    const r = findNavAffordances(doc, win);
    expect(r.measured).toBe('structure');
    expect(r.tooSmall).toHaveLength(0);
  });
});

describe('assertMobileNavModel', () => {
  it('throws naming the offending selector', () => {
    const { doc, win } = dom(`${SHARED_HEADER}
      <button class="menubar-hamburger" aria-label="Open menu">Menu</button>`);
    expect(() => assertMobileNavModel(doc, { appName: 'docs', win })).toThrow(/menubar-hamburger/);
  });

  it('throws when two triggers are present', () => {
    const { doc, win } = dom(`
      <header class="cloistr-header">
        <button class="cloistr-sidebar-toggle" aria-label="Open navigation"></button>
      </header>
      <button class="menubar-hamburger" aria-label="Open menu">Menu</button>`);
    expect(() => assertMobileNavModel(doc, { appName: 'docs', win })).toThrow(/nav trigger/i);
  });

  it('passes for a compliant app and returns the report', () => {
    const { doc, win } = dom(`
      <header class="cloistr-header">
        <button class="cloistr-apps-trigger" aria-label="Apps"></button>
        <div class="cloistr-appshell-hamburger">
          <button class="cloistr-sidebar-toggle" aria-label="Open navigation"></button>
        </div>
      </header>
      <main><p>document</p></main>`);
    const r = assertMobileNavModel(doc, { appName: 'docs', win });
    expect(r.appOwned).toHaveLength(0);
    expect(r.triggers).toHaveLength(1);
  });

  it('passes for an app with no nav affordance at all', () => {
    // Neither nav nor commands => no hamburger is CORRECT, not a failure.
    const { doc, win } = dom(`${SHARED_HEADER}<main><p>content</p></main>`);
    expect(() => assertMobileNavModel(doc, { appName: 'tasks', win })).not.toThrow();
  });
});

describe('stubViewport', () => {
  it('makes matchMedia report mobile below the breakpoint', () => {
    const { win } = dom('');
    stubViewport(win, 390);
    expect(win.matchMedia('(min-width: 768px)').matches).toBe(false);
    expect(win.innerWidth).toBe(390);
  });

  it('makes matchMedia report desktop above the breakpoint', () => {
    const { win } = dom('');
    stubViewport(win, 1440);
    expect(win.matchMedia('(min-width: 768px)').matches).toBe(true);
  });
});
