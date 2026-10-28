// Patience Garden on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules (js/rules.js), deal generator
// (js/solver.js), content (js/content.js) and session (js/session.js) are
// the browser build's, unchanged in what they decide; this module is what
// js/main.js did around them — the app state machine (title → mode screens →
// preparing → active ⇄ paused → results), starting every mode (Learn,
// Journey, Daily, Practice, Challenge, Score Chase) and resuming the saved
// round, taps, drags and double taps on the glasshouse table (or the 2D card
// table), the keyboard / pad pile focus, hints, auto-finish, undo, the lesson
// coach, the round's end with stats, stars, achievements, the local boards
// and the high-score post, and the lifecycle (a hidden window pauses the
// round, as visibilitychange did). Screens are drawn by screens.ts
// (starhermit:ui), the 2D table by board2d.ts, the 3D table by render.ts.
//
// Time is the runtime's fixed steps: the session's clock (session.js `now`)
// advances 1000/60 ms a step while the window shows, so slow frames never
// move it and play scripts replay exactly.
import { clipboard, frame, onFixedUpdate, onPreferencesChange, onRender, onResume, onStart, onSuspend, onUpdate, preferences, setFixedRate } from "starhermit:engine";
import { onAction, onPointerButton, onPointerMove, onTouch, vibrate } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onSessionEnded, requestSignIn } from "starhermit:platform";
import { Content, Rules, SessionClass, Solver, type Action, type Breakdown, type GameEvent, type Loc, type Session, type Stage } from "./game.ts";
import * as audio from "./audio.ts";
import { N, S, T, cardLabel, fmtTime } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens } from "./screens.ts";
import { applyTokens, initStyles } from "./style.ts";

export type ScreenName = "title" | "modes" | "setup" | "journey" | "learn" | "pause" | "results" | "settings" | "help" | "profile" | "scores";
export type SetupMode = "practice" | "challenge" | "daily" | "journey" | "score";
export interface Screen { name: ScreenName; mode?: SetupMode; stage?: number }
export interface Config {
  mode: string; lessonId?: string; stage?: number; challengeId?: string; level?: string; salt?: number; scoreProfile?: string; scoreBand?: string;
}
export interface ResultsView {
  headline: string; sub: string; stars: number; breakdown: Breakdown; progressNote: string; achievements: string[]; nextLabel: string | null;
}

/** Full-page screens (the title, mode select, setup, Journey and Learn) cover the table; the rest are overlays. */
export const PAGES = new Set<ScreenName>(["title", "modes", "setup", "journey", "learn"]);

export const app = {
  /** main.js appState. */
  phase: "title" as "title" | "active" | "paused" | "results",
  screens: [] as Screen[],
  /** Frame the top screen opened on (the press that opened it must not also act on it). */
  openedFrame: 0,
  focusNext: null as string | null,
  session: null as Session | null,
  config: null as Config | null,
  selection: null as Loc | null,
  hintShown: null as Action | null,
  hintUntil: 0,
  /** Input lock until (game seconds): the shortest resolution phase. */
  resolvingUntil: 0,
  /** Setup screen picks (ui.js setupConfig). */
  setup: { level: "easy", challengeId: Content.CHALLENGES[0]!.id, scoreBand: "medium", scoreProfile: "wildwood" },
  results: null as (() => ResultsView) | null,
  resultsCtx: null as { mode: string; next?: number | string | null; isLast?: boolean; retry?: boolean } | null,
  lb: null as platform.Posted | "posting" | null,
  toast: null as { text: string; error: boolean; until: number } | null,
  /** The rails as drawers (narrow windows), open or not (ui.js btn-rail-toggle). */
  railsOpen: false,
  /** The keyboard / pad pile focus (main.js kbFocus), shown once used. */
  kbFocus: 0,
  kbActive: false,
};
const now = (): number => frame().time;
export const fresh = (): boolean => frame().frame !== app.openedFrame;

// ------------------------------------------------------------------ the session clock (fixed steps)
let clockMs = 0;
let hidden = false;
const sessionNow = (): number => clockMs;
onFixedUpdate((step) => {
  if (hidden) return;
  clockMs += step * 1000;
  tickCount++;
  // session.tick every second of game time (main.js setInterval 1000).
  if (tickCount % 60 === 0 && app.session && app.phase === "active" && !app.session.paused) {
    const fail = app.session.tick();
    if (fail) afterDispatch(fail);
  }
  if (tickCount % 480 === 0 && app.session && !app.session.isFinished()) saveSnapshot();
});
let tickCount = 0;

// ------------------------------------------------------------------ helpers
export function announce(text: string, assertive = false): void {
  if (text) ui.announce(text.slice(0, 500), { politeness: assertive ? "assertive" : "polite" });
}
export function toast(text: string, error = false): void { app.toast = { text, error, until: now() + 2.6 }; }
function haptic(ms: number): void { if (platform.options.haptics) { try { vibrate(ms); } catch { /* no motor */ } } }
const INVALID_TEXT: Record<string, string> = {
  "no-movable-card": N("That card cannot move — only uncovered cards and valid runs move."),
  "run-to-foundation": N("Foundations take one card at a time."),
  "wrong-foundation": N("Each foundation grows a single suit."),
  "foundation-order": N("Foundations grow upward from the Ace, one rank at a time."),
  "kings-only": N("Only a King may root in an empty row."),
  "sequence-mismatch": N("Tableau runs descend in alternating colors."),
  "same-pile": N("That card is already there."),
  "bad-target": N("Cards can only move to a row or a foundation."),
  "stock-empty": N("The stock is empty."),
  "no-redeals-left": N("No recycles left in this ruleset."),
  "nothing-to-undo": N("Nothing to undo yet."),
  "undo-disabled": N("Undo is disabled in this ruleset."),
  "not-auto-finishable": N("Auto-finish needs an empty stock and no hidden cards."),
  "lesson-step": N("Follow the lesson step — try the highlighted action."),
  "game-over": N("This round has ended."),
  paused: N("The game is paused."),
};
export const MODE_NAMES: Record<string, string> = { learn: N("Lesson"), journey: N("Journey"), daily: N("Daily"), practice: N("Practice"), challenge: N("Challenge"), score: N("Score Chase") };

// ------------------------------------------------------------------ screens
export function top(): Screen | null { return app.screens[app.screens.length - 1] ?? null; }
/** ui.js showScreen: a page replaces the stack. */
export function showScreen(s: Screen): void {
  app.screens = [s];
  app.openedFrame = frame().frame;
  app.focusNext = null;
  ui.setFocus(null);
  refreshActive();
}
/** ui.js openOverlay: over what is open. */
export function openOverlay(s: Screen): void {
  app.screens.push(s);
  app.openedFrame = frame().frame;
  app.focusNext = null;
  ui.setFocus(null);
  refreshActive();
}
/** Closes the top screen; closing the pause screen resumes. */
export function closeTop(): void {
  const s = app.screens.pop();
  app.openedFrame = frame().frame;
  ui.setFocus(null);
  if (s?.name === "pause" && app.phase === "paused") resumeGame();
  refreshActive();
}
export function closeAll(): void {
  app.screens = [];
  app.openedFrame = frame().frame;
  ui.setFocus(null);
  refreshActive();
}
/** The glasshouse draws during a round in the 3D interface, unless a page covers the window. */
export function refreshActive(): void {
  const covered = app.screens.some((s) => PAGES.has(s.name));
  render.setActive(!covered && !!app.session && platform.options.interfaceMode === "3d");
}
export function boardIs2D(): boolean { return platform.options.interfaceMode === "2d"; }
export function dailyInfo(): ReturnType<typeof Content.dailyInfo> { return Content.dailyInfo(platform.now()); }
export function nextJourneyIndex(): number {
  const p = platform.save().progress;
  for (let i = 0; i < Content.JOURNEY.length; i++) if (!p.journey[Content.JOURNEY[i]!.id]) return i;
  return Content.JOURNEY.length - 1;
}

export const actions = {
  /** Play: resume the saved round, else the mode select (main.js onPlay). */
  play(): void { if (!resumeSavedGame()) showScreen({ name: "modes" }); },
  quickStart(mode: string): void { startGame({ mode }); },
  modeSelect(mode: string): void {
    if (mode === "journey") { showScreen({ name: "journey" }); return; }
    if (mode === "learn") { showScreen({ name: "learn" }); return; }
    showScreen({ name: "setup", mode: mode as SetupMode });
  },
  journeyPick(i: number): void { startGame({ mode: "journey", stage: i }); },
  lessonPick(id: string): void { startGame({ mode: "learn", lessonId: id }); },
  startSetup(mode: SetupMode, stage?: number): void {
    const s = app.setup;
    if (mode === "practice") startGame({ mode, level: s.level });
    else if (mode === "challenge") startGame({ mode, challengeId: s.challengeId });
    else if (mode === "score") startGame({ mode, scoreBand: s.scoreBand, scoreProfile: s.scoreProfile });
    else if (mode === "journey") startGame({ mode, stage: stage ?? nextJourneyIndex() });
    else startGame({ mode });
  },
  signIn(): void { void requestSignIn().catch(() => undefined); },
  invite(): void {
    const link = platform.inviteLink();
    if (!link) return;
    try { clipboard.writeText(link); toast(S("inviteCopied")); } catch { toast(S("inviteFailed", { link })); }
  },
};

// ------------------------------------------------------------------ game lifecycle (main.js startGame …)
function saveSnapshot(): void {
  const s = app.session;
  if (!s || s.isFinished()) return;
  // JSON round trip: the rulesets' Infinity (unlimited recycles) is not JSON (rules.js reads null as unlimited).
  platform.save().session = JSON.parse(JSON.stringify({ ...s.snapshot(), restartConfig: app.config }));
  platform.persist();
}
function clearSnapshot(): void { platform.save().session = null; platform.persist(); }

/** Best-effort restart config for a restored session lacking one (main.js configForSession). */
function configForSession(sess: Session): Config {
  const cfg: Config = { mode: sess.mode };
  if (sess.mode === "challenge") cfg.challengeId = sess.contentId;
  else if (sess.mode === "learn") cfg.lessonId = sess.contentId;
  else if (sess.mode === "journey") { const i = Content.JOURNEY.findIndex((s) => s.id === sess.contentId); if (i >= 0) cfg.stage = i; }
  else if (sess.mode === "practice") { const m = /^practice-(.+)-(\d+)$/.exec(sess.contentId || ""); if (m) { cfg.level = m[1]; cfg.salt = +m[2]!; } }
  else if (sess.mode === "score") { const m = /^score-(.+)-(.+)-(\d+)$/.exec(sess.contentId || ""); if (m) { cfg.scoreProfile = m[1]; cfg.scoreBand = m[2]; } }
  return cfg;
}

export function startGame(config: Config): void {
  const save = platform.save();
  let opts: Record<string, unknown>;
  if (config.mode === "learn") {
    const lesson = config.lessonId ? Content.lessonById(config.lessonId) : undefined;
    if (!lesson) { toast(T("That lesson is unavailable — pick another."), true); showScreen({ name: "learn" }); return; }
    const initialState = Rules.createCustomGame(lesson.layout, lesson.ruleset, 0);
    opts = { mode: "learn", contentId: lesson.id, seed: 0, ruleset: initialState.ruleset, layout: lesson.layout, lessonSteps: lesson.steps, ranked: false, initialState };
  } else {
    let d: { id: string; seed: number; ruleset: unknown; ranked?: boolean; constraint?: { type: string; limitMs?: number; limit?: number } | null } | undefined;
    if (config.mode === "daily") d = dailyInfo();
    else if (config.mode === "journey") d = Content.journeyStage(config.stage ?? nextJourneyIndex());
    else if (config.mode === "challenge") d = config.challengeId ? Content.challengeById(config.challengeId) : undefined;
    else if (config.mode === "score") d = Content.scoreChaseDeal(config.scoreProfile || "wildwood", config.scoreBand || "medium", 0);
    else {
      if (config.salt === undefined) config.salt = save.stats.games; // pin the deal so Replay is identical
      d = Content.practiceDeal(config.level || "easy", config.salt);
    }
    if (!d) { toast(T("That table is unavailable — pick another."), true); showScreen({ name: "modes" }); return; }
    const { layout } = Solver.generateWinnableLayout(d.seed, d.ruleset);
    const initialState = Rules.createCustomGame(layout, d.ruleset, d.seed);
    initialState.custom = false;
    const c = d.constraint ?? null;
    opts = {
      mode: config.mode, contentId: d.id, seed: d.seed, ruleset: initialState.ruleset, layout, ranked: !!d.ranked,
      constraint: c ? (c.type === "time" && platform.options.timingAssist ? { ...c, limitMs: Math.round(c.limitMs! * 1.15) } : c) : null,
      contentVersion: Content.CONTENT_VERSION, initialState,
    };
    if (config.mode === "journey") opts.journeyStage = d;
  }
  opts.now = sessionNow;
  const session = new SessionClass(opts);
  session._journeyStage = (opts.journeyStage as Stage | undefined) ?? null;
  attach(config, session, false);
  saveSnapshot();
  announce(T("{mode} started. {objective}", { mode: T(MODE_NAMES[session.mode] ?? session.mode), objective: objectiveText() }));
  audio.play("draw");
}
function attach(config: Config, session: Session, instant: boolean): void {
  app.config = config;
  app.session = session;
  app.selection = null;
  app.hintShown = null;
  app.results = null;
  app.resultsCtx = null;
  app.lb = null;
  app.phase = "active";
  app.railsOpen = false;
  app.kbActive = false;
  render.newDeal(session.state.seed || 1);
  render.setState(session.state, instant);
  closeAll();
  updateMusic();
}
export function restartGame(): void {
  if (!app.config) return;
  const mode = app.session?.mode;
  closeAll();
  startGame(app.config); // same config → same seed / content
  void mode;
}
export function leaveGame(): void {
  if (app.session && !app.session.isFinished()) app.session.dispatch({ type: "concede" });
  clearSnapshot();
  app.session = null;
  app.selection = null;
  app.phase = "title";
  showScreen({ name: "title" });
}
export function pauseGame(): void {
  const s = app.session;
  if (!s || s.isFinished() || app.phase !== "active") return;
  s.pause();
  audio.play("pause");
  app.phase = "paused";
  audio.setSuspended(true);
  openOverlay({ name: "pause" });
  app.focusNext = "btn-resume";
  saveSnapshot();
}
export function resumeGame(): void {
  if (!app.session || app.phase !== "paused") return;
  app.session.resume();
  app.phase = "active";
  audio.setSuspended(false);
  announce(T("Resumed."));
}
/** main.js resumeSavedGame. */
function resumeSavedGame(): boolean {
  const snap = platform.save().session;
  if (!snap) return false;
  let session: Session | null = null;
  try { session = SessionClass.restore(snap, sessionNow); } catch { session = null; }
  if (!session || session.state.status !== "active") { clearSnapshot(); return false; }
  const config = (snap.restartConfig as Config | undefined) ?? configForSession(session);
  session._journeyStage = session.mode === "journey" ? Content.JOURNEY.find((s) => s.id === session!.contentId) ?? null : null;
  attach(config, session, true);
  session.resume();
  announce(T("Resumed your saved garden."));
  return true;
}
/** Play becomes "Resume garden" with a round in progress (main.js refreshPlayButton). */
export function hasSavedRound(): boolean { return (platform.save().session?.state as { status?: string } | undefined)?.status === "active"; }

// ------------------------------------------------------------------ objective / HUD text
export function objectiveText(): string {
  const s = app.session;
  if (!s) return "";
  if (s.mode === "learn") return T("Follow the lesson steps.");
  const c = s.constraint;
  if (c?.type === "moves") return T("Win in {n} moves or fewer.", { n: c.limit! });
  if (c?.type === "time") return T("Win within {time}.", { time: fmtTime(c.limitMs!) });
  if (c?.type === "redeals") return c.limit === 0 ? T("Win without recycling the stock.") : T("Win with at most {n} recycles.", { n: c.limit! });
  return T("Build every foundation, Ace to King.");
}
export function constraintText(): string {
  const s = app.session;
  if (!s?.constraint) return "";
  const st = s.state, c = s.constraint;
  if (c.type === "moves") return T("{n} moves left", { n: Math.max(0, c.limit! - st.moves) });
  if (c.type === "time") return T("{time} left", { time: fmtTime(Math.max(0, c.limitMs! - s.elapsedMs())) });
  return T("recycles used: {used}/{max}", { used: st.redealsUsed, max: c.limit === 0 ? 0 : st.ruleset.maxRedeals });
}
export function canAcceptInput(): boolean {
  const s = app.session;
  return !!s && app.phase === "active" && !s.paused && !s.isFinished() && now() >= app.resolvingUntil && !app.screens.length;
}
function lockInputBriefly(): void { app.resolvingUntil = now() + (preferences().reducedMotion ? 0.04 : 0.22); }

// ------------------------------------------------------------------ input → commands (main.js handleTap …)
function normalizeSelection(t: Loc): Loc {
  const s = app.session!.state;
  if (t.zone === "waste") return { zone: "waste", pile: 0, index: s.waste.length - 1 };
  if (t.zone === "foundation") return { zone: "foundation", pile: t.pile, index: s.foundations[t.pile]!.length - 1 };
  return { zone: "tableau", pile: t.pile, index: t.index };
}
function select(sel: Loc | null): void {
  app.selection = sel;
  refreshBoard();
}
function clearSelection(): void { app.selection = null; render.setSelection(null); render.setLegalTargets([]); }
export function legalTargetsForSelection(): Loc[] {
  const sel = app.selection, s = app.session;
  if (!sel || !s) return [];
  const out: Loc[] = [];
  for (let p = 0; p < 7; p++) if (Rules.canMove(s.state, sel, { zone: "tableau", pile: p }).ok) out.push({ zone: "tableau", pile: p });
  for (let f = 0; f < 4; f++) if (Rules.canMove(s.state, sel, { zone: "foundation", pile: f }).ok) out.push({ zone: "foundation", pile: f });
  return out;
}
/** main.js refreshBoard: the renderer's selection and targets (the 2D table reads app state each frame). */
function refreshBoard(instant = false): void {
  const s = app.session;
  if (!s) return;
  if (instant) render.setState(s.state, true);
  render.setSelection(app.selection);
  render.setLegalTargets(app.selection ? legalTargetsForSelection() : app.kbActive ? [kbTarget()] : []);
}
function describeSelection(): string {
  if (!app.selection || !app.session) return "";
  const run = Rules.resolveRun(app.session.state, app.selection);
  if (!run) return T("card");
  return run.cards.length > 1 ? T("a {n}-card run starting at {card}", { n: run.cards.length, card: cardLabel(run.cards[0]!) }) : cardLabel(run.cards[0]!);
}
export function handleTap(target: Loc): void {
  if (!canAcceptInput()) return;
  const s = app.session!.state;
  if (target.zone === "stock") { clearSelection(); tryDispatch({ type: "draw" }); return; }
  const sel = app.selection;
  if (!sel) {
    if (target.index === -1) return;
    if (target.zone === "tableau" && s.tableau[target.pile]!.length === 0) return;
    if (target.zone === "foundation" && s.foundations[target.pile]!.length === 0) return;
    if (target.zone === "waste" && s.waste.length === 0) { invalid(T("The waste is empty — draw first.")); return; }
    const next = normalizeSelection(target);
    if (Rules.resolveRun(s, next)) {
      app.hintShown = null;
      render.setHint(null);
      audio.play("select");
      select(next);
      announce(T("Selected {what}. Choose a destination.", { what: describeSelection() }));
    } else invalid(T("That card is covered or cannot move."));
    return;
  }
  // Tapping the selected card again banks it to its foundation.
  const selNow = normalizeSelection(target);
  if (sel.zone === selNow.zone && sel.pile === selNow.pile && sel.index === selNow.index) {
    const run = Rules.resolveRun(s, sel);
    if (run && run.cards.length === 1) {
      const to: Loc = { zone: "foundation", pile: Rules.suitOf(run.cards[0]!) };
      if (Rules.canMove(s, sel, to).ok) { attemptMove(sel, to); return; }
    }
    clearSelection();
    select(null);
    return;
  }
  if (target.zone === "tableau" || target.zone === "foundation") {
    const to: Loc = { zone: target.zone, pile: target.pile };
    const verdict = Rules.canMove(s, sel, to);
    if (verdict.ok) { tryDispatch({ type: "move", from: sel, to }); return; }
    invalid(T(INVALID_TEXT[verdict.reason ?? ""] ?? N("That move is not legal.")));
    const alt = normalizeSelection(target);
    const re = target.index !== -1 && Rules.resolveRun(s, alt) ? alt : null;
    if (re) audio.play("select");
    select(re);
    return;
  }
  clearSelection();
  select(null);
}
/** main.js handleDouble: a single exposed card banks to its foundation. */
export function handleDouble(target: Loc): void {
  if (!canAcceptInput()) return;
  if (target.zone !== "waste" && target.zone !== "tableau") return;
  const sel = normalizeSelection(target);
  const run = Rules.resolveRun(app.session!.state, sel);
  if (!run || run.cards.length !== 1) { invalid(T("Only a single exposed card can bank.")); return; }
  attemptMove(sel, { zone: "foundation", pile: Rules.suitOf(run.cards[0]!) });
}
/** A hint or action in words, in the game language (main.js describeAction). */
export function describeAction(a: Action | null): string {
  if (!a) return T("No moves available.");
  if (a.type === "draw") return app.session!.state.stock.length > 0 ? T("Draw from the stock.") : T("Recycle the waste into a fresh stock.");
  const card = a.cards[0]!;
  const name = `${Rules.RANK_LABELS[Rules.rankOf(card)]}${Rules.SUIT_SYMBOLS[Rules.suitOf(card)]}`;
  const from = a.from.zone === "waste" ? T("the waste") : a.from.zone === "foundation" ? T("foundation {n}", { n: a.from.pile + 1 }) : T("row {n}", { n: a.from.pile + 1 });
  const to = a.to.zone === "foundation" ? T("its foundation") : T("row {n}", { n: a.to.pile + 1 });
  return a.cards.length > 1 ? T("Move {card} ({n}-card run) from {from} to {to}.", { card: name, n: a.cards.length, from, to }) : T("Move {card} from {from} to {to}.", { card: name, from, to });
}
export function attemptMove(from: Loc, to: Loc): void {
  const verdict = Rules.canMove(app.session!.state, from, to);
  if (!verdict.ok) {
    invalid(T(INVALID_TEXT[verdict.reason ?? ""] ?? N("That move is not legal.")));
    clearSelection();
    select(null);
    return;
  }
  tryDispatch({ type: "move", from, to });
}
export function tryDispatch(cmd: Record<string, unknown>): void {
  const s = app.session;
  if (!s || !canAcceptInput()) return;
  const r = s.dispatch(cmd);
  if (!r.ok) {
    const e = r.error ?? "";
    invalid(INVALID_TEXT[e] ? T(INVALID_TEXT[e]!) : T("Cannot: {reason}", { reason: e }));
    return;
  }
  lockInputBriefly();
  clearSelection();
  app.selection = null;
  app.hintShown = null;
  render.setHint(null);
  afterDispatch(r.events);
}
function updateMusic(): void {
  const s = app.session;
  if (s) audio.setMusicIntensity(Math.min(1, Rules.foundationCount(s.state) / 52 + 0.25));
}
function afterDispatch(events: GameEvent[]): void {
  const s = app.session;
  if (!s) return;
  for (const e of events) {
    if (e.type === "draw" || e.type === "redeal") audio.play("draw");
    if (e.type === "move") audio.play(e.to?.zone === "foundation" ? "bank" : "place");
    if (e.type === "flip") audio.play("flip");
    if (e.type === "win") audio.play("win");
    if (e.type === "lose") audio.play("lose");
  }
  const mv = events.find((e) => e.type === "move");
  if (mv) {
    haptic(15);
    announce(mv.to?.zone === "foundation"
      ? T("{card} banked. {n} of {total} banked.", { card: cardLabel(mv.cards![0]!), n: Rules.foundationCount(s.state), total: 13 * s.state.ruleset.suitCount })
      : T("{card} moved to row {n}.", { card: cardLabel(mv.cards![0]!), n: (mv.to?.pile ?? 0) + 1 }));
  }
  if (events.some((e) => e.type === "flip")) audio.play("reveal");
  updateMusic();
  render.setState(s.state);
  if (mv) render.playEvent("place");
  if (events.some((e) => e.type === "flip")) render.playEvent("flip");
  if (events.some((e) => e.type === "win")) render.playEvent("win");
  refreshBoard();
  if (s.mode === "learn") {
    saveSnapshot();
    if (!s.currentStep()) queueMicrotask(finishLesson);
    return;
  }
  if (s.finalizeIfEnded()) queueMicrotask(finishRound);
  else saveSnapshot();
}
function invalid(text: string): void {
  audio.play("invalid");
  toast(text, true);
  announce(text, true);
  render.playEvent("invalid");
}
export function doUndo(): void {
  if (!canAcceptInput()) return;
  const r = app.session!.undo();
  if (!r.ok) { invalid(T(INVALID_TEXT[r.error ?? ""] ?? N("Cannot undo."))); return; }
  audio.play("undo");
  clearSelection();
  app.selection = null;
  render.setState(app.session!.state);
  refreshBoard();
  saveSnapshot();
  announce(T("Undone."));
}
export function doHint(): void {
  if (!app.session || !canAcceptInput()) return;
  const h = app.session.hint();
  if (!h) { invalid(T("No moves available.")); return; }
  app.hintShown = h;
  app.hintUntil = now() + 2.6;
  audio.play("hint");
  const text = T("Hint: {text}", { text: describeAction(h) });
  toast(text);
  announce(text);
  render.setHint(h.type === "draw" ? { draw: true } : { from: h.from, to: h.to });
  refreshBoard();
}
export function doDraw(): void { tryDispatch({ type: "draw" }); }
export function doAutofinish(): void { if (app.session?.canAutoFinish()) tryDispatch({ type: "autofinish" }); }
/** The coach's Continue (lesson ack steps). */
export function ackLesson(): void {
  const s = app.session;
  // As main.js's coach button: straight to the session (the finale's ack follows the won garden).
  if (!s || app.phase !== "active" || app.screens.length) return;
  const r = s.dispatch({ type: "ack" });
  if (r.ok) afterDispatch(r.events);
}

// ------------------------------------------------------------------ the round's end (main.js finishLesson / finishRound)
function finishLesson(): void {
  const s = app.session;
  if (!s || app.phase === "results") return;
  const save = platform.save();
  const lessonId = s.contentId;
  save.progress.lessons[lessonId] = { completedAt: Date.now() };
  const newly: string[] = [];
  if (Object.keys(save.progress.lessons).length >= Content.LESSONS.length) {
    if (platform.unlock("graduate")) newly.push("Graduate");
    platform.setOption("tutorialDone", true);
  }
  save.session = null;
  platform.persist();
  const idx = Content.LESSONS.findIndex((l) => l.id === lessonId);
  const next = Content.LESSONS[idx + 1];
  const breakdown: Breakdown = { rows: [[N("Lesson steps"), s.lessonIndex]], total: 0, moves: s.state.moves, invalids: 0, undos: 0, hints: 0, ms: s.elapsedMs(), foundations: 0, status: "won", reason: null, seed: 0 };
  const done = Object.keys(save.progress.lessons).length;
  const lesson = Content.lessonById(lessonId);
  app.results = () => ({
    headline: T("Lesson complete"), sub: lesson ? T(lesson.title) : "", stars: 0, breakdown,
    progressNote: T("{n}/{total} lessons complete", { n: done, total: Content.LESSONS.length }), achievements: newly,
    nextLabel: next ? T("Next: {title}", { title: T(next.title) }) : null,
  });
  app.resultsCtx = { mode: "learn", next: next?.id ?? null };
  showResults();
}
function finishRound(): void {
  const s = app.session;
  if (!s || app.phase === "results") return;
  const b = s.breakdown();
  const won = b.status === "won";
  const save = platform.save();
  const stats = save.stats, progress = save.progress;
  save.session = null;
  stats.games += 1;
  stats.totalMoves += b.moves;
  stats.totalTimeMs += b.ms;
  stats.foundationsBanked += b.foundations;
  if (won) {
    stats.wins += 1;
    stats.streak += 1;
    stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
    stats.bestScore = Math.max(stats.bestScore, b.total);
    if (stats.bestWinMs == null || b.ms < stats.bestWinMs) stats.bestWinMs = b.ms;
  } else { stats.losses += 1; stats.streak = 0; }
  const newly: string[] = [];
  if (won && platform.unlock("first_bloom")) newly.push("First Bloom");
  if (stats.streak >= 3 && platform.unlock("green_streak")) newly.push("Green Streak");
  if (stats.foundationsBanked >= 1000 && platform.unlock("thousand_leaves")) newly.push("Thousand Leaves");

  let stars = 0;
  let progressNote = (): string => "";
  let nextLabel = (): string | null => null;
  const stage = s.mode === "journey" ? s._journeyStage : null;
  if (stage) {
    if (won) {
      stars = 1 + (b.moves <= stage.par.moves ? 1 : 0) + (b.ms <= stage.par.timeMs ? 1 : 0);
      const prev = progress.journey[stage.id];
      progress.journey[stage.id] = {
        stars: Math.max(stars, prev?.stars || 0), bestMoves: Math.min(b.moves, prev?.bestMoves ?? Infinity),
        bestTimeMs: Math.min(b.ms, prev?.bestTimeMs ?? Infinity), completedAt: Date.now(),
      };
      progress.mastery.stagesCompleted = Object.keys(progress.journey).length;
      if (stage.index + 1 >= 20 && platform.unlock("head_gardener")) newly.push("Head Gardener");
      const nextIdx = Math.min(stage.index + 1, Content.JOURNEY.length - 1);
      const isLast = stage.index >= Content.JOURNEY.length - 1;
      nextLabel = () => (isLast ? null : T("Next: {title}", { title: T(Content.JOURNEY[nextIdx]!.title) }));
      app.resultsCtx = { mode: "journey", next: nextIdx, isLast };
      const done = Object.keys(progress.journey).length;
      progressNote = () => T("Journey: {n}/{total} stages", { n: done, total: Content.JOURNEY.length });
    } else {
      app.resultsCtx = { mode: "journey", next: stage.index, retry: true };
      nextLabel = () => T("Try again");
    }
  } else if (s.mode === "daily") {
    const day = dailyInfo().day;
    if (won && !progress.dailies[day]) {
      progress.dailies[day] = { score: b.total, moves: b.moves, ms: b.ms, won: true };
      stats.dailyCompleted += 1;
      if (stats.dailyCompleted >= 5 && platform.unlock("daily_devotion")) newly.push("Daily Devotion");
    }
    platform.addScore({ mode: "daily", seed: b.seed, rulesetKey: "daily", score: b.total, moves: b.moves, ms: b.ms, assists: b.undos + b.hints > 0, date: day, status: b.status, invalids: b.invalids, sessionId: s.sessionId });
    app.resultsCtx = { mode: "daily" };
    progressNote = () => (won ? T("Daily complete — see you tomorrow.") : T("The daily remains unconquered."));
  } else if (s.mode === "challenge") {
    if (won) {
      const prev = progress.challenges[s.contentId];
      progress.challenges[s.contentId] = { completed: true, bestScore: Math.max(b.total, prev?.bestScore || 0), bestMs: Math.min(b.ms, prev?.bestMs ?? Infinity) };
    }
    app.resultsCtx = { mode: "challenge" };
  } else if (s.mode === "score") {
    if (won) platform.addScore({ mode: "score", seed: b.seed, rulesetKey: s.contentId, score: b.total, moves: b.moves, ms: b.ms, assists: b.undos + b.hints > 0, status: b.status, invalids: b.invalids, sessionId: s.sessionId });
    app.resultsCtx = { mode: "score" };
    progressNote = () => T("Saved to the local board.");
  } else app.resultsCtx = { mode: "practice" };
  platform.persist();

  const stageTitle = stage?.title ?? null;
  const mode = s.mode;
  const LOSS: Record<string, string> = { conceded: N("You left the table."), "move-limit-exceeded": N("Out of moves."), "time-limit-exceeded": N("Out of time."), "redeal-limit-exceeded": N("Too many recycles.") };
  app.results = () => ({
    headline: won ? T("The garden blooms") : T("The garden rests"),
    sub: won ? (stageTitle ? T("{title} — complete", { title: T(stageTitle) }) : T("Every foundation stands complete.")) : T(LOSS[b.reason ?? ""] ?? N("Round over.")),
    stars, breakdown: b, progressNote: progressNote(), achievements: newly,
    nextLabel: nextLabel() || (mode !== "journey" ? T("New deal") : null),
  });
  showResults();
  // Signed in, every won round (any mode but lessons) posts its total to the high-score board.
  app.lb = null;
  if (won && platform.signedIn()) {
    app.lb = "posting";
    const sess = s;
    void platform.postScore(b.total).then((r) => { if (app.session === sess) app.lb = r; });
  }
}
function showResults(): void {
  app.phase = "results";
  app.selection = null;
  render.settle();
  app.screens = [];
  openOverlay({ name: "results" });
  app.focusNext = "btn-results-next";
  const v = app.results!();
  announce(`${v.headline}. ${v.sub}`, true);
}
export function leaderboardLine(): string | null {
  const r = app.lb;
  if (!r) return null;
  if (r === "posting") return S("lbPosting");
  return !r.posted ? S("lbNotPosted") : r.rank ? S("lbRank", { rank: r.rank }) : S("lbPosted");
}
/** main.js resultsAction. */
export function resultsAction(action: "replay" | "next" | "home"): void {
  const ctx = app.resultsCtx ?? { mode: "practice" };
  if (action === "replay" && app.config) { startGame(app.config); return; }
  if (action === "next") {
    if (ctx.mode === "learn") {
      if (typeof ctx.next === "string") startGame({ mode: "learn", lessonId: ctx.next });
      else { app.session = null; app.phase = "title"; showScreen({ name: "learn" }); }
      return;
    }
    if (ctx.mode === "journey") { startGame({ mode: "journey", stage: ctx.next as number }); return; }
    if (ctx.mode === "daily") { goHome(); return; }
    if (ctx.mode === "practice") { startGame({ mode: "practice", level: app.config?.level, salt: platform.save().stats.games }); return; }
    app.session = null;
    app.phase = "title";
    showScreen({ name: "setup", mode: ctx.mode as SetupMode });
    return;
  }
  goHome();
}
function goHome(): void { app.session = null; app.phase = "title"; showScreen({ name: "title" }); }

// ------------------------------------------------------------------ keyboard / pad pile focus (main.js KB_ORDER)
const KB_ORDER: Loc[] = [
  { zone: "stock", pile: 0 }, { zone: "waste", pile: 0 },
  { zone: "foundation", pile: 0 }, { zone: "foundation", pile: 1 }, { zone: "foundation", pile: 2 }, { zone: "foundation", pile: 3 },
  ...Array.from({ length: 7 }, (_, i): Loc => ({ zone: "tableau", pile: i })),
];
export function kbTarget(): Loc { return KB_ORDER[app.kbFocus]!; }
function kbMove(k: "left" | "right" | "up" | "down"): void {
  app.kbActive = true;
  const row = app.kbFocus <= 5 ? 0 : 1;
  if (k === "left") app.kbFocus = Math.max(row === 0 ? 0 : 6, app.kbFocus - 1);
  if (k === "right") app.kbFocus = Math.min(row === 0 ? 5 : 12, app.kbFocus + 1);
  if (k === "down" && row === 0) app.kbFocus = 6 + Math.min(6, Math.max(0, app.kbFocus));
  if (k === "up" && row === 1) app.kbFocus = Math.min(5, app.kbFocus - 6);
  kbAnnounce();
}
function kbConfirm(): void {
  app.kbActive = true;
  const t = kbTarget(), s = app.session!.state;
  if (t.zone === "tableau") handleTap({ zone: "tableau", pile: t.pile, index: s.tableau[t.pile]!.length - 1 });
  else if (t.zone === "waste") handleTap({ zone: "waste", pile: 0, index: s.waste.length - 1 });
  else handleTap(t);
}
export function kbWords(): string {
  const t = kbTarget(), s = app.session?.state;
  if (!s) return "";
  if (t.zone === "stock") return s.stock.length ? T("Stock, {n} cards", { n: s.stock.length }) : T("Stock empty");
  if (t.zone === "waste") return s.waste.length ? T("Waste: {card}", { card: cardLabel(s.waste[s.waste.length - 1]!) }) : T("Waste empty");
  if (t.zone === "foundation") {
    const f = s.foundations[t.pile]!;
    return f.length ? T("Foundation: {card}", { card: cardLabel(f[f.length - 1]!) }) : T("Foundation {suit}, empty", { suit: Rules.SUIT_SYMBOLS[t.pile]! });
  }
  const p = s.tableau[t.pile]!, topCard = p[p.length - 1];
  return topCard ? T("Row {n}: {count} cards, top {card}", { n: t.pile + 1, count: p.length, card: topCard.up ? cardLabel(topCard.c) : T("face down") }) : T("Row {n}, empty", { n: t.pile + 1 });
}
function kbAnnounce(): void {
  if (!app.session) return;
  const where = kbWords();
  announce(app.selection ? T("{where}. Placing {what}", { where, what: describeSelection() }) : T("{where}. Press Enter to select.", { where }));
  refreshBoard();
}

onAction((e) => {
  if (!e.pressed || ui.capturingKeys()) return;
  const a = e.action;
  if (app.screens.length) return; // screens handle their own keys (Escape closes the top one)
  if (!app.session || app.phase !== "active") return;
  if (a === "pause") { if (fresh()) pauseGame(); return; }
  if (a === "cancel") {
    if (!fresh()) return;
    if (app.selection) { clearSelection(); app.selection = null; refreshBoard(); } else pauseGame();
    return;
  }
  if (a === "focus_left" || a === "focus_right" || a === "focus_up" || a === "focus_down") {
    ui.setFocus(null);
    kbMove(a.slice(6) as "left" | "right" | "up" | "down");
  } else if (a === "select") {
    if (ui.focused() !== null) return; // Enter / Space on a focused button is the button's
    kbConfirm();
  } else if (a === "draw") doDraw();
  else if (a === "undo") doUndo();
  else if (a === "hint") doHint();
  else if (a === "autofinish") doAutofinish();
});

// ------------------------------------------------------------------ taps and drags on the glasshouse (main.js installCanvasInput)
/** Rectangles (window pixels) where a press belongs to the UI, set by screens.ts each frame. */
export const hudRects: { x: number; y: number; width: number; height: number }[] = [];
/** The playfield (window pixels), set by screens.ts. */
export const view: render.ViewRect = { x: 0, y: 0, width: 0, height: 0 };
const inView = (x: number, y: number): boolean => x >= view.x && y >= view.y && x <= view.x + view.width && y <= view.y + view.height;
const onHud = (x: number, y: number): boolean => hudRects.some((r) => x >= r.x && y >= r.y && x <= r.x + r.width && y <= r.y + r.height);
type PEvent = { kind: "down" | "move" | "up" | "cancel"; x: number; y: number; id: number };
const events: PEvent[] = [];
let lastTouch = -1e9;
let press: { x: number; y: number; id: number; hit: Loc | null; dragging: boolean } | null = null;
let lastTap: { key: string; at: number } = { key: "", at: -10 };
onTouch((e) => {
  lastTouch = now();
  if (e.control) return;
  const kind = e.phase === "start" ? "down" : e.phase === "end" ? "up" : e.phase === "move" ? "move" : "cancel";
  events.push({ kind, x: e.x, y: e.y, id: e.id });
});
onPointerButton((e) => {
  if (e.button !== 0 || now() - lastTouch < 0.6) return;
  events.push({ kind: e.pressed ? "down" : "up", x: e.x, y: e.y, id: -1 });
});
onPointerMove((x, y) => { if (press && press.id === -1 && now() - lastTouch >= 0.6) events.push({ kind: "move", x, y, id: -1 }); });
function isDraggable(hit: Loc): boolean {
  if (!app.session || hit.zone === "stock") return false;
  return !!Rules.resolveRun(app.session.state, hit);
}
/** Board taps (main.js pointerdown / pointermove / pointerup / dblclick): a tap selects or places, a drag moves a run, a second tap within 0.4 s banks. */
function pointerInput(): void {
  const sc = frame().scale;
  for (const ev of events.splice(0)) {
    if (ev.kind === "down") {
      press = null;
      if (boardIs2D() || !canAcceptInput() || !inView(ev.x, ev.y) || onHud(ev.x, ev.y)) continue;
      ui.setFocus(null);
      // Fast-forward: a press settles cosmetic animation into the exact end state (spec: skip settles every object).
      if (render.isAnimating()) render.settle();
      press = { x: ev.x, y: ev.y, id: ev.id, hit: render.pick(ev.x, ev.y), dragging: false };
      continue;
    }
    if (!press || press.id !== ev.id) continue;
    if (ev.kind === "move") {
      if (!canAcceptInput()) continue;
      if (!press.dragging && Math.hypot(ev.x - press.x, ev.y - press.y) > 8 * sc && press.hit && isDraggable(press.hit)) {
        press.dragging = true;
        app.selection = normalizeSelection(press.hit);
        render.setSelection(app.selection);
        audio.play("select");
      }
      if (press.dragging && app.selection) {
        const w = render.pointerToWorld(ev.x, ev.y);
        render.setDragged({ from: app.selection, x: w.x, z: w.z });
      }
      continue;
    }
    const p = press;
    press = null;
    if (p.dragging) {
      // Pick under the run while it is still lifted (the dragged cards are not pickable), then let it go.
      const target = ev.kind === "cancel" ? null : render.pick(ev.x, ev.y);
      render.setDragged(null);
      if (!canAcceptInput()) continue;
      if (target && (target.zone === "tableau" || target.zone === "foundation") && app.selection) attemptMove(app.selection, { zone: target.zone, pile: target.pile });
      else { clearSelection(); app.selection = null; refreshBoard(true); }
    } else if (ev.kind === "up" && p.hit) tap(p.hit);
  }
}
/** A tap on a pile location (3D picks and the 2D table's cards): a second one within 0.4 s is a double tap. */
export function tap(hit: Loc): void {
  if (render.isAnimating()) render.settle();
  const key = `${hit.zone}/${hit.pile}/${hit.index ?? -1}`;
  const t = now();
  const dbl = lastTap.key === key && t - lastTap.at < 0.4;
  lastTap = { key: dbl ? "" : key, at: t };
  app.kbActive = false;
  handleTap(hit);
  if (dbl) handleDouble(hit);
}

// ------------------------------------------------------------------ boot and lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}`;
  if (k === lookKey) return;
  lookKey = k;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}
function applyOptions(): void {
  render.setTheme(platform.options.theme);
  render.setCameraDrift(platform.options.cameraDrift);
  refreshActive();
}

onStart(() => {
  setFixedRate(60);
  initStyles();
  platform.initPlatform();
  audio.loadSfx();
  render.setReducedMotion(preferences().reducedMotion);
  applyLook();
  applyOptions();
  showScreen({ name: "title" });
  app.focusNext = "btn-play";
});
onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
platform.onOptionsChange(() => applyOptions());
platform.onProgressMerged(() => { if (top()?.name === "title") announce(T("Progress restored from your StarHermit cloud save.")); });
onSessionEnded(() => toast(S("signedOut"))); // keep playing locally
onSuspend(() => {
  hidden = true;
  awayAt = Date.now();
  // Backgrounding pauses the round (visibilitychange → pauseGame).
  if (app.phase === "active" && app.session && !app.screens.length) pauseGame();
  else saveSnapshot();
  audio.setSuspended(true);
  platform.flush();
});
let awayAt = 0;
onResume(() => {
  hidden = false;
  if (app.phase !== "paused") audio.setSuspended(false);
  // main.js visibilitychange: back from away with the round paused, say how long the garden waited.
  const away = Math.round((Date.now() - awayAt) / 1000);
  if (awayAt && app.session && app.phase === "paused" && away > 3) toast(T("While you were away: the garden waited {time} (clock paused).", { time: fmtTime(away * 1000) }));
  awayAt = 0;
});

let frameDt = 0;
onUpdate((dt) => {
  frameDt = dt;
  applyLook();
  applyTokens(platform.options.theme, ui.preferences().highContrast);
  audio.update();
  const t = now();
  if (app.toast && app.toast.until < t) app.toast = null;
  if (app.hintShown && app.hintUntil < t) { app.hintShown = null; render.setHint(null); }
});
const pending: (() => void)[] = [];
/** A widget's press, run once the frame's UI is built (state changes mid-build would break later widgets). */
export function later(fn: () => void): void { pending.push(fn); }
onRender(() => {
  hudRects.length = 0;
  drawScreens();
  for (const fn of pending.splice(0)) fn();
  pointerInput();
  const f = frame();
  render.update(frameDt, f.width, f.height, view);
});
