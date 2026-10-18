// Patience Garden — bootstrap and game controller.
// State model: boot → title → mode-select → preparing → active ↔ paused →
// resolving → results → progression. Rendering consumes immutable snapshots;
// only the session mutates rules state, through validated commands.

import {
  createCustomGame, legalActions, canMove, resolveRun, totalScore, foundationCount,
  hiddenCount, isFinished, rankOf, suitOf, RANK_LABELS, SUIT_SYMBOLS,
} from './rules.js';
import { generateWinnableLayout } from './solver.js';
import { Session } from './session.js';
import {
  THEMES, themeById, DEFAULT_THEME, JOURNEY, LESSONS, lessonById, challengeById,
  practiceDeal, dailyInfo, msUntilNextDaily, scoreChaseDeal, journeyStage, CONTENT_VERSION,
} from './content.js';
import * as store from './storage.js';
import * as audio from './audio.js';
import * as platform from './platform.js';
import { platformStrings } from './platform-i18n.js';
import { pickGfxLocale } from './gfx-i18n.js';
import { createUI, fmtTime, cardLabel } from './ui.js';
import { T, N, initLanguage, onLanguage, getLang } from './i18n.js';
import { mergeSaveDocs } from './save-merge.js';
import { detectLevel, presetForLevel, resolve as resolveGraphics, DEFAULT_GRAPHICS } from './gfx.js';

const $ = (id) => document.getElementById(id);
/** Account-control strings (platform-i18n.js) in the game language. */
const platformText = () => platformStrings(pickGfxLocale([getLang()]));

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const settings = store.loadSettings();
let progress = store.loadProgress();
let stats = store.loadStats();
if (matchMedia('(prefers-reduced-motion: reduce)').matches && !localStorage.getItem('patience-garden/settings')) {
  settings.reducedMotion = true;
}

let session = null;
let renderer = null;
let rendererFailed = false;
let selection = null;        // {zone, pile, index}
let hintShown = null;
let resolvingUntil = 0;      // input lock window (shortest resolution phase)
let appState = 'title';

// Refusal reasons (English keys, translated when shown).
const INVALID_TEXT = {
  'no-movable-card': N('That card cannot move — only uncovered cards and valid runs move.'),
  'run-to-foundation': N('Foundations take one card at a time.'),
  'wrong-foundation': N('Each foundation grows a single suit.'),
  'foundation-order': N('Foundations grow upward from the Ace, one rank at a time.'),
  'kings-only': N('Only a King may root in an empty row.'),
  'sequence-mismatch': N('Tableau runs descend in alternating colors.'),
  'same-pile': N('That card is already there.'),
  'bad-target': N('Cards can only move to a row or a foundation.'),
  'stock-empty': N('The stock is empty.'),
  'no-redeals-left': N('No recycles left in this ruleset.'),
  'nothing-to-undo': N('Nothing to undo yet.'),
  'undo-disabled': N('Undo is disabled in this ruleset.'),
  'not-auto-finishable': N('Auto-finish needs an empty stock and no hidden cards.'),
  'lesson-step': N('Follow the lesson step — try the highlighted action.'),
  'game-over': N('This round has ended.'),
  'paused': N('The game is paused.'),
};
const MODE_NAMES = { learn: N('Lesson'), journey: N('Journey'), daily: N('Daily'), practice: N('Practice'), challenge: N('Challenge'), score: N('Score Chase') };

// ---------------------------------------------------------------------------
// UI handlers
// ---------------------------------------------------------------------------

const ui = createUI({
  onNav: (name) => { ui.showScreen(name); refreshScreens(); },
  onPlay: async () => {
    if (!(await resumeSavedGame())) { ui.showScreen('modes'); refreshScreens(); }
  },
  onQuickStart: (mode) => { pendingConfig = { mode }; startGame(); },
  onModeSelect: (mode) => {
    if (mode === 'journey') { ui.showScreen('journey'); refreshScreens(); return; }
    if (mode === 'learn') { ui.showScreen('learn'); refreshScreens(); return; }
    ui.showScreen('setup');
    ui.renderSetup(mode, setupContext(mode));
  },
  onStartGame: () => {
    pendingConfig = ui.getSetupConfig();
    startGame();
  },
  onJourneyPick: (index) => {
    pendingConfig = { mode: 'journey', stage: index };
    ui.showScreen('setup');
    ui.renderSetup('journey', setupContext('journey', index));
    // setup screen for journey is informational; begin directly for fewer taps
    startGame();
  },
  onLessonPick: (lessonId) => { pendingConfig = { mode: 'learn', lessonId }; startGame(); },
  onShowProfile: () => { ui.renderProfile(stats, store.loadAchievements(), progress, platform.nickname()); ui.openOverlay('profile'); },
  onShowScores: () => {
    ui.renderScores(store.loadScores().entries);
    ui.openOverlay('scores');
    lastGlobalBoards = null;
    loadGlobalBoards().then((boards) => {
      lastGlobalBoards = boards;
      if (boards && !document.getElementById('screen-scores').hidden) {
        ui.renderScores(store.loadScores().entries, boards);
      }
    });
  },
  onBoardTap: (target) => handleTap(target),
  onBoardDbl: (target) => handleDouble(target),
  onDraw: () => tryDispatch({ type: 'draw' }),
  onUndo: () => doUndo(),
  onHint: () => doHint(),
  onAutofinish: () => tryDispatch({ type: 'autofinish' }),
  onPause: () => pauseGame(),
  onResume: () => resumeGame(),
  onRestart: () => restartGame(),
  onLeave: () => leaveGame(),
  onResultsAction: (action) => resultsAction(action),
  onSettingsChange: (key, value) => applySetting(key, value),
  onGraphicsChange: (g) => applyGraphics(g),
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function applySetting(key, value) {
  const parts = key.split('.');
  let obj = settings;
  for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
  obj[parts[parts.length - 1]] = value;
  store.saveSettings(settings);
  applySettings();
  mirrorCloud();
  track('settings-change', { key });
}

function applySettings() {
  const theme = themeById(settings.theme);
  const root = document.documentElement.style;
  root.setProperty('--bg', theme.ui.bg);
  root.setProperty('--panel', theme.ui.panel);
  root.setProperty('--panel-2', `color-mix(in srgb, ${theme.ui.panel} 80%, white 6%)`);
  root.setProperty('--text', theme.ui.text);
  root.setProperty('--accent', theme.ui.accent);
  root.setProperty('--cb-a', theme.cardBack[0]);
  root.setProperty('--cb-b', theme.cardBack[1]);
  document.body.classList.toggle('high-contrast', settings.highContrast);
  document.body.classList.toggle('large-text', settings.largeText);
  document.body.classList.remove('cb-deuteranopia', 'cb-protanopia', 'cb-tritanopia');
  if (settings.colorblindPalette !== 'default') document.body.classList.add(`cb-${settings.colorblindPalette}`);
  const gfxNow = resolveGraphics(graphicsSettings(), gpuInfo().detected, gpuInfo().level);
  document.body.dataset.gfxPreset = gfxNow.preset;
  // Frosted overlay screens only where the budget allows a per-frame backdrop blur (High/Ultra).
  document.body.classList.toggle('gfx-blur', !!gfxNow.budget.blur);
  audio.setVolumes(settings.volumes);
  audio.setMuted(settings.muted);
  if (renderer) {
    renderer.setTheme(theme);
    renderer.setGraphics(graphicsSettings());
    renderer.setReducedMotion(settings.reducedMotion);
  }
  if (session && ui.currentScreen() === 'game') {
    ui.setBoard2DVisible(boardIs2D());
    if (!boardIs2D() && !renderer) {
      ensureRenderer().then(() => { if (renderer) renderer.setState(session.state, { instant: true }); refreshBoard(true); });
    }
    refreshBoard(true);
  }
}

// ---------------------------------------------------------------------------
// Graphics (quality model in gfx.js; applied live by render3d.setGraphics)
// ---------------------------------------------------------------------------

let gpuProbe = null;
/** GPU name + Auto preset, probed once from a throwaway WebGL context. */
function gpuInfo() {
  if (gpuProbe) return gpuProbe;
  let name = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '');
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  } catch { /* no WebGL: the 2D table is used */ }
  const mobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  // StarHermit hardware level (js/gpu-level.js): renderer string + device facts (phone/tablet, cores,
  // memory, screen).
  let sys = { mobile };
  try {
    const G = globalThis.StarHermitGpu;
    if (G) { const d = G.detectSystem(); sys = { mobile: mobile || d.mobile, webgl2: d.webgl2, touch: d.touch, screen: d.screen, cores: d.cores, memoryGb: d.memoryGb, astc: d.astc }; }
  } catch { /* defaults */ }
  const level = detectLevel(name, sys);
  gpuProbe = { gpu: name, level, detected: presetForLevel(level) };
  return gpuProbe;
}

function graphicsSettings() {
  if (!settings.graphics || typeof settings.graphics !== 'object') settings.graphics = { ...DEFAULT_GRAPHICS };
  return settings.graphics;
}

function graphicsInfo() {
  if (renderer) return renderer.graphicsInfo();
  const { gpu, detected, level } = gpuInfo();
  const resolved = resolveGraphics(graphicsSettings(), detected, level);
  const r = ui.els.boardRegion.getBoundingClientRect();
  const w = r.width > 8 ? r.width : window.innerWidth, h = r.height > 8 ? r.height : window.innerHeight;
  const ratio = Math.min(window.devicePixelRatio || 1, resolved.cap) * resolved.scale;
  return { gpu, level, detected, resolved, pixels: [Math.round(w * ratio), Math.round(h * ratio)], postFailed: false, noRenderer: true, fps: 0 };
}

function applyGraphics(g) {
  settings.graphics = g;
  store.saveSettings(settings);
  applySettings();
  mirrorCloud();
  ui.renderGraphics(settings.graphics, graphicsInfo());
  track('settings-change', { key: 'graphics' });
}

// Live summary (fps, adaptive pixels) while the Settings overlay is open.
setInterval(() => {
  if (!document.getElementById('screen-settings').hidden) ui.updateGraphicsInfo(graphicsInfo());
}, 1000);

function boardIs2D() {
  return settings.interfaceMode === '2d' || rendererFailed;
}

// ---------------------------------------------------------------------------
// Renderer lifecycle
// ---------------------------------------------------------------------------

let compatKey = null;
async function ensureRenderer() {
  if (renderer || rendererFailed || boardIs2D()) return renderer;
  try {
    const { createRenderer } = await import('./render3d.js');
    renderer = createRenderer({
      canvas: ui.els.canvas,
      theme: themeById(settings.theme),
      graphics: graphicsSettings(),
      detected: gpuInfo().detected,
      level: gpuInfo().level,
      reducedMotion: settings.reducedMotion,
      seed: session ? session.state.seed : 1,
    });
    const r = ui.els.boardRegion.getBoundingClientRect();
    renderer.resize(r.width, r.height);
    installCanvasInput();
  } catch (err) {
    console.warn('3D unavailable, falling back to 2D:', err);
    renderer = null;
    rendererFailed = true;
    compatKey = N('3D graphics are unavailable in this browser — switched to the 2D card table. Your progress is safe.');
    ui.compatNote(T(compatKey));
  }
  return renderer;
}

function installCanvasInput() {
  const canvas = ui.els.canvas;
  if (canvas.dataset.inputInstalled) return;
  canvas.dataset.inputInstalled = '1';
  let downInfo = null;
  let dragging = false;

  canvas.addEventListener('pointerdown', (e) => {
    if (!canAcceptInput()) return;
    canvas.setPointerCapture(e.pointerId);
    const hit = renderer.pick(e.clientX, e.clientY);
    downInfo = { hit, x: e.clientX, y: e.clientY, id: e.pointerId };
    dragging = false;
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!downInfo || !canAcceptInput()) return;
    const dist = Math.hypot(e.clientX - downInfo.x, e.clientY - downInfo.y);
    if (!dragging && dist > 8 && downInfo.hit && isDraggable(downInfo.hit)) {
      dragging = true;
      selection = normalizeSelection(downInfo.hit);
      renderer.setSelection(selection);
      audio.playSfx('select');
    }
    if (dragging) {
      const w = renderer.pointerToWorld(e.clientX, e.clientY);
      renderer.setDragged({ from: selection, x: w.x, z: w.z });
    }
  });

  const finish = (e, cancelled) => {
    if (!downInfo) return;
    const wasDragging = dragging;
    dragging = false;
    const hit = downInfo.hit;
    downInfo = null;
    if (!canAcceptInput()) { renderer.setDragged(null); return; }
    if (wasDragging) {
      renderer.setDragged(null);
      const target = cancelled ? null : renderer.pick(e.clientX, e.clientY);
      if (target && (target.zone === 'tableau' || target.zone === 'foundation')) {
        attemptMove(selection, { zone: target.zone, pile: target.pile });
      } else {
        renderer.setSelection(null);
        refreshBoard(true); // snap back
      }
    } else if (!cancelled && hit) {
      handleTap(hit);
    }
  };
  canvas.addEventListener('pointerup', (e) => finish(e, false));
  canvas.addEventListener('pointercancel', (e) => finish(e, true));
  canvas.addEventListener('lostpointercapture', () => { if (dragging) { dragging = false; renderer.setDragged(null); refreshBoard(true); } });
  canvas.addEventListener('dblclick', (e) => {
    if (!canAcceptInput()) return;
    const hit = renderer.pick(e.clientX, e.clientY);
    if (hit) handleDouble(hit);
  });
}

function isDraggable(hit) {
  if (!session || !hit) return false;
  if (hit.zone === 'stock') return false;
  return !!resolveRun(session.state, hit);
}

function normalizeSelection(hit) {
  const s = session.state;
  if (hit.zone === 'waste') return { zone: 'waste', pile: 0, index: s.waste.length - 1 };
  if (hit.zone === 'foundation') return { zone: 'foundation', pile: hit.pile, index: s.foundations[hit.pile].length - 1 };
  return { zone: 'tableau', pile: hit.pile, index: hit.index };
}

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------

let pendingConfig = null;

/** Persist the in-round snapshot plus the config needed to restart this deal. */
function saveSnapshot() {
  if (!session) return;
  store.saveSessionSnapshot({ ...session.snapshot(), restartConfig: pendingConfig });
}

/** Best-effort restart config for a restored session lacking one. */
function configForSession(sess) {
  const cfg = { mode: sess.mode };
  if (sess.mode === 'challenge') cfg.challengeId = sess.contentId;
  else if (sess.mode === 'learn') cfg.lessonId = sess.contentId;
  else if (sess.mode === 'journey') {
    const i = JOURNEY.findIndex((s) => s.id === sess.contentId);
    if (i >= 0) cfg.stage = i;
  } else if (sess.mode === 'practice') {
    const m = /^practice-(.+)-(\d+)$/.exec(sess.contentId || '');
    if (m) { cfg.level = m[1]; cfg.salt = +m[2]; }
  } else if (sess.mode === 'score') {
    const m = /^score-(.+)-(.+)-(\d+)$/.exec(sess.contentId || '');
    if (m) { cfg.scoreProfile = m[1]; cfg.scoreBand = m[2]; }
  }
  return cfg;
}

function setupContext(mode, stageIndex = null) {
  if (mode === 'daily') return { daily: dailyInfo() };
  if (mode === 'challenge') return { challenges: progress.challenges };
  if (mode === 'journey') return { stage: journeyStage(stageIndex ?? nextJourneyIndex()) };
  return {};
}

function nextJourneyIndex() {
  for (let i = 0; i < JOURNEY.length; i++) if (!progress.journey[JOURNEY[i].id]) return i;
  return JOURNEY.length - 1;
}

async function startGame() {
  const config = pendingConfig;
  if (!config) return;
  appState = 'preparing';
  ui.toast(T('Dealing…'));

  let initialState, opts;
  if (config.mode === 'learn') {
    const lesson = lessonById(config.lessonId);
    if (!lesson) { // stale config — never wedge on "Dealing…"
      ui.hideToast();
      ui.toast(T('That lesson is unavailable — pick another.'), true);
      ui.showScreen('learn');
      refreshScreens();
      appState = 'title';
      return;
    }
    initialState = createCustomGame(lesson.layout, lesson.ruleset, 0);
    opts = {
      mode: 'learn', contentId: lesson.id, seed: 0, ruleset: initialState.ruleset,
      layout: lesson.layout, lessonSteps: lesson.steps, ranked: false,
      initialState,
    };
  } else {
    let descriptor;
    if (config.mode === 'daily') descriptor = dailyInfo();
    else if (config.mode === 'journey') descriptor = journeyStage(config.stage ?? nextJourneyIndex());
    else if (config.mode === 'challenge') descriptor = challengeById(config.challengeId);
    else if (config.mode === 'score') descriptor = scoreChaseDeal(config.scoreProfile || 'wildwood', config.scoreBand || 'medium', 0);
    else {
      if (config.salt === undefined) config.salt = stats.games; // pin deal so Replay is identical
      descriptor = practiceDeal(config.level || 'easy', config.salt);
    }

    if (!descriptor) { // unknown content (e.g. stale config) — never wedge on "Dealing…"
      ui.hideToast();
      ui.toast(T('That table is unavailable — pick another.'), true);
      ui.showScreen('modes');
      refreshScreens();
      appState = 'title';
      return;
    }

    const { layout } = generateWinnableLayout(descriptor.seed, descriptor.ruleset);
    initialState = createCustomGame(layout, descriptor.ruleset, descriptor.seed);
    initialState.custom = false;
    opts = {
      mode: config.mode,
      contentId: descriptor.id,
      seed: descriptor.seed,
      ruleset: initialState.ruleset,
      layout,
      ranked: !!descriptor.ranked,
      constraint: descriptor.constraint
        ? (descriptor.constraint.type === 'time' && settings.timingAssist
          ? { ...descriptor.constraint, limitMs: Math.round(descriptor.constraint.limitMs * 1.15) }
          : descriptor.constraint)
        : null,
      contentVersion: CONTENT_VERSION,
      initialState,
    };
    if (config.mode === 'journey') opts.journeyStage = descriptor;
  }

  session = new Session(opts);
  session._journeyStage = opts.journeyStage || null;
  selection = null;
  hintShown = null;
  saveSnapshot();

  ui.showScreen('game');
  ui.setBoard2DVisible(boardIs2D());
  await ensureRenderer();
  ui.setBoard2DVisible(boardIs2D()); // renderer may have failed during ensureRenderer
  if (renderer) renderer.setState(session.state, { instant: false });
  refreshBoard(true);
  updateCoach();
  updateHUDFull();
  ui.hideToast(); // the "Dealing…" notice must not linger over active play
  ui.setRailsCollapsed(matchMedia('(max-width: 1023px)').matches);

  ui.updateHUD({ modeName: T(MODE_NAMES[session.mode] || session.mode), seed: session.state.seed.toString(16) });
  ui.announce(T('{mode} started. {objective}', { mode: T(MODE_NAMES[session.mode] || session.mode), objective: objectiveText() }));
  appState = 'active';
  track('round-start', { mode: session.mode });
  audio.unlockAudio();
  audio.playSfx('draw');
}

function restartGame() {
  if (!session) return;
  const mode = session.mode;
  ui.closeOverlay('pause');
  startGame(); // same pendingConfig → same seed/content for authored modes
  track('retry', { mode });
}

function leaveGame() {
  if (session && !session.isFinished()) {
    session.dispatch({ type: 'concede' });
  }
  store.clearSessionSnapshot();
  session = null;
  selection = null;
  ui.closeOverlay('pause');
  ui.showScreen('title');
  refreshTitle();
  appState = 'title';
}

function pauseGame() {
  if (!session || session.isFinished()) return;
  session.pause();
  audio.playSfx('pause');
  ui.openOverlay('pause');
  $('btn-resume').focus();
  appState = 'paused';
  saveSnapshot();
}

function resumeGame() {
  if (!session) return;
  session.resume();
  ui.closeOverlay('pause');
  appState = 'active';
  ui.announce(T('Resumed.'));
}

// ---------------------------------------------------------------------------
// Objective text / HUD
// ---------------------------------------------------------------------------

function objectiveText() {
  if (!session) return '';
  if (session.mode === 'learn') return T('Follow the lesson steps.');
  if (session.constraint?.type === 'moves') return T('Win in {n} moves or fewer.', { n: session.constraint.limit });
  if (session.constraint?.type === 'time') return T('Win within {time}.', { time: fmtTime(session.constraint.limitMs) });
  if (session.constraint?.type === 'redeals') return session.constraint.limit === 0
    ? T('Win without recycling the stock.') : T('Win with at most {n} recycles.', { n: session.constraint.limit });
  return T('Build every foundation, Ace to King.');
}

function updateHUDFull() {
  if (!session) return;
  const s = session.state;
  const hud = {
    score: totalScore(s),
    moves: s.moves,
    ms: session.elapsedMs(),
    goal: T('{banked}/{total} banked · {hidden} hidden', { banked: foundationCount(s), total: 13 * s.ruleset.suitCount, hidden: hiddenCount(s) }),
    objective: objectiveText(),
    foundations: s.foundations.map((f) => f.length),
    assists: T('assists: {undos} undo · {hints} hints', { undos: s.undos, hints: s.hints }),
  };
  if (session.constraint?.type === 'moves') hud.constraint = T('{n} moves left', { n: Math.max(0, session.constraint.limit - s.moves) });
  if (session.constraint?.type === 'time') hud.constraint = T('{time} left', { time: fmtTime(Math.max(0, session.constraint.limitMs - session.elapsedMs())) });
  if (session.constraint?.type === 'redeals') hud.constraint = T('recycles used: {used}/{max}', { used: s.redealsUsed, max: session.constraint.limit === 0 ? 0 : s.ruleset.maxRedeals });
  ui.updateHUD(hud);
  const acts = legalActions(s);
  ui.setActions({
    undo: s.ruleset.allowUndo && (s.history?.length || 0) > 0,
    hint: !isFinished(s) && acts.length > 0,
    draw: !isFinished(s) && acts.some((a) => a.type === 'draw'),
    autofinish: session.canAutoFinish(),
  });
}

// ---------------------------------------------------------------------------
// Coach (lessons)
// ---------------------------------------------------------------------------

function updateCoach() {
  if (!session || session.mode !== 'learn') { ui.coach(null); return; }
  const step = session.currentStep();
  if (!step) {
    ui.coach(null);
    return;
  }
  if (step.expect.type === 'ack') {
    ui.coach(`${T(step.text)}<div style="margin-top:10px;text-align:right"><button class="btn primary" id="coach-ack">${T('Continue')}</button></div>`);
    document.getElementById('coach-ack').addEventListener('click', () => {
      const r = session.dispatch({ type: 'ack' });
      if (r.ok) afterDispatch(r.events);
    });
  } else {
    ui.coach(T(step.text));
  }
}

// ---------------------------------------------------------------------------
// Input → commands
// ---------------------------------------------------------------------------

function canAcceptInput() {
  return session && appState === 'active' && !session.paused && !session.isFinished() && Date.now() >= resolvingUntil;
}

function lockInputBriefly() {
  resolvingUntil = Date.now() + (settings.reducedMotion ? 40 : 220);
}

function handleTap(target) {
  if (!canAcceptInput()) return;
  audio.unlockAudio();
  const s = session.state;

  if (target.zone === 'stock') {
    clearSelection();
    tryDispatch({ type: 'draw' });
    return;
  }

  if (!selection) {
    // bare slots / empty piles with no selection: quietly ignore
    if (target.index === -1) return;
    if (target.zone === 'tableau' && s.tableau[target.pile].length === 0) return;
    if (target.zone === 'foundation' && s.foundations[target.pile].length === 0) return;
    // try to select a movable card
    const sel = normalizeSelection(target);
    if (target.zone === 'waste' && s.waste.length === 0) { invalid(T('The waste is empty — draw first.')); return; }
    if (resolveRun(s, sel)) {
      selection = sel;
      hintShown = null;
      audio.playSfx('select');
      ui.announce(T('Selected {what}. Choose a destination.', { what: describeSelection() }));
      refreshBoard();
    } else {
      invalid(T('That card is covered or cannot move.'));
    }
    return;
  }

  // tapping the selected card again banks it to its foundation
  const selNow = normalizeSelection(target);
  if (selection.zone === selNow.zone && selection.pile === selNow.pile && selection.index === selNow.index) {
    const run = resolveRun(s, selection);
    if (run && run.cards.length === 1) {
      const card = run.cards[0];
      if (canMove(s, selection, { zone: 'foundation', pile: suitOf(card) }).ok) {
        attemptMove(selection, { zone: 'foundation', pile: suitOf(card) });
        return;
      }
    }
    clearSelection();
    refreshBoard();
    return;
  }

  // selection active → place or reselect
  if (target.zone === 'tableau' || target.zone === 'foundation') {
    const to = { zone: target.zone, pile: target.pile };
    const verdict = canMove(s, selection, to);
    if (verdict.ok) {
      tryDispatch({ type: 'move', from: selection, to });
      return;
    }
    // explain, then reselect the tapped card when it is itself movable
    invalid(T(INVALID_TEXT[verdict.reason] || N('That move is not legal.')));
    const alt = normalizeSelection(target);
    selection = (target.index !== -1 && resolveRun(s, alt)) ? alt : null;
    if (selection && renderer) renderer.setSelection(selection);
    if (selection) audio.playSfx('select');
    refreshBoard();
    return;
  } else if (target.zone === 'waste') {
    clearSelection();
    refreshBoard();
  } else {
    clearSelection();
    refreshBoard();
  }
}

function handleDouble(target) {
  if (!canAcceptInput()) return;
  audio.unlockAudio();
  if (target.zone !== 'waste' && target.zone !== 'tableau') return;
  const sel = normalizeSelection(target);
  const s = session.state;
  const run = resolveRun(s, sel);
  if (!run || run.cards.length !== 1) { invalid(T('Only a single exposed card can bank.')); return; }
  const card = run.cards[0];
  attemptMove(sel, { zone: 'foundation', pile: suitOf(card) });
}

function describeSelection() {
  if (!selection) return '';
  const run = resolveRun(session.state, selection);
  if (!run) return T('card');
  return run.cards.length > 1 ? T('a {n}-card run starting at {card}', { n: run.cards.length, card: cardLabel(run.cards[0]) }) : cardLabel(run.cards[0]);
}

/** A hint/action in words, in the game language (session.describeAction is the English original). */
function describeAction(a) {
  if (!a) return T('No moves available.');
  if (a.type === 'draw') return session.state.stock.length > 0 ? T('Draw from the stock.') : T('Recycle the waste into a fresh stock.');
  const card = a.cards[0];
  const name = `${RANK_LABELS[rankOf(card)]}${SUIT_SYMBOLS[suitOf(card)]}`;
  const from = a.from.zone === 'waste' ? T('the waste') : a.from.zone === 'foundation' ? T('foundation {n}', { n: a.from.pile + 1 }) : T('row {n}', { n: a.from.pile + 1 });
  const to = a.to.zone === 'foundation' ? T('its foundation') : T('row {n}', { n: a.to.pile + 1 });
  return a.cards.length > 1
    ? T('Move {card} ({n}-card run) from {from} to {to}.', { card: name, n: a.cards.length, from, to })
    : T('Move {card} from {from} to {to}.', { card: name, from, to });
}

function attemptMove(from, to) {
  const verdict = canMove(session.state, from, to);
  if (!verdict.ok) {
    invalid(T(INVALID_TEXT[verdict.reason] || N('That move is not legal.')));
    clearSelection();
    refreshBoard(true);
    return;
  }
  tryDispatch({ type: 'move', from, to });
}

function tryDispatch(cmd) {
  if (!session || !canAcceptInput()) return;
  const r = session.dispatch(cmd);
  if (!r.ok) {
    if (r.error === 'lesson-step') {
      invalid(T(INVALID_TEXT['lesson-step']));
    } else {
      invalid(INVALID_TEXT[r.error] ? T(INVALID_TEXT[r.error]) : T('Cannot: {reason}', { reason: r.error }));
    }
    return;
  }
  lockInputBriefly();
  clearSelection();
  hintShown = null;
  afterDispatch(r.events);
}

function afterDispatch(events) {
  for (const e of events) {
    if (e.type === 'draw' || e.type === 'redeal') audio.playSfx('draw');
    if (e.type === 'move') audio.playSfx(e.to.zone === 'foundation' ? 'bank' : 'place');
    if (e.type === 'flip') { audio.playSfx('flip'); }
    if (e.type === 'win') audio.playSfx('win');
    if (e.type === 'lose') audio.playSfx('lose');
  }
  const moveEvt = events.find((e) => e.type === 'move');
  if (moveEvt) ui.announce(moveEvt.to.zone === 'foundation'
    ? T('{card} banked. {n} of {total} banked.', { card: cardLabel(moveEvt.cards[0]), n: foundationCount(session.state), total: 13 * session.state.ruleset.suitCount })
    : T('{card} moved to row {n}.', { card: cardLabel(moveEvt.cards[0]), n: moveEvt.to.pile + 1 }));
  if (events.some((e) => e.type === 'flip')) audio.playSfx('reveal');

  audio.setMusicIntensity(Math.min(1, foundationCount(session.state) / 52 + 0.25));

  if (renderer) {
    renderer.setState(session.state);
    if (events.some((e) => e.type === 'win')) renderer.playEvent({ type: 'win' });
  }
  refreshBoard();
  updateCoach();
  updateHUDFull();
  saveSnapshot();

  if (session.mode === 'learn') {
    if (!session.currentStep()) finishLesson();
    return; // lessons end via finishLesson, never the round-results path
  }
  if (session.finalizeIfEnded()) {
    finishRound();
  }
}

function clearSelection() {
  selection = null;
  if (renderer) renderer.setSelection(null);
}

function invalid(text) {
  audio.playSfx('invalid');
  ui.toast(text, true);
  ui.announce(text);
  if (renderer) renderer.playEvent({ type: 'invalid' });
}

function doUndo() {
  if (!canAcceptInput()) return;
  const r = session.undo();
  if (!r.ok) { invalid(T(INVALID_TEXT[r.error] || N('Cannot undo.'))); return; }
  audio.playSfx('undo');
  clearSelection();
  if (renderer) renderer.setState(session.state);
  refreshBoard();
  updateHUDFull();
  ui.announce(T('Undone.'));
}

function doHint() {
  if (!session || !canAcceptInput()) return;
  const h = session.hint();
  if (!h) { invalid(T('No moves available.')); return; }
  hintShown = h;
  audio.playSfx('hint');
  const text = T('Hint: {text}', { text: describeAction(h) });
  ui.toast(text);
  ui.announce(text);
  if (renderer) {
    renderer.setHint(h.type === 'draw' ? { draw: true } : { from: h.from, to: h.to });
    setTimeout(() => renderer && renderer.setHint(null), 2600);
  }
  refreshBoard();
  setTimeout(() => { hintShown = null; refreshBoard(); }, 2600);
}

// ---------------------------------------------------------------------------
// Board refresh (2D layer + renderer highlights)
// ---------------------------------------------------------------------------

function refreshBoard(instant = false) {
  if (!session) return;
  const s = session.state;
  if (boardIs2D()) {
    ui.renderBoard2D(s, { selected: selection, hintAction: hintShown, targets: legalTargetsForSelection() });
  }
  if (renderer) {
    if (instant) renderer.setState(s, { instant: true });
    renderer.setSelection(selection);
    renderer.setLegalTargets(legalTargetsForSelection());
  }
}

function legalTargetsForSelection() {
  if (!selection || !session) return [];
  const s = session.state;
  const out = [];
  for (let p = 0; p < 7; p++) {
    if (canMove(s, selection, { zone: 'tableau', pile: p }).ok) out.push({ zone: 'tableau', pile: p });
  }
  for (let f = 0; f < 4; f++) {
    if (canMove(s, selection, { zone: 'foundation', pile: f }).ok) out.push({ zone: 'foundation', pile: f });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Round completion
// ---------------------------------------------------------------------------

function finishLesson() {
  const lessonId = session.contentId;
  progress.lessons[lessonId] = { completedAt: Date.now() };
  store.saveProgress(progress);
  store.clearSessionSnapshot();
  const newly = [];
  if (Object.keys(progress.lessons).length >= LESSONS.length) {
    if (store.unlockAchievement('graduate')) newly.push({ name: 'Graduate' });
    settings.tutorialDone = true;
    store.saveSettings(settings);
  }
  track('tutorial-step', { lesson: lessonId, done: true });
  mirrorCloud();
  const lessonIndex = LESSONS.findIndex((l) => l.id === lessonId);
  const next = LESSONS[lessonIndex + 1];
  const breakdown = { rows: [[N('Lesson steps'), session.lessonIndex]], total: 0, moves: session.state.moves, invalids: 0, undos: 0, hints: 0, ms: session.elapsedMs() };
  const lessonsDone = Object.keys(progress.lessons).length;
  resultsView = () => ({
    headline: T('Lesson complete'),
    sub: T(lessonById(lessonId).title),
    stars: 0,
    breakdown,
    progressNote: T('{n}/{total} lessons complete', { n: lessonsDone, total: LESSONS.length }),
    achievements: newly,
    nextLabel: next ? T('Next: {title}', { title: T(next.title) }) : null,
  });
  resultsExtra = { validation: null, lb: null };
  ui.renderResults(resultsView());
  resultsContext = { mode: 'learn', next };
}

let resultsContext = null;
// The open results screen, rebuilt in the game language on demand:
// resultsView() → renderResults payload; resultsExtra holds the replay
// validation verdict and the leaderboard line that arrive afterwards.
let resultsView = null;
let resultsExtra = { validation: null, lb: null };

function finishRound() {
  const b = session.breakdown();
  const won = b.status === 'won';
  store.clearSessionSnapshot();

  // stats
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
  } else {
    stats.losses += 1;
    stats.streak = 0;
  }

  const newly = [];
  if (won && store.unlockAchievement('first_bloom')) newly.push({ name: 'First Bloom' });
  if (stats.streak >= 3 && store.unlockAchievement('green_streak')) newly.push({ name: 'Green Streak' });
  if (stats.foundationsBanked >= 1000 && store.unlockAchievement('thousand_leaves')) newly.push({ name: 'Thousand Leaves' });

  let stars = 0;
  let progressNote = () => '';
  let nextLabel = () => null;

  if (session.mode === 'journey' && session._journeyStage) {
    const stage = session._journeyStage;
    if (won) {
      stars = 1 + (b.moves <= stage.par.moves ? 1 : 0) + (b.ms <= stage.par.timeMs ? 1 : 0);
      const prev = progress.journey[stage.id];
      progress.journey[stage.id] = {
        stars: Math.max(stars, prev?.stars || 0),
        bestMoves: Math.min(b.moves, prev?.bestMoves ?? Infinity),
        bestTimeMs: Math.min(b.ms, prev?.bestTimeMs ?? Infinity),
        completedAt: Date.now(),
      };
      progress.mastery.stagesCompleted = Object.keys(progress.journey).length;
      if (stage.index + 1 >= 20 && store.unlockAchievement('head_gardener')) newly.push({ name: 'Head Gardener' });
      const nextIdx = Math.min(stage.index + 1, JOURNEY.length - 1);
      const isLast = stage.index >= JOURNEY.length - 1;
      nextLabel = () => (isLast ? null : T('Next: {title}', { title: T(JOURNEY[nextIdx].title) }));
      resultsContext = { mode: 'journey', next: nextIdx, isLast };
      const stagesDone = Object.keys(progress.journey).length;
      progressNote = () => T('Journey: {n}/{total} stages', { n: stagesDone, total: JOURNEY.length });
    } else {
      resultsContext = { mode: 'journey', next: stage.index, retry: true };
      nextLabel = () => T('Try again');
    }
  } else if (session.mode === 'daily') {
    const day = dailyInfo().day;
    if (won && !progress.dailies[day]) {
      progress.dailies[day] = { score: b.total, moves: b.moves, ms: b.ms, won: true };
      stats.dailyCompleted += 1;
      if (stats.dailyCompleted >= 5 && store.unlockAchievement('daily_devotion')) newly.push({ name: 'Daily Devotion' });
    }
    store.addScore({ mode: 'daily', seed: b.seed, rulesetKey: 'daily', score: b.total, moves: b.moves, ms: b.ms, assists: b.undos + b.hints > 0, date: day, status: b.status, invalids: b.invalids, sessionId: session.sessionId });
    resultsContext = { mode: 'daily' };
    progressNote = () => (won ? T('Daily complete — see you tomorrow.') : T('The daily remains unconquered.'));
  } else if (session.mode === 'challenge') {
    const ch = challengeById(session.contentId);
    if (won) {
      const prev = progress.challenges[session.contentId];
      progress.challenges[session.contentId] = {
        completed: true,
        bestScore: Math.max(b.total, prev?.bestScore || 0),
        bestMs: Math.min(b.ms, prev?.bestMs ?? Infinity),
      };
    }
    resultsContext = { mode: 'challenge' };
  } else if (session.mode === 'score') {
    if (won) {
      store.addScore({ mode: 'score', seed: b.seed, rulesetKey: session.contentId, score: b.total, moves: b.moves, ms: b.ms, assists: b.undos + b.hints > 0, status: b.status, invalids: b.invalids, sessionId: session.sessionId });
    }
    resultsContext = { mode: 'score' };
    progressNote = () => T('Saved to the local board.');
  } else {
    resultsContext = { mode: 'practice' };
  }

  store.saveProgress(progress);
  store.saveStats(stats);
  mirrorCloud();
  track('round-end', { mode: session.mode, won, moves: b.moves });

  const stageTitle = session.mode === 'journey' && session._journeyStage ? session._journeyStage.title : null;
  const mode = session.mode;
  const LOSS = { 'conceded': N('You left the table.'), 'move-limit-exceeded': N('Out of moves.'), 'time-limit-exceeded': N('Out of time.'), 'redeal-limit-exceeded': N('Too many recycles.') };
  resultsView = () => ({
    headline: won ? T('The garden blooms') : T('The garden rests'),
    sub: won
      ? (stageTitle ? T('{title} — complete', { title: T(stageTitle) }) : T('Every foundation stands complete.'))
      : T(LOSS[b.reason] || N('Round over.')),
    stars,
    breakdown: b,
    progressNote: progressNote(),
    achievements: newly,
    nextLabel: nextLabel() || (mode !== 'journey' ? T('New deal') : null),
  });
  resultsExtra = { validation: null, lb: null };
  ui.renderResults(resultsView());
  submitRankedReplay();
  postToLeaderboard(won, b.total);
}

// Signed in, every won round (any mode but lessons) posts its total to the
// StarHermit high-score board; the results screen shows the rank.
function postToLeaderboard(won, total) {
  const line = $('results-lb');
  if (!line) return;
  if (!won || !platform.isHosted()) { line.hidden = true; return; }
  line.hidden = false;
  resultsExtra.lb = { pending: true };
  renderLbLine();
  const extra = resultsExtra;
  platform.submitScore(total).then((r) => {
    extra.lb = r;
    if (extra === resultsExtra) renderLbLine();
  });
}

function renderLbLine() {
  const line = $('results-lb');
  const r = resultsExtra.lb;
  if (!line || !r) return;
  const t = platformText();
  line.textContent = r.pending ? t.lbPosting : !r.posted ? t.lbNotPosted
    : r.rank ? t.lbRank.replace('{rank}', r.rank) : t.lbPosted;
}

/** Replay-validation suffix on the progress line (Daily / Score Chase). */
function renderValidation() {
  const v = resultsExtra.validation;
  const note = $('results-progress');
  if (!v || !note || !resultsView) return;
  const base = resultsView().progressNote;
  if (v.ok && v.accepted) note.textContent = T('{note} · validated ✓', { note: base });
  else if (v.ok) note.textContent = T('{note} · not validated ({reason}) — kept local', { note: base, reason: v.reason });
}

function resultsAction(action) {
  ui.closeOverlay('results');
  const ctx = resultsContext || {};
  if (action === 'replay') {
    startGame();
    return;
  }
  if (action === 'next') {
    if (ctx.mode === 'learn') {
      if (ctx.next) { pendingConfig = { mode: 'learn', lessonId: ctx.next.id }; startGame(); }
      else { ui.showScreen('learn'); refreshScreens(); }
      return;
    }
    if (ctx.mode === 'journey') {
      pendingConfig = { mode: 'journey', stage: ctx.next };
      startGame();
      return;
    }
    if (ctx.mode === 'daily') { ui.showScreen('title'); refreshTitle(); return; }
    // practice / challenge / score: new deal or back to setup
    if (ctx.mode === 'practice') { pendingConfig = { mode: 'practice', level: pendingConfig.level, salt: stats.games }; startGame(); return; }
    ui.showScreen('setup');
    ui.renderSetup(ctx.mode || 'practice', setupContext(ctx.mode));
    return;
  }
  // home
  ui.showScreen('title');
  refreshTitle();
}

// ---------------------------------------------------------------------------
// Screens refresh
// ---------------------------------------------------------------------------

function refreshTitle() {
  refreshPlayButton();
  const done = Object.keys(progress.journey).length;
  const todayDone = !!progress.dailies[dailyInfo().day];
  ui.setTitleInfo({
    journeyDone: done,
    journeyTotal: JOURNEY.length,
    dailyDone: todayDone,
    buildNote: T('Patience Garden · content v{version}', { version: CONTENT_VERSION }),
  });
}

function refreshScreens() {
  ui.renderModes();
  ui.renderJourney(JOURNEY, progress);
  ui.renderLessons(progress);
  refreshTitle();
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

const KB_ORDER = [
  { zone: 'stock', pile: 0 }, { zone: 'waste', pile: 0 },
  { zone: 'foundation', pile: 0 }, { zone: 'foundation', pile: 1 },
  { zone: 'foundation', pile: 2 }, { zone: 'foundation', pile: 3 },
  ...Array.from({ length: 7 }, (_, i) => ({ zone: 'tableau', pile: i })),
];
let kbFocus = 0;
let kbActive = false;

function kbTarget() { return KB_ORDER[kbFocus]; }

function kbMove(k) {
  kbActive = true;
  const row = kbFocus <= 5 ? 0 : 1;
  if (k === 'arrowleft') kbFocus = Math.max(row === 0 ? 0 : 6, kbFocus - 1);
  if (k === 'arrowright') kbFocus = Math.min(row === 0 ? 5 : 12, kbFocus + 1);
  if (k === 'arrowdown' && row === 0) kbFocus = 6 + Math.min(6, Math.max(0, kbFocus - 0));
  if (k === 'arrowup' && row === 1) kbFocus = Math.min(5, kbFocus - 6);
  kbAnnounce();
}

function kbConfirm() {
  kbActive = true;
  const t = kbTarget();
  if (t.zone === 'tableau') {
    const pile = session.state.tableau[t.pile];
    handleTap({ zone: 'tableau', pile: t.pile, index: pile.length - 1 });
  } else if (t.zone === 'waste') {
    handleTap({ zone: 'waste', pile: 0, index: session.state.waste.length - 1 });
  } else {
    handleTap(t);
  }
}

function kbAnnounce() {
  const t = kbTarget();
  const s = session?.state;
  if (!s) return;
  let text = '';
  if (t.zone === 'stock') text = s.stock.length ? T('Stock, {n} cards', { n: s.stock.length }) : T('Stock empty');
  else if (t.zone === 'waste') text = s.waste.length ? T('Waste: {card}', { card: cardLabel(s.waste[s.waste.length - 1]) }) : T('Waste empty');
  else if (t.zone === 'foundation') text = s.foundations[t.pile].length ? T('Foundation: {card}', { card: cardLabel(s.foundations[t.pile][s.foundations[t.pile].length - 1]) }) : T('Foundation {suit}, empty', { suit: SUIT_SYMBOLS[t.pile] });
  else {
    const p = s.tableau[t.pile];
    const top = p[p.length - 1];
    text = p.length ? T('Row {n}: {count} cards, top {card}', { n: t.pile + 1, count: p.length, card: top.up ? cardLabel(top.c) : T('face down') }) : T('Row {n}, empty', { n: t.pile + 1 });
  }
  ui.announce(selection ? T('{where}. Placing {what}', { where: text, what: describeSelection() }) : T('{where}. Press Enter to select.', { where: text }));
  if (renderer) renderer.setLegalTargets(selection ? legalTargetsForSelection() : [t]);
}

// Keyboard bindings: declared as control.* in starhermit.txt; the player's
// StarHermit overrides replace these defaults when signed in.
const DEFAULT_BINDINGS = {
  focus_left: ['ArrowLeft'],
  focus_right: ['ArrowRight'],
  focus_up: ['ArrowUp'],
  focus_down: ['ArrowDown'],
  select: ['Enter', 'NumpadEnter', 'Space'],
  draw: ['KeyD'],
  undo: ['KeyU'],
  hint: ['KeyH'],
  autofinish: ['KeyA'],
  pause: ['Escape'],
};
let bindings = structuredClone(DEFAULT_BINDINGS);
const KB_DIR = { focus_left: 'arrowleft', focus_right: 'arrowright', focus_up: 'arrowup', focus_down: 'arrowdown' };

function actionFor(code) {
  for (const [action, codes] of Object.entries(bindings)) if (codes.includes(code)) return action;
  return null;
}

function applyBindings(b) {
  bindings = b;
  ui.renderHelp(bindings);
}

document.addEventListener('keydown', (e) => {
  const action = actionFor(e.code);
  // global overlay handling
  if (e.key === 'Escape' || action === 'pause') {
    for (const ov of ['settings', 'help', 'profile', 'scores']) {
      if (!document.getElementById(`screen-${ov}`).hidden) { ui.closeOverlay(ov); return; }
    }
    if (appState === 'active') { pauseGame(); return; }
    if (appState === 'paused') { resumeGame(); return; }
    return;
  }
  if (!session || ui.currentScreen() !== 'game') return;
  if (!boardIs2D() || !document.activeElement?.closest?.('#board-dom')) {
    if (KB_DIR[action]) {
      e.preventDefault();
      kbMove(KB_DIR[action]);
      return;
    }
    if (action === 'select') {
      e.preventDefault();
      kbConfirm();
      return;
    }
    if (action === 'draw') { e.preventDefault(); tryDispatch({ type: 'draw' }); return; }
    if (action === 'undo') { e.preventDefault(); doUndo(); return; }
    if (action === 'hint') { e.preventDefault(); doHint(); return; }
    if (action === 'autofinish') { e.preventDefault(); if (session.canAutoFinish()) tryDispatch({ type: 'autofinish' }); return; }
  }
});

// ---------------------------------------------------------------------------
// Gamepad: dpad/left-stick navigate focus, A confirm, B cancel, X undo,
// Y hint, Start pause — the same actions as the keyboard layer.
// ---------------------------------------------------------------------------

const padPrev = {};
const padHeldAt = {};

setInterval(() => {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = pads && pads[0];
  if (!gp) { for (const k of Object.keys(padPrev)) padPrev[k] = false; return; }
  const pressed = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
  const axis = (i) => gp.axes[i] || 0;
  const now = Date.now();
  const edge = (name, v) => { const was = padPrev[name]; padPrev[name] = v; return v && !was; };
  // held directions repeat: delay 350 ms, then every 140 ms
  const repeat = (name, v) => {
    if (!v) { padPrev[name] = false; delete padHeldAt[name]; return false; }
    if (edge(name, v)) { padHeldAt[name] = now; return true; }
    const held = padHeldAt[name] ?? now;
    if (now - held >= 350 && now - (padHeldAt[`${name}:last`] ?? 0) >= 140) {
      padHeldAt[`${name}:last`] = now;
      return true;
    }
    return false;
  };

  if (edge('start', pressed(9))) {
    if (appState === 'active') { pauseGame(); return; }
    if (appState === 'paused') { resumeGame(); return; }
  }
  if (!session || ui.currentScreen() !== 'game') return;
  if (edge('a', pressed(0))) kbConfirm();
  if (edge('b', pressed(1))) {
    if (selection) { clearSelection(); refreshBoard(); }
    else if (appState === 'active') pauseGame();
  }
  if (edge('x', pressed(2))) doUndo();
  if (edge('y', pressed(3))) doHint();
  if (repeat('left', pressed(14) || axis(0) < -0.5)) kbMove('arrowleft');
  if (repeat('right', pressed(15) || axis(0) > 0.5)) kbMove('arrowright');
  if (repeat('up', pressed(12) || axis(1) < -0.5)) kbMove('arrowup');
  if (repeat('down', pressed(13) || axis(1) > 0.5)) kbMove('arrowdown');
}, 120);

// ---------------------------------------------------------------------------
// Clock tick, autosave, daily countdown, visibility
// ---------------------------------------------------------------------------

let awayAt = null;

setInterval(() => {
  if (session && appState === 'active' && !session.paused) {
    const failEvents = session.tick();
    if (failEvents) {
      afterDispatch(failEvents);
      return;
    }
    ui.updateHUD({ ms: session.elapsedMs() });
    if (session.constraint?.type === 'time') updateHUDFull();
  }
  // daily countdown (setup screen) — server time when hosted, local otherwise
  ui.updateDailyCountdown(msUntilNextDaily(platform.serverNow()));
}, 1000);

setInterval(() => {
  if (session && !session.isFinished()) saveSnapshot();
}, 8000);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    awayAt = Date.now();
    if (session && appState === 'active' && !session.isFinished()) {
      pauseGame();
    }
    if (renderer) renderer.pause();
    audio.setBackgrounded(true);
  } else {
    if (renderer) renderer.resume();
    audio.setBackgrounded(false);
    if (awayAt && session && appState === 'paused') {
      const away = Math.round((Date.now() - awayAt) / 1000);
      if (away > 3) ui.toast(T('While you were away: the garden waited {time} (clock paused).', { time: fmtTime(away * 1000) }));
    }
    awayAt = null;
  }
});

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

function handleViewportChange() {
  ui.setRailsCollapsed(matchMedia('(max-width: 1023px)').matches);
  const r = ui.els.boardRegion.getBoundingClientRect();
  if (renderer && r.width > 0) renderer.resize(r.width, r.height);
  if (boardIs2D() && session) refreshBoard(true);
}

new ResizeObserver(handleViewportChange).observe(ui.els.boardRegion);
window.addEventListener('orientationchange', () => setTimeout(handleViewportChange, 250));
matchMedia('(max-width: 1023px)').addEventListener('change', handleViewportChange);

// ---------------------------------------------------------------------------
// Analytics (anonymous funnel only, consent-free aggregate counters)
// ---------------------------------------------------------------------------

function track(event, data = {}) {
  try {
    const key = 'patience-garden/funnel';
    const log = JSON.parse(localStorage.getItem(key) || '[]');
    log.push({ e: event, d: data, t: Date.now() });
    while (log.length > 200) log.shift();
    localStorage.setItem(key, JSON.stringify(log));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// StarHermit platform (hosted mode only): account identity, cloud mirror of
// the local save documents, validated ranked replays, read-only global board.
// Without a launch token none of this runs and play is purely local.
// ---------------------------------------------------------------------------

const SYNC_LABELS = { syncing: N('saving…'), synced: N('cloud saved'), error: N('cloud save failed') };
const SAVE_DOC_KEYS = ['settings', 'progress', 'stats', 'achievements', 'scores'];

function currentSaveDoc() {
  return {
    version: 1,
    savedAt: Date.now(),
    settings: store.loadSettings(),
    progress: store.loadProgress(),
    stats: store.loadStats(),
    achievements: store.loadAchievements(),
    scores: store.loadScores(),
  };
}

// Signed in, nothing is mirrored until the cloud doc has been compared: a
// save queued earlier would PUT the stale local docs over a newer cloud save
// (debounce or pagehide flush). Such a save is replayed after the load.
let cloudReady = true;
let cloudMirrorHeld = false;

/** Debounced PUT of the save documents to the cloud slot (localStorage stays the cache). */
function mirrorCloud() {
  if (!cloudReady) { cloudMirrorHeld = true; return; }
  platform.queueCloudSave(currentSaveDoc());
  platform.syncSettings(settings);
}

function updatePlayerLine() {
  const name = platform.nickname();
  ui.setPlayerInfo(name, name ? T(SYNC_LABELS[platform.syncStatus()] || '') : null);
  ui.setAccountButtons({ signIn: platform.canSignIn(), invite: !!platform.inviteLink() });
}

/**
 * Merge the cloud doc with this device's docs (save-merge.js: the account's
 * settings, the better record of every progress entry) and adopt the result,
 * keeping a backup of the replaced local docs. Returns true when the merge
 * differs from the cloud copy, i.e. it must be written back.
 */
function applyRemoteDoc(remote) {
  const local = currentSaveDoc();
  const doc = mergeSaveDocs(remote, local);
  const needsPush = SAVE_DOC_KEYS.some((k) => JSON.stringify(remote[k]) !== JSON.stringify(doc[k]));
  const differs = SAVE_DOC_KEYS.some((k) => JSON.stringify(local[k]) !== JSON.stringify(doc[k]));
  if (!differs) return needsPush;
  store.backupLocalDocs(local);
  store.saveSettings(doc.settings);
  store.saveProgress(doc.progress);
  store.saveStats(doc.stats);
  store.saveAchievements(doc.achievements);
  store.saveScores(doc.scores);
  for (const k of Object.keys(settings)) delete settings[k];
  Object.assign(settings, structuredClone(doc.settings));
  progress = store.loadProgress();
  stats = store.loadStats();
  applySettings();
  ui.renderSettings(settings);
  refreshScreens();
  if (session) updateHUDFull();
  return needsPush;
}

/** Platform settings KV wins over local values for known preference keys. */
function applyRemoteSettings(remote) {
  let changed = false;
  for (const [k, v] of Object.entries(remote || {})) {
    if (k === 'version' || !(k in store.DEFAULT_SETTINGS) || v == null) continue;
    if (typeof v !== typeof store.DEFAULT_SETTINGS[k]) continue;
    if (JSON.stringify(settings[k]) === JSON.stringify(v)) continue;
    settings[k] = structuredClone(v);
    changed = true;
  }
  if (!changed) return;
  store.saveSettings(settings);
  ui.renderSettings(settings);
  ui.renderGraphics(graphicsSettings(), graphicsInfo());
  applySettings();
}

async function inviteFriend() {
  const t = platformText();
  const link = platform.inviteLink();
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link);
    ui.toast(t.inviteCopied);
  } catch {
    ui.toast(t.inviteFailed.replace('{link}', link));
  }
}

function labelAccount() {
  const t = platformText();
  ui.setAccountLabels({ signIn: t.signIn, invite: t.invite });
}

function bootPlatform() {
  labelAccount();
  ui.onAccountAction({ signIn: () => platform.signIn(), invite: () => inviteFriend() });
  const boot = platform.initPlatform();
  platform.loadBindings(DEFAULT_BINDINGS).then(applyBindings);
  platform.onAuthChange(({ signedIn }) => {
    if (!signedIn) ui.toast(platformText().signedOut);
    updatePlayerLine();
  });
  updatePlayerLine();
  if (!boot.hosted) return;
  platform.onSyncStatus(updatePlayerLine);
  cloudReady = false;
  // Another device saved first: the SDK refused the write; re-read, merge, save again.
  platform.onSaveConflict(async () => {
    const remote = await platform.loadCloudDoc().catch(() => null);
    if (remote) applyRemoteDoc(remote);
    mirrorCloud();
  });
  boot.ready.catch(() => null).then(async (remoteDoc) => {
    cloudReady = true;
    if (remoteDoc && applyRemoteDoc(remoteDoc)) cloudMirrorHeld = true; // write the merge back
    if (cloudMirrorHeld) { cloudMirrorHeld = false; mirrorCloud(); } // pushes the docs as they stand after the merge
    applyRemoteSettings(await platform.loadRemoteSettings());
    platform.syncSettings(settings);
    updatePlayerLine();
  });
}

// Ranked boards (Daily / Score Chase): hand the replay envelope to the
// authoritative validator. Unreachable or rejected → the result stays local
// and the board is casual, per spec.
function submitRankedReplay() {
  if (session.mode !== 'daily' && session.mode !== 'score') return;
  const note = $('results-progress');
  if (!note) return;
  const extra = resultsExtra;
  platform.validateReplay(session.envelope).then((v) => {
    const resultsOpen = !document.getElementById('screen-results').hidden;
    if (!resultsOpen || extra !== resultsExtra) return;
    extra.validation = v;
    renderValidation();
  });
}

// Read-only global board for the scores overlay; local records always shown.
let lastGlobalBoards = null;
function loadGlobalBoards() {
  if (!platform.isHosted()) return Promise.resolve(null);
  return platform.globalBoardRows().then((rows) => (rows ? [{ title: N('Global'), rows }] : null), () => null);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
  // Game language first (sh-language.js): every screen renders in it.
  initLanguage();
  bootPlatform();
  audio.initAudio(2024);
  ui.renderGraphics(graphicsSettings(), graphicsInfo());
  ui.renderSettings(settings);
  ui.renderHelp(bindings);
  applySettings();
  refreshScreens();
  ui.showScreen('title');
  ui.setRailsCollapsed(matchMedia('(max-width: 1023px)').matches);

  // unlock audio on first interaction
  const unlock = () => { audio.unlockAudio(); };
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });

  // debug/testing handle (not part of the public UI)
  window.__pg = {
    get session() { return session; },
    get appState() { return appState; },
    get renderer() { return renderer; },
    dispatch(cmd) { tryDispatch(cmd); }, // debug/testing: full UI path
    canAcceptInput() { return canAcceptInput(); }, // input lock (reduced-motion / resolution phase)
  };

  // resume offer: Play becomes snapshot-aware; falls back to mode select
  refreshPlayButton();
  onLanguage(relocalize);
}

// Live language switch: markup re-applies itself (i18n.js); everything built
// in code re-renders here in place. The round, selection and open screens stay.
function relocalize() {
  ui.refreshLanguage();
  refreshScreens();
  labelAccount();
  updatePlayerLine();
  if (!$('screen-setup').hidden) {
    const cfg = ui.getSetupConfig();
    if (cfg) ui.renderSetup(cfg.mode, setupContext(cfg.mode, cfg.stage ?? null), cfg);
  }
  if (session) {
    ui.updateHUD({ modeName: T(MODE_NAMES[session.mode] || session.mode) });
    updateHUDFull();
    updateCoach();
    refreshBoard();
  }
  if (!$('screen-results').hidden && resultsView) {
    ui.renderResults(resultsView(), { reopen: false });
    renderValidation();
    renderLbLine();
  }
  if (!$('screen-profile').hidden) ui.renderProfile(stats, store.loadAchievements(), progress, platform.nickname());
  if (!$('screen-scores').hidden) ui.renderScores(store.loadScores().entries, lastGlobalBoards);
  if (compatKey) ui.compatNote(T(compatKey));
}

function refreshPlayButton() {
  const snap = store.loadSessionSnapshot();
  const playBtn = document.getElementById('btn-play');
  const hasSave = !!(snap && snap.state?.status === 'active');
  playBtn.textContent = hasSave ? T('Resume garden') : T('Play');
}

async function resumeSavedGame() {
  const snap = store.loadSessionSnapshot();
  if (!snap) return false;
  session = Session.restore(snap, () => Date.now());
  if (!session) return false;
  pendingConfig = snap.restartConfig || configForSession(session);
  // Journey progress is keyed from the stage descriptor, which the snapshot
  // does not carry — re-derive it so a resumed win still records stars.
  session._journeyStage = session.mode === 'journey'
    ? JOURNEY.find((s) => s.id === session.contentId) || null
    : null;
  ui.showScreen('game');
  ui.setBoard2DVisible(boardIs2D());
  await ensureRenderer();
  ui.setBoard2DVisible(boardIs2D()); // renderer may have failed during ensureRenderer
  if (renderer) renderer.setState(session.state, { instant: true });
  session.resume();
  refreshBoard(true);
  updateCoach();
  updateHUDFull();
  appState = 'active';
  ui.announce(T('Resumed your saved garden.'));
  return true;
}

init();
