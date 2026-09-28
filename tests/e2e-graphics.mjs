/**
 * Patience Garden — Graphics settings end-to-end test (dev only, not shipped).
 *
 * Through the real visible UI in headless Chrome (software GPU, so Auto
 * resolves to Low): title → Settings → Graphics: switch Low → High, override
 * Bloom off, check the summary and body[data-gfx-preset]; start a 3D Practice
 * game and confirm the renderer applied it (canvas[data-gfx-preset], post
 * chain, override); enable the frame-rate readout from the pause menu's
 * Settings; reload and confirm everything persisted; try Ultra and back to
 * Auto. Runs at desktop 1280x800 and mobile 390x844 (touch). Any page error,
 * console error or console warning fails the run.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.opus': 'audio/opus',
};
// Benign headless-Chrome / swiftshader driver chatter (not emitted by the game).
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const server = createServer(async (req, res) => {
  const p = (req.url || '/').split('?')[0];
  const rel = normalize(decodeURIComponent(p === '/' ? '/index.html' : p)).replace(/^([/\\])+/, '');
  const file = join(ROOT, rel);
  if (file !== ROOT && !file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) {
    res.statusCode = 403; res.end('forbidden'); return;
  }
  try {
    const data = await readFile(file);
    res.setHeader('content-type', MIME[extname(file).toLowerCase()] || 'application/octet-stream');
    res.end(data);
  } catch { res.statusCode = 404; res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
});

const step = async (name, fn) => { await fn(); console.log(`ok - ${name}`); };
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

async function runPass(vp, opts) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !browserNoise.test(m.text())) problems.push(`${m.type()}: ${m.text()}`);
  });
  const press = (sel) => (opts.hasTouch ? page.locator(sel).tap() : page.locator(sel).click());
  const bodyPreset = () => page.evaluate(() => document.body.dataset.gfxPreset);
  const openSettings = async (btn = '#btn-settings') => {
    await press(btn);
    await page.waitForSelector('#screen-settings:not([hidden])');
    await page.locator('#gfx-section').scrollIntoViewIfNeeded();
  };
  const closeSettings = async () => {
    await press('#btn-settings-close');
    await page.waitForSelector('#screen-settings', { state: 'hidden' });
  };

  try {
    await step(`${vp}: load → Auto resolves to Low on a software GPU`, async () => {
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.waitForSelector('#screen-title:not([hidden])');
      expect(await bodyPreset() === 'low', `expected auto → low, got ${await bodyPreset()}`);
    });

    await step(`${vp}: Settings → Graphics: Low, then High, Bloom override off`, async () => {
      await openSettings();
      const autoLabel = await page.locator('#gfx-preset option[value="auto"]').textContent();
      expect(/\(.*Low.*\)|\(.*low.*\)/i.test(autoLabel), `auto label: ${autoLabel}`);
      await page.selectOption('#gfx-preset', 'low');
      await page.waitForFunction(() => document.body.dataset.gfxPreset === 'low');
      expect(/no shadows/.test(await page.textContent('#gfx-summary')), 'low summary');
      await page.selectOption('#gfx-preset', 'high');
      await page.waitForFunction(() => document.body.dataset.gfxPreset === 'high');
      const shadowLabel = await page.locator('#gfx-cat-shadows option[value="preset"]').textContent();
      expect(/Medium/.test(shadowLabel), `shadows label: ${shadowLabel}`);
      let summary = await page.textContent('#gfx-summary');
      expect(/2048² shadows/.test(summary) && /bloom/.test(summary), `high summary: ${summary}`);
      expect(/\d+×\d+ px/.test(summary), 'summary has pixels');
      await page.selectOption('#gfx-cat-bloom', 'off');
      summary = await page.textContent('#gfx-summary');
      expect(!/bloom/.test(summary), `bloom override not applied: ${summary}`);
      const box = await page.locator('#screen-settings .glass-panel').boundingBox();
      const view = page.viewportSize();
      expect(box.y >= 0 && box.y + box.height <= view.height + 1 && box.x >= 0 && box.x + box.width <= view.width + 1, 'settings panel fits the viewport');
      await page.locator('#btn-settings-close').scrollIntoViewIfNeeded();
      expect(await page.locator('#btn-settings-close').isVisible(), 'Done visible');
      await closeSettings();
    });

    await step(`${vp}: 3D game applies the settings`, async () => {
      await press('#btn-play');
      await page.waitForSelector('#screen-modes:not([hidden])');
      await page.locator('.mode-card-btn', { hasText: 'Practice' }).click();
      await page.waitForSelector('#screen-setup:not([hidden])');
      await press('#btn-start-game');
      await page.waitForFunction(() => window.__pg.appState === 'active' && !!window.__pg.renderer);
      await page.waitForFunction(() => document.getElementById('game-canvas').dataset.gfxPreset === 'high');
      await page.waitForTimeout(500);
      const info = await page.evaluate(() => window.__pg.renderer.graphicsInfo());
      expect(info.resolved.preset === 'high' && info.resolved.bloom === 'off', `renderer resolved ${JSON.stringify(info.resolved)}`);
      expect(info.postActive && !info.postFailed, 'post chain active at High');
    });

    await step(`${vp}: pause → Settings → show frame rate; switch to Ultra`, async () => {
      await press('#btn-pause');
      await page.waitForSelector('#screen-pause:not([hidden])');
      await openSettings('#btn-pause-settings');
      await page.locator('#gfx-fps').check();
      await page.waitForFunction(() => { const el = document.getElementById('fps-meter'); return el && !el.hidden; });
      await page.selectOption('#gfx-preset', 'ultra');
      await page.waitForFunction(() => document.getElementById('game-canvas').dataset.gfxPreset === 'ultra');
      expect(await page.inputValue('#gfx-cat-bloom') === 'preset', 'preset change clears overrides');
      await page.selectOption('#gfx-preset', 'high');
      await page.selectOption('#gfx-cat-bloom', 'off');
      await page.waitForTimeout(400);
      await closeSettings();
      await press('#btn-resume');
      await page.waitForFunction(() => window.__pg.appState === 'active');
      // let frames render at High until the readout has a measured value
      await page.waitForFunction(() => /\d+ fps/.test(document.getElementById('fps-meter').textContent), null, { timeout: 30000 });
      const fpsText = await page.textContent('#fps-meter');
      expect(/\d+ fps/.test(fpsText), `fps readout: ${fpsText}`);
    });

    await step(`${vp}: settings survive a reload`, async () => {
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('#screen-title:not([hidden])');
      expect(await bodyPreset() === 'high', `after reload: ${await bodyPreset()}`);
      await openSettings();
      expect(await page.inputValue('#gfx-preset') === 'high', 'preset persisted');
      expect(await page.inputValue('#gfx-cat-bloom') === 'off', 'override persisted');
      expect(await page.isChecked('#gfx-fps'), 'fps toggle persisted');
      await page.selectOption('#gfx-preset', 'auto');
      await page.waitForFunction(() => document.body.dataset.gfxPreset === 'low');
      await closeSettings();
    });
  } finally {
    if (problems.length) console.log(`PROBLEMS (${vp}):\n${problems.join('\n')}`);
    await context.close();
    if (problems.length) throw new Error(`${problems.length} console problem(s) during ${vp} pass`);
  }
}

try {
  await runPass('desktop', { viewport: { width: 1280, height: 800 } });
  await runPass('mobile', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  console.log('\nGRAPHICS E2E PASS — patience-garden, both viewports, no console errors or warnings');
} finally {
  await browser.close();
  server.close();
}
