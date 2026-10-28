// Patience Garden — merge two copies of the save documents (this device and
// the cloud slot) without dropping progress from either. Used on launch and
// after a cloud-save conflict (another device saved first).
//
// Settings follow the account (the cloud copy wins); progress, stats,
// achievements and local scores keep the better record of each entry.

import { DEFAULT_SETTINGS, DEFAULT_PROGRESS, DEFAULT_STATS, DEFAULT_ACHIEVEMENTS } from './save.js';
import { compareResults } from './rules.js';

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const obj = (v) => (v && typeof v === 'object' ? v : {});
const minOf = (a, b) => (a == null ? b : b == null ? a : Math.min(a, b));
const maxOf = (a, b) => Math.max(a || 0, b || 0);

function mergeEntries(a, b, pick) {
  const out = { ...clone(obj(a)) };
  for (const [k, v] of Object.entries(obj(b))) out[k] = k in out ? pick(out[k], clone(v)) : clone(v);
  return out;
}

export function mergeProgress(remote, local) {
  const a = { ...clone(DEFAULT_PROGRESS), ...obj(remote) };
  const b = { ...clone(DEFAULT_PROGRESS), ...obj(local) };
  const out = { ...a };
  out.journey = mergeEntries(a.journey, b.journey, (x, y) => ({
    ...x, ...y,
    stars: maxOf(x.stars, y.stars),
    bestMoves: minOf(x.bestMoves, y.bestMoves),
    bestTimeMs: minOf(x.bestTimeMs, y.bestTimeMs),
    completedAt: minOf(x.completedAt, y.completedAt),
  }));
  out.lessons = mergeEntries(a.lessons, b.lessons, (x, y) => ({ ...x, ...y, completedAt: minOf(x.completedAt, y.completedAt) }));
  out.challenges = mergeEntries(a.challenges, b.challenges, (x, y) => ({
    ...x, ...y,
    completed: !!(x.completed || y.completed),
    bestScore: maxOf(x.bestScore, y.bestScore),
    bestMs: minOf(x.bestMs, y.bestMs),
  }));
  // One record per day: a win beats a loss, then the higher score.
  out.dailies = mergeEntries(a.dailies, b.dailies, (x, y) => {
    if (!!x.won !== !!y.won) return x.won ? x : y;
    return (y.score || 0) > (x.score || 0) ? y : x;
  });
  out.mastery = { ...obj(a.mastery), ...obj(b.mastery), stagesCompleted: Object.keys(out.journey).length };
  return out;
}

export function mergeStats(remote, local) {
  const a = { ...DEFAULT_STATS, ...obj(remote) };
  const b = { ...DEFAULT_STATS, ...obj(local) };
  const out = { ...a };
  for (const k of ['games', 'wins', 'losses', 'bestStreak', 'totalMoves', 'totalTimeMs', 'foundationsBanked', 'bestScore', 'dailyCompleted']) out[k] = maxOf(a[k], b[k]);
  out.bestWinMs = minOf(a.bestWinMs, b.bestWinMs);
  // The current streak belongs to whichever copy has played more.
  out.streak = (b.games || 0) > (a.games || 0) ? b.streak : a.streak;
  return out;
}

export function mergeAchievements(remote, local) {
  const a = { ...clone(DEFAULT_ACHIEVEMENTS), ...obj(remote) };
  const b = { ...clone(DEFAULT_ACHIEVEMENTS), ...obj(local) };
  return { ...a, unlocked: mergeEntries(a.unlocked, b.unlocked, (x, y) => minOf(x, y)) }; // earliest unlock
}

export function mergeScores(remote, local) {
  const seen = new Set();
  const all = [];
  for (const e of [...(obj(remote).entries || []), ...(obj(local).entries || [])]) {
    const id = `${e.mode}|${e.sessionId}|${e.score}`;
    if (seen.has(id)) continue;
    seen.add(id);
    all.push(clone(e));
  }
  const bySpec = (x, y) => y.score - x.score || compareResults(x, y);
  all.sort(bySpec);
  const perMode = new Map();
  for (const e of all) {
    const key = e.mode || 'default';
    if (!perMode.has(key)) perMode.set(key, []);
    if (perMode.get(key).length < 100) perMode.get(key).push(e);
  }
  return { version: 1, entries: [...perMode.values()].flat().sort(bySpec) };
}

/** Merge the cloud doc into this device's doc; the result carries both copies' progress. */
export function mergeSaveDocs(remote, local) {
  const r = obj(remote), l = obj(local);
  return {
    version: 1,
    savedAt: Math.max(r.savedAt || 0, l.savedAt || 0),
    settings: { ...clone(DEFAULT_SETTINGS), ...clone(obj(l.settings)), ...clone(obj(r.settings)) },
    progress: mergeProgress(r.progress, l.progress),
    stats: mergeStats(r.stats, l.stats),
    achievements: mergeAchievements(r.achievements, l.achievements),
    scores: mergeScores(r.scores, l.scores),
  };
}
