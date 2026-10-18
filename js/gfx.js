// Patience Garden — graphics quality model: presets, per-category overrides,
// StarHermit hardware-level detection, per-preset asset/effect budgets and a cost summary. Pure (no three.js, no DOM), so the
// Settings panel, the renderer and the unit tests agree on what a setting means.

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

// Category → allowed tiers, cheapest first.
export const CATEGORIES = {
  shadows: ['off', 'low', 'medium', 'high'],
  ao: ['off', 'on', 'high'],
  bloom: ['off', 'on'],
  grade: ['off', 'on'],
  antialias: ['off', 'fxaa', 'smaa', 'msaa'],
  reflections: ['off', 'on'],       // image-based lighting (glasshouse environment map)
  detail: ['plain', 'detailed'],    // extra foliage, lacquered cards, wood grain, felt nap
  particles: ['low', 'high'],       // dust motes and win petals
  background: ['static', 'animated'], // sunbeam shimmer and swaying vines
};

// Each preset is a row of tiers, a render scale (multiplies the capped device
// pixel ratio) and a pixel-ratio cap.
const TABLE = {
  low: { scale: 1, cap: 1, shadows: 'off', ao: 'off', bloom: 'off', grade: 'off', antialias: 'msaa', reflections: 'off', detail: 'plain', particles: 'low', background: 'static' },
  balanced: { scale: 1, cap: 1.5, shadows: 'low', ao: 'off', bloom: 'on', grade: 'on', antialias: 'fxaa', reflections: 'on', detail: 'detailed', particles: 'low', background: 'animated' },
  high: { scale: 1, cap: 2, shadows: 'medium', ao: 'on', bloom: 'on', grade: 'on', antialias: 'smaa', reflections: 'on', detail: 'detailed', particles: 'high', background: 'animated' },
  ultra: { scale: 1.25, cap: 2, shadows: 'high', ao: 'high', bloom: 'on', grade: 'on', antialias: 'msaa', reflections: 'on', detail: 'detailed', particles: 'high', background: 'animated' },
};

export const SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };

export const DEFAULT_GRAPHICS = { preset: 'auto', render_scale: 1, adaptive: true, show_fps: false };

// Auto picks the preset from the StarHermit hardware level (0 = Galaxy S20 / Intel UHD or weaker, 20 = RTX
// 5090; js/gpu-level.js → window.StarHermitGpu, a classic script loaded before the game): Low from 0,
// Balanced from 4, High from 10, Ultra from 17. Phones, tablets and ≤ 4 GB machines are capped at level 9.
export const LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };
const gpuApi = () => globalThis.StarHermitGpu;

/** Hardware level 0–20 for an unmasked renderer string plus StarHermitGpu.detectSystem() facts. */
export function detectLevel(gpu, system) {
  const G = gpuApi();
  const sys = { webgl: true, webgl2: true, ...(system || {}), gpu: String(gpu || '') };
  if (!gpu) sys.webgl = false; // no renderer string: no usable WebGL
  return G ? G.detectLevel(sys) : (gpu ? LEVELS.balanced : 0);
}

/** The preset Auto starts from for a hardware level. */
export function presetForLevel(level) {
  const G = gpuApi();
  return G ? G.presetForLevel(level, LEVELS) : PRESETS.filter((p) => LEVELS[p] <= level).pop() || 'low';
}

/** Best preset for this GPU (the hardware level already caps phones/tablets at Balanced). */
export function detectPreset(gpu, system) {
  return presetForLevel(detectLevel(gpu, system));
}

/*
 * Per-preset asset and effect budget. Each preset holds 60 FPS on the weakest GPU Auto gives it (Low →
 * level 0, Balanced → 4, High → 10, Ultra → 17; measured with tests/gfx-bench.mjs). Cards, piles, tap
 * areas and rules are identical on every preset — only visuals change.
 *   material  card shading: lambert (Low) / standard (Balanced) / lacquered physical stock with a
 *             clearcoat (High, Ultra; Detail on)
 *   paperBump card paper-tooth bump map (Detail on)
 *   motes     dust motes in the sunbeams at Particles "high" (low: 30 %), scaled with the level
 *   petals    win-petal cap at Particles "high" (low: 40 %), scaled with the level
 *   bloomRes / aoRes  bloom and GTAO resolution as a fraction of the frame
 *   blur      frosted (backdrop-filter) overlay screens over the live table
 */
export const BUDGETS = {
  low: { material: 'lambert', paperBump: false, motes: 80, petals: 150, bloomRes: 0.5, aoRes: 0.5, blur: false },
  balanced: { material: 'standard', paperBump: false, motes: 120, petals: 200, bloomRes: 0.5, aoRes: 0.5, blur: false },
  high: { material: 'physical', paperBump: true, motes: 200, petals: 300, bloomRes: 0.5, aoRes: 0.5, blur: true },
  ultra: { material: 'physical', paperBump: true, motes: 300, petals: 450, bloomRes: 1, aoRes: 1, blur: true },
};
export const MOTE_MAX = 600;
export const PETAL_MAX = 900;

/** A preset's concrete budget for a hardware level (counts scale ≤ 2× within the preset). */
export function budgetFor(preset, level) {
  const b = { ...(BUDGETS[preset] || BUDGETS.balanced) };
  const G = gpuApi(), floor = LEVELS[preset] || 0;
  const lv = Math.max(Number.isFinite(level) ? level : floor, floor);
  const k = G ? Math.min(2, G.scaleBudget(1, lv, floor)) : 1;
  b.motes = Math.min(MOTE_MAX, Math.round(b.motes * k));
  b.petals = Math.min(PETAL_MAX, Math.round(b.petals * k));
  return b;
}

/** Live mote / petal counts for resolved settings (Particles tier share of the preset's budget). */
export function moteCount(r) { return Math.round(r.budget.motes * (r.particles === 'high' ? 1 : 0.3)); }
export function petalCount(r) { return Math.round(r.budget.petals * (r.particles === 'high' ? 1 : 0.4)); }

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 */
export function resolve(saved, detected, level) {
  const s = saved || {};
  const auto = !PRESETS.includes(s.preset);
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const out = {
    preset,
    auto,
    renderScale: clamp(Number(s.render_scale) || 1, 0.5, 2),
    cap: row.cap,
  };
  out.scale = row.scale * out.renderScale;
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
  out.level = Number.isFinite(level) ? level : LEVELS[preset];
  out.budget = budgetFor(preset, out.level);
  out.adaptive = s.adaptive !== false;
  out.showFps = !!s.show_fps;
  // Post-processing runs only when something needs it; otherwise canvas MSAA is used.
  out.post = out.ao !== 'off' || out.bloom === 'on' || out.grade === 'on' ||
    out.antialias === 'fxaa' || out.antialias === 'smaa';
  return out;
}

/** Choosing a preset clears every per-category override (keeps scale/adaptive/fps). */
export function choosePreset(saved, preset) {
  const s = { ...DEFAULT_GRAPHICS, ...(saved || {}) };
  for (const cat of Object.keys(CATEGORIES)) delete s[cat];
  s.preset = PRESETS.includes(preset) ? preset : 'auto';
  return s;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
export function presetTier(preset, cat) {
  return TABLE[preset]?.[cat];
}

/** Short cost summary. `words` optionally localizes the fragments. */
export function describe(r, pixels, words = {}) {
  const w = { noShadows: 'no shadows', shadows: 'shadows', ao: 'ambient occlusion', aoHigh: 'full ambient occlusion', bloom: 'bloom', noAa: 'no anti-aliasing', ibl: 'reflections', ...words };
  const parts = [
    r.shadows === 'off' ? w.noShadows : `${SHADOW_MAP[r.shadows]}² ${w.shadows}`,
    r.ao === 'off' ? null : r.ao === 'high' ? w.aoHigh : w.ao,
    r.bloom === 'on' ? w.bloom : null,
    r.reflections === 'on' ? w.ibl : null,
    r.antialias === 'off' ? w.noAa : r.antialias.toUpperCase(),
    pixels ? `${pixels[0]}×${pixels[1]} px` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
