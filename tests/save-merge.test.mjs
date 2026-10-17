// Cloud/local save merge (js/save-merge.js): nothing is dropped from either copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSaveDocs } from '../js/save-merge.js';

const doc = (over = {}) => ({ version: 1, settings: {}, progress: {}, stats: {}, achievements: { unlocked: {} }, scores: { entries: [] }, ...over });

test('progress keeps the better record of every entry', () => {
  const remote = doc({ progress: {
    journey: { j1: { stars: 1, bestMoves: 120, bestTimeMs: 90000, completedAt: 20 } },
    lessons: { a: { completedAt: 30 } },
    challenges: { c1: { completed: true, bestScore: 900, bestMs: 50000 } },
    dailies: { '2026-10-01': { score: 400, won: true } },
  } });
  const local = doc({ progress: {
    journey: { j1: { stars: 3, bestMoves: 140, bestTimeMs: 80000, completedAt: 10 }, j2: { stars: 2, completedAt: 40 } },
    lessons: { a: { completedAt: 25 }, b: { completedAt: 35 } },
    challenges: { c1: { completed: false, bestScore: 1200, bestMs: 60000 } },
    dailies: { '2026-10-01': { score: 900, won: false }, '2026-10-02': { score: 100, won: true } },
  } });
  const m = mergeSaveDocs(remote, local).progress;
  assert.deepEqual(m.journey.j1, { stars: 3, bestMoves: 120, bestTimeMs: 80000, completedAt: 10 });
  assert.ok(m.journey.j2);
  assert.equal(m.mastery.stagesCompleted, 2);
  assert.equal(m.lessons.a.completedAt, 25);
  assert.ok(m.lessons.b);
  assert.deepEqual(m.challenges.c1, { completed: true, bestScore: 1200, bestMs: 50000 });
  assert.equal(m.dailies['2026-10-01'].score, 400, 'a win beats a higher-scoring loss');
  assert.ok(m.dailies['2026-10-02']);
});

test('stats take the larger counters, the faster win and the busier copy\'s streak', () => {
  const m = mergeSaveDocs(
    doc({ stats: { games: 10, wins: 6, losses: 4, streak: 1, bestStreak: 4, bestScore: 800, bestWinMs: 200000, foundationsBanked: 300 } }),
    doc({ stats: { games: 12, wins: 5, losses: 7, streak: 3, bestStreak: 3, bestScore: 900, bestWinMs: 250000, foundationsBanked: 280 } }),
  ).stats;
  assert.equal(m.games, 12);
  assert.equal(m.wins, 6);
  assert.equal(m.losses, 7);
  assert.equal(m.streak, 3);
  assert.equal(m.bestStreak, 4);
  assert.equal(m.bestScore, 900);
  assert.equal(m.bestWinMs, 200000);
  assert.equal(m.foundationsBanked, 300);
});

test('achievements union with the earliest unlock; local scores union without duplicates', () => {
  const e = (sessionId, score) => ({ mode: 'daily', sessionId, score, moves: 100, ms: 1000, status: 'won', invalids: 0, elapsedMs: 1000 });
  const m = mergeSaveDocs(
    doc({ achievements: { unlocked: { a: 5, b: 9 } }, scores: { entries: [e('s1', 500), e('s2', 300)] } }),
    doc({ achievements: { unlocked: { a: 3, c: 7 } }, scores: { entries: [e('s1', 500), e('s3', 700)] } }),
  );
  assert.deepEqual(m.achievements.unlocked, { a: 3, b: 9, c: 7 });
  assert.deepEqual(m.scores.entries.map((x) => x.sessionId), ['s3', 's1', 's2']);
});

test('settings follow the account copy, falling back to local and defaults', () => {
  const m = mergeSaveDocs(doc({ settings: { theme: 'dusk-orchid' } }), doc({ settings: { theme: 'desert-bloom', muted: true } }));
  assert.equal(m.settings.theme, 'dusk-orchid');
  assert.equal(m.settings.muted, true);
  assert.equal(m.settings.version, 1);
});
