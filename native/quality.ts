// The look per graphics level: the browser build's four presets and budgets
// (js/gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the weakest GPU
// its Auto gave it) keyed by the runtime's quality tier (frame().quality),
// with the dust motes and win petals scaled within the tier by the level
// (frame().levelIndex, at most 2×), as the browser build scaled them by its
// StarHermit hardware level. The runtime owns the rest of what the old
// Graphics panel did: Auto and the level choice, render scale and the
// pixel-ratio cap, adaptive resolution, the frame-rate limit and readout. The
// old panel's per-effect overrides are not offered (Options choose a level).
import type { QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export interface Budget {
  /** Card shading: Lambert (Low), Standard (Balanced), lacquered Physical stock with a clearcoat (High, Ultra; Detail on). */
  material: "lambert" | "standard" | "physical";
  /** The card paper-tooth bump map (Detail on). */
  paperBump: boolean;
  /** Dust motes at Particles High (Low: 30 %), win petals at Particles High (Low: 40 %). */
  motes: number;
  petals: number;
  bloomRes: number;
  aoRes: number;
  /** Face atlas size: 1024 (Low) or 2048. */
  faces: 1024 | 2048;
}
export interface Look {
  preset: QualityTier;
  /** Key-light shadow map (0 = off). */
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
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

const TABLE: Record<QualityTier, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "msaa", reflections: false, detailed: false, particles: "low", animated: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", reflections: true, detailed: true, particles: "low", animated: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", reflections: true, detailed: true, particles: "high", animated: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", reflections: true, detailed: true, particles: "high", animated: true },
};
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", paperBump: false, motes: 80, petals: 150, bloomRes: 0.5, aoRes: 0.5, faces: 1024 },
  balanced: { material: "standard", paperBump: false, motes: 120, petals: 200, bloomRes: 0.5, aoRes: 0.5, faces: 2048 },
  high: { material: "physical", paperBump: true, motes: 200, petals: 300, bloomRes: 0.5, aoRes: 0.5, faces: 2048 },
  ultra: { material: "physical", paperBump: true, motes: 300, petals: 450, bloomRes: 1, aoRes: 1, faces: 2048 },
};
/** The first level index of each tier. */
const TIER_FLOOR: Record<QualityTier, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };
export const MOTE_MAX = 600, PETAL_MAX = 900;

/** The look for a quality tier at a level index (0 … 9). */
export function lookFor(preset: QualityTier, levelIndex: number): Look {
  const b = { ...BUDGETS[preset] };
  // Levels are about 1.64× apart in GPU throughput: budgets grow with the level above the tier's first, at most 2×.
  const k = Math.min(2, Math.pow(1.64, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  b.motes = Math.min(MOTE_MAX, Math.round(b.motes * k));
  b.petals = Math.min(PETAL_MAX, Math.round(b.petals * k));
  return { preset, ...TABLE[preset], budget: b };
}
/** gfx.js moteCount / petalCount: the Particles tier's share of the budget. */
export function moteCount(l: Look): number { return Math.round(l.budget.motes * (l.particles === "high" ? 1 : 0.3)); }
export function petalCount(l: Look): number { return Math.round(l.budget.petals * (l.particles === "high" ? 1 : 0.4)); }
