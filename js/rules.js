// Patience Garden — rules engine.
// Pure, deterministic state transitions for a Klondike-family sequencing game:
// four ordered suit foundations, descending alternating-colour tableau runs,
// a stock and waste with configurable draw count and redeal limit.
//
// The engine exposes legal-action queries, deterministic command resolution,
// serializable state, a monotonically increasing turn number, and an explicit
// terminal-state reason. Rendering, tutorials and hints all call these same
// functions; nothing here touches the DOM, clocks, or Math.random.

import { createRng, shuffled, hashString, checksum } from './rng.js';

export const RULES_VERSION = 1;

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------
// A card is an integer 0..51: suit * 13 + rank.
// rank: 0=Ace .. 12=King.  suit: 0=Spades 1=Hearts 2=Diamonds 3=Clubs.

export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
export const SUIT_SYMBOLS = ['\u2660', '\u2665', '\u2666', '\u2663'];
export const RANK_LABELS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export const rankOf = (card) => card % 13;
export const suitOf = (card) => Math.floor(card / 13);
export const colorOf = (card) => (suitOf(card) === 1 || suitOf(card) === 2 ? 'red' : 'black');
export const makeCard = (suit, rank) => suit * 13 + rank;

export function cardName(card) {
  const names = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven',
    'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King'];
  const suits = ['Spades', 'Hearts', 'Diamonds', 'Clubs'];
  return `${names[rankOf(card)]} of ${suits[suitOf(card)]}`;
}

export function fullDeck(suitCount = 4) {
  const deck = [];
  for (let s = 0; s < suitCount; s++) {
    for (let r = 0; r < 13; r++) deck.push(makeCard(s, r));
  }
  return deck;
}

// ---------------------------------------------------------------------------
// Rulesets
// ---------------------------------------------------------------------------

export const DEFAULT_RULESET = Object.freeze({
  drawCount: 1,          // cards drawn from stock per draw command
  maxRedeals: Infinity,  // how many times the waste may be recycled to stock
  suitCount: 4,          // suits in play (fewer for introductory content)
  redealPenalty: 25,     // score cost of recycling the waste
  allowUndo: true,
  allFaceUp: false,      // challenge variant: no hidden tableau cards
});

export function normalizeRuleset(overrides = {}) {
  const r = { ...DEFAULT_RULESET, ...overrides };
  r.drawCount = r.drawCount === 3 ? 3 : 1;
  r.suitCount = Math.min(4, Math.max(3, r.suitCount | 0)); // 7-pile tableau needs >= 3 suits
  // Infinity survives neither JSON nor structuredClone — accept null/'inf'/<0 as unlimited.
  if (r.maxRedeals === Infinity || r.maxRedeals == null || r.maxRedeals === 'inf' || r.maxRedeals < 0) {
    r.maxRedeals = Infinity;
  } else {
    r.maxRedeals = Math.max(0, r.maxRedeals | 0);
  }
  r.allowUndo = !!r.allowUndo;
  r.allFaceUp = !!r.allFaceUp;
  return r;
}

// ---------------------------------------------------------------------------
// Dealing
// ---------------------------------------------------------------------------

/** Deterministic deck order for a seed and ruleset. */
export function dealDeck(seed, ruleset = DEFAULT_RULESET) {
  const rs = normalizeRuleset(ruleset);
  const rng = createRng((seed ^ hashString('patience-garden/deal')) >>> 0);
  return shuffled(fullDeck(rs.suitCount), rng);
}

function emptyState(seed, ruleset) {
  return {
    version: RULES_VERSION,
    ruleset: normalizeRuleset(ruleset),
    seed: seed >>> 0,
    stock: [], waste: [], redealsUsed: 0,
    foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
    moves: 0, invalids: 0, undos: 0, hints: 0, turn: 0,
    score: { foundation: 0, reveal: 0, wasteToTableau: 0, redeal: 0, regress: 0, timeBonus: 0 },
    status: 'active', terminalReason: null,
    elapsedMs: 0,
    custom: false,
  };
}

/** Create a fresh game dealt from a seed. */
export function createGame(seed, ruleset = DEFAULT_RULESET) {
  const state = emptyState(seed, ruleset);
  const deck = dealDeck(seed, state.ruleset);
  for (let pile = 0; pile < 7; pile++) {
    for (let i = 0; i <= pile; i++) {
      const c = deck.pop();
      state.tableau[pile].push({ c, up: i === pile || state.ruleset.allFaceUp });
    }
  }
  state.stock = deck; // top of stock is the END of the array
  return state;
}

/** Create a game from an explicit layout (tutorial / authored content). */
export function createCustomGame(layout, ruleset = DEFAULT_RULESET, seed = 0) {
  const state = emptyState(seed, ruleset);
  state.custom = true;
  state.stock = layout.stock.slice();
  state.waste = (layout.waste || []).slice();
  for (let s = 0; s < 4; s++) state.foundations[s] = (layout.foundations?.[s] || []).slice();
  for (let p = 0; p < 7; p++) {
    state.tableau[p] = (layout.tableau?.[p] || []).map((e) =>
      typeof e === 'number' ? { c: e, up: true } : { c: e.c, up: !!e.up });
  }
  return state;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export function serialize(state) {
  const { history, ...rest } = state; // history is session-only, not serialized
  return JSON.parse(JSON.stringify(rest));
}

export function deserialize(data) {
  if (!data || typeof data !== 'object') throw new Error('bad snapshot');
  const state = emptyState(data.seed >>> 0, data.ruleset);
  Object.assign(state, JSON.parse(JSON.stringify(data)));
  state.ruleset = normalizeRuleset(data.ruleset);
  state.history = [];
  return migrate(state);
}

/** Migration hook for older save versions. */
export function migrate(state) {
  if (state.version < 1) {
    state.score = { foundation: 0, reveal: 0, wasteToTableau: 0, redeal: 0, regress: 0, timeBonus: 0 };
    state.version = 1;
  }
  return state;
}

/** Canonical hash of the *visible* rules state (for replay envelopes). */
export function stateHash(state) {
  const s = serialize(state);
  delete s.elapsedMs;
  delete s.custom; // provenance flag, not rules state
  // normalize Infinity so hashes survive JSON round-trips
  s.ruleset = { ...s.ruleset, maxRedeals: s.ruleset.maxRedeals === Infinity ? 'inf' : s.ruleset.maxRedeals };
  return checksum(s);
}

// ---------------------------------------------------------------------------
// Totals / status
// ---------------------------------------------------------------------------

export function totalScore(state) {
  const sc = state.score;
  return sc.foundation + sc.reveal + sc.wasteToTableau + sc.redeal + sc.regress + sc.timeBonus;
}

export function foundationCount(state) {
  return state.foundations.reduce((n, f) => n + f.length, 0);
}

export function hiddenCount(state) {
  return state.tableau.reduce((n, p) => n + p.filter((e) => !e.up).length, 0);
}

export function isWon(state) {
  const need = 13 * state.ruleset.suitCount;
  return foundationCount(state) === need;
}

export function isFinished(state) {
  return state.status !== 'active';
}

// ---------------------------------------------------------------------------
// Move legality
// ---------------------------------------------------------------------------

/**
 * Can a run beginning at tableau index `index` be lifted?
 * The card must be face up and the run must descend in alternating colours.
 */
export function isValidRun(pile, index) {
  if (index < 0 || index >= pile.length) return false;
  for (let i = index; i < pile.length; i++) {
    if (!pile[i].up) return false;
    if (i > index) {
      const above = pile[i].c, below = pile[i - 1].c;
      if (rankOf(above) !== rankOf(below) - 1) return false;
      if (colorOf(above) === colorOf(below)) return false;
    }
  }
  return true;
}

/** Can `card` be placed on top of tableau pile `dest`? */
export function canPlaceOnTableau(card, dest) {
  if (dest.length === 0) return rankOf(card) === 12; // kings only on empty piles
  const top = dest[dest.length - 1];
  if (!top.up) return false;
  return rankOf(card) === rankOf(top.c) - 1 && colorOf(card) !== colorOf(top.c);
}

/** Can `card` be placed on its foundation? */
export function canPlaceOnFoundation(state, card) {
  const f = state.foundations[suitOf(card)];
  return f.length === rankOf(card);
}

/** Locate helpers for command targets: {zone, pile, index} */
export function resolveRun(state, from) {
  if (from.zone === 'waste') {
    if (state.waste.length === 0) return null;
    return { cards: [state.waste[state.waste.length - 1]], origin: 'waste' };
  }
  if (from.zone === 'foundation') {
    const f = state.foundations[from.pile];
    if (!f || f.length === 0) return null;
    return { cards: [f[f.length - 1]], origin: 'foundation' };
  }
  if (from.zone === 'tableau') {
    const pile = state.tableau[from.pile];
    if (!pile) return null;
    const index = from.index == null ? pile.length - 1 : from.index;
    if (!isValidRun(pile, index)) return null;
    return { cards: pile.slice(index).map((e) => e.c), origin: 'tableau', index };
  }
  return null;
}

export function canMove(state, from, to) {
  if (!from || typeof from !== 'object' || !to || typeof to !== 'object') {
    return { ok: false, reason: 'malformed-target' };
  }
  const run = resolveRun(state, from);
  if (!run) return { ok: false, reason: 'no-movable-card' };
  const card = run.cards[0];
  if (to.zone === 'foundation') {
    if (run.cards.length !== 1) return { ok: false, reason: 'run-to-foundation' };
    if (to.pile !== suitOf(card)) return { ok: false, reason: 'wrong-foundation' };
    if (!canPlaceOnFoundation(state, card)) return { ok: false, reason: 'foundation-order' };
    return { ok: true };
  }
  if (to.zone === 'tableau') {
    const dest = state.tableau[to.pile];
    if (!dest) return { ok: false, reason: 'bad-target' };
    if (from.zone === 'tableau' && from.pile === to.pile) return { ok: false, reason: 'same-pile' };
    if (!canPlaceOnTableau(card, dest)) {
      return { ok: false, reason: dest.length === 0 ? 'kings-only' : 'sequence-mismatch' };
    }
    return { ok: true };
  }
  return { ok: false, reason: 'bad-target' };
}

// ---------------------------------------------------------------------------
// Legal action enumeration (used by hints, tutorials and the UI alike)
// ---------------------------------------------------------------------------

/**
 * Enumerate all legal actions.
 * Returns [{type:'draw'} | {type:'move', from, to, cards} ...]
 */
export function legalActions(state) {
  if (isFinished(state)) return [];
  const actions = [];
  if (state.stock.length > 0 || canRedeal(state)) {
    actions.push({ type: 'draw' });
  }
  const sources = [];
  if (state.waste.length > 0) sources.push({ zone: 'waste', pile: 0, index: state.waste.length - 1 });
  state.foundations.forEach((f, s) => {
    if (f.length > 0) sources.push({ zone: 'foundation', pile: s, index: f.length - 1 });
  });
  state.tableau.forEach((pile, p) => {
    pile.forEach((e, i) => {
      if (e.up && isValidRun(pile, i)) sources.push({ zone: 'tableau', pile: p, index: i });
    });
  });
  for (const from of sources) {
    const run = resolveRun(state, from);
    if (!run) continue;
    const card = run.cards[0];
    // foundation destinations (single cards only)
    if (run.cards.length === 1 && canPlaceOnFoundation(state, card)) {
      const to = { zone: 'foundation', pile: suitOf(card) };
      if (canMove(state, from, to).ok) actions.push({ type: 'move', from, to, cards: run.cards });
    }
    // tableau destinations
    for (let p = 0; p < 7; p++) {
      const to = { zone: 'tableau', pile: p };
      if (canMove(state, from, to).ok) actions.push({ type: 'move', from, to, cards: run.cards });
    }
  }
  return actions;
}

export function canRedeal(state) {
  return state.stock.length === 0 && state.waste.length > 0 && state.redealsUsed < state.ruleset.maxRedeals;
}

/** True when no command other than undo/concede can change the state. */
export function isStuck(state) {
  return !isFinished(state) && legalActions(state).length === 0;
}

/** All remaining tableau cards face up and stock empty → safe to auto-finish. */
export function canAutoFinish(state) {
  return state.stock.length === 0 && hiddenCount(state) === 0 && !isFinished(state);
}

// ---------------------------------------------------------------------------
// Command resolution
// ---------------------------------------------------------------------------

let commandCounter = 0;
export function nextCommandId() {
  return `c${Date.now().toString(36)}-${(++commandCounter).toString(36)}`;
}

function clone(state) {
  const copy = JSON.parse(JSON.stringify(state));
  copy.ruleset = normalizeRuleset(state.ruleset); // restore Infinity lost to JSON
  return copy;
}

function pushHistory(state) {
  if (!state.ruleset.allowUndo) return;
  const snap = serialize(state);
    delete snap.history;
  state.history = state.history || [];
  state.history.push(snap);
  if (state.history.length > 400) state.history.shift();
}

function score(state, component, delta, events) {
  state.score[component] += delta;
  events.push({ type: 'score', component, delta, total: totalScore(state) });
}

function flipExposed(state, pileIndex, events) {
  const pile = state.tableau[pileIndex];
  if (pile.length > 0 && !pile[pile.length - 1].up) {
    pile[pile.length - 1].up = true;
    score(state, 'reveal', 5, events);
    events.push({ type: 'flip', pile: pileIndex, card: pile[pile.length - 1].c });
  }
}

function finishIfWon(state, events) {
  if (isWon(state)) {
    state.status = 'won';
    state.terminalReason = 'foundations-complete';
    // Time bonus: faster finishes earn more, integers only.
    const secs = Math.floor(state.elapsedMs / 1000);
    const bonus = Math.max(0, 1500 - secs * 2);
    if (bonus > 0) score(state, 'timeBonus', bonus, events);
    events.push({ type: 'win', score: totalScore(state) });
  }
}

/**
 * Apply a validated command. Returns { ok, state, events, error }.
 * The input state is not mutated; a new state is returned on success.
 * Duplicate command ids are rejected idempotently by the caller (session).
 */
export function applyCommand(prev, cmd) {
  if (!cmd || typeof cmd !== 'object') return { ok: false, error: 'malformed-command' };
  if (isFinished(prev) && cmd.type !== 'undo') {
    return { ok: false, error: 'game-over' };
  }
  const state = clone(prev);
  state.history = prev.history ? prev.history.slice() : [];
  const events = [];
  let next = null; // set when the command mutates state

  switch (cmd.type) {
    case 'draw': {
      if (state.stock.length > 0) {
        pushHistory(state);
        const n = Math.min(state.ruleset.drawCount, state.stock.length);
        for (let i = 0; i < n; i++) state.waste.push(state.stock.pop());
        events.push({ type: 'draw', count: n });
      } else if (canRedeal(state)) {
        pushHistory(state);
        state.stock = state.waste.reverse();
        state.waste = [];
        state.redealsUsed += 1;
        if (state.ruleset.redealPenalty > 0) score(state, 'redeal', -state.ruleset.redealPenalty, events);
        events.push({ type: 'redeal', used: state.redealsUsed });
      } else {
        return { ok: false, error: state.stock.length === 0 && state.waste.length === 0 ? 'stock-empty' : 'no-redeals-left' };
      }
      next = state;
      break;
    }

    case 'move': {
      const verdict = canMove(state, cmd.from, cmd.to);
      if (!verdict.ok) return { ok: false, error: verdict.reason };
      pushHistory(state);
      const run = resolveRun(state, cmd.from);
      // remove from origin
      if (run.origin === 'waste') state.waste.pop();
      else if (run.origin === 'foundation') state.foundations[cmd.from.pile].pop();
      else state.tableau[cmd.from.pile].splice(run.index);
      // place at destination
      if (cmd.to.zone === 'foundation') {
        state.foundations[cmd.to.pile].push(run.cards[0]);
        score(state, 'foundation', 10, events);
      } else {
        for (const c of run.cards) state.tableau[cmd.to.pile].push({ c, up: true });
        if (run.origin === 'waste') score(state, 'wasteToTableau', 5, events);
        if (run.origin === 'foundation') score(state, 'regress', -15, events);
      }
      if (run.origin === 'tableau') flipExposed(state, cmd.from.pile, events);
      events.push({ type: 'move', from: cmd.from, to: cmd.to, cards: run.cards });
      next = state;
      break;
    }

    case 'autofinish': {
      if (!canAutoFinish(state)) return { ok: false, error: 'not-auto-finishable' };
      pushHistory(state);
      let moved = true;
      let guard = 0;
      while (moved && guard++ < 600) {
        moved = false;
        const candidates = [];
        if (state.waste.length > 0) candidates.push(state.waste[state.waste.length - 1]);
        for (const pile of state.tableau) if (pile.length > 0 && pile[pile.length - 1].up) candidates.push(pile[pile.length - 1].c);
        candidates.sort((a, b) => rankOf(a) - rankOf(b));
        for (const card of candidates) {
          if (!canPlaceOnFoundation(state, card)) continue;
          let from = null;
          if (state.waste.length > 0 && state.waste[state.waste.length - 1] === card) from = { zone: 'waste', pile: 0 };
          else for (let p = 0; p < 7; p++) {
            const pile = state.tableau[p];
            if (pile.length > 0 && pile[pile.length - 1].c === card) { from = { zone: 'tableau', pile: p }; break; }
          }
          if (!from) continue;
          const sub = applyMoveInner(state, from, { zone: 'foundation', pile: suitOf(card) }, events);
          if (sub) { moved = true; break; }
        }
      }
      next = state;
      break;
    }

    case 'undo': {
      if (!state.ruleset.allowUndo) return { ok: false, error: 'undo-disabled' };
      const history = prev.history || [];
      if (history.length === 0) return { ok: false, error: 'nothing-to-undo' };
      const restored = deserialize(history[history.length - 1]);
      restored.history = history.slice(0, -1);
      restored.undos = prev.undos + 1;
      restored.turn = prev.turn; // turn remains monotonic across undo
      events.push({ type: 'undo' });
      return { ok: true, state: { ...restored, turn: prev.turn }, events };
    }

    case 'hint': { // assist — recorded in the log so replay reconstructs it
      state.hints += 1;
      events.push({ type: 'hint' });
      next = state;
      break;
    }

    case 'concede': {
      state.status = 'lost';
      state.terminalReason = 'conceded';
      events.push({ type: 'lose', reason: 'conceded' });
      next = state;
      break;
    }

    case 'fail': { // challenge constraints (move/time limit) breached
      state.status = 'lost';
      state.terminalReason = typeof cmd.reason === 'string' ? cmd.reason : 'constraint-breached';
      events.push({ type: 'lose', reason: state.terminalReason });
      next = state;
      break;
    }

    default:
      return { ok: false, error: 'unknown-command' };
  }

  if (next) {
    next.moves += (cmd.type === 'autofinish' || cmd.type === 'hint') ? 0 : 1;
    next.turn = prev.turn + 1;
    finishIfWon(next, events);
    return { ok: true, state: next, events };
  }
  return { ok: false, error: 'unreachable' };
}

/** Inner move used by autofinish (no history push, no legality re-check). */
function applyMoveInner(state, from, to, events) {
  const verdict = canMove(state, from, to);
  if (!verdict.ok) return false;
  const run = resolveRun(state, from);
  if (run.origin === 'waste') state.waste.pop();
  else if (run.origin === 'foundation') state.foundations[from.pile].pop();
  else state.tableau[from.pile].splice(run.index);
  if (to.zone === 'foundation') {
    state.foundations[to.pile].push(run.cards[0]);
    score(state, 'foundation', 10, events);
  } else {
    for (const c of run.cards) state.tableau[to.pile].push({ c, up: true });
    if (run.origin === 'waste') score(state, 'wasteToTableau', 5, events);
    if (run.origin === 'foundation') score(state, 'regress', -15, events);
  }
  if (run.origin === 'tableau') flipExposed(state, from.pile, events);
  events.push({ type: 'move', from, to, cards: run.cards });
  return true;
}

/** Record a rejected action attempt (for tie-breaking and feedback). */
export function recordInvalid(prev) {
  const state = clone(prev);
  state.history = prev.history;
  state.invalids = prev.invalids + 1;
  return state;
}

// ---------------------------------------------------------------------------
// Hints — uses legalActions, never a private copy of the rules
// ---------------------------------------------------------------------------

/**
 * Pick the most instructive legal action.
 * Priority: reveal hidden cards, build foundations when safe, free buried
 * cards, move from waste, reposition runs, then draw.
 */
export function hint(state) {
  const actions = legalActions(state);
  if (actions.length === 0) return null;
  const minFoundation = Math.min(...state.foundations.map((f, s) =>
    s < state.ruleset.suitCount ? f.length : 99));

  const scored = actions.map((a) => {
    if (a.type === 'draw') return { a, weight: state.stock.length > 0 ? 1 : 2 };
    let w = 0;
    const card = a.cards[0];
    if (a.from.zone === 'foundation') w -= 8; // regression: rarely wise
    if (a.to.zone === 'foundation') {
      w += 4;
      if (rankOf(card) <= minFoundation + 1) w += 4; // safe to bank
    }
    if (a.to.zone === 'tableau' && a.from.zone === 'tableau') {
      const src = state.tableau[a.from.pile];
      if (a.from.index > 0 && !src[a.from.index - 1].up) w += 10; // reveals a card
      else if (a.from.index === 0 && rankOf(card) !== 12) w -= 3; // pointless shuffle
    }
    if (a.from.zone === 'waste' && a.to.zone === 'tableau') {
      w += 3;
      const src = state.tableau[a.to.pile];
      if (src.length === 0) w -= 1;
    }
    if (a.from.zone === 'waste' && a.to.zone === 'foundation') w += 2;
    return { a, weight: w };
  });
  scored.sort((x, y) => y.weight - x.weight);
  return scored[0].a;
}

// ---------------------------------------------------------------------------
// Replay envelope
// ---------------------------------------------------------------------------

export const REPLAY_SCHEMA = 1;

export function openReplay({ seed, ruleset, contentVersion = 1, layout = null }) {
  return {
    schema: REPLAY_SCHEMA,
    build: RULES_VERSION,
    contentVersion,
    seed: seed >>> 0,
    ruleset: normalizeRuleset(ruleset),
    layout,
    initialHash: null,
    timestampOffset: 0,
    commands: [],
    hashes: [],
    result: null,
  };
}

export function replayInitialState(envelope) {
  const state = envelope.layout
    ? createCustomGame(envelope.layout, envelope.ruleset, envelope.seed)
    : createGame(envelope.seed, envelope.ruleset);
  return state;
}

/** Re-run an envelope; returns { ok, state, error, mismatchAt }. */
export function verifyReplay(envelope) {
  if (!envelope || envelope.schema !== REPLAY_SCHEMA) return { ok: false, error: 'bad-envelope' };
  let state = replayInitialState(envelope);
  if (envelope.initialHash && stateHash(state) !== envelope.initialHash) {
    return { ok: false, error: 'initial-hash-mismatch' };
  }
  const seen = new Set();
  // Periodic hashes are keyed by command index (`at`) when available — turn
  // numbers are not unique across undo, so turn-keyed hashes can falsely
  // mismatch. Legacy envelopes carry turn-only hashes; match those by turn.
  const indexed = envelope.hashes.some((h) => typeof h.at === 'number');
  for (let i = 0; i < envelope.commands.length; i++) {
    const cmd = envelope.commands[i];
    if (cmd.id && seen.has(cmd.id)) continue; // idempotent duplicates
    if (cmd.id) seen.add(cmd.id);
    if (typeof cmd.elapsedMs === 'number') state.elapsedMs = cmd.elapsedMs;
    const r = applyCommand(state, cmd);
    if (!r.ok) return { ok: false, error: `illegal-command:${r.error}`, mismatchAt: i };
    state = r.state;
    const expected = indexed
      ? envelope.hashes.find((h) => h.at === i + 1)
      : envelope.hashes.find((h) => h.turn === state.turn);
    if (expected && expected.hash !== stateHash(state)) {
      return { ok: false, error: 'hash-mismatch', mismatchAt: i };
    }
  }
  if (envelope.result) {
    if (envelope.result.status !== state.status) return { ok: false, error: 'result-mismatch' };
    if (envelope.result.score !== totalScore(state)) return { ok: false, error: 'score-mismatch' };
  }
  return { ok: true, state };
}

// ---------------------------------------------------------------------------
// Tie-breaking (per spec): objective completion, fewer invalid actions,
// lower authoritative elapsed time, then stable session identifier.
// ---------------------------------------------------------------------------

export function compareResults(a, b) {
  const done = (r) => (r.status === 'won' ? 1 : 0);
  if (done(a) !== done(b)) return done(b) - done(a);
  if (a.invalids !== b.invalids) return a.invalids - b.invalids;
  if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;
  return String(a.sessionId).localeCompare(String(b.sessionId));
}
