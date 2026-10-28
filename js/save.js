// Patience Garden — the save document and the game's own options. Pure (no
// storage, no platform): the engine client (native/platform.ts) and the node
// tests share it. It replaces the browser build's js/storage.js (versioned,
// checksummed localStorage documents); what it decides is unchanged.
//
// The engine save is { version, progress, stats, achievements, scores, session }:
//  - progress, stats, achievements, scores: the documents the browser build
//    kept in localStorage (patience-garden/<doc>) and mirrored to the cloud
//    slot game:<slug> as { version: 1, savedAt, settings, progress, stats,
//    achievements, scores } (readForeign reads that text);
//  - session: the round in progress (the browser build's
//    patience-garden/session snapshot, never synced).
// Two copies merge with js/save-merge.js (the browser build's launch and
// save-conflict merge): the better record of every entry wins.

import { compareResults } from './rules.js';
import { mergeProgress, mergeStats, mergeAchievements, mergeScores } from './save-merge.js';

export const SAVE_VERSION = 1;

/** The browser build's settings document (still read from its cloud slot and settings KV). */
export const DEFAULT_SETTINGS = {
  version: 1,
  theme: 'dawn-glasshouse',
  graphics: { preset: 'auto', render_scale: 1, adaptive: true, show_fps: false },
  interfaceMode: '3d',        // 3d | 2d
  reducedMotion: false,
  highContrast: false,
  colorblindPalette: 'default', // default | deuteranopia | protanopia | tritanopia
  largeText: false,
  leftHanded: false,
  holdToDrag: false,
  timingAssist: false,        // challenges with clocks give a grace buffer
  haptics: true,
  volumes: { music: 0.5, effects: 0.8, ambience: 0.4, voice: 0.0 },
  muted: false,
  tutorialDone: false,
  cameraDrift: true,
};

export const DEFAULT_PROGRESS = {
  version: 1,
  journey: {},          // stageId -> { stars, bestMoves, bestTimeMs, completedAt }
  lessons: {},          // lessonId -> { completedAt }
  challenges: {},       // challengeId -> { completed, bestScore, bestMs }
  dailies: {},          // 'YYYY-MM-DD' -> { score, moves, ms, won }
  mastery: { stagesCompleted: 0 },
};

export const DEFAULT_STATS = {
  version: 1,
  games: 0, wins: 0, losses: 0,
  streak: 0, bestStreak: 0,
  totalMoves: 0, totalTimeMs: 0, foundationsBanked: 0,
  bestScore: 0, bestWinMs: null,
  dailyCompleted: 0,
};

export const DEFAULT_ACHIEVEMENTS = { version: 1, unlocked: {} }; // key -> timestamp

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

/** A document of `defaults`' version from anything (storage.js read: a wrong version is the default). */
function doc(raw, defaults) {
  const d = obj(raw);
  if (!d || d.version !== defaults.version) return clone(defaults);
  return { ...clone(defaults), ...clone(d) };
}

export function emptySave() {
  return {
    version: SAVE_VERSION,
    progress: clone(DEFAULT_PROGRESS),
    stats: clone(DEFAULT_STATS),
    achievements: clone(DEFAULT_ACHIEVEMENTS),
    scores: { version: 1, entries: [] },
    session: null,
  };
}

/** A save document from anything (missing or stale parts are the defaults). */
export function normalize(raw) {
  const d = obj(raw) || {};
  const scores = doc(d.scores, { version: 1, entries: [] });
  if (!Array.isArray(scores.entries)) scores.entries = [];
  const achievements = doc(d.achievements, DEFAULT_ACHIEVEMENTS);
  if (!obj(achievements.unlocked)) achievements.unlocked = {};
  const progress = doc(d.progress, DEFAULT_PROGRESS);
  for (const k of ['journey', 'lessons', 'challenges', 'dailies']) if (!obj(progress[k])) progress[k] = {};
  if (!obj(progress.mastery)) progress.mastery = { stagesCompleted: Object.keys(progress.journey).length };
  return {
    version: SAVE_VERSION,
    progress,
    stats: doc(d.stats, DEFAULT_STATS),
    achievements,
    scores,
    session: obj(d.session) ? clone(d.session) : null,
  };
}

/** Merge two saves (another device saved since, or the old cloud slot): nothing either earned is dropped; this device's round in progress wins. */
export function mergeSave(remote, local) {
  const a = normalize(remote), b = normalize(local);
  return {
    version: SAVE_VERSION,
    progress: mergeProgress(a.progress, b.progress),
    stats: mergeStats(a.stats, b.stats),
    achievements: mergeAchievements(a.achievements, b.achievements),
    scores: mergeScores(a.scores, b.scores),
    session: b.session ?? a.session,
  };
}

export function sameSave(a, b) {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

/**
 * The browser build's cloud slot text ({ version: 1, savedAt, settings, progress, stats, achievements, scores })
 * as { save, settings }, or null when it is something else.
 */
export function readForeign(text) {
  if (typeof text !== 'string' || !text) return null;
  try {
    const d = JSON.parse(text);
    if (!obj(d) || d.version !== 1 || !(obj(d.progress) || obj(d.stats) || obj(d.achievements) || obj(d.scores))) return null;
    return { save: normalize({ progress: d.progress, stats: d.stats, achievements: d.achievements, scores: d.scores }), settings: obj(d.settings) || {} };
  } catch {
    return null;
  }
}

/** Idempotent unlock (storage.js unlockAchievement); true when newly unlocked. */
export function unlockAchievement(save, key, now = Date.now()) {
  if (save.achievements.unlocked[key]) return false;
  save.achievements.unlocked[key] = now;
  return true;
}

/**
 * Add a local-board entry (storage.js addScore): { mode, seed, rulesetKey, score, moves, ms, assists, date, status, invalids, sessionId }.
 * Keeps the best 100 entries per mode by score, ties by spec order (rules.compareResults).
 */
export function addScore(save, entry, now = Date.now()) {
  const doc = save.scores;
  doc.entries.push({
    ...entry,
    status: entry.status || 'won',
    invalids: entry.invalids || 0,
    elapsedMs: entry.ms || 0,
    sessionId: entry.sessionId || String(entry.when || now),
    when: now,
  });
  const bySpec = (a, b) => b.score - a.score || compareResults(a, b);
  doc.entries.sort(bySpec);
  const perMode = new Map();
  for (const e of doc.entries) {
    const key = e.mode || 'default';
    if (!perMode.has(key)) perMode.set(key, []);
    perMode.get(key).push(e);
  }
  const kept = [];
  for (const list of perMode.values()) kept.push(...list.slice(0, 100));
  kept.sort(bySpec);
  doc.entries = kept;
  return doc.entries;
}

// --- the game's own options ---------------------------------------------------------
// The browser build's settings that stay the game's (engine `settings`, synced with the
// account): the 3D / 2D table, the theme, the colour-vision palette of the 2D cards, the
// left-handed tray, timing assistance, haptics, the camera's idle drift and whether the
// lessons were finished. Graphics, volumes, mute, reduced motion, high contrast, larger
// text and the language are the runtime's Options now.
export const THEME_IDS = ['dawn-glasshouse', 'verdant-canopy', 'dusk-orchid', 'midnight-conservatory', 'desert-bloom'];
export const PALETTES = ['default', 'deuteranopia', 'protanopia', 'tritanopia'];
export const DEFAULT_OPTIONS = {
  interfaceMode: '3d', theme: 'dawn-glasshouse', colorblindPalette: 'default',
  leftHanded: false, timingAssist: false, haptics: true, cameraDrift: true, tutorialDone: false,
};
export const OPTION_KEYS = Object.keys(DEFAULT_OPTIONS);
/** The browser build's keys in the account's settings KV (platform.js syncSettings: every settings key), removed once migrated. */
export const BROWSER_KEYS = [...Object.keys(DEFAULT_SETTINGS).filter((k) => k !== 'version'), 'ui.language'];

/** The valid option values among `raw`. */
export function pickOptions(raw) {
  const o = obj(raw) || {};
  const out = {};
  if (o.interfaceMode === '3d' || o.interfaceMode === '2d') out.interfaceMode = o.interfaceMode;
  if (THEME_IDS.includes(o.theme)) out.theme = o.theme;
  if (PALETTES.includes(o.colorblindPalette)) out.colorblindPalette = o.colorblindPalette;
  for (const k of ['leftHanded', 'timingAssist', 'haptics', 'cameraDrift', 'tutorialDone']) if (typeof o[k] === 'boolean') out[k] = o[k];
  return out;
}
