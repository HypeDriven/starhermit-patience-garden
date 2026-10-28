// The engine save (js/save.js): normalizing, merging two copies, reading the browser build's
// cloud slot, the local boards, achievements and the game's options.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptySave, normalize, mergeSave, sameSave, readForeign, addScore, unlockAchievement, pickOptions,
  DEFAULT_OPTIONS, OPTION_KEYS, BROWSER_KEYS,
} from '../js/save.js';

test('normalize fills missing documents and drops stale versions', () => {
  const s = normalize({ progress: { version: 1, journey: { j: { stars: 2 } } }, stats: { version: 0, games: 9 }, session: 'x' });
  assert.equal(s.progress.journey.j.stars, 2);
  assert.deepEqual(s.progress.lessons, {});
  assert.equal(s.stats.games, 0, 'a stats document of another version is the default');
  assert.equal(s.session, null);
  assert.deepEqual(s.scores.entries, []);
  assert.ok(sameSave(normalize(null), emptySave()));
});

test('mergeSave keeps both copies\' records and this device\'s round in progress', () => {
  const remote = emptySave();
  remote.progress.journey['journey-01'] = { stars: 1, bestMoves: 90, bestTimeMs: 1000, completedAt: 5 };
  remote.stats.games = 4;
  remote.session = { mode: 'daily', state: { status: 'active' } };
  const local = emptySave();
  local.progress.journey['journey-01'] = { stars: 3, bestMoves: 120, bestTimeMs: 900, completedAt: 7 };
  local.progress.lessons['learn-draw'] = { completedAt: 3 };
  local.session = { mode: 'practice', state: { status: 'active' } };
  const m = mergeSave(remote, local);
  assert.deepEqual(m.progress.journey['journey-01'], { stars: 3, bestMoves: 90, bestTimeMs: 900, completedAt: 5 });
  assert.ok(m.progress.lessons['learn-draw']);
  assert.equal(m.stats.games, 4);
  assert.equal(m.session.mode, 'practice');
  assert.equal(mergeSave(remote, emptySave()).session.mode, 'daily', 'no local round: the remote one');
});

test('readForeign reads the browser build\'s cloud documents and their settings', () => {
  const old = {
    version: 1, savedAt: 1,
    settings: { version: 1, theme: 'dusk-orchid', interfaceMode: '2d', volumes: { music: 0.2 } },
    progress: { version: 1, journey: { 'journey-02': { stars: 2 } }, lessons: {}, challenges: {}, dailies: {}, mastery: { stagesCompleted: 1 } },
    stats: { version: 1, games: 3, wins: 2 },
    achievements: { version: 1, unlocked: { first_bloom: 10 } },
    scores: { version: 1, entries: [{ mode: 'daily', score: 400, sessionId: 'a' }] },
  };
  const r = readForeign(JSON.stringify(old));
  assert.equal(r.save.progress.journey['journey-02'].stars, 2);
  assert.equal(r.save.stats.wins, 2);
  assert.equal(r.save.achievements.unlocked.first_bloom, 10);
  assert.equal(r.save.scores.entries.length, 1);
  assert.deepEqual(pickOptions(r.settings), { theme: 'dusk-orchid', interfaceMode: '2d' });
  assert.equal(readForeign('not json'), null);
  assert.equal(readForeign(JSON.stringify({ version: 1 })), null);
  assert.equal(readForeign(''), null);
});

test('addScore keeps the best 100 per mode, best first; achievements unlock once', () => {
  const s = emptySave();
  for (let i = 0; i < 105; i++) addScore(s, { mode: 'score', score: i, sessionId: `s${i}` }, 1000 + i);
  addScore(s, { mode: 'daily', score: 5, sessionId: 'd' }, 2000);
  const score = s.scores.entries.filter((e) => e.mode === 'score');
  assert.equal(score.length, 100);
  assert.equal(s.scores.entries[0].score, 104);
  assert.ok(s.scores.entries.some((e) => e.mode === 'daily'));
  assert.equal(unlockAchievement(s, 'first_bloom', 5), true);
  assert.equal(unlockAchievement(s, 'first_bloom', 6), false);
  assert.equal(s.achievements.unlocked.first_bloom, 5);
});

test('the game\'s options: valid values only; the browser build\'s KV keys are known', () => {
  assert.deepEqual(OPTION_KEYS, Object.keys(DEFAULT_OPTIONS));
  assert.deepEqual(pickOptions({ theme: 'nope', colorblindPalette: 'tritanopia', haptics: 'yes', leftHanded: true }), { colorblindPalette: 'tritanopia', leftHanded: true });
  for (const k of ['graphics', 'volumes', 'muted', 'reducedMotion', 'highContrast', 'largeText', 'theme', 'ui.language']) assert.ok(BROWSER_KEYS.includes(k), k);
});
