/**
 * Patience Garden — end-to-end playthrough test (dev only, not shipped).
 *
 * Drives the REAL visible UI in headless Chrome (playwright-core + system
 * Chrome), no internal dispatch shortcuts:
 *
 *   title → settings (switch Interface to the "2D cards" board — a documented,
 *   fully playable user-facing mode — and enable reduced motion) → Play →
 *   Practice → Begin → exercise tray buttons (Draw / Hint / Undo) →
 *   pause/resume overlay → restart the deal → play the full deal to a WIN by
 *   clicking real board cards (the deal's solver certificate is recomputed
 *   from the live session seed/ruleset and replayed through DOM clicks) →
 *   results screen ("The garden blooms") → Next deal → pause → leave → title.
 *
 * The whole flow runs twice: desktop 1280x800, then a fresh mobile context
 * 390x844 with touch. Page errors and console errors (minus benign GPU noise)
 * fail the run. Screenshots go to /tmp/patience-garden-e2e-<stage>-<vp>.png.
 *
 * `server.js` is the StarHermit authoritative script, so this file embeds its
 * own minimal static server on an ephemeral port.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.ts': 'video/mp2t',
};

// Benign headless-Chrome / swiftshader noise (from tools/production_game_audit.mjs).
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const server = createServer(async (req, res) => {
  const path = (req.url || '/').split('?')[0];
  const rel = normalize(decodeURIComponent(path === '/' ? '/index.html' : path)).replace(/^([/\\])+/, '');
  const file = join(ROOT, rel);
  if (file !== ROOT && !file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) {
    res.statusCode = 403;
    res.end('forbidden');
    return;
  }
  try {
    const data = await readFile(file);
    res.setHeader('content-type', MIME[extname(file).toLowerCase()] || 'application/octet-stream');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--mute-audio'],
});

const step = async (name, fn) => {
  await fn();
  console.log(`ok - ${name}`);
};

/** Read the live session state (sync/timing only — actions go through the UI). */
const stateInfo = (page) => page.evaluate(() => {
  const s = window.__pg?.session?.state;
  if (!s) return null;
  return {
    status: s.status,
    moves: s.moves,
    stock: s.stock.length,
    waste: s.waste.length,
    hidden: s.tableau.flat().filter((e) => !e.up).length,
    banked: s.foundations.reduce((a, f) => a + f.length, 0),
  };
});

/** Click a board element and wait until the session state actually changes. */
async function boardClick(page, selector, prevMoves) {
  await waitInputReady(page);
  await page.locator(selector).first().click();
  await page.waitForFunction(
    (m) => {
      const s = window.__pg?.session?.state;
      return !s || s.moves !== m || s.status !== 'active';
    },
    prevMoves,
    { timeout: 8000 },
  );
}

/**
 * The game briefly locks input after each move (resolution phase); a click that
 * lands inside that window is silently dropped, which would leave a source card
 * unselected and the following destination click no-op (→ boardClick timeout).
 * Wait until the game accepts input again before issuing the next click.
 */
const waitInputReady = (page) =>
  page.waitForFunction(() => !window.__pg || !window.__pg.canAcceptInput || window.__pg.canAcceptInput());

async function runPass(vpName, contextOpts) {
  const SHOT = (n) => `/tmp/patience-garden-e2e-${n}-${vpName}.png`;
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !browserNoise.test(m.text())) errors.push(`console: ${m.text()}`);
  });

  try {
    await step(`${vpName}: load → title visible`, async () => {
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.waitForSelector('#screen-title:not([hidden])', { timeout: 10000 });
      await page.waitForFunction(() => !!window.__pg && window.__pg.appState === 'title');
      await page.screenshot({ path: SHOT('title') });
    });

    await step(`${vpName}: settings → 2D interface + reduced motion → close`, async () => {
      await page.click('#btn-settings');
      await page.waitForSelector('#screen-settings:not([hidden])');
      await page.selectOption('#set-interfaceMode', '2d');
      await page.check('#set-reducedMotion');
      const mode = await page.inputValue('#set-interfaceMode');
      if (mode !== '2d') throw new Error(`interface select not applied: ${mode}`);
      await page.screenshot({ path: SHOT('settings') });
      await page.click('#btn-settings-close');
      await page.waitForSelector('#screen-settings:not([hidden])', { state: 'hidden' });
    });

    await step(`${vpName}: play → practice → begin (2D board dealt)`, async () => {
      await page.click('#btn-play');
      await page.waitForSelector('#screen-modes:not([hidden])');
      await page.locator('.mode-card-btn', { hasText: 'Practice' }).click();
      await page.waitForSelector('#screen-setup:not([hidden])');
      await page.screenshot({ path: SHOT('setup') });
      await page.click('#btn-start-game');
      await page.waitForSelector('#screen-game:not([hidden])');
      await page.waitForFunction(() => window.__pg.appState === 'active');
      await page.waitForSelector('#board-dom:not([hidden]) .pcard');
      const st = await stateInfo(page);
      if (!st || st.status !== 'active' || st.moves !== 0) throw new Error('fresh deal expected: ' + JSON.stringify(st));
      console.log(`  deal: ${st.stock} in stock, ${st.hidden} hidden`);
      await page.screenshot({ path: SHOT('game') });
    });

    await step(`${vpName}: tray buttons — draw, hint, undo`, async () => {
      await page.click('#btn-draw');
      await page.waitForFunction(() => window.__pg.session.state.moves === 1);
      let st = await stateInfo(page);
      if (st.waste < 1) throw new Error('draw did not fill the waste');
      // Wait out the post-draw input lock, or the hint click is silently dropped.
      await waitInputReady(page);
      await page.click('#btn-hint');
      // Wait for the hint toast's *text*: a stale toast ("Dealing…") may still
      // be visible from game start, so matching visibility alone races.
      await page.waitForFunction(() => /Hint:/.test(document.getElementById('toast').textContent), null, { timeout: 8000 });
      const hintText = await page.textContent('#toast');
      if (!/Hint:/.test(hintText)) throw new Error('hint produced no toast: ' + hintText);
      console.log('  hint:', hintText.trim());
      await page.click('#btn-undo');
      await page.waitForFunction(() => window.__pg.session.state.moves === 0);
      st = await stateInfo(page);
      if (st.waste !== 0) throw new Error('undo did not revert the draw');
      await page.screenshot({ path: SHOT('assists') });
    });

    await step(`${vpName}: pause / resume overlay`, async () => {
      await page.click('#btn-pause');
      await page.waitForSelector('#screen-pause:not([hidden])');
      await page.waitForFunction(() => window.__pg.appState === 'paused');
      await page.screenshot({ path: SHOT('pause') });
      await page.click('#btn-resume');
      await page.waitForSelector('#screen-pause:not([hidden])', { state: 'hidden' });
      await page.waitForFunction(() => window.__pg.appState === 'active');
    });

    await step(`${vpName}: restart deal after messing with it`, async () => {
      await page.click('#btn-draw');
      await page.waitForFunction(() => window.__pg.session.state.moves === 1);
      await page.click('#btn-pause');
      await page.waitForSelector('#screen-pause:not([hidden])');
      await page.click('#btn-restart');
      await page.waitForSelector('#screen-pause:not([hidden])', { state: 'hidden' });
      await page.waitForFunction(() => window.__pg.appState === 'active' && window.__pg.session.state.moves === 0);
    });

    await step(`${vpName}: play the deal to a win via real board clicks`, async () => {
      // Recompute the solver certificate for the live deal (same seed+ruleset
      // the session was built from) and replay it through DOM clicks only.
      const cert = await page.evaluate(async () => {
        const s = window.__pg.session.state;
        const { generateWinnableLayout } = await import('./js/solver.js');
        const { certificate } = generateWinnableLayout(s.seed, JSON.parse(JSON.stringify(s.ruleset)));
        return certificate.map((c) => c.type === 'draw'
          ? { type: 'draw' }
          : { type: 'move', fromZone: c.from.zone, fromPile: c.from.pile ?? 0, toPile: c.to.pile });
      });
      console.log(`  certificate: ${cert.length} commands`);
      for (let i = 0; i < cert.length; i++) {
        const st = await stateInfo(page);
        if (!st || st.status !== 'active') throw new Error(`game ended early at step ${i}: ${JSON.stringify(st)}`);
        const c = cert[i];
        if (c.type === 'draw') {
          await boardClick(page, '.pile-slot.stock', st.moves);
        } else if (c.fromZone === 'waste') {
          // select top waste card, then tap its foundation
          await waitInputReady(page);
          await page.locator('.pcard[data-zone="waste"]').last().click();
          await boardClick(page, `.pile-slot.foundation[data-pile="${c.toPile}"]`, st.moves);
        } else {
          // select top card of the tableau row, then tap its foundation
          await waitInputReady(page);
          await page.locator(`.pile-slot.tableau[data-pile="${c.fromPile}"] .pcard`).last().click();
          await boardClick(page, `.pile-slot.foundation[data-pile="${c.toPile}"]`, st.moves);
        }
        if (i === Math.floor(cert.length / 2)) await page.screenshot({ path: SHOT('midgame') });
      }
      const fin = await stateInfo(page);
      if (fin.status !== 'won') throw new Error('expected won, got ' + JSON.stringify(fin));
      console.log(`  won in ${fin.moves} moves, ${fin.banked} banked`);
    });

    await step(`${vpName}: results screen with breakdown`, async () => {
      await page.waitForSelector('#screen-results:not([hidden])', { timeout: 8000 });
      const headline = await page.textContent('#results-heading');
      if (!/blooms/.test(headline)) throw new Error('unexpected results headline: ' + headline);
      const rows = await page.locator('#results-table tr').count();
      if (rows < 5) throw new Error(`expected breakdown rows, got ${rows}`);
      const stats = await page.evaluate(() => {
        const rec = JSON.parse(localStorage.getItem('patience-garden/stats') || 'null');
        return rec ? JSON.parse(rec.body) : null;
      });
      if (!stats || stats.wins !== 1) throw new Error('win not persisted: ' + JSON.stringify(stats));
      console.log('  headline:', headline.trim(), '· wins:', stats.wins);
      await page.screenshot({ path: SHOT('results') });
    });

    await step(`${vpName}: next deal → pause → leave → title`, async () => {
      await page.click('#btn-results-next');
      await page.waitForSelector('#screen-results:not([hidden])', { state: 'hidden' });
      await page.waitForFunction(() => window.__pg.appState === 'active' && window.__pg.session.state.moves === 0);
      await page.keyboard.press('Escape');
      await page.waitForSelector('#screen-pause:not([hidden])');
      await page.click('#btn-leave');
      await page.waitForSelector('#screen-title:not([hidden])');
      await page.waitForFunction(() => window.__pg.appState === 'title');
      await page.screenshot({ path: SHOT('home') });
    });
  } finally {
    if (errors.length) {
      console.log(`PAGE ERRORS (${vpName}):\n` + errors.join('\n'));
    }
    await context.close();
    if (errors.length) throw new Error(`${errors.length} page error(s) during ${vpName} pass`);
  }
}

try {
  await runPass('desktop', { viewport: { width: 1280, height: 800 } });
  await runPass('mobile', { viewport: { width: 390, height: 844 }, hasTouch: true });
  console.log('\nE2E PASS — patience-garden, both viewports, no page errors');
} finally {
  await browser.close();
  server.close();
}
