// Patience Garden — deal generation and solvability.
//
// Deals are generated *constructively*: starting from the solved state we
// apply inverse moves (un-bank foundation cards onto the tableau or waste,
// un-draw the waste back into the stock). Inverting the recorded reverse
// steps yields a certificate solution, so every generated deal is solvable
// by construction and the certificate can be replayed through the public
// rules API to prove it. A bounded search classifier is also provided for
// difficulty measurement.

import {
  createGame, createCustomGame, legalActions, applyCommand, serialize,
  rankOf, suitOf, colorOf, canPlaceOnFoundation, isWon, makeCard,
  normalizeRuleset,
} from './rules.js';
import { createRng, hashString } from './rng.js';

// ---------------------------------------------------------------------------
// Constructive winnable-deal generation
// ---------------------------------------------------------------------------

/**
 * Generate a guaranteed-solvable initial layout for `seed`.
 * Requires ruleset.suitCount >= 3 (a 7-pile tableau needs 28 cards).
 * Returns { layout, certificate } where certificate is an ordered list of
 * forward commands that solve the deal (used by validators and tests).
 */
export function generateWinnableLayout(seed, ruleset = {}) {
  const rs = normalizeRuleset(ruleset);
  if (rs.suitCount < 3) throw new Error('winnable deals need at least 3 suits');
  const rng = createRng((seed ^ hashString('patience-garden/winnable')) >>> 0);
  const suits = rs.suitCount;
  const total = 13 * suits;
  // Tableau shape: standard Klondike staircase, or a shallower profile for
  // gentler content. Targets are dealt left to right.
  const targets = Array.isArray(ruleset.targets) && ruleset.targets.length === 7
    ? ruleset.targets.slice()
    : [1, 2, 3, 4, 5, 6, 7];
  const tableauSize = targets.reduce((a, b) => a + b, 0);
  if (tableauSize > total) throw new Error('tableau targets exceed deck size');

  // Foundation stacks as in the solved state: bottom Ace .. top King.
  const found = [];
  for (let s = 0; s < suits; s++) found.push(Array.from({ length: 13 }, (_, r) => makeCard(s, r)));

  const tableau = [[], [], [], [], [], [], []];
  const waste = [];
  const stock = [];
  const reverse = [];

  let tableauSlots = tableauSize;
  let wasteSlots = total - tableauSize;

  while (found.some((f) => f.length > 0)) {
    const avail = [];
    found.forEach((f, s) => { if (f.length > 0) avail.push(s); });
    const s = avail[rng.int(avail.length)];
    const c = found[s].pop();
    const useTableau = tableauSlots > 0 && (wasteSlots <= 0 || rng() < tableauSlots / (tableauSlots + wasteSlots));
    if (useTableau) {
      const open = [];
      targets.forEach((t, p) => { if (tableau[p].length < t) open.push(p); });
      const p = open[rng.int(open.length)];
      if (tableau[p].length > 0) tableau[p][tableau[p].length - 1].up = false;
      tableau[p].push({ c, up: true });
      tableauSlots--;
      reverse.push({ op: 'unbank-tableau', card: c, pile: p });
    } else {
      waste.push(c);
      wasteSlots--;
      reverse.push({ op: 'unbank-waste', card: c });
    }
  }
  // Un-draw the waste back into the stock in draw-sized chunks (the exact
  // inverse of forward `draw` commands).
  while (waste.length > 0) {
    const n = Math.min(rs.drawCount, waste.length);
    for (let i = 0; i < n; i++) stock.push(waste.pop());
    reverse.push({ op: 'undraw', count: n });
  }

  const layout = { stock, waste: [], foundations: [[], [], [], []], tableau };
  if (rs.allFaceUp) for (const pile of layout.tableau) for (const e of pile) e.up = true;
  return { layout, certificate: invertProof(reverse) };
}

/** Invert recorded reverse steps into an ordered forward solution. */
function invertProof(reverse) {
  const commands = [];
  for (let i = reverse.length - 1; i >= 0; i--) {
    const step = reverse[i];
    if (step.op === 'undraw') {
      commands.push({ type: 'draw' });
    } else if (step.op === 'unbank-tableau') {
      commands.push({
        type: 'move',
        from: { zone: 'tableau', pile: step.pile }, // index omitted = top
        to: { zone: 'foundation', pile: suitOf(step.card) },
      });
    } else if (step.op === 'unbank-waste') {
      commands.push({
        type: 'move',
        from: { zone: 'waste', pile: 0 },
        to: { zone: 'foundation', pile: suitOf(step.card) },
      });
    }
  }
  return commands;
}

/**
 * Replay a certificate against a layout through the public rules API.
 * Returns { ok, error } — ok only when every command is legal and the
 * terminal state is a win.
 */
export function verifyCertificate(layout, ruleset, certificate) {
  let state = createCustomGame(layout, ruleset, 0);
  for (let i = 0; i < certificate.length; i++) {
    const r = applyCommand(state, certificate[i]);
    if (!r.ok) return { ok: false, error: `step ${i}: ${r.error}` };
    state = r.state;
  }
  return isWon(state) ? { ok: true } : { ok: false, error: 'certificate does not win' };
}

/** Create a guaranteed-solvable game directly from a seed. */
export function createWinnableGame(seed, ruleset = {}) {
  const { layout } = generateWinnableLayout(seed, ruleset);
  const state = createCustomGame(layout, ruleset, seed);
  state.custom = false; // constructively generated deals are rank-eligible
  return state;
}

// ---------------------------------------------------------------------------
// Bounded search classifier (difficulty measurement / content validation)
// ---------------------------------------------------------------------------

const DEFAULT_NODE_CAP = 80000;

/** Layout-only canonical key (score/turn/history ignored). */
function layoutKey(state) {
  const t = state.tableau.map((p) => p.map((e) => (e.up ? e.c : e.c + 64)).join(',')).join('|');
  return `${state.stock.join(',')}#${state.waste.join(',')}#${state.foundations.map((f) => f.length).join(',')}#${t}`;
}

/**
 * Auto-bank every "safe" card onto its foundation. A card of rank r is safe
 * when both opposite-colour foundations already hold rank r-1 or better, so
 * banking it can never remove a needed landing spot.
 */
function normalize(state) {
  let moved = true;
  let guard = 0;
  while (moved && guard++ < 400) {
    moved = false;
    const f = state.foundations;
    const tops = [];
    if (state.waste.length > 0) tops.push({ card: state.waste[state.waste.length - 1], from: { zone: 'waste', pile: 0 } });
    state.tableau.forEach((pile, p) => {
      if (pile.length > 0 && pile[pile.length - 1].up) {
        tops.push({ card: pile[pile.length - 1].c, from: { zone: 'tableau', pile: p, index: pile.length - 1 } });
      }
    });
    for (const { card, from } of tops) {
      if (!canPlaceOnFoundation(state, card)) continue;
      const r = rankOf(card), s = suitOf(card);
      const oppLow = colorOf(card) === 'red' ? Math.min(f[0].length, f[3].length) : Math.min(f[1].length, f[2].length);
      if (r <= 1 || oppLow >= r - 1) {
        const res = applyCommand(state, { type: 'move', from, to: { zone: 'foundation', pile: s } });
        if (res.ok) { res.state.history = []; Object.assign(state, res.state); moved = true; break; }
      }
    }
  }
  return state;
}

/** Prioritise moves that reveal cards and safe foundation builds. */
function orderActions(state, actions) {
  const minF = Math.min(...state.foundations.map((f, s) => (s < state.ruleset.suitCount ? f.length : 99)));
  const moves = [];
  const draws = [];
  for (const a of actions) {
    if (a.type === 'draw') { draws.push(a); continue; }
    const card = a.cards[0];
    if (a.from.zone === 'foundation') continue; // never regress in search
    if (a.from.zone === 'tableau' && a.to.zone === 'tableau') {
      const src = state.tableau[a.from.pile];
      const dst = state.tableau[a.to.pile];
      if (a.from.index === 0 && dst.length === 0) continue; // no-op shuffle
      if (rankOf(card) === 12 && dst.length === 0 && a.from.index > 0 && src[a.from.index - 1].up) continue;
    }
    let w = 0;
    if (a.to.zone === 'foundation') w += rankOf(card) <= minF + 1 ? 30 : 12;
    if (a.to.zone === 'tableau' && a.from.zone === 'tableau') {
      const src = state.tableau[a.from.pile];
      if (a.from.index > 0 && !src[a.from.index - 1].up) w += 40;
      w += a.cards.length;
    }
    if (a.from.zone === 'waste' && a.to.zone === 'tableau') w += 10;
    moves.push({ a, w });
  }
  moves.sort((x, y) => y.w - x.w);
  return moves.map((m) => m.a).concat(draws);
}

/**
 * Bounded depth-first classification with node accounting.
 * Returns { verdict: 'solvable'|'unknown', nodes }.
 */
export function classify(initial, nodeCap = DEFAULT_NODE_CAP) {
  const start = serialize(initial);
  delete start.history;
  const seen = new Set();
  let nodes = 0;

  const dfs = (state) => {
    if (isWon(state)) return true;
    if (++nodes > nodeCap) return false;
    const key = layoutKey(state);
    if (seen.has(key)) return false;
    seen.add(key);
    const actions = orderActions(state, legalActions(normalize(state)));
    for (const a of actions) {
      if (nodes > nodeCap) return false;
      const cmd = a.type === 'draw' ? { type: 'draw' } : { type: 'move', from: a.from, to: a.to };
      const r = applyCommand(state, cmd);
      if (!r.ok) continue;
      r.state.history = [];
      if (dfs(r.state)) return true;
    }
    return false;
  };

  const solved = dfs(normalize(start));
  return { verdict: solved ? 'solvable' : 'unknown', nodes };
}

/**
 * Difficulty heuristic from solution search effort (not merely bigger
 * numbers): search nodes needed to prove the certificate-free deal, plus
 * hidden information at deal time. Returns 1 (gentle) .. 5 (thorny).
 */
export function measureDifficulty(initial) {
  const { verdict, nodes } = classify(initial, 60000);
  const hidden = initial.tableau.reduce((n, p) => n.filter((e) => !e.up).length, 0);
  let level;
  if (verdict !== 'solvable') level = 5;
  else if (nodes < 300) level = 1;
  else if (nodes < 1500) level = 2;
  else if (nodes < 6000) level = 3;
  else if (nodes < 20000) level = 4;
  else level = 5;
  return { level, nodes, verdict, hidden };
}

// ---------------------------------------------------------------------------
// Strategy-playout win rate (difficulty bands, expected duration)
// ---------------------------------------------------------------------------

function playoutKey(s) {
  return JSON.stringify([s.stock, s.waste, s.foundations.map((f) => f.length),
    s.tableau.map((p) => p.map((e) => (e.up ? e.c : e.c + 64)))]);
}

function playoutSafeBank(st) {
  let moved = true, guard = 0;
  while (moved && guard++ < 400) {
    moved = false;
    const f = st.foundations;
    const tops = [];
    if (st.waste.length) tops.push({ card: st.waste[st.waste.length - 1], from: { zone: 'waste', pile: 0 } });
    st.tableau.forEach((p, i) => {
      if (p.length && p[p.length - 1].up) tops.push({ card: p[p.length - 1].c, from: { zone: 'tableau', pile: i, index: p.length - 1 } });
    });
    for (const { card, from } of tops) {
      if (!canPlaceOnFoundation(st, card)) continue;
      const r = rankOf(card), s = suitOf(card);
      const opp = colorOf(card) === 'red' ? Math.min(f[0].length, f[3].length) : Math.min(f[1].length, f[2].length);
      if (r <= 1 || opp >= r - 1) {
        const res = applyCommand(st, { type: 'move', from, to: { zone: 'foundation', pile: s } });
        if (res.ok) { res.state.history = []; st = res.state; moved = true; break; }
      }
    }
  }
  return st;
}

/** One randomized strategy playout. Returns true when the strategy wins. */
export function playout(initial, rng) {
  let st = serialize(initial);
  delete st.history;
  st = playoutSafeBank(st);
  const seen = new Set();
  let steps = 0;
  while (steps++ < 3000) {
    if (isWon(st)) return { won: true, steps };
    const acts = legalActions(st).filter((a) => !(a.type === 'move' && a.from.zone === 'foundation'));
    const reveals = [], banks = [], others = [], draws = [];
    for (const a of acts) {
      if (a.type === 'draw') { draws.push(a); continue; }
      if (a.to.zone === 'foundation') { banks.push(a); continue; }
      if (a.from.zone === 'tableau' && a.to.zone === 'tableau') {
        const src = st.tableau[a.from.pile];
        if (a.from.index > 0 && !src[a.from.index - 1].up) { reveals.push(a); continue; }
        if (a.from.index === 0 && st.tableau[a.to.pile].length === 0) continue;
      }
      others.push(a);
    }
    let pick;
    if (reveals.length) pick = rng.pick(reveals);
    else if (banks.length && rng() < 0.65) pick = rng.pick(banks);
    else if (others.length && rng() < 0.7) pick = rng.pick(others);
    else if (draws.length) pick = draws[0];
    else if (banks.length) pick = rng.pick(banks);
    else if (others.length) pick = rng.pick(others);
    else return { won: false, steps };
    const cmd = pick.type === 'draw' ? { type: 'draw' } : { type: 'move', from: pick.from, to: pick.to };
    const r = applyCommand(st, cmd);
    if (!r.ok) return { won: false, steps };
    st = playoutSafeBank(r.state);
    st.history = [];
    const k = playoutKey(st);
    if (seen.has(k)) return { won: false, steps };
    seen.add(k);
  }
  return { won: isWon(st), steps };
}

/**
 * Estimate how approachable a deal is by sampling seeded strategy playouts.
 * Returns { winRate, avgSteps, samples } — deterministic for given inputs.
 */
export function estimateWinRate(initial, samples = 48, streamSeed = 1) {
  let wins = 0, steps = 0;
  for (let i = 0; i < samples; i++) {
    const r = playout(initial, createRng((streamSeed * 1000003 + i * 7919) >>> 0));
    if (r.won) wins++;
    steps += r.steps;
  }
  return { winRate: wins / samples, avgSteps: steps / samples, samples };
}
