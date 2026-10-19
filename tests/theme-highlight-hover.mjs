/**
 * Playwright test: the active theme button keeps its primary styling when hovered.
 *
 * Proves the CSS fix: without it, :hover (specificity 0,1,1) overrides --active
 * (0,1,0), making the selected button look identical to any other hovered button.
 *
 * Run:  node tests/theme-highlight-hover.mjs
 * Exit: 0 = PASS, 1 = FAIL
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// Playwright is not a direct dep of cloistr-ui. Resolve from NODE_PATH or
// a sibling repo that has it (the CI smoke image has it globally).
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  const pw = require('playwright');
  chromium = pw.chromium;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const variablesCss = readFileSync(resolve(__dirname, '../src/styles/variables.css'), 'utf8');
const componentsCss = readFileSync(resolve(__dirname, '../src/styles/components.css'), 'utf8');

const html = `<!doctype html>
<html>
<head>
<style>${variablesCss}</style>
<style>${componentsCss}</style>
<style>body { background: var(--cloistr-bg); }</style>
</head>
<body>
<div class="cloistr-apps-theme-options" role="group" aria-label="Theme">
  <button type="button" class="cloistr-apps-theme-btn" data-mode="light">
    <span>☀️</span><span>Light</span>
  </button>
  <button type="button" class="cloistr-apps-theme-btn" data-mode="dark">
    <span>🌙</span><span>Dark</span>
  </button>
  <button type="button" class="cloistr-apps-theme-btn cloistr-apps-theme-btn--active" data-mode="system">
    <span>🖥️</span><span>System</span>
  </button>
</div>
<script>
  document.querySelectorAll('.cloistr-apps-theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cloistr-apps-theme-btn').forEach(b =>
        b.classList.remove('cloistr-apps-theme-btn--active'));
      btn.classList.add('cloistr-apps-theme-btn--active');
    });
  });
</script>
</body>
</html>`;

function parseRgb(s) {
  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
}

function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

let exitCode = 0;
let browser;

try {
  browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'domcontentloaded' });

  // Click "Dark" to make it active
  const darkBtn = page.locator('[data-mode="dark"]');
  await darkBtn.click();

  // Keep the pointer hovering on the Dark button (the active one)
  await darkBtn.hover();
  await page.waitForTimeout(100);

  // Read computed styles of the active+hovered button
  const activeBorder = await darkBtn.evaluate(el =>
    getComputedStyle(el).borderColor);
  const activeColor = await darkBtn.evaluate(el =>
    getComputedStyle(el).color);

  // Hover over "Light" (non-active) to get its hovered styles
  const lightBtn = page.locator('[data-mode="light"]');
  await lightBtn.hover();
  await page.waitForTimeout(100);

  const hoveredBorder = await lightBtn.evaluate(el =>
    getComputedStyle(el).borderColor);
  const hoveredColor = await lightBtn.evaluate(el =>
    getComputedStyle(el).color);

  // Now hover back to Dark to re-check
  await darkBtn.hover();
  await page.waitForTimeout(100);

  const activeHoveredBorder = await darkBtn.evaluate(el =>
    getComputedStyle(el).borderColor);
  const activeHoveredColor = await darkBtn.evaluate(el =>
    getComputedStyle(el).color);

  const activeBorderHex = rgbToHex(parseRgb(activeHoveredBorder));
  const hoveredBorderHex = rgbToHex(parseRgb(hoveredBorder));
  const activeColorHex = rgbToHex(parseRgb(activeHoveredColor));
  const hoveredColorHex = rgbToHex(parseRgb(hoveredColor));

  console.log(`Active+hovered button:  border=${activeBorderHex}  color=${activeColorHex}`);
  console.log(`Hovered non-active btn: border=${hoveredBorderHex}  color=${hoveredColorHex}`);

  // The active button's border must be the primary colour (#a78bfa)
  // and must differ from a hovered non-active button's border.
  if (activeBorderHex === hoveredBorderHex) {
    console.error('FAIL: active+hovered border matches non-active hovered border');
    console.error(`  both are ${activeBorderHex} — the active highlight is invisible`);
    exitCode = 1;
  } else {
    console.log('PASS: active+hovered border differs from non-active hovered border');
  }

  if (activeColorHex === hoveredColorHex) {
    console.error('FAIL: active+hovered text colour matches non-active hovered text');
    console.error(`  both are ${activeColorHex}`);
    exitCode = 1;
  } else {
    console.log('PASS: active+hovered text colour differs from non-active hovered text');
  }

  // Sanity: the primary colour should be in the purple range
  const activeBorderRgb = parseRgb(activeHoveredBorder);
  if (activeBorderRgb && activeBorderRgb.b > activeBorderRgb.r && activeBorderRgb.b > 200) {
    console.log(`PASS: active border looks like the primary purple (${activeBorderHex})`);
  } else {
    console.error(`FAIL: active border doesn't look like primary purple (${activeBorderHex})`);
    exitCode = 1;
  }

} catch (err) {
  console.error(`ERROR: ${err.message}`);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
}

process.exit(exitCode);
