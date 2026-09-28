// Graphics quality model (js/gfx.js) and its panel strings (js/gfx-i18n.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, CATEGORIES, detectPreset, resolve, presetTier, choosePreset, describe } from '../js/gfx.js';
import { GFX_LOCALES, gfxStrings, pickGfxLocale } from '../js/gfx-i18n.js';

test('detectPreset maps GPU strings to presets', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
  assert.equal(detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)'), 'high');
  assert.equal(detectPreset('Apple M2'), 'high');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)'), 'balanced');
  assert.equal(detectPreset('Adreno (TM) 650'), 'balanced');
  assert.equal(detectPreset(''), 'balanced');
  assert.equal(detectPreset(undefined), 'balanced');
});

test('detectPreset caps Auto at balanced on mobile', () => {
  assert.equal(detectPreset('Apple M1', { mobile: true }), 'balanced');
  assert.equal(detectPreset('SwiftShader', { mobile: true }), 'low');
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
