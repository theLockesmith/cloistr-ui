/**
 * The single shared detector for "how many nav affordances does this app show?"
 *
 * WHY THIS EXISTS
 *
 * On 2026-08-24 three apps shipped their own hamburger outside the shared
 * header, all below the 44x44 tap minimum, with their whole command set
 * rendered expanded beside it. The checklist item that was supposed to catch
 * that (CC-LAYOUT-2) had no assertion at all, and when it was fixed it lived in
 * cloistr-app-audit, which tests *.cloistr.xyz — i.e. PRODUCTION, i.e. the code
 * that is already deployed.
 *
 * That leaves no gate before merge. When five apps were migrated onto AppShell,
 * not one of them was rendered at 390x844 by anything: four of the six repos
 * have no Playwright, and a local build cannot authenticate because the SSO
 * cookie is scoped to `.cloistr.xyz`.
 *
 * This module closes that. It is deliberately:
 *
 *   - SELF-CONTAINED. No imports, no framework, no `window` at module scope.
 *     It takes a Document and reads it. That means the SAME function runs in a
 *     jsdom unit test (fast, in every repo's existing vitest, no auth, no
 *     server) AND inside Playwright's page.evaluate against production. One
 *     implementation, so the pre-merge gate and the post-deploy check cannot
 *     drift into disagreeing.
 *
 *   - HONEST ABOUT WHAT IT CANNOT SEE. jsdom does not lay out, so sizes are
 *     only meaningful in a real browser. `measured` says which mode produced
 *     the result rather than silently reporting zeroes, because a silent zero
 *     read as "no offenders" is the exact failure this project keeps hitting.
 */

export interface NavTrigger {
  label: string;
  className: string;
  insideHeader: boolean;
  /** 0 in jsdom — see `measured`. */
  width: number;
  height: number;
}

export interface NavAffordanceReport {
  /** 'layout' in a real browser, 'structure' in jsdom where nothing is laid out. */
  measured: 'layout' | 'structure';
  triggers: NavTrigger[];
  /** Triggers rendered by the APP rather than the shared header. Must be empty. */
  appOwned: NavTrigger[];
  /** Triggers under the 44x44 minimum. Always empty when measured === 'structure'. */
  tooSmall: NavTrigger[];
  /** Command buttons visible alongside a hamburger instead of collapsed into it. */
  expandedCommands: number;
  commandSample: string[];
}

/**
 * Inspect a document for nav affordances.
 *
 * Written as one self-contained function with no closure over imports so it can
 * be handed straight to Playwright's `page.evaluate`.
 */
export function findNavAffordances(doc: Document, win?: Window): NavAffordanceReport {
  const w = win ?? (doc.defaultView as Window);
  // jsdom reports 0 for every box. Detect that once rather than reporting
  // fake measurements.
  const probe = doc.body ? doc.body.getBoundingClientRect() : null;
  const laidOut = !!probe && (probe.width > 0 || probe.height > 0);

  const cls = (el: Element) => String((el as HTMLElement).className || '');
  const aria = (el: Element) => (el.getAttribute('aria-label') || '').trim();
  const text = (el: Element) => (el.textContent || '').trim();

  const header = doc.querySelector('header, .cloistr-header');
  const headerBottom = header && laidOut ? header.getBoundingClientRect().bottom : 0;
  const footer = doc.querySelector('footer, .cloistr-footer');
  const footerTop =
    footer && laidOut ? footer.getBoundingClientRect().top : Number.MAX_SAFE_INTEGER;

  const isThirdParty = (el: Element) =>
    /excalidraw|ToolIcon|App-toolbar|main-menu-trigger|sidebar-trigger|univer-/i.test(cls(el));

  const isNavTrigger = (el: Element): boolean => {
    // The 9-dot ServiceMenu is explicitly NOT a hamburger and must never be
    // counted as one, nor restyled into one.
    if (/apps-trigger/.test(cls(el)) || /^apps$/i.test(aria(el))) return false;
    if (/user-menu/.test(cls(el))) return false;
    if (isThirdParty(el)) return false;
    // Three detection routes, because the apps did not agree on markup:
    //   docs   button.menubar-hamburger         aria="Open menu"
    //   slides button.slides-menubar-hamburger  aria="Open menu"
    //   sheets button with NO CLASS AT ALL      aria="Open menu"
    // Testing `aria + " " + text` against an anchored /^menu$/ missed sheets
    // entirely, because that string is "Open menu Menu".
    return (
      /hamburger|menu-toggle|drawer-toggle/i.test(cls(el)) ||
      /^(open|close|toggle)\s+(menu|nav|navigation|sidebar)$/i.test(aria(el)) ||
      (/^menu$/i.test(text(el)) && el.children.length === 0)
    );
  };

  const visible = (el: Element): boolean => {
    if (!laidOut) {
      // Structure mode: fall back to the computed style, which jsdom does
      // model, rather than assuming everything is visible.
      const s = w && w.getComputedStyle ? w.getComputedStyle(el) : null;
      if (s && (s.display === 'none' || s.visibility === 'hidden')) return false;
      return true;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const inBody = (el: Element): boolean => {
    if (!visible(el)) return false;
    // Structure mode has no geometry to separate page body from chrome, so use
    // DOM containment. Without this the shared header's own controls (the
    // 9-dot ServiceMenu, the user chip) counted as "expanded app commands" and
    // a fully compliant app failed the gate — caught by the fixtures below.
    if (!laidOut) {
      if (header && header.contains(el)) return false;
      if (footer && footer.contains(el)) return false;
      return true;
    }
    const r = el.getBoundingClientRect();
    return r.top >= headerBottom - 1 && r.bottom <= footerTop + 1;
  };

  const describe = (el: Element): NavTrigger => {
    const r = laidOut ? el.getBoundingClientRect() : null;
    return {
      label: (aria(el) || text(el)).slice(0, 40),
      className: cls(el).slice(0, 60),
      insideHeader: !!(header && header.contains(el)),
      width: r ? Math.round(r.width) : 0,
      height: r ? Math.round(r.height) : 0,
    };
  };

  const clickable = Array.from(
    doc.querySelectorAll('button, [role="button"], [role="menuitem"]'),
  );

  const triggers = clickable.filter((el) => visible(el) && isNavTrigger(el)).map(describe);

  // Commands rendered expanded rather than collapsed behind the trigger.
  // Counted across the page body, NOT just inside [role=menubar]: docs' toolbar
  // buttons are SIBLINGS of .menubar, so a menubar-scoped count reported 0
  // while 17 were on screen.
  const CHROME = /^(back|← back|save|saved|saving|privacy|terms|source|menu)$/i;
  const commands = clickable
    .filter((el) => inBody(el) && !isNavTrigger(el) && !isThirdParty(el))
    .filter((el) => !CHROME.test(text(el)))
    .filter((el) => text(el).length > 0 || aria(el).length > 0);

  return {
    measured: laidOut ? 'layout' : 'structure',
    triggers,
    appOwned: triggers.filter((t) => !t.insideHeader),
    tooSmall: laidOut ? triggers.filter((t) => t.width < 44 || t.height < 44) : [],
    expandedCommands: commands.length,
    commandSample: commands.slice(0, 8).map((el) => (el.textContent || '').trim().slice(0, 30)),
  };
}

/**
 * Throw unless the document satisfies the mobile navigation model.
 *
 * Intended for a repo's own unit tests: render your app shell with matchMedia
 * stubbed to a mobile viewport, then call this. It needs no server, no auth and
 * no browser, which is what makes it runnable in every repo rather than only in
 * cloistr-app-audit.
 */
export function assertMobileNavModel(
  doc: Document,
  opts: { appName?: string; win?: Window } = {},
): NavAffordanceReport {
  const name = opts.appName ?? 'app';
  const r = findNavAffordances(doc, opts.win);
  const problems: string[] = [];

  if (r.appOwned.length > 0) {
    problems.push(
      `${name} renders its OWN nav trigger outside the shared header ` +
        `[${r.appOwned.map((t) => t.className || t.label).join(', ')}]. ` +
        `navigation-model.md: "No app renders its own hamburger. Ever."`,
    );
  }
  if (r.triggers.length > 1) {
    problems.push(`${name} exposes ${r.triggers.length} nav triggers at mobile; expected at most 1.`);
  }
  if (r.tooSmall.length > 0) {
    problems.push(
      `${name} has a nav trigger below the 44x44 minimum ` +
        `[${r.tooSmall.map((t) => `${t.className || t.label} ${t.width}x${t.height}`).join(', ')}].`,
    );
  }
  if (r.triggers.length > 0 && r.expandedCommands > 0) {
    problems.push(
      `${name} renders ${r.expandedCommands} commands EXPANDED beside a hamburger ` +
        `[${r.commandSample.join(', ')}]. They must collapse into it.`,
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `Mobile navigation model violated (measured: ${r.measured}):\n  ` + problems.join('\n  '),
    );
  }
  return r;
}

/**
 * Stub `matchMedia` for a given viewport width.
 *
 * jsdom ships no matchMedia at all, so `useIsMobile` would otherwise always
 * report desktop and every mobile assertion would pass vacuously — a silent
 * green, which is the failure mode this whole module exists to prevent.
 */
export function stubViewport(win: Window, width: number): void {
  Object.defineProperty(win, 'innerWidth', { writable: true, configurable: true, value: width });
  (win as unknown as { matchMedia: unknown }).matchMedia = (query: string) => {
    const m = /min-width:\s*(\d+)px/.exec(query);
    const min = m ? Number(m[1]) : 0;
    return {
      matches: width >= min,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  };
}
