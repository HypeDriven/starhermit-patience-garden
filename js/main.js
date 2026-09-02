// Patience Garden — bootstrap and game controller.
// State model: boot → title → mode-select → preparing → active ↔ paused →
// resolving → results → progression. Rendering consumes immutable snapshots;
// only the session mutates rules state, through validated commands.

import {
  createCustomGame, legalActions, canMove, resolveRun, totalScore, foundationCount,
  hiddenCount, isFinished, cardName, rankOf, suitOf, RANK_LABELS, SUIT_SYMBOLS,
} from './rules.js';
import { generateWinnableLayout } from './solver.js';
import { Session } from './session.js';
import {
  THEMES, themeById, DEFAULT_THEME, JOURNEY, LESSONS, lessonById, challengeById,
  practiceDeal, dailyInfo, msUntilNextDaily, scoreChaseDeal, journeyStage, CONTENT_VERSION,
} from './content.js';
import * as store from './storage.js';
import * as audio from './audio.js';
import { createUI, fmtTime } from './ui.js';

const $ = (id) => document.getElementById(id);

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

const INVALID_TEXT = {
  'no-movable-card': 'That card cannot move — only uncovered cards and valid runs move.',
  'run-to-foundation': 'Foundations take one card at a time.',
  'wrong-foundation': 'Each foundation grows a single suit.',
  'foundation-order': 'Foundations grow upward from the Ace, one rank at a time.',
  'kings-only': 'Only a King may root in an empty row.',
  'sequence-mismatch': 'Tableau runs descend in alternating colours.',
  'same-pile': 'That card is already there.',
  'bad-target': 'Cards can only move to a row or a foundation.',
  'stock-empty': 'The stock is empty.',
  'no-redeals-left': 'No recycles left in this ruleset.',
  'nothing-to-undo': 'Nothing to undo yet.',
  'undo-disabled': 'Undo is disabled in this ruleset.',
  'not-auto-finishable': 'Auto-finish needs an empty stock and no hidden cards.',
  'lesson-step': 'Follow the lesson step — try the highlighted action.',
  'game-over': 'This round has ended.',
  'paused': 'The game is paused.',
};

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
  onShowProfile: () => { ui.renderProfile(stats, store.loadAchievements(), progress); ui.openOverlay('profile'); },
  onShowScores: () => { ui.renderScores(store.loadScores().entries); ui.openOverlay('scores'); },
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
  audio.setVolumes(settings.volumes);
  audio.setMuted(settings.muted);
  if (renderer) {
    renderer.setTheme(theme);
    renderer.setQuality(resolvedQuality());
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

function resolvedQuality() {
  if (settings.quality !== 'auto') return settings.quality;
  const mobile = matchMedia('(pointer: coarse)').matches;
  return mobile ? 'medium' : 'high';
}

function boardIs2D() {
  return settings.interfaceMode === '2d' || rendererFailed;
}

// ---------------------------------------------------------------------------
// Renderer lifecycle
// ---------------------------------------------------------------------------

async function ensureRenderer() {
  if (renderer || rendererFailed || boardIs2D()) return renderer;
  try {
    const { createRenderer } = await import('./render3d.js');
    renderer = createRenderer({
      canvas: ui.els.canvas,
      theme: themeById(settings.theme),
      quality: resolvedQuality(),
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
    ui.compatNote('3D graphics are unavailable in this browser — switched to the 2D card table. Your progress is safe.');
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
  ui.toast('Dealing…');

  let initialState, opts;
  if (config.mode === 'learn') {
    const lesson = lessonById(config.lessonId);
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
  store.saveSessionSnapshot(session.snapshot());

  ui.showScreen('game');
  ui.setBoard2DVisible(boardIs2D());
  await ensureRenderer();
  ui.setBoard2DVisible(boardIs2D()); // renderer may have failed during ensureRenderer
  if (renderer) renderer.setState(session.state, { instant: false });
  refreshBoard(true);
  updateCoach();
  updateHUDFull();
  ui.setRailsCollapsed(matchMedia('(max-width: 1023px)').matches);

  const names = { learn: 'Lesson', journey: 'Journey', daily: 'Daily', practice: 'Practice', challenge: 'Challenge', score: 'Score Chase' };
  ui.updateHUD({ modeName: names[session.mode] || session.mode, seed: session.state.seed.toString(16) });
  ui.announce(`${names[session.mode]} started. ${objectiveText()}`);
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
  store.saveSessionSnapshot(session.snapshot());
}

function resumeGame() {
  if (!session) return;
  session.resume();
  ui.closeOverlay('pause');
  appState = 'active';
  ui.announce('Resumed.');
}

// ---------------------------------------------------------------------------
// Objective text / HUD
// ---------------------------------------------------------------------------

function objectiveText() {
  if (!session) return '';
  if (session.mode === 'learn') return 'Follow the lesson steps.';
  if (session.constraint?.type === 'moves') return `Win in ${session.constraint.limit} moves or fewer.`;
  if (session.constraint?.type === 'time') return `Win within ${fmtTime(session.constraint.limitMs)}.`;
  if (session.constraint?.type === 'redeals') return session.constraint.limit === 0
    ? 'Win without recycling the stock.' : `Win with at most ${session.constraint.limit} recycles.`;
  return 'Build every foundation, Ace to King.';
}

function updateHUDFull() {
  if (!session) return;
  const s = session.state;
  const hud = {
    score: totalScore(s),
    moves: s.moves,
    ms: session.elapsedMs(),
    goal: `${foundationCount(s)}/${13 * s.ruleset.suitCount} banked · ${hiddenCount(s)} hidden`,
    objective: objectiveText(),
    foundations: s.foundations.map((f) => f.length),
    assists: `assists: ${s.undos} undo · ${s.hints} hints`,
  };
  if (session.constraint?.type === 'moves') hud.constraint = `${Math.max(0, session.constraint.limit - s.moves)} moves left`;
  if (session.constraint?.type === 'time') hud.constraint = `${fmtTime(Math.max(0, session.constraint.limitMs - session.elapsedMs()))} left`;
  if (session.constraint?.type === 'redeals') hud.constraint = `recycles used: ${s.redealsUsed}/${session.constraint.limit === 0 ? 0 : s.ruleset.maxRedeals}`;
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
    ui.coach(`${step.text}<div style="margin-top:10px;text-align:right"><button class="btn primary" id="coach-ack">Continue</button></div>`);
    document.getElementById('coach-ack').addEventListener('click', () => {
      const r = session.dispatch({ type: 'ack' });
      if (r.ok) afterDispatch(r.events);
    });
  } else {
    ui.coach(step.text);
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
    if (target.zone === 'waste' && s.waste.length === 0) { invalid('The waste is empty — draw first.'); return; }
    if (resolveRun(s, sel)) {
      selection = sel;
      hintShown = null;
      audio.playSfx('select');
      ui.announce(`Selected ${describeSelection()}. Choose a destination.`);
      refreshBoard();
    } else {
      invalid('That card is covered or cannot move.');
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
    invalid(INVALID_TEXT[verdict.reason] || 'That move is not legal.');
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
  if (!run || run.cards.length !== 1) { invalid('Only a single exposed card can bank.'); return; }
  const card = run.cards[0];
  attemptMove(sel, { zone: 'foundation', pile: suitOf(card) });
}

function describeSelection() {
  if (!selection) return '';
  const run = resolveRun(session.state, selection);
  if (!run) return 'card';
  return run.cards.length > 1 ? `a ${run.cards.length}-card run starting at ${cardName(run.cards[0])}` : cardName(run.cards[0]);
}

function attemptMove(from, to) {
  const verdict = canMove(session.state, from, to);
  if (!verdict.ok) {
    invalid(INVALID_TEXT[verdict.reason] || 'That move is not legal.');
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
      invalid(INVALID_TEXT['lesson-step']);
    } else {
      invalid(INVALID_TEXT[r.error] || `Cannot: ${r.error}`);
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
    ? `${cardName(moveEvt.cards[0])} banked. ${foundationCount(session.state)} of ${13 * session.state.ruleset.suitCount} banked.`
    : `${cardName(moveEvt.cards[0])} moved to row ${moveEvt.to.pile + 1}.`);
  if (events.some((e) => e.type === 'flip')) audio.playSfx('reveal');

  audio.setMusicIntensity(Math.min(1, foundationCount(session.state) / 52 + 0.25));

  if (renderer) {
    renderer.setState(session.state);
    if (events.some((e) => e.type === 'win')) renderer.playEvent({ type: 'win' });
  }
  refreshBoard();
  updateCoach();
  updateHUDFull();
  store.saveSessionSnapshot(session.snapshot());

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
  if (!r.ok) { invalid(INVALID_TEXT[r.error] || 'Cannot undo.'); return; }
  audio.playSfx('undo');
  clearSelection();
  if (renderer) renderer.setState(session.state);
  refreshBoard();
  updateHUDFull();
  ui.announce('Undone.');
}

function doHint() {
  if (!session || !canAcceptInput()) return;
  const h = session.hint();
  if (!h) { invalid('No moves available.'); return; }
  hintShown = h;
  audio.playSfx('hint');
  const text = session.describeAction(h);
  ui.toast(`Hint: ${text}`);
  ui.announce(`Hint: ${text}`);
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
  const lessonIndex = LESSONS.findIndex((l) => l.id === lessonId);
  const next = LESSONS[lessonIndex + 1];
  ui.renderResults({
    headline: 'Lesson complete',
    sub: lessonById(lessonId).title,
    stars: 0,
    breakdown: { rows: [['Lesson steps', session.lessonIndex]], total: 0, moves: session.state.moves, invalids: 0, undos: 0, hints: 0, ms: session.elapsedMs() },
    progressNote: `${Object.keys(progress.lessons).length}/${LESSONS.length} lessons complete`,
    achievements: newly,
    nextLabel: next ? `Next: ${next.title}` : null,
  });
  resultsContext = { mode: 'learn', next };
}

let resultsContext = null;

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
    stats.streak = 0;
  }

  const newly = [];
  if (won && store.unlockAchievement('first_bloom')) newly.push({ name: 'First Bloom' });
  if (stats.streak >= 3 && store.unlockAchievement('green_streak')) newly.push({ name: 'Green Streak' });
  if (stats.foundationsBanked >= 1000 && store.unlockAchievement('thousand_leaves')) newly.push({ name: 'Thousand Leaves' });

  let stars = 0;
  let progressNote = '';
  let nextLabel = null;

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
      nextLabel = isLast ? null : `Next: ${JOURNEY[nextIdx].title}`;
      resultsContext = { mode: 'journey', next: nextIdx, isLast };
      progressNote = `Journey: ${Object.keys(progress.journey).length}/${JOURNEY.length} stages`;
    } else {
      resultsContext = { mode: 'journey', next: stage.index, retry: true };
      nextLabel = 'Try again';
    }
  } else if (session.mode === 'daily') {
    const day = dailyInfo().day;
    if (won && !progress.dailies[day]) {
      progress.dailies[day] = { score: b.total, moves: b.moves, ms: b.ms, won: true };
      stats.dailyCompleted += 1;
      if (stats.dailyCompleted >= 5 && store.unlockAchievement('daily_devotion')) newly.push({ name: 'Daily Devotion' });
    }
    store.addScore({ mode: 'daily', seed: b.seed, rulesetKey: 'daily', score: b.total, moves: b.moves, ms: b.ms, assists: b.undos + b.hints > 0, date: day });
    resultsContext = { mode: 'daily' };
    progressNote = won ? 'Daily complete — see you tomorrow.' : 'The daily remains unconquered.';
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
      store.addScore({ mode: 'score', seed: b.seed, rulesetKey: session.contentId, score: b.total, moves: b.moves, ms: b.ms, assists: b.undos + b.hints > 0 });
    }
    resultsContext = { mode: 'score' };
    progressNote = 'Saved to the local board.';
  } else {
    resultsContext = { mode: 'practice' };
  }

  store.saveProgress(progress);
  store.saveStats(stats);
  track('round-end', { mode: session.mode, won, moves: b.moves });

  ui.renderResults({
    headline: won ? 'The garden blooms' : 'The garden rests',
    sub: won
      ? (session.mode === 'journey' && session._journeyStage ? `${session._journeyStage.title} — complete` : 'Every foundation stands complete.')
      : ({ 'conceded': 'You left the table.', 'move-limit-exceeded': 'Out of moves.', 'time-limit-exceeded': 'Out of time.', 'redeal-limit-exceeded': 'Too many recycles.' })[b.reason] || 'Round over.',
    stars,
    breakdown: b,
    progressNote,
    achievements: newly,
    nextLabel: nextLabel || (session.mode !== 'journey' ? 'New deal' : null),
  });
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
    buildNote: `Patience Garden · content v${CONTENT_VERSION}`,
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

function kbAnnounce() {
  const t = kbTarget();
  const s = session?.state;
  if (!s) return;
  let text = '';
  if (t.zone === 'stock') text = s.stock.length ? `Stock, ${s.stock.length} cards` : 'Stock empty';
  else if (t.zone === 'waste') text = s.waste.length ? `Waste: ${cardName(s.waste[s.waste.length - 1])}` : 'Waste empty';
  else if (t.zone === 'foundation') text = s.foundations[t.pile].length ? `Foundation: ${cardName(s.foundations[t.pile][s.foundations[t.pile].length - 1])}` : `Foundation ${SUIT_SYMBOLS[t.pile]}, empty`;
  else {
    const p = s.tableau[t.pile];
    const top = p[p.length - 1];
    text = p.length ? `Row ${t.pile + 1}: ${p.length} cards, top ${top.up ? cardName(top.c) : 'face down'}` : `Row ${t.pile + 1}, empty`;
  }
  ui.announce(text + (selection ? '. Placing ' + describeSelection() : '. Press Enter to select.'));
  if (renderer) renderer.setLegalTargets(selection ? legalTargetsForSelection() : [t]);
}

document.addEventListener('keydown', (e) => {
  // global overlay handling
  if (e.key === 'Escape') {
    if (!document.getElementById('screen-settings').hidden) { ui.closeOverlay('settings'); return; }
    if (!document.getElementById('screen-help').hidden) { ui.closeOverlay('help'); return; }
    if (appState === 'active') { pauseGame(); return; }
    if (appState === 'paused') { resumeGame(); return; }
    return;
  }
  if (!session || ui.currentScreen() !== 'game') return;
  if (!boardIs2D() || !document.activeElement?.closest?.('#board-dom')) {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'arrowright' || k === 'arrowup' || k === 'arrowdown') {
      e.preventDefault();
      kbActive = true;
      const row = kbFocus <= 5 ? 0 : 1;
      if (k === 'arrowleft') kbFocus = Math.max(row === 0 ? 0 : 6, kbFocus - 1);
      if (k === 'arrowright') kbFocus = Math.min(row === 0 ? 5 : 12, kbFocus + 1);
      if (k === 'arrowdown' && row === 0) kbFocus = 6 + Math.min(6, Math.max(0, kbFocus - 0));
      if (k === 'arrowup' && row === 1) kbFocus = Math.min(5, kbFocus - 6);
      kbAnnounce();
      return;
    }
    if (k === 'enter' || k === ' ') {
      e.preventDefault();
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
      return;
    }
    if (k === 'd') { e.preventDefault(); tryDispatch({ type: 'draw' }); return; }
    if (k === 'u') { e.preventDefault(); doUndo(); return; }
    if (k === 'h') { e.preventDefault(); doHint(); return; }
    if (k === 'a') { e.preventDefault(); if (session.canAutoFinish()) tryDispatch({ type: 'autofinish' }); return; }
  }
});

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
  // daily countdown (setup screen)
  ui.updateDailyCountdown(msUntilNextDaily());
}, 1000);

setInterval(() => {
  if (session && !session.isFinished()) store.saveSessionSnapshot(session.snapshot());
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
      if (away > 3) ui.toast(`While you were away: the garden waited ${fmtTime(away * 1000)} (clock paused).`);
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
// Init
// ---------------------------------------------------------------------------

function init() {
  audio.initAudio(2024);
  ui.renderSettings(settings);
  ui.renderHelp();
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
  };

  // resume offer: Play becomes snapshot-aware; falls back to mode select
  refreshPlayButton();
}

function refreshPlayButton() {
  const snap = store.loadSessionSnapshot();
  const playBtn = document.getElementById('btn-play');
  const hasSave = !!(snap && snap.state?.status === 'active');
  playBtn.textContent = hasSave ? 'Resume garden' : 'Play';
}

async function resumeSavedGame() {
  const snap = store.loadSessionSnapshot();
  if (!snap) return false;
  session = Session.restore(snap, () => Date.now());
  if (!session) return false;
  pendingConfig = { mode: session.mode };
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
  ui.announce('Resumed your saved garden.');
  return true;
}

init();
