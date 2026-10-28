// Bakes the browser build's procedural canvas textures (js/render3d.js of
// commit 6e8e909, the last browser build) into assets/textures/ by running
// those painters unchanged in Chrome (~/games/tools/gpu-chrome.mjs). Canvas
// text and per-pixel strokes paint far too slowly on the engine's canvas at
// start-up, so the engine client loads these images (native/render.ts):
//   faces-2048.webp / faces-1024.webp   the 52 faces (paintFaceTexture), 9 × 6 cells of 224 × 318 / 112 × 159
//                                       (card id = suit × 13 + rank at cell id % 9, ⌊id / 9⌋)
//   back-<theme>.webp, sky-<theme>.webp, felt-<theme>.webp, felt-deep-<theme>.webp, petal-<theme>.png
//   pocket-<suit>.png, stock-slot.png, soft-dot.png
//   paper-bump.png, felt-bump.png, wood.webp, window-light.webp
// Run once; commit the images.   node tools/bake-textures.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { THEMES } from '../js/content.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'assets', 'textures');
mkdirSync(out, { recursive: true });

// The painters, verbatim from the browser build (mulberry32 … paintWindowLightTexture, shade).
const src = execFileSync('git', ['show', '6e8e909:js/render3d.js'], { cwd: root, encoding: 'utf8' });
const lines = src.split('\n');
const at = (re) => lines.findIndex((l) => re.test(l));
const painters = [
  ...lines.slice(at(/^const RANKS/), at(/^const TILT/)),
  ...lines.slice(at(/^function mulberry32/), at(/^\/\/ Colour grade/)),
  ...lines.slice(at(/^function shade/), at(/^\/\/ Geometry helpers/)),
].join('\n');

const { launchChrome } = await import('/home/albert/games/tools/gpu-chrome.mjs');
const { browser, close } = await launchChrome(chromium);
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  // A stand-in THREE: CanvasTexture keeps its canvas; the math types are unused by the painters.
  await page.evaluate((code) => {
    class Stub { constructor(...a) { this.args = a; } set() { return this; } }
    const THREE = {
      SRGBColorSpace: 'srgb', RepeatWrapping: 1000,
      Vector2: Stub, Vector3: Stub, Quaternion: Stub, Matrix4: Stub, Euler: Stub,
      CanvasTexture: class { constructor(cv) { this.image = cv; this.repeat = new Stub(); this.center = new Stub(); this.offset = new Stub(); } },
    };
    window.P = new Function('THREE', `${code}
      return { paintFaceTexture, paintBackTexture, paintPocketTexture, paintFeltTexture, paintStockSlotTexture, paintSkyTexture,
        paintSoftDotTexture, paintPetalTexture, paintNoiseBumpTexture, paintWoodTexture, paintWindowLightTexture };`)(THREE);
    window.enc = (cv, type, q) => cv.toDataURL(type, q);
  }, painters);
  const save = async (name, expr, type = 'image/webp', q = 0.92) => {
    const url = await page.evaluate(([e, t, qq]) => window.enc(eval(e), t, qq), [expr, type, q]);
    writeFileSync(join(out, name), Buffer.from(url.split(',')[1], 'base64'));
    console.log(name);
  };
  for (const [name, cw, ch] of [['faces-2048.webp', 224, 318], ['faces-1024.webp', 112, 159]]) {
    await save(name, `(() => {
      const cv = document.createElement('canvas'); cv.width = ${cw} * 9; cv.height = ${ch} * 6;
      const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high';
      for (let id = 0; id < 52; id++) g.drawImage(P.paintFaceTexture(id).image, (id % 9) * ${cw}, Math.floor(id / 9) * ${ch}, ${cw}, ${ch});
      return cv; })()`);
  }
  for (const t of THEMES) {
    const th = JSON.stringify(t);
    await save(`back-${t.id}.webp`, `P.paintBackTexture(${th}).image`);
    await save(`sky-${t.id}.webp`, `P.paintSkyTexture(${th}).image`);
    await save(`felt-${t.id}.webp`, `P.paintFeltTexture(${JSON.stringify(t.felt)}).image`);
    await save(`felt-deep-${t.id}.webp`, `P.paintFeltTexture(${JSON.stringify(t.feltDeep)}).image`);
    await save(`petal-${t.id}.png`, `P.paintPetalTexture(${th}).image`, 'image/png');
  }
  for (let s = 0; s < 4; s++) await save(`pocket-${s}.png`, `P.paintPocketTexture(${s}).image`, 'image/png');
  await save('stock-slot.png', 'P.paintStockSlotTexture().image', 'image/png');
  await save('soft-dot.png', 'P.paintSoftDotTexture().image', 'image/png');
  await save('paper-bump.png', 'P.paintNoiseBumpTexture(256, 5, 2600).image', 'image/png');
  await save('felt-bump.png', 'P.paintNoiseBumpTexture(256, 11, 5200).image', 'image/png');
  await save('wood.webp', 'P.paintWoodTexture().image');
  await save('window-light.webp', 'P.paintWindowLightTexture().image');
} finally {
  await close();
}
