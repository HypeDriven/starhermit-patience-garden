// Patience Garden — local persistence.
// Versioned, checksummed documents in localStorage. No credentials or
// private data are ever stored here; conflicts preserve both snapshots.

import { checksum } from './rng.js';
import { compareResults } from './rules.js';

const PREFIX = 'patience-garden/';

export const DEFAULT_SETTINGS = {
  version: 1,
  theme: 'dawn-glasshouse',
  quality: 'high',            // low | medium | high | auto
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

function wrap(doc) {
  const body = JSON.stringify(doc);
  return { body, sum: checksum(body), savedAt: Date.now() };
}

function unwrap(raw) {
  if (!raw) return null;
  try {
    const { body, sum } = JSON.parse(raw);
    if (checksum(body) !== sum) return null; // corrupted
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function read(key, defaults) {
  const doc = unwrap(localStorage.getItem(PREFIX + key));
  if (!doc || doc.version !== defaults.version) return structuredClone(defaults);
  return { ...structuredClone(defaults), ...doc };
}

function write(key, doc) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(wrap(doc)));
    return true;
  } catch {
    return false; // storage full/blocked — session continues without persistence
  }
}

export const loadSettings = () => read('settings', DEFAULT_SETTINGS);
export const saveSettings = (s) => write('settings', s);
export const loadProgress = () => read('progress', DEFAULT_PROGRESS);
export const saveProgress = (p) => write('progress', p);
export const loadStats = () => read('stats', DEFAULT_STATS);
export const saveStats = (s) => write('stats', s);

export function loadAchievements() {
  return read('achievements', DEFAULT_ACHIEVEMENTS);
}

/** Idempotent unlock; returns true when newly unlocked. */
export function unlockAchievement(key) {
  const doc = loadAchievements();
  if (doc.unlocked[key]) return false;
  doc.unlocked[key] = Date.now();
  write('achievements', doc);
  return true;
}

// --- in-round session snapshot (resume after reload/background) ------------

export function saveSessionSnapshot(snapshot) {
  return write('session', { version: 1, ...snapshot });
}

export function loadSessionSnapshot() {
  return unwrap(localStorage.getItem(PREFIX + 'session'));
}

export function clearSessionSnapshot() {
  try { localStorage.removeItem(PREFIX + 'session'); } catch { /* ignore */ }
}

// --- local leaderboard (score chase) ----------------------------------------

export function loadScores() {
  return read('scores', { version: 1, entries: [] });
}

/**
 * Add an entry: { mode, seed, rulesetKey, score, moves, ms, assists, date }.
 * Keeps the best 100 entries per mode by score, ties by spec order.
 */
export function addScore(entry) {
  const doc = loadScores();
  doc.entries.push({
    ...entry,
    status: entry.status || 'won',            // ties: completion first
    invalids: entry.invalids || 0,            // ties: fewer invalid actions
    elapsedMs: entry.ms || 0,                 // ties: lower authoritative elapsed
    sessionId: entry.sessionId || String(entry.when || Date.now()),
    when: Date.now(),
  });
  // Primary sort: highest score first; ties per spec (rules.compareResults).
  const bySpec = (a, b) => b.score - a.score || compareResults(a, b);
  doc.entries.sort(bySpec);
  // Retention: best 100 per mode, so one prolific mode cannot evict another.
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
  write('scores', doc);
  return doc.entries;
}
