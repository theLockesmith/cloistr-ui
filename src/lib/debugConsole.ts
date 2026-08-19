/**
 * On-device debug console, enabled with `?debug=1`.
 *
 * WHY THIS EXISTS
 *
 * Bugs that only reproduce on a phone were undiagnosable. The operator hit
 * "Failed to sign event: No relay connections available" on stash mobile while
 * the identical action succeeded on desktop, and there was no way to read a
 * console from the device. Four source-level hypotheses were raised and refuted
 * without ever seeing what the client actually logged.
 *
 * The alternatives were worse:
 *   adb + chrome://inspect  Android only, needs a cable and a host machine, and
 *                           does nothing for iOS (which needs a Mac + Safari).
 *   eruda / vConsole        a dependency, and this package cannot currently
 *                           install one (the @cloistr registry auth has been
 *                           failing), plus it is a full DevTools clone when what
 *                           is actually needed is "show me the log lines".
 *
 * So this is deliberately tiny and dependency-free. Nothing leaves the device —
 * no network calls, no third party — which matters for a product whose entire
 * pitch is that your data stays yours. The copy button is the transport: the
 * user pastes the log wherever it is useful.
 *
 * OFF BY DEFAULT AND UNREACHABLE BY ACCIDENT. It only installs when the query
 * string explicitly asks, so shipping it costs users nothing.
 */

const MAX_LINES = 500;

type Level = 'log' | 'warn' | 'error' | 'info';

interface Entry {
  level: Level;
  time: string;
  text: string;
}

/** True when the page was asked to enable the debug console. */
export function isDebugRequested(search?: string): boolean {
  const qs = search ?? (typeof location !== 'undefined' ? location.search : '');
  if (!qs) return false;
  const v = new URLSearchParams(qs).get('debug');
  return v === '1' || v === 'true';
}

/** Render one console argument the way a human wants to read it. */
export function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  // JSON.stringify(undefined) returns undefined, NOT a string — which would
  // violate this function's return type at runtime and put a literal `undefined`
  // hole in the log where a value was expected. Caught by its own test.
  if (arg === undefined) return 'undefined';
  try {
    const out = JSON.stringify(arg);
    return out === undefined ? String(arg) : out;
  } catch {
    // Circular structures are common in DOM/WebSocket objects, and a debug
    // console that throws while formatting is worse than useless.
    return String(arg);
  }
}

/**
 * Install the console. Idempotent and safe to call unconditionally — it no-ops
 * unless `?debug=1` is present.
 *
 * Returns a disposer, or null when not installed.
 */
export function installDebugConsole(): (() => void) | null {
  if (typeof document === 'undefined' || typeof console === 'undefined') return null;
  if (!isDebugRequested()) return null;
  if (document.getElementById('cloistr-debug-console')) return null; // already installed

  const entries: Entry[] = [];
  const original: Partial<Record<Level, (...a: unknown[]) => void>> = {};

  const panel = document.createElement('div');
  panel.id = 'cloistr-debug-console';
  panel.setAttribute('role', 'log');
  panel.style.cssText = [
    'position:fixed', 'left:0', 'right:0', 'bottom:0', 'height:45vh',
    // Above every app layer including modals: a debug tool that the app can
    // cover is a debug tool you cannot read at the moment it matters.
    'z-index:2147483647',
    'background:#111', 'color:#eee', 'font:12px/1.4 ui-monospace,Menlo,monospace',
    'display:flex', 'flex-direction:column', 'border-top:2px solid #444',
  ].join(';');

  const bar = document.createElement('div');
  bar.style.cssText =
    'display:flex;gap:8px;align-items:center;padding:6px 8px;background:#222;flex-shrink:0';

  const title = document.createElement('span');
  title.textContent = 'debug';
  title.style.cssText = 'flex:1;color:#888';

  const mkBtn = (label: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      'background:#333;color:#eee;border:1px solid #555;border-radius:4px;padding:4px 8px;font:inherit';
    b.onclick = onClick;
    return b;
  };

  const out = document.createElement('div');
  out.style.cssText = 'flex:1;overflow:auto;padding:6px 8px;white-space:pre-wrap;word-break:break-word';

  const asText = () => entries.map((e) => `${e.time} [${e.level}] ${e.text}`).join('\n');

  const copy = mkBtn('copy', () => {
    const text = asText();
    // navigator.clipboard needs a secure context and can reject; the textarea
    // fallback is what makes this work on the devices most likely to need it.
    void navigator.clipboard?.writeText(text).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        ta.remove();
      }
    });
    copy.textContent = 'copied';
    setTimeout(() => (copy.textContent = 'copy'), 1200);
  });

  const clear = mkBtn('clear', () => {
    entries.length = 0;
    out.textContent = '';
  });

  const hide = mkBtn('hide', () => panel.remove());

  bar.append(title, copy, clear, hide);
  panel.append(bar, out);
  document.body.appendChild(panel);

  const colour: Record<Level, string> = {
    log: '#ddd',
    info: '#8cf',
    warn: '#fc6',
    error: '#f77',
  };

  const push = (level: Level, args: unknown[]) => {
    const text = args.map(formatArg).join(' ');
    const time = new Date().toISOString().slice(11, 19);
    entries.push({ level, time, text });
    // Bound the buffer: a long-lived page can log thousands of lines and an
    // unbounded array on a phone is its own bug.
    if (entries.length > MAX_LINES) entries.shift();

    const line = document.createElement('div');
    line.style.color = colour[level];
    line.textContent = `${time} ${text}`;
    out.appendChild(line);
    while (out.childElementCount > MAX_LINES) out.firstElementChild?.remove();
    out.scrollTop = out.scrollHeight;
  };

  (['log', 'info', 'warn', 'error'] as Level[]).forEach((level) => {
    original[level] = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original[level]?.(...args);
      try {
        push(level, args);
      } catch {
        // Never let the debug console break the app it is observing.
      }
    };
  });

  // Uncaught errors are exactly what is missing when a phone silently fails.
  const onError = (e: ErrorEvent) => push('error', [e.message]);
  const onRejection = (e: PromiseRejectionEvent) => push('error', ['unhandled rejection:', e.reason]);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  push('info', ['debug console ready —', navigator.userAgent]);

  return () => {
    (Object.keys(original) as Level[]).forEach((l) => {
      const fn = original[l];
      if (fn) console[l] = fn;
    });
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    panel.remove();
  };
}
