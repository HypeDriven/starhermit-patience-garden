// Graphics quality model (js/gfx.js) and its panel strings (js/gfx-i18n.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// js/gpu-level.js is a classic script in the page (window.StarHermitGpu); evaluate it the same way here.
new Function('window', 'module', readFileSync(new URL('../js/gpu-level.js', import.meta.url), 'utf8'))(globalThis, undefined);
const { PRESETS, CATEGORIES, detectPreset, detectLevel, presetForLevel, budgetFor, moteCount, petalCount, resolve, presetTier, choosePreset, describe, LEVELS, BUDGETS, MOTE_MAX, PETAL_MAX } = await import('../js/gfx.js');
const { GFX_LOCALES, gfxStrings, pickGfxLocale } = await import('../js/gfx-i18n.js');

const DESK = { cores: 8, memoryGb: 8 };
const PHONE = { mobile: true, cores: 8, memoryGb: 8 };

test('hardware level picks the Auto preset (Low 0, Balanced 4, High 10, Ultra 17)', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', DESK), 'low');
  assert.equal(detectLevel('llvmpipe (LLVM 15.0.7, 256 bits)', DESK), 0);
  assert.equal(detectPreset('', DESK), 'low', 'no WebGL');
  assert.equal(detectPreset('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', DESK), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)', DESK), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', DESK), 'balanced');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)', DESK), 'high');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  assert.equal(detectLevel('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 20);
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  for (const [p, lv] of Object.entries(LEVELS)) assert.equal(presetForLevel(lv), p);
  assert.equal(presetForLevel(3), 'low');
  assert.equal(presetForLevel(16), 'high');
});

test('phones and tablets are Balanced at most; software GPUs stay Low', () => {
  assert.equal(detectPreset('Adreno (TM) 740', PHONE), 'balanced');
  assert.ok(detectLevel('Adreno (TM) 740', PHONE) <= 9);
  assert.equal(detectPreset('Apple M1', PHONE), 'balanced');
  assert.equal(detectPreset('SwiftShader', PHONE), 'low');
});

test('per-preset budgets are explicit, grow from Low to Ultra and scale with the level', () => {
  const keys = ['material', 'paperBump', 'motes', 'petals', 'bloomRes', 'aoRes', 'blur'];
  for (const p of PRESETS) for (const k of keys) assert.ok(BUDGETS[p][k] != null, `${p}.${k}`);
  for (let i = 1; i < PRESETS.length; i++) for (const k of keys) {
    if (typeof BUDGETS.low[k] === 'number') assert.ok(BUDGETS[PRESETS[i]][k] >= BUDGETS[PRESETS[i - 1]][k], `${PRESETS[i]}.${k}`);
  }
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].material), ['lambert', 'standard', 'physical', 'physical']);
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].bloomRes), [0.5, 0.5, 0.5, 1], 'half-res bloom below Ultra');
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].blur), [false, false, true, true]);
  assert.deepEqual(resolve({ preset: 'high' }, 'low', 10).budget, BUDGETS.high, 'floor level = the tuned budget');
  assert.deepEqual(resolve({ preset: 'ultra' }, 'low', 0).budget, resolve({ preset: 'ultra' }, 'ultra', 17).budget);
  assert.ok(budgetFor('balanced', 9).motes > budgetFor('balanced', 4).motes, 'counts scale up within the preset');
  assert.ok(budgetFor('ultra', 20).motes <= MOTE_MAX && budgetFor('ultra', 20).petals <= PETAL_MAX);
  assert.equal(moteCount(resolve({ preset: 'high' }, 'low', 10)), BUDGETS.high.motes);
  assert.equal(petalCount(resolve({ preset: 'high' }, 'low', 10)), BUDGETS.high.petals);
  assert.equal(resolve({}, 'low', 0).budget.material, 'lambert', 'headless SwiftShader: Low, Lambert');
});

test('graphics summary level label in every locale', () => {
  for (const loc of GFX_LOCALES) assert.match(gfxStrings(loc).level.replace('{n}', 7), /7$/, loc);
});

test('resolve: auto uses the detected preset; explicit preset wins', () => {
  const a = resolve({ preset: 'auto' }, 'low');
  assert.equal(a.preset, 'low');
  assert.equal(a.auto, true);
  assert.equal(a.shadows, 'off');
  assert.equal(a.post, false, 'Low renders without post-processing');
  const h = resolve({ preset: 'high' }, 'low');
  assert.equal(h.preset, 'high');
  assert.equal(h.auto, false);
  assert.equal(h.shadows, presetTier('high', 'shadows'));
  assert.equal(h.post, true);
  assert.equal(resolve({}, 'nonsense').preset, 'balanced');
  assert.equal(resolve(null, undefined).preset, 'balanced');
});

test('resolve: per-category overrides apply, invalid ones fall back to the preset', () => {
  const r = resolve({ preset: 'low', bloom: 'on', shadows: 'bogus' }, 'high');
  assert.equal(r.bloom, 'on');
  assert.equal(r.shadows, presetTier('low', 'shadows'));
  assert.equal(r.post, true, 'bloom override turns the post chain on');
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    for (const p of PRESETS) assert.ok(tiers.includes(presetTier(p, cat)), `${p}.${cat}`);
  }
});

test('resolve: render scale is clamped to 50–200% and multiplies the preset scale', () => {
  assert.equal(resolve({ preset: 'high', render_scale: 5 }, 'low').renderScale, 2);
  assert.equal(resolve({ preset: 'high', render_scale: 0.1 }, 'low').renderScale, 0.5);
  assert.equal(resolve({ preset: 'high', render_scale: 1.5 }, 'low').scale, 1.5);
  assert.equal(resolve({ preset: 'ultra', render_scale: 1 }, 'low').scale, 1.25);
  const low = resolve({ preset: 'low' }, 'low');
  assert.equal(low.cap, 1, 'Low caps the pixel ratio at 1');
  assert.equal(resolve({}, 'low').adaptive, true);
  assert.equal(resolve({ adaptive: false }, 'low').adaptive, false);
  assert.equal(resolve({}, 'low').showFps, false);
  assert.equal(resolve({ show_fps: true }, 'low').showFps, true);
});

test('choosing a preset clears overrides but keeps scale, adaptive and fps', () => {
  const saved = { preset: 'low', bloom: 'on', ao: 'high', render_scale: 1.5, adaptive: false, show_fps: true };
  const next = choosePreset(saved, 'ultra');
  assert.equal(next.preset, 'ultra');
  for (const cat of Object.keys(CATEGORIES)) assert.equal(next[cat], undefined, cat);
  assert.equal(next.render_scale, 1.5);
  assert.equal(next.adaptive, false);
  assert.equal(next.show_fps, true);
  assert.equal(choosePreset(saved, 'auto').preset, 'auto');
  assert.equal(saved.bloom, 'on', 'input is not mutated');
});

test('describe summarises cost and pixels', () => {
  const s = describe(resolve({ preset: 'high' }, 'low'), [1280, 720]);
  assert.match(s, /2048² shadows/);
  assert.match(s, /SMAA/);
  assert.match(s, /1280×720 px$/);
  assert.match(describe(resolve({ preset: 'low' }, 'low')), /^no shadows/);
});

test('graphics strings exist for every required locale', () => {
  const required = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
  for (const l of required) assert.ok(GFX_LOCALES.includes(l), l);
  const en = gfxStrings('en-GB');
  const tiers = new Set(Object.values(CATEGORIES).flat());
  for (const l of GFX_LOCALES) {
    const t = gfxStrings(l);
    for (const k of Object.keys(en)) assert.ok(t[k], `${l}.${k}`);
    for (const p of PRESETS) assert.ok(t.presets[p], `${l}.presets.${p}`);
    for (const c of Object.keys(CATEGORIES)) assert.ok(t.cats[c], `${l}.cats.${c}`);
    for (const tier of tiers) assert.ok(t.tiers[tier], `${l}.tiers.${tier}`);
    assert.match(t.auto, /\{tier\}/);
    assert.match(t.fromPreset, /\{tier\}/);
  }
  assert.equal(pickGfxLocale(['de']), 'de-DE');
  assert.equal(pickGfxLocale(['es-MX']), 'es-419');
  assert.equal(pickGfxLocale(['fr-CA']), 'fr-CA');
  assert.equal(pickGfxLocale(['en-US']), 'en-US');
  assert.equal(pickGfxLocale(['ja-JP']), 'en-GB');
});
