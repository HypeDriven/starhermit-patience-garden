// Patience Garden — session controller.
// Owns the rules state for one round: validates and deduplicates commands,
// tracks the authoritative elapsed clock (pause-aware), enforces challenge
// constraints, records a replay envelope, and produces result breakdowns.
// No DOM access here.

import {
  applyCommand, legalActions, hint as engineHint, recordInvalid, totalScore,
  serialize, deserialize, stateHash, canAutoFinish, isFinished, foundationCount,
  nextCommandId, openReplay, cardName, rankOf, suitOf, SUIT_SYMBOLS, RANK_LABELS,
} from './rules.js';
import { checksum } from './rng.js';

export const SESSION_VERSION = 1;

export class Session {
  /**
   * @param opts { mode, contentId, seed, ruleset, layout, ranked, constraint,
   *               lessonSteps, now: () => ms }
   */
  constructor(opts) {
    this.mode = opts.mode;
    this.contentId = opts.contentId || 'free';
    this.ranked = !!opts.ranked;
    this.constraint = opts.constraint || null;
    this.lessonSteps = opts.lessonSteps || null;
    this.lessonIndex = 0;
    this.now = opts.now || (() => Date.now());
    this.sessionId = opts.sessionId || `s-${this.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    this.paused = false;
    this.ended = false;
    this._resumedAt = this.now();
    this._seenCommands = new Set();
    this.envelope = openReplay({
      seed: opts.seed >>> 0,
      ruleset: opts.ruleset,
      contentVersion: opts.contentVersion || 1,
      layout: opts.layout || null,
    });
    this._initialState = opts.initialState;
    this.state = opts.initialState;
    this.envelope.initialHash = stateHash(this.state);
    this.envelope.timestampOffset = this.now();
  }

  /** Elapsed authoritative ms (excludes paused time). */
  elapsedMs() {
    if (this.ended) return this.state.elapsedMs;
    const live = this.paused ? 0 : this.now() - this._resumedAt;
    return this.state.elapsedMs + live;
  }

  pause() {
    if (this.paused || this.ended) return;
    this.state = { ...this.state, elapsedMs: this.elapsedMs() };
    this._resumedAt = this.now();
    this.paused = true;
  }

  resume() {
    if (!this.paused) return;
    this._resumedAt = this.now();
    this.paused = false;
  }

  /** Current lesson step expectation, if any. */
  currentStep() {
    if (!this.lessonSteps || this.lessonIndex >= this.lessonSteps.length) return null;
    return this.lessonSteps[this.lessonIndex];
  }

  /** Does a command satisfy the current lesson step? */
  _matchesStep(cmd, step) {
    const e = step.expect;
    if (e.type === 'ack') return cmd.type === 'ack';
    if (e.type === 'any-move') return cmd.type === 'move';
    if (cmd.type !== e.type) return false;
    if (e.type === 'draw') {
      if (e.redeal) return this.state.stock.length === 0;
      return this.state.stock.length > 0;
    }
    if (e.type === 'move') {
      if (e.fromZone && cmd.from?.zone !== e.fromZone) return false;
      if (e.toZone && cmd.to?.zone !== e.toZone) return false;
      if (e.fromPile !== undefined && cmd.from?.pile !== e.fromPile) return false;
      if (e.toPile !== undefined && cmd.to?.pile !== e.toPile) return false;
    }
    return true;
  }

  /**
   * Dispatch a player command. Returns { ok, events, error, lessonAdvanced }.
   * Duplicate command ids are rejected idempotently.
   */
  dispatch(cmd) {
    if (this.ended) return { ok: false, error: 'game-over' };
    if (this.paused) return { ok: false, error: 'paused' };

    if (cmd.type === 'ack') {
      const step = this.currentStep();
      if (step && step.expect.type === 'ack') {
        this.lessonIndex++;
        return { ok: true, events: [{ type: 'lesson-step' }], lessonAdvanced: true };
      }
      return { ok: false, error: 'no-ack-expected' };
    }

    // Lesson gate: only the expected action is accepted.
    const step = this.currentStep();
    if (step && step.expect.type !== 'ack' && !this._matchesStep(cmd, step)) {
      return { ok: false, error: 'lesson-step', lesson: true };
    }

    const id = cmd.id || nextCommandId();
    if (this._seenCommands.has(id)) return { ok: true, events: [], duplicate: true };

    // freeze elapsed time into the state before resolving
    const withClock = { ...this.state, elapsedMs: this.elapsedMs() };
    const r = applyCommand(withClock, { ...cmd, id });
    if (!r.ok) {
      this.state = recordInvalid(withClock);
      this._resumedAt = this.now();
      return { ok: false, error: r.error };
    }
    this._seenCommands.add(id);
    this.state = r.state;
    this._resumedAt = this.now();
    this.envelope.commands.push({ ...cmd, id, elapsedMs: this.state.elapsedMs });
    if (this.state.turn % 10 === 0) {
      // Keyed by command index (`at`), not turn: undo keeps turn monotonic but
      // not unique, so a turn-keyed hash would falsely mismatch on replay.
      this.envelope.hashes.push({ at: this.envelope.commands.length, turn: this.state.turn, hash: stateHash(this.state) });
    }
    if (step) {
      this.lessonIndex++;
      r.events.push({ type: 'lesson-step' });
    }
    this._checkConstraint(r.events);
    return { ok: true, events: r.events, lessonAdvanced: !!step };
  }

  _checkConstraint(events) {
    if (!this.constraint || this.ended || this.state.status !== 'active') return;
    const c = this.constraint;
    if (c.type === 'moves' && this.state.moves > c.limit) {
      this._fail('move-limit-exceeded', events);
    } else if (c.type === 'redeals' && this.state.redealsUsed > c.limit) {
      this._fail('redeal-limit-exceeded', events);
    }
  }

  /** Called on a timer by the host to enforce time constraints. */
  tick() {
    if (this.ended || this.paused || !this.constraint) return null;
    if (this.constraint.type === 'time' && this.elapsedMs() > this.constraint.limitMs) {
      const events = [];
      this._fail('time-limit-exceeded', events);
      return events;
    }
    return null;
  }

  _fail(reason, events) {
    const withClock = { ...this.state, elapsedMs: this.elapsedMs() };
    const r = applyCommand(withClock, { id: nextCommandId(), type: 'fail', reason });
    if (r.ok) {
      this.state = r.state;
      events.push(...r.events);
      this._finalize();
    }
  }

  /** Undo the last command (where rules permit). */
  undo() {
    return this.dispatch({ type: 'undo' });
  }

  /** Hint from the shared legal-action engine; marks the assist. */
  hint() {
    if (this.ended || this.paused) return null;
    const h = engineHint(this.state);
    if (!h) return null;
    // Record the assist as an authoritative command so the replay log
    // reconstructs it (a hinted run can never be published as unassisted).
    const id = nextCommandId();
    const wrap = { ...this.state, elapsedMs: this.elapsedMs() };
    const r = applyCommand(wrap, { id, type: 'hint' });
    if (r.ok) {
      this.state = r.state;
      this._seenCommands.add(id);
      this._resumedAt = this.now();
      this.envelope.commands.push({ type: 'hint', id, elapsedMs: this.state.elapsedMs });
      if (this.state.turn % 10 === 0) {
        this.envelope.hashes.push({ at: this.envelope.commands.length, turn: this.state.turn, hash: stateHash(this.state) });
      }
    }
    return h;
  }

  canAutoFinish() {
    return canAutoFinish(this.state);
  }

  isFinished() {
    return isFinished(this.state);
  }

  /** True when the game just transitioned out of 'active'; finalize once. */
  finalizeIfEnded() {
    if (this.state.status !== 'active' && !this.ended) {
      this._finalize();
      return true;
    }
    return false;
  }

  _finalize() {
    this.state = { ...this.state, elapsedMs: this.elapsedMs() };
    this.ended = true;
    this.envelope.result = {
      status: this.state.status,
      reason: this.state.terminalReason,
      score: totalScore(this.state),
      moves: this.state.moves,
      invalids: this.state.invalids,
      undos: this.state.undos,
      hints: this.state.hints,
      ms: this.state.elapsedMs,
    };
    this.envelope.finalChecksum = checksum(this.envelope.commands.map((c) => c.id).join('|') + stateHash(this.state));
  }

  /** Human description of a hint or action, for announcements. */
  describeAction(a) {
    if (!a) return 'No moves available.';
    if (a.type === 'draw') {
      return this.state.stock.length > 0
        ? 'Draw from the stock.'
        : 'Recycle the waste into a fresh stock.';
    }
    const card = a.cards[0];
    const name = `${RANK_LABELS[rankOf(card)]}${SUIT_SYMBOLS[suitOf(card)]}`;
    const fromZ = a.from.zone === 'waste' ? 'the waste' : a.from.zone === 'foundation' ? `foundation ${a.from.pile + 1}` : `row ${a.from.pile + 1}`;
    const toZ = a.to.zone === 'foundation' ? 'its foundation' : `row ${a.to.pile + 1}`;
    const n = a.cards.length > 1 ? ` (${a.cards.length}-card run)` : '';
    return `Move ${name}${n} from ${fromZ} to ${toZ}.`;
  }

  /** Result breakdown for the results screen (integers; formatted by UI). */
  breakdown() {
    const s = this.state;
    const sc = s.score;
    const rows = [
      ['Foundations banked', sc.foundation],
      ['Cards revealed', sc.reveal],
      ['Waste to tableau', sc.wasteToTableau],
      ['Stock recycles', sc.redeal],
      ['Foundation regressions', sc.regress],
      ['Time bonus', sc.timeBonus],
    ];
    return {
      rows,
      total: totalScore(s),
      moves: s.moves,
      invalids: s.invalids,
      undos: s.undos,
      hints: s.hints,
      ms: s.elapsedMs,
      foundations: foundationCount(s),
      status: s.status,
      reason: s.terminalReason,
      seed: s.seed,
    };
  }

  /** Serializable snapshot for suspend/resume. */
  snapshot() {
    return {
      sessionVersion: SESSION_VERSION,
      mode: this.mode,
      contentId: this.contentId,
      ranked: this.ranked,
      constraint: this.constraint,
      lessonSteps: this.lessonSteps,
      lessonIndex: this.lessonIndex,
      sessionId: this.sessionId,
      state: serialize(this.state),
      history: (this.state.history || []).slice(-60),
      envelope: this.envelope,
      savedAt: Date.now(),
    };
  }

  static restore(snap, now) {
    if (!snap || snap.sessionVersion !== SESSION_VERSION) return null;
    const session = Object.create(Session.prototype);
    session.mode = snap.mode;
    session.contentId = snap.contentId;
    session.ranked = snap.ranked;
    session.constraint = snap.constraint;
    session.lessonSteps = snap.lessonSteps;
    session.lessonIndex = snap.lessonIndex;
    session.sessionId = snap.sessionId;
    session.now = now || (() => Date.now());
    session.paused = true; // restored sessions start paused
    session.ended = snap.state.status !== 'active';
    session._resumedAt = session.now();
    session._seenCommands = new Set((snap.envelope.commands || []).map((c) => c.id));
    session.envelope = snap.envelope;
    const state = deserialize(snap.state);
    state.history = snap.history || [];
    session.state = state;
    session._initialState = null;
    return session;
  }
}
