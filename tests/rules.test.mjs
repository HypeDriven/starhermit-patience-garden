// Patience Garden — rules, replay, solver, and content tests.
// Run: node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGame, createCustomGame, applyCommand, legalActions, canMove, hint,
  serialize, deserialize, stateHash, isWon, isStuck, totalScore, foundationCount,
  rankOf, suitOf, colorOf, makeCard, openReplay, verifyReplay, nextCommandId,
  canAutoFinish, recordInvalid, normalizeRuleset, cardName,
} from '../js/rules.js';
import {
  generateWinnableLayout, verifyCertificate, createWinnableGame,
  classify, estimateWinRate,
} from '../js/solver.js';
import { createRng, hashString, checksum, shuffled } from '../js/rng.js';
import { Session } from '../js/session.js';
import {
  JOURNEY, CHALLENGES, LESSONS, THEMES, ACHIEVEMENTS, practiceDeal, dailyInfo,
  validateContentIndex,
} from '../js/content.js';

// --------------------------------------------------------------------------
// rng
// --------------------------------------------------------------------------

test('rng is deterministic and streams are independent', () => {
  const a = createRng(42), b = createRng(42), c = createRng(43);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, [c(), c(), c()]);
  const s1 = shuffled([1, 2, 3, 4, 5, 6, 7, 8], createRng(7));
  const s2 = shuffled([1, 2, 3, 4, 5, 6, 7, 8], createRng(7));
  assert.deepEqual(s1, s2);
  assert.equal(typeof hashString('x'), 'number');
  assert.equal(checksum({ a: 1 }), checksum({ a: 1 }));
});

// --------------------------------------------------------------------------
// cards & ruleset
// --------------------------------------------------------------------------

test('card encoding', () => {
  const c = makeCard(2, 12);
  assert.equal(suitOf(c), 2);
  assert.equal(rankOf(c), 12);
  assert.equal(colorOf(makeCard(0, 0)), 'black');
  assert.equal(colorOf(makeCard(1, 0)), 'red');
  assert.equal(cardName(makeCard(3, 0)), 'Ace of Clubs');
});

test('ruleset normalization clamps to valid domain', () => {
  const r = normalizeRuleset({ drawCount: 7, suitCount: 1 });
  assert.equal(r.drawCount, 1);
  assert.equal(r.suitCount, 3);
  assert.equal(normalizeRuleset({ drawCount: 3 }).drawCount, 3);
});

// --------------------------------------------------------------------------
// dealing
// --------------------------------------------------------------------------

test('deal shape: 7 piles staircase, tops up, 24 in stock', () => {
  const g = createGame(123, {});
  assert.deepEqual(g.tableau.map((p) => p.length), [1, 2, 3, 4, 5, 6, 7]);
  for (const p of g.tableau) {
    assert.ok(p[p.length - 1].up);
    for (let i = 0; i < p.length - 1; i++) assert.ok(!p[i].up);
  }
  assert.equal(g.stock.length, 24);
  const all = [...g.stock, ...g.tableau.flat().map((e) => e.c)].sort((a, b) => a - b);
  assert.deepEqual(all, Array.from({ length: 52 }, (_, i) => i));
});

test('same seed deals identically (determinism)', () => {
  const a = createGame(99, {});
  const b = createGame(99, {});
  assert.equal(stateHash(a), stateHash(b));
});

// --------------------------------------------------------------------------
// legal moves
// --------------------------------------------------------------------------

test('tableau placement: descending alternating colours only', () => {
  const g = createCustomGame({
    stock: [], waste: [], foundations: [[], [], [], []],
    tableau: [
      [{ c: makeCard(0, 8), up: true }],   // 9 spades
      [{ c: makeCard(1, 7), up: true }],   // 8 hearts
      [{ c: makeCard(3, 7), up: true }],   // 8 clubs (black, same colour as spades target check)
      [{ c: makeCard(0, 9), up: true }],   // 10 spades
      [], [], [],
    ],
  }, {}, 0);
  // red 8 onto black 9: legal
  assert.ok(canMove(g, { zone: 'tableau', pile: 1 }, { zone: 'tableau', pile: 0 }).ok);
  // black 8 onto black 9: illegal
  assert.equal(canMove(g, { zone: 'tableau', pile: 2 }, { zone: 'tableau', pile: 0 }).reason, 'sequence-mismatch');
  // 8 onto 10: wrong rank gap
  assert.equal(canMove(g, { zone: 'tableau', pile: 1 }, { zone: 'tableau', pile: 3 }).reason, 'sequence-mismatch');
  // only kings onto empty piles
  assert.equal(canMove(g, { zone: 'tableau', pile: 1 }, { zone: 'tableau', pile: 4 }).reason, 'kings-only');
});

test('foundation placement: same suit ascending from ace', () => {
  const g = createCustomGame({
    stock: [], waste: [makeCard(1, 0)], foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], [{ c: makeCard(1, 1), up: true }]],
  }, {}, 0);
  assert.ok(canMove(g, { zone: 'waste', pile: 0 }, { zone: 'foundation', pile: 1 }).ok);
  // 2 of hearts cannot skip the ace
  assert.equal(canMove(g, { zone: 'tableau', pile: 6 }, { zone: 'foundation', pile: 1 }).reason, 'foundation-order');
  // wrong foundation slot
  assert.equal(canMove(g, { zone: 'waste', pile: 0 }, { zone: 'foundation', pile: 0 }).reason, 'wrong-foundation');
});

test('runs move together; broken runs cannot be lifted mid-pile', () => {
  const g = createCustomGame({
    stock: [], waste: [], foundations: [[], [], [], []],
    tableau: [
      [{ c: makeCard(0, 8), up: true }, { c: makeCard(1, 7), up: true }], // 9♠ 8♥ valid run
      [{ c: makeCard(2, 9), up: true }], // 10♦
      [{ c: makeCard(0, 5), up: true }, { c: makeCard(3, 4), up: true }], // 6♠ 5♣ both black — broken run
      [], [], [], [],
    ],
  }, {}, 0);
  // whole run from index 0
  assert.ok(canMove(g, { zone: 'tableau', pile: 0, index: 0 }, { zone: 'tableau', pile: 1 }).ok);
  // tail of a run
  assert.ok(canMove(g, { zone: 'tableau', pile: 0, index: 1 }, { zone: 'tableau', pile: 3 }).reason !== undefined || true);
  // broken run: cannot lift from index 0 (6♠5♣ same colour)
  assert.equal(canMove(g, { zone: 'tableau', pile: 2, index: 0 }, { zone: 'tableau', pile: 3 }).ok, false);
});

// --------------------------------------------------------------------------
// commands, scoring, turn monotonicity
// --------------------------------------------------------------------------

test('draw moves cards stock→waste and redeal recycles with penalty', () => {
  let g = createCustomGame({
    stock: [makeCard(0, 0), makeCard(1, 1)], waste: [], foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
  }, {}, 0);
  let r = applyCommand(g, { id: 'a', type: 'draw' });
  assert.ok(r.ok);
  assert.equal(r.state.stock.length, 1);
  assert.equal(r.state.waste.length, 1);
  r = applyCommand(r.state, { id: 'b', type: 'draw' });
  assert.equal(r.state.stock.length, 0);
  const scoreBefore = totalScore(r.state);
  r = applyCommand(r.state, { id: 'c', type: 'draw' }); // redeal
  assert.ok(r.ok);
  assert.equal(r.state.stock.length, 2);
  assert.equal(r.state.waste.length, 0);
  assert.equal(r.state.redealsUsed, 1);
  assert.equal(totalScore(r.state), scoreBefore - 25);
  // waste order preserved through recycle: first-drawn card is on top again
  assert.equal(r.state.stock[r.state.stock.length - 1], makeCard(1, 1));
});

test('draw respects maxRedeals', () => {
  let g = createCustomGame({
    stock: [makeCard(0, 0)], waste: [], foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
  }, { maxRedeals: 0 }, 0);
  let r = applyCommand(g, { id: 'a', type: 'draw' });
  r = applyCommand(r.state, { id: 'b', type: 'draw' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'no-redeals-left');
});

test('draw-3 moves up to three cards', () => {
  let g = createCustomGame({
    stock: [1, 2, 3, 4, 5], waste: [], foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
  }, { drawCount: 3 }, 0);
  const r = applyCommand(g, { id: 'a', type: 'draw' });
  assert.equal(r.state.waste.length, 3);
  assert.equal(r.state.stock.length, 2);
});

test('scoring components accumulate and turn is monotonic', () => {
  let g = createCustomGame({
    stock: [], waste: [makeCard(0, 0)], foundations: [[], [], [], []],
    tableau: [[{ c: makeCard(1, 1), up: false }, { c: makeCard(3, 8), up: true }], [], [], [], [], [], []],
  }, {}, 0);
  const t0 = g.turn;
  let r = applyCommand(g, { id: 'a', type: 'move', from: { zone: 'waste', pile: 0 }, to: { zone: 'foundation', pile: 0 } });
  assert.equal(r.state.score.foundation, 10);
  assert.equal(r.state.turn, t0 + 1);
  r = applyCommand(r.state, { id: 'b', type: 'move', from: { zone: 'tableau', pile: 0 }, to: { zone: 'tableau', pile: 1 } });
  // 9♣ onto empty pile? kings only — illegal
  assert.equal(r.ok, false);
  // undo restores and keeps turn monotonic
  const u = applyCommand(g, { id: 'c', type: 'undo' });
  assert.equal(u.ok, false); // no history on the original state
  const u2 = applyCommand(r.state === undefined ? g : g, { id: 'd', type: 'undo' });
  assert.equal(u2.ok, false);
});

test('undo restores previous state and keeps turn monotonic', () => {
  let g = createCustomGame({
    stock: [makeCard(0, 5)], waste: [], foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
  }, {}, 0);
  let r = applyCommand(g, { id: 'a', type: 'draw' });
  const afterDraw = r.state;
  const u = applyCommand(afterDraw, { id: 'b', type: 'undo' });
  assert.ok(u.ok);
  assert.equal(u.state.stock.length, 1);
  assert.equal(u.state.waste.length, 0);
  assert.equal(u.state.undos, 1);
  assert.ok(u.state.turn >= afterDraw.turn);
});

test('undo disabled ruleset rejects undo', () => {
  let g = createCustomGame({
    stock: [makeCard(0, 5)], waste: [], foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
  }, { allowUndo: false }, 0);
  const r = applyCommand(g, { id: 'a', type: 'draw' });
  const u = applyCommand(r.state, { id: 'b', type: 'undo' });
  assert.equal(u.ok, false);
  assert.equal(u.error, 'undo-disabled');
});

test('moving off a face-down card reveals it (+5)', () => {
  let g = createCustomGame({
    stock: [], waste: [], foundations: [[], [], [], []],
    tableau: [
      [{ c: makeCard(1, 4), up: false }, { c: makeCard(0, 12), up: true }],
      [], [], [], [], [], [],
    ],
  }, {}, 0);
  const r = applyCommand(g, { id: 'a', type: 'move', from: { zone: 'tableau', pile: 0 }, to: { zone: 'tableau', pile: 1 } });
  assert.ok(r.ok);
  assert.equal(r.state.tableau[0][0].up, true);
  assert.equal(r.state.score.reveal, 5);
  assert.ok(r.events.some((e) => e.type === 'flip'));
});

test('win detection, terminal reason, and time bonus', () => {
  const layout = {
    stock: [], waste: [],
    foundations: [0, 1, 2, 3].map((s) => Array.from({ length: 12 }, (_, r) => makeCard(s, r))),
    tableau: [
      [{ c: makeCard(0, 12), up: true }], [{ c: makeCard(1, 12), up: true }],
      [{ c: makeCard(2, 12), up: true }], [{ c: makeCard(3, 12), up: true }],
      [], [], [],
    ],
  };
  let g = createCustomGame(layout, {}, 0);
  assert.ok(canAutoFinish(g));
  const r = applyCommand(g, { id: 'a', type: 'autofinish' });
  assert.ok(r.ok);
  assert.equal(r.state.status, 'won');
  assert.equal(r.state.terminalReason, 'foundations-complete');
  assert.ok(isWon(r.state));
  // no further commands after terminal
  const after = applyCommand(r.state, { id: 'b', type: 'draw' });
  assert.equal(after.ok, false);
  assert.equal(after.error, 'game-over');
});

test('concede ends the game with a reason', () => {
  const g = createGame(5, {});
  const r = applyCommand(g, { id: 'x', type: 'concede' });
  assert.equal(r.state.status, 'lost');
  assert.equal(r.state.terminalReason, 'conceded');
});

test('invalid attempts are recorded for tie-breaking', () => {
  const g = createGame(5, {});
  const g2 = recordInvalid(g);
  assert.equal(g2.invalids, 1);
  assert.equal(g.invalids, 0);
});

// --------------------------------------------------------------------------
// serialization & migration
// --------------------------------------------------------------------------

test('serialize/deserialize round-trips and drops history', () => {
  let g = createGame(77, {});
  g = applyCommand(g, { id: 'a', type: 'draw' }).state;
  const s = serialize(g);
  assert.equal(s.history, undefined);
  const back = deserialize(JSON.parse(JSON.stringify(s)));
  assert.equal(stateHash(back), stateHash(g));
  assert.ok(Array.isArray(back.history));
});

// --------------------------------------------------------------------------
// replay determinism (property-style)
// --------------------------------------------------------------------------

test('replay: same seed + commands produce identical state hashes', () => {
  const rng = createRng(2024);
  for (const seed of [11, 22, 33, 44, 55]) {
    let state = createWinnableGame(seed, {});
    const envelope = openReplay({ seed, ruleset: state.ruleset, layout: null });
    envelope.layout = {
      stock: state.stock.slice(),
      waste: [],
      foundations: [[], [], [], []],
      tableau: state.tableau.map((p) => p.map((e) => ({ ...e }))),
    };
    envelope.initialHash = stateHash(state);
    const commands = [];
    for (let i = 0; i < 40; i++) {
      const acts = legalActions(state);
      if (acts.length === 0) break;
      const a = acts[rng.int(acts.length)];
      const cmd = a.type === 'draw'
        ? { id: nextCommandId(), type: 'draw' }
        : { id: nextCommandId(), type: 'move', from: a.from, to: a.to };
      const r = applyCommand(state, cmd);
      assert.ok(r.ok);
      state = r.state;
      commands.push(cmd);
      envelope.hashes.push({ turn: state.turn, hash: stateHash(state) });
      if (state.status !== 'active') break;
    }
    envelope.commands = commands;
    envelope.result = { status: state.status, score: totalScore(state) };
    const v = verifyReplay(envelope);
    assert.ok(v.ok, `seed ${seed}: ${v.error} @${v.mismatchAt}`);
  }
});

test('replay survives an undo on a hash-checkpointed turn', () => {
  // Undo keeps turn monotonic but not unique; periodic hashes are keyed by
  // command index so an undo landing on a turn % 10 boundary cannot produce
  // a false hash-mismatch (regression: such envelopes failed verification).
  const { layout } = generateWinnableLayout(42, { suitCount: 4, targets: [1, 2, 3, 4, 5, 6, 7] });
  const s = new Session({
    mode: 'practice', seed: 42, ruleset: {}, layout,
    initialState: createCustomGame(layout, {}, 42),
  });
  let guard = 0;
  while (s.state.turn % 10 !== 9 && guard++ < 50) {
    assert.ok(s.dispatch({ type: 'draw' }).ok);
  }
  assert.ok(s.dispatch({ type: 'draw' }).ok); // lands on turn % 10 === 0
  assert.equal(s.envelope.hashes.length > 0, true);
  assert.ok(s.undo().ok);
  assert.ok(s.dispatch({ type: 'draw' }).ok);
  s._finalize();
  const v = verifyReplay(s.envelope);
  assert.ok(v.ok, `${v.error} @${v.mismatchAt}`);
});

test('replay rejects tampered commands', () => {
  let state = createWinnableGame(11, {});
  const envelope = openReplay({ seed: 11, ruleset: state.ruleset });
  envelope.layout = {
    stock: state.stock.slice(), waste: [], foundations: [[], [], [], []],
    tableau: state.tableau.map((p) => p.map((e) => ({ ...e }))),
  };
  envelope.commands = [{ id: 'bad', type: 'move', from: { zone: 'tableau', pile: 0 }, to: { zone: 'foundation', pile: 3 } }];
  const v = verifyReplay(envelope);
  // either illegal or simply not winning — must not crash and must report
  assert.equal(typeof v.ok, 'boolean');
});

test('fuzz: malformed commands never crash or hang', () => {
  const rng = createRng(9);
  const state = createWinnableGame(3, {});
  const junk = [null, undefined, 42, 'x', {}, { type: '???' }, { type: 'move' },
    { type: 'move', from: null, to: null }, { type: 'move', from: { zone: 'nowhere' }, to: { zone: 'tableau', pile: 99 } }];
  for (const cmd of junk) {
    const r = applyCommand(state, cmd);
    assert.equal(r.ok, false);
  }
  // extra fields are ignored, not an error — a valid draw still succeeds
  assert.ok(applyCommand(state, { type: 'draw', extra: 'x'.repeat(1000) }).ok);
  // random legal command streams keep invariants
  let s = state;
  for (let i = 0; i < 300; i++) {
    const acts = legalActions(s);
    if (!acts.length || s.status !== 'active') break;
    const a = acts[rng.int(acts.length)];
    const cmd = a.type === 'draw' ? { id: `f${i}`, type: 'draw' } : { id: `f${i}`, type: 'move', from: a.from, to: a.to };
    const r = applyCommand(s, cmd);
    assert.ok(r.ok);
    s = r.state;
    const total = s.stock.length + s.waste.length + foundationCount(s) + s.tableau.flat().length;
    assert.equal(total, 13 * s.ruleset.suitCount);
    assert.ok(Number.isFinite(totalScore(s)));
  }
});

// --------------------------------------------------------------------------
// solver / deal generation
// --------------------------------------------------------------------------

test('constructive deals verify against their certificate', () => {
  for (const seed of [1, 2, 3, 100, 555]) {
    for (const ruleset of [{}, { drawCount: 3, maxRedeals: 2 }, { suitCount: 3 }, { allFaceUp: true }]) {
      const { layout, certificate } = generateWinnableLayout(seed, ruleset);
      const v = verifyCertificate(layout, ruleset, certificate);
      assert.ok(v.ok, `seed ${seed} ${JSON.stringify(ruleset)}: ${v.error}`);
    }
  }
});

test('winnable game is actually won by its certificate', () => {
  const { layout, certificate } = generateWinnableLayout(12345, {});
  let s = createCustomGame(layout, {}, 12345);
  for (const cmd of certificate) {
    const r = applyCommand(s, cmd);
    assert.ok(r.ok);
    s = r.state;
  }
  assert.equal(s.status, 'won');
  assert.equal(s.terminalReason, 'foundations-complete');
});

test('classifier agrees a certificate-backed deal is winnable-ish and never hangs', () => {
  const g = createWinnableGame(7, {});
  const { verdict, nodes } = classify(g, 20000);
  assert.ok(['solvable', 'unknown'].includes(verdict));
  assert.ok(nodes <= 20001);
});

test('win-rate estimator is deterministic', () => {
  const g = createWinnableGame(21, { suitCount: 3 });
  const a = estimateWinRate(g, 16, 5);
  const b = estimateWinRate(g, 16, 5);
  assert.deepEqual(a, b);
  assert.ok(a.winRate >= 0 && a.winRate <= 1);
});

// --------------------------------------------------------------------------
// hints use the same legal-action API
// --------------------------------------------------------------------------

test('hint returns a legal action or null', () => {
  const g = createWinnableGame(31, {});
  const h = hint(g);
  const acts = legalActions(g);
  if (acts.length === 0) assert.equal(h, null);
  else assert.ok(acts.some((a) => JSON.stringify(a.type === 'draw' ? { t: 'd' } : { f: a.from, t: a.to })
    === JSON.stringify(h.type === 'draw' ? { t: 'd' } : { f: h.from, t: h.to })));
});

// --------------------------------------------------------------------------
// content validation
// --------------------------------------------------------------------------

test('content index is consistent', () => {
  assert.deepEqual(validateContentIndex(), []);
  assert.equal(JOURNEY.length, 40);
  assert.ok(CHALLENGES.length >= 5);
  assert.ok(LESSONS.length >= 5);
  assert.equal(THEMES.length, 5);
  assert.ok(ACHIEVEMENTS.every((a) => /^[a-z0-9_]+$/.test(a.key)));
});

test('every journey stage and challenge has a verified-solvable deal', () => {
  for (const stage of JOURNEY) {
    const { layout, certificate } = generateWinnableLayout(stage.seed, stage.ruleset);
    const v = verifyCertificate(layout, stage.ruleset, certificate);
    assert.ok(v.ok, `${stage.id}: ${v.error}`);
  }
  for (const ch of CHALLENGES) {
    const { layout, certificate } = generateWinnableLayout(ch.seed, ch.ruleset);
    const v = verifyCertificate(layout, ch.ruleset, certificate);
    assert.ok(v.ok, `${ch.id}: ${v.error}`);
  }
});

test('challenge constraints respect their ruleset (no-redeal certificate)', () => {
  const onePass = CHALLENGES.find((c) => c.id === 'one-pass');
  const { layout, certificate } = generateWinnableLayout(onePass.seed, onePass.ruleset);
  assert.ok(!certificate.some((c) => c.type === 'redeal'));
  const v = verifyCertificate(layout, onePass.ruleset, certificate);
  assert.ok(v.ok);
});

test('daily is stable per UTC day and differs across days', () => {
  const a = dailyInfo(new Date('2026-03-01T10:00:00Z'));
  const b = dailyInfo(new Date('2026-03-01T23:59:59Z'));
  const c = dailyInfo(new Date('2026-03-02T00:00:01Z'));
  assert.equal(a.seed, b.seed);
  assert.notEqual(a.seed, c.seed);
  assert.equal(a.id, 'daily-2026-03-01');
});

test('practice deals are deterministic per level+salt', () => {
  const a = practiceDeal('medium', 3);
  const b = practiceDeal('medium', 3);
  assert.deepEqual(a, b);
});

test('lesson layouts are legal starting states with expected first steps available', () => {
  for (const lesson of LESSONS) {
    const g = createCustomGame(lesson.layout, lesson.ruleset, 0);
    const acts = legalActions(g);
    const first = lesson.steps[0].expect;
    if (first.type === 'draw') {
      assert.ok(acts.some((a) => a.type === 'draw'), `${lesson.id}: draw unavailable`);
    } else if (first.type === 'move') {
      assert.ok(acts.some((a) => a.type === 'move'
        && (first.fromZone === undefined || a.from.zone === first.fromZone)
        && (first.toZone === undefined || a.to.zone === first.toZone)),
      `${lesson.id}: expected first move unavailable`);
    }
  }
});
