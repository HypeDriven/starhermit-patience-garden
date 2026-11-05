// The look per graphics level. The engine's level (levelSettings()) owns the
// effects: shadow map, AO, bloom, grade and anti-aliasing. The browser build's
// art per preset (js/gfx.js TABLE / BUDGETS: materials, face atlas, detail)
// stays keyed by the quality tier, with the dust motes and win petals scaled
// by the level's particle budget against the tier's anchor level (at most 2×).
// The runtime owns the rest of what the old Graphics panel did: Auto and the
// level choice, render scale and the pixel-ratio cap, adaptive resolution, the
// frame-rate limit and readout. The old panel's per-effect overrides are not
// offered (Options choose a level).
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export interface Budget {
  /** Card shading: Lambert (Low), Standard (Balanced), lacquered Physical stock with a clearcoat (High, Ultra; Detail on). */
  material: "lambert" | "standard" | "physical";
  /** The card paper-tooth bump map (Detail on). */
  paperBump: boolean;
  /** Dust motes at Particles High (Low: 30 %), win petals at Particles High (Low: 40 %). */
  motes: number;
  petals: number;
  /** Face atlas size: 1024 (Low) or 2048. */
  faces: 1024 | 2048;
}
export interface Look {
  preset: QualityTier;
  /** Key-light shadow map: the level's size (0 = off). */
  shadows: number;
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** The level's bloom resolution (null = off). */
  bloom: number | null;
  grade: boolean;
  antialias: AntialiasMode;
  /** Image-based lighting (the glasshouse room environment). */
  reflections: boolean;
  /** Extra foliage and vines, lacquered cards, wood grain, felt nap, the window light. */
  detailed: boolean;
  particles: "low" | "high";
  /** Sunbeam shimmer and swaying vines. */
  animated: boolean;
  budget: Budget;
}

type Art = Omit<Look, "preset" | "budget" | "shadows" | "ao" | "bloom" | "grade" | "antialias">;
const ART: Record<QualityTier, Art> = {
  low: { reflections: false, detailed: false, particles: "low", animated: false },
  balanced: { reflections: true, detailed: true, particles: "low", animated: true },
  high: { reflections: true, detailed: true, particles: "high", animated: true },
  ultra: { reflections: true, detailed: true, particles: "high", animated: true },
};
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", paperBump: false, motes: 80, petals: 150, faces: 1024 },
  balanced: { material: "standard", paperBump: false, motes: 120, petals: 200, faces: 2048 },
  high: { material: "physical", paperBump: true, motes: 200, petals: 300, faces: 2048 },
  ultra: { material: "physical", paperBump: true, motes: 300, petals: 450, faces: 2048 },
};
/** The level whose particle budget is each tier's own. */
const ANCHOR: Record<QualityTier, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };
export const MOTE_MAX = 600, PETAL_MAX = 900;

/** The look at a graphics level. Plain data: applyLook compares it by JSON. */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const b = { ...BUDGETS[preset] };
  const k = Math.min(2, s.particles / levelSettings(ANCHOR[preset]).particles);
  b.motes = Math.min(MOTE_MAX, Math.round(b.motes * k));
  b.petals = Math.min(PETAL_MAX, Math.round(b.petals * k));
  return {
    preset, ...ART[preset],
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    antialias: s.antialias,
    budget: b,
  };
}
/** gfx.js moteCount / petalCount: the Particles tier's share of the budget. */
export function moteCount(l: Look): number { return Math.round(l.budget.motes * (l.particles === "high" ? 1 : 0.3)); }
export function petalCount(l: Look): number { return Math.round(l.budget.petals * (l.particles === "high" ? 1 : 0.4)); }
