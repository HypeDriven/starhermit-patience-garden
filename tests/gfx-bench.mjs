// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Settings → Graphics,
// starts a Practice deal on the 3D glasshouse table and keeps playing it with the on-screen tray —
// Draw flips stock cards to the waste (recycling the stock when it runs out), Hint highlights a move,
// and every few draws Undo flips one back — so cards fly and turn while the sunbeams, vines and dust
// motes animate. A finished deal goes to Next.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

export async function setPreset(page, preset) {
  await page.waitForFunction(() => !!window.__pg && window.__pg.appState === 'title', null, { timeout: 30000 });
  await page.click('#btn-settings');
  await page.waitForSelector('#screen-settings:not([hidden])');
  await page.locator('#gfx-section').scrollIntoViewIfNeeded();
  await page.selectOption('#gfx-preset', preset);
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, preset);
  await page.click('#btn-settings-close');
  await page.waitForSelector('#screen-settings', { state: 'hidden' });
}

export async function start(page) {
  await page.click('#btn-play');
  await page.waitForSelector('#screen-modes:not([hidden])');
  await page.locator('.mode-card-btn', { hasText: 'Practice' }).click();
  await page.waitForSelector('#screen-setup:not([hidden])');
  await page.click('#btn-start-game');
  await page.waitForFunction(() => window.__pg.appState === 'active', null, { timeout: 15000 });
  let open = true, i = 0;
  page.once('close', () => { open = false; });
  (async () => {
    while (open) {
      try {
        if (await page.locator('#screen-results:not([hidden])').count()) {
          await page.click('#btn-results-next', { timeout: 2000 });
        } else {
          const ready = await page.evaluate(() => !window.__pg.canAcceptInput || window.__pg.canAcceptInput());
          if (ready) {
            const k = i++ % 6;
            await page.click(k === 3 ? '#btn-hint' : k === 5 ? '#btn-undo' : '#btn-draw', { timeout: 2000 });
          }
        }
      } catch (e) { if (!open) return; if (process.env.BENCH_DEBUG) console.error(e.message); }
      await page.waitForTimeout(400).catch(() => {});
    }
  })();
  await page.waitForTimeout(1500);
}
