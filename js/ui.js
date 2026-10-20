// Patience Garden — DOM UI layer: screens, HUD, accessible 2D board,
// settings, help, results, profile. The 2D board is a fully playable
// semantic-HTML interface (and the no-WebGL fallback); the 3D canvas is
// driven separately by render3d.js through the same session state.

import {
  RANK_LABELS, SUIT_SYMBOLS, suitOf, rankOf, colorOf, totalScore,
  foundationCount, hiddenCount,
} from './rules.js';
import { THEMES, MODES, BAND_LABELS, PROFILES, PRACTICE_LEVELS, CHALLENGES, LESSONS, JOURNEY, ACHIEVEMENTS } from './content.js';
import { PRESETS, CATEGORIES, presetTier, choosePreset, describe } from './gfx.js';
import { pickGfxLocale, gfxStrings } from './gfx-i18n.js';
import { T, N, getLang } from './i18n.js';

const $ = (id) => document.getElementById(id);

const SUIT_NAMES = [N('Spades'), N('Hearts'), N('Diamonds'), N('Clubs')];
const RANK_NAMES = [N('Ace'), N('Two'), N('Three'), N('Four'), N('Five'), N('Six'), N('Seven'),
  N('Eight'), N('Nine'), N('Ten'), N('Jack'), N('Queen'), N('King')];
/** Card name in the game language ("Queen of Hearts"). */
export function cardLabel(card) {
  return T('{rank} of {suit}', { rank: T(RANK_NAMES[rankOf(card)]), suit: T(SUIT_NAMES[suitOf(card)]) });
}
export const suitName = (s) => T(SUIT_NAMES[s]);
/** Band + profile label, e.g. "Medium Wildwood". */
export function tableLabel(band, profile) {
  return T('{band} {profile}', { band: T(BAND_LABELS[band] || band), profile: T(PROFILES[profile]?.label || profile) });
}

export function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function createUI(handlers) {
  const els = {
    screens: Object.fromEntries(
      ['title', 'modes', 'setup', 'journey', 'learn', 'game', 'pause', 'results', 'settings', 'help', 'profile', 'scores']
        .map((n) => [n, $(`screen-${n}`)])),
    toast: $('toast'), announce: $('announce'), coach: $('coach'),
    boardDom: $('board-dom'), canvas: $('game-canvas'), boardRegion: $('board-region'),
  };
  let overlayReturn = 'title';
  let lastFocus = null;

  // ---- generic helpers ----------------------------------------------------

  function showScreen(name) {
    for (const [n, el] of Object.entries(els.screens)) el.hidden = n !== name;
    if (name === 'game') $('board-region').focus({ preventScroll: true });
    else {
      const first = els.screens[name]?.querySelector('button');
      if (first) first.focus({ preventScroll: true });
    }
  }

  function currentScreen() {
    for (const [n, el] of Object.entries(els.screens)) if (!el.hidden) return n;
    return 'title';
  }

  function openOverlay(name) {
    overlayReturn = currentScreen();
    lastFocus = document.activeElement;
    els.screens[name].hidden = false;
    const first = els.screens[name].querySelector('button, input, select');
    if (first) first.focus({ preventScroll: true });
  }

  function closeOverlay(name) {
    els.screens[name].hidden = true;
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
    lastFocus = null;
  }

  let toastTimer = null;
  function toast(text, isError = false) {
    els.toast.textContent = text;
    els.toast.classList.toggle('error', isError);
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    els.toast.classList.remove('show');
  }

  function announce(text) {
    els.announce.textContent = '';
    requestAnimationFrame(() => { els.announce.textContent = text; });
  }

  function coach(text) {
    els.coach.hidden = !text;
    if (text) els.coach.innerHTML = text;
  }

  // ---- buttons --------------------------------------------------------------

  const wire = (id, fn) => $(id).addEventListener('click', (e) => { e.preventDefault(); fn(); });
  wire('btn-play', () => handlers.onPlay());
  wire('btn-daily', () => handlers.onQuickStart('daily'));
  wire('btn-journey', () => handlers.onNav('journey'));
  wire('btn-learn', () => handlers.onNav('learn'));
  wire('btn-scores', () => { handlers.onShowScores(); });
  wire('btn-profile', () => { handlers.onShowProfile(); });
  wire('btn-help', () => openOverlay('help'));
  wire('btn-settings', () => openOverlay('settings'));
  wire('btn-start-game', () => handlers.onStartGame());
  wire('btn-pause', () => handlers.onPause());
  wire('btn-rail-toggle', () => {
    const rail = $('rail-left');
    const collapsed = rail.classList.toggle('collapsed');
    $('rail-right').classList.toggle('collapsed', collapsed);
    $('btn-rail-toggle').setAttribute('aria-expanded', String(!collapsed));
  });
  wire('btn-resume', () => handlers.onResume());
  wire('btn-pause-settings', () => openOverlay('settings'));
  wire('btn-pause-help', () => openOverlay('help'));
  wire('btn-restart', () => handlers.onRestart());
  wire('btn-leave', () => handlers.onLeave());
  wire('btn-undo', () => handlers.onUndo());
  wire('btn-hint', () => handlers.onHint());
  wire('btn-draw', () => handlers.onDraw());
  wire('btn-autofinish', () => handlers.onAutofinish());
  wire('btn-results-replay', () => handlers.onResultsAction('replay'));
  wire('btn-results-next', () => handlers.onResultsAction('next'));
  wire('btn-results-home', () => handlers.onResultsAction('home'));
  wire('btn-settings-close', () => closeOverlay('settings'));
  wire('btn-help-close', () => closeOverlay('help'));
  wire('btn-profile-close', () => closeOverlay('profile'));
  wire('btn-scores-close', () => closeOverlay('scores'));
  document.querySelectorAll('[data-nav]').forEach((b) =>
    b.addEventListener('click', () => showScreen(b.dataset.nav)));

  // ---- title / modes ---------------------------------------------------------

  function setTitleInfo({ journeyDone, journeyTotal, dailyDone, buildNote }) {
    $('journey-status').textContent = `${journeyDone}/${journeyTotal}`;
    $('daily-status').textContent = dailyDone ? T('done today ✓') : T('new today');
    $('build-note').textContent = buildNote;
  }

  // Hosted identity slot: platform nickname + cloud sync status (hidden locally).
  function setPlayerInfo(name, syncLabel) {
    const line = $('player-line');
    if (!name) { line.hidden = true; return; }
    line.hidden = false;
    $('player-name').textContent = name;
    $('sync-status').textContent = syncLabel ? `· ${syncLabel}` : '';
  }

  // StarHermit account buttons on the title card (sign-in only on the hosted
  // domain without a token; invite only when signed in).
  function setAccountButtons({ signIn, invite }) {
    $('btn-signin').hidden = !signIn;
    $('btn-invite').hidden = !invite;
  }
  function setAccountLabels({ signIn, invite }) {
    $('btn-signin').textContent = signIn;
    $('btn-invite').textContent = invite;
  }
  function onAccountAction({ signIn, invite }) {
    wire('btn-signin', signIn);
    wire('btn-invite', invite);
  }

  function renderModes() {
    const host = $('mode-list');
    host.innerHTML = '';
    for (const m of MODES) {
      const card = document.createElement('div');
      card.className = 'mode-card';
      const b = document.createElement('button');
      b.className = 'mode-card-btn';
      // Keep the button label exactly the mode name: it is the card's action,
      // and assistive tech / automation match on the full label text.
      b.innerHTML = `<h3 data-icon="${m.icon}">${T(m.name)}</h3>`;
      b.addEventListener('click', () => handlers.onModeSelect(m.id));
      const info = document.createElement('div');
      info.className = 'mode-card-info';
      info.innerHTML = `${m.ranked ? `<span class="badge">${T('ranked')}</span>` : ''}
        <p>${T(m.blurb)}</p>
        <span class="meta"><span>${T('1 player')}</span><span>${T(m.duration)}</span><span>${T('assists: {list}', { list: T(m.assists) })}</span></span>`;
      card.append(b, info);
      host.appendChild(card);
    }
  }

  // ---- setup ------------------------------------------------------------------

  let setupConfig = null;

  // `keep` (a previous config for the same mode) re-applies the player's pick
  // when the screen is re-rendered for a language change.
  function renderSetup(mode, ctx, keep = null) {
    const body = $('setup-body');
    body.innerHTML = '';
    setupConfig = { mode };
    const title = $('setup-heading');
    if (keep && keep.mode !== mode) keep = null;

    if (mode === 'practice') {
      title.textContent = T('Practice — pick a difficulty');
      const grid = document.createElement('div');
      grid.className = 'card-grid';
      for (const level of PRACTICE_LEVELS) {
        const b = document.createElement('button');
        b.className = 'mode-card';
        b.innerHTML = `<h3>${T(level.label)}</h3><p>${T(level.text)}</p>
          <span class="meta"><span>${T('unrated')}</span><span>${T('undo + hints allowed')}</span></span>`;
        b.addEventListener('click', () => {
          grid.querySelectorAll('.mode-card').forEach((x) => x.classList.remove('completed'));
          b.classList.add('completed');
          setupConfig.level = level.id;
        });
        grid.appendChild(b);
      }
      body.appendChild(grid);
      const keptLevel = PRACTICE_LEVELS.findIndex((l) => l.id === keep?.level);
      setupConfig.level = keptLevel >= 0 ? keep.level : 'easy';
      grid.children[keptLevel >= 0 ? keptLevel : 1].classList.add('completed');
    } else if (mode === 'challenge') {
      title.textContent = T('Challenges — constrained goals');
      const grid = document.createElement('div');
      grid.className = 'card-grid';
      for (const ch of CHALLENGES) {
        const done = ctx.challenges?.[ch.id]?.completed;
        const b = document.createElement('button');
        b.className = 'mode-card' + (done ? ' completed' : '');
        b.innerHTML = `<h3>${done ? '✓ ' : ''}${T(ch.name)}</h3><p>${T(ch.text)}</p>
          <span class="meta"><span>${T('~{n} min', { n: ch.expectedMinutes })}</span>${done ? `<span>${T('best {score}', { score: ctx.challenges[ch.id].bestScore })}</span>` : ''}</span>`;
        b.addEventListener('click', () => {
          grid.querySelectorAll('.mode-card').forEach((x) => x.classList.remove('completed'));
          b.classList.add('completed');
          setupConfig.challengeId = ch.id;
        });
        grid.appendChild(b);
      }
      body.appendChild(grid);
      const keptCh = CHALLENGES.findIndex((c) => c.id === keep?.challengeId);
      setupConfig.challengeId = CHALLENGES[Math.max(0, keptCh)].id;
      grid.children[Math.max(0, keptCh)].classList.add('completed');
    } else if (mode === 'daily') {
      title.textContent = T('Daily — {day}', { day: ctx.daily.day });
      body.innerHTML = `<div class="rule-card"><div class="demo">☀</div><div>
        <h4>${T('One garden, worldwide')}</h4>
        <p>${T('Everyone plays the same seed today. Draw 1, unlimited recycles. Undo and hints are allowed but flagged as assists on the board.')}</p>
        <p class="mono dim">${T('seed {seed} · ruleset v{version}', { seed: ctx.daily.seed.toString(16), version: ctx.daily.version })}</p></div></div>
        <p class="dim">${T('Local board. Next daily in {time}.', { time: '<b id="daily-countdown"></b>' })}</p>`;
      setupConfig.daily = ctx.daily;
    } else if (mode === 'journey') {
      const s = ctx.stage;
      title.textContent = T('Stage {n} — {title}', { n: s.index + 1, title: T(s.title) });
      body.innerHTML = `<div class="rule-card"><div class="demo">${s.mastery ? '❀' : '❧'}</div><div>
        <h4>${T(s.title)}</h4><p>${T(s.text)}</p>
        <p class="dim">${T('Par: {moves} moves · about {min} min · {table}', { moves: s.par.moves, min: s.expectedMinutes, table: tableLabel(s.band, s.profile) })}</p></div></div>`;
      setupConfig.stage = s.index;
    } else if (mode === 'score') {
      title.textContent = T('Score Chase — pick a table');
      const grid = document.createElement('div');
      grid.className = 'card-grid';
      const bands = [['medium', 'wildwood'], ['hard', 'wildwood'], ['easy', 'thicket']];
      const keptBand = Math.max(0, bands.findIndex(([band, profile]) => band === keep?.scoreBand && profile === keep?.scoreProfile));
      bands.forEach(([band, profile], i) => {
        const b = document.createElement('button');
        b.className = 'mode-card' + (i === keptBand ? ' completed' : '');
        b.innerHTML = `<h3>${tableLabel(band, profile)}</h3>
          <p>${T('A fixed, validated seed — difficulty: {band}. Local board; assists flagged.', { band: T(BAND_LABELS[band]) })}</p>`;
        b.addEventListener('click', () => {
          grid.querySelectorAll('.mode-card').forEach((x) => x.classList.remove('completed'));
          b.classList.add('completed');
          setupConfig.scoreBand = band;
          setupConfig.scoreProfile = profile;
        });
        grid.appendChild(b);
      });
      body.appendChild(grid);
      [setupConfig.scoreBand, setupConfig.scoreProfile] = bands[keptBand];
    }
    return setupConfig;
  }

  function getSetupConfig() { return setupConfig; }

  function updateDailyCountdown(ms) {
    const el = $('daily-countdown');
    if (el) el.textContent = fmtTime(ms);
  }

  // ---- journey / learn lists ---------------------------------------------------

  function renderJourney(stages, progress) {
    const host = $('journey-map');
    host.innerHTML = '';
    const unlocked = (i) => i === 0 || progress.journey[stages[i - 1].id];
    stages.forEach((s, i) => {
      const rec = progress.journey[s.id];
      const b = document.createElement('button');
      b.className = 'jnode' + (s.mastery ? ' mastery' : '') + (unlocked(i) ? '' : ' locked') + (!rec && unlocked(i) ? ' current' : '');
      b.disabled = !unlocked(i);
      b.setAttribute('role', 'listitem');
      b.title = `${T(s.title)} — ${T(BAND_LABELS[s.band])}`;
      const status = rec ? T('{n} stars.', { n: rec.stars }) : unlocked(i) ? T('Unlocked.') : T('Locked.');
      b.setAttribute('aria-label', T('Stage {n}: {title}. {status}', { n: i + 1, title: T(s.title), status }));
      b.innerHTML = `${i + 1}${rec ? `<span class="stars">${'★'.repeat(rec.stars)}${'☆'.repeat(3 - rec.stars)}</span>` : ''}`;
      b.addEventListener('click', () => handlers.onJourneyPick(i));
      host.appendChild(b);
    });
  }

  function renderLessons(progress) {
    const host = $('lesson-list');
    host.innerHTML = '';
    for (const l of LESSONS) {
      const done = progress.lessons[l.id];
      const b = document.createElement('button');
      b.className = 'mode-card' + (done ? ' completed' : '');
      b.innerHTML = `<h3>${done ? '✓ ' : ''}${T(l.title)}</h3><p>${T('{n} guided steps', { n: l.steps.length })}</p>`;
      b.addEventListener('click', () => handlers.onLessonPick(l.id));
      host.appendChild(b);
    }
  }

  // ---- HUD -----------------------------------------------------------------------

  function updateHUD(s) {
    if (s.score !== undefined) $('hud-score').textContent = s.score;
    if (s.moves !== undefined) $('hud-moves').textContent = s.moves;
    if (s.ms !== undefined) $('hud-time').textContent = fmtTime(s.ms);
    if (s.modeName !== undefined) $('hud-mode-name').textContent = s.modeName;
    if (s.goal !== undefined) $('hud-goal').textContent = s.goal;
    if (s.objective !== undefined) $('rail-objective').textContent = s.objective;
    if (s.constraint !== undefined) $('rail-constraint').textContent = s.constraint;
    if (s.seed !== undefined) $('rail-seed').textContent = T('seed {seed}', { seed: s.seed });
    if (s.streak !== undefined) $('rail-streak').textContent = s.streak;
    if (s.assists !== undefined) $('rail-assists').textContent = s.assists;
    if (s.foundations) {
      const host = $('rail-progress');
      host.innerHTML = s.foundations.map((f, i) =>
        `<div class="pring" style="--p:${f / 13}" title="${suitName(i)}: ${f}/13"><span>${SUIT_SYMBOLS[i]}</span></div>`).join('');
    }
  }

  function setActions({ undo, hint, draw, autofinish }) {
    $('btn-undo').disabled = !undo;
    $('btn-hint').disabled = !hint;
    $('btn-draw').disabled = !draw;
    $('btn-autofinish').hidden = !autofinish;
  }

  // ---- 2D DOM board -------------------------------------------------------------
  // Fully playable semantic HTML layer; also the no-WebGL fallback.

  let boardBuilt = false;
  let pileEls = { stock: null, waste: null, foundations: [], tableau: [] };

  function buildBoard() {
    const host = els.boardDom;
    host.innerHTML = '';
    const top = document.createElement('div');
    top.className = 'dom-row';
    const stock = document.createElement('div');
    stock.className = 'pile-slot stock';
    stock.dataset.zone = 'stock';
    stock.setAttribute('role', 'button');
    stock.setAttribute('tabindex', '0');
    stock.innerHTML = '<span class="pile-label">⟳</span>';
    const waste = document.createElement('div');
    waste.className = 'pile-slot waste';
    waste.dataset.zone = 'waste';
    top.append(stock, waste);
    const spacer = document.createElement('div');
    spacer.style.width = 'calc(var(--card-w) * 0.8)';
    top.appendChild(spacer);
    pileEls.foundations = [];
    for (let s = 0; s < 4; s++) {
      const f = document.createElement('div');
      f.className = 'pile-slot foundation';
      f.dataset.zone = 'foundation';
      f.dataset.pile = s;
      f.setAttribute('role', 'button');
      f.setAttribute('tabindex', '0');
      f.innerHTML = `<span class="pile-label">${SUIT_SYMBOLS[s]}</span>`;
      top.appendChild(f);
      pileEls.foundations.push(f);
    }
    const tab = document.createElement('div');
    tab.className = 'dom-row dom-tableau';
    pileEls.tableau = [];
    for (let p = 0; p < 7; p++) {
      const t = document.createElement('div');
      t.className = 'pile-slot tableau';
      t.dataset.zone = 'tableau';
      t.dataset.pile = p;
      t.setAttribute('role', 'button');
      t.setAttribute('tabindex', '0');
      tab.appendChild(t);
      pileEls.tableau.push(t);
    }
    host.append(top, tab);
    pileEls.stock = stock;
    pileEls.waste = waste;
    boardBuilt = true;
    labelPiles();

    host.addEventListener('click', (e) => {
      const card = e.target.closest('.pcard');
      const pile = e.target.closest('.pile-slot');
      if (card) {
        handlers.onBoardTap({ zone: card.dataset.zone, pile: +card.dataset.pile, index: +card.dataset.index });
      } else if (pile) {
        handlers.onBoardTap({ zone: pile.dataset.zone, pile: pile.dataset.pile === undefined ? 0 : +pile.dataset.pile });
      }
    });
    host.addEventListener('dblclick', (e) => {
      const card = e.target.closest('.pcard');
      if (card) handlers.onBoardDbl({ zone: card.dataset.zone, pile: +card.dataset.pile, index: +card.dataset.index });
    });
    host.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const pile = e.target.closest('.pile-slot');
        const card = e.target.closest('.pcard');
        if (card) { e.preventDefault(); handlers.onBoardTap({ zone: card.dataset.zone, pile: +card.dataset.pile, index: +card.dataset.index }); }
        else if (pile) { e.preventDefault(); handlers.onBoardTap({ zone: pile.dataset.zone, pile: pile.dataset.pile === undefined ? 0 : +pile.dataset.pile }); }
      }
    });
  }

  /** Fixed pile labels (re-applied when the language changes). */
  function labelPiles() {
    if (!boardBuilt) return;
    pileEls.stock.setAttribute('aria-label', T('Stock'));
    pileEls.waste.setAttribute('aria-label', T('Waste'));
    pileEls.foundations.forEach((f, s) => f.setAttribute('aria-label', T('Foundation {suit}', { suit: suitName(s) })));
    pileEls.tableau.forEach((t, p) => t.setAttribute('aria-label', T('Row {n}', { n: p + 1 })));
  }

  function sizeBoard2D() {
    const r = els.boardRegion.getBoundingClientRect();
    // the 96px cap grows with the large-screen UI scale (1 at ≤1600×1000)
    const cap = 96 * ((window.UIScale && window.UIScale.value) || 1);
    const w = Math.min((r.width - 24 - 6 * 8) / 7, (r.height - 60) / 5.2, cap);
    els.boardDom.style.setProperty('--card-w', `${Math.max(38, Math.floor(w))}px`);
  }

  function cardEl(card, zone, pile, index, faceUp, top) {
    const b = document.createElement('button');
    b.className = 'pcard ' + (faceUp ? colorOf(card) : 'down');
    b.dataset.zone = zone;
    b.dataset.pile = pile;
    b.dataset.index = index;
    b.style.top = `${top}px`;
    if (faceUp) {
      const r = RANK_LABELS[rankOf(card)], s = SUIT_SYMBOLS[suitOf(card)];
      b.innerHTML = `<span class="corner">${r}<small class="suitmark">${s}</small></span>
        <span class="center suitmark">${s}</span>
        <span class="corner br">${r}<small class="suitmark">${s}</small></span>`;
      b.setAttribute('aria-label', cardLabel(card));
    } else {
      b.setAttribute('aria-label', T('Face-down card'));
      b.tabIndex = -1;
    }
    return b;
  }

  /**
   * Render the 2D board from a rules snapshot.
   * uiState: { selected, targets:[{zone,pile}], hintAction }
   */
  function renderBoard2D(state, uiState = {}) {
    if (!boardBuilt) buildBoard();
    sizeBoard2D();
    const cw = parseFloat(getComputedStyle(els.boardDom).getPropertyValue('--card-w'));
    const upGap = cw * 0.32, downGap = cw * 0.14;

    const clear = (el) => { el.querySelectorAll('.pcard').forEach((c) => c.remove()); el.classList.remove('target', 'selected-origin'); };
    [pileEls.stock, pileEls.waste, ...pileEls.foundations, ...pileEls.tableau].forEach(clear);

    // stock
    if (state.stock.length > 0) {
      const c = cardEl(state.stock[state.stock.length - 1], 'stock', 0, state.stock.length - 1, false, 0);
      c.tabIndex = -1;
      pileEls.stock.appendChild(c);
      pileEls.stock.setAttribute('aria-label', T('Stock, {n} cards. Activate to draw.', { n: state.stock.length }));
    } else {
      pileEls.stock.setAttribute('aria-label', state.waste.length ? T('Stock empty. Activate to recycle the waste.') : T('Stock empty.'));
    }

    // waste (fan up to 3)
    const fan = state.waste.slice(-3);
    fan.forEach((c, i) => {
      const idx = state.waste.length - fan.length + i;
      const el = cardEl(c, 'waste', 0, idx, true, 0);
      el.style.left = `${i * cw * 0.28}px`;
      el.style.zIndex = i + 1;
      el.tabIndex = idx === state.waste.length - 1 ? 0 : -1;
      pileEls.waste.appendChild(el);
    });
    pileEls.waste.style.minWidth = `${cw * 1.56}px`;

    // foundations
    state.foundations.forEach((f, s) => {
      if (f.length > 0) {
        const el = cardEl(f[f.length - 1], 'foundation', s, f.length - 1, true, 0);
        pileEls.foundations[s].appendChild(el);
      }
    });

    // tableau
    state.tableau.forEach((pile, p) => {
      let y = 0;
      pile.forEach((entry, i) => {
        const el = cardEl(entry.c, 'tableau', p, i, entry.up, y);
        el.style.zIndex = i + 1;
        pileEls.tableau[p].appendChild(el);
        y += entry.up ? upGap : downGap;
      });
      pileEls.tableau[p].style.minHeight = `${Math.max(cw * 1.4, y + cw * 1.4)}px`;
      const topCard = pile[pile.length - 1];
      pileEls.tableau[p].setAttribute('aria-label',
        pile.length === 0 ? T('Row {n}, empty', { n: p + 1 }) :
          T('Row {n}, {count} cards, top {card}', { n: p + 1, count: pile.length, card: topCard.up ? cardLabel(topCard.c) : T('face down') }));
    });

    // selection / targets / hint
    if (uiState.selected) {
      const { zone, pile, index } = uiState.selected;
      const host = zone === 'waste' ? pileEls.waste : zone === 'foundation' ? pileEls.foundations[pile] : pileEls.tableau[pile];
      host.classList.add('selected-origin');
      host.querySelectorAll('.pcard').forEach((c) => {
        if (+c.dataset.index >= (index ?? 0)) c.classList.add('selected');
      });
    }
    for (const t of uiState.targets || []) {
      const host = t.zone === 'foundation' ? pileEls.foundations[t.pile] : t.zone === 'tableau' ? pileEls.tableau[t.pile] : null;
      if (host) host.classList.add('target');
    }
    if (uiState.hintAction && uiState.hintAction.type === 'move') {
      const { from } = uiState.hintAction;
      const host = from.zone === 'waste' ? pileEls.waste : from.zone === 'foundation' ? pileEls.foundations[from.pile] : pileEls.tableau[from.pile];
      const idx = from.index ?? (host.querySelectorAll('.pcard').length - 1);
      host.querySelectorAll('.pcard').forEach((c) => { if (+c.dataset.index === idx) c.classList.add('hinted'); });
    }
  }

  // Drop the hint marks in place (the cards stay, so a press on one keeps its click).
  function clearBoardHint() {
    els.boardDom.querySelectorAll('.pcard.hinted').forEach((c) => c.classList.remove('hinted'));
  }

  // ---- results ------------------------------------------------------------------

  function renderResults(r, { reopen = true } = {}) {
    $('results-heading').textContent = r.headline;
    $('results-sub').textContent = r.sub;
    $('results-stars').textContent = r.stars ? '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars) : '';
    const tbl = $('results-table');
    tbl.innerHTML = r.breakdown.rows
      .filter(([, v]) => v !== 0)
      .map(([label, v]) => `<tr><td>${T(label)}</td><td>${v > 0 ? '+' : ''}${v}</td></tr>`)
      .join('') +
      `<tr><td>${T('Moves')}</td><td>${r.breakdown.moves}</td></tr>
       <tr><td>${T('Time')}</td><td>${fmtTime(r.breakdown.ms)}</td></tr>
       <tr><td>${T('Assists')}</td><td>${T('{undos} undo · {hints} hint · {invalids} invalid', { undos: r.breakdown.undos, hints: r.breakdown.hints, invalids: r.breakdown.invalids })}</td></tr>
       <tr class="total"><td>${T('Total score')}</td><td>${r.breakdown.total}</td></tr>`;
    $('results-progress').textContent = r.progressNote || '';
    const ach = $('results-achievements');
    ach.innerHTML = (r.achievements || []).map((a) => `<span class="ach-pop">❀ ${T('{name} unlocked', { name: T(a.name) })}</span>`).join('');
    $('btn-results-next').textContent = r.nextLabel || T('Next →');
    $('btn-results-next').style.display = r.nextLabel ? '' : 'none';
    if (reopen) openOverlay('results');
  }

  // ---- settings -----------------------------------------------------------------

  // Labels are English keys, translated at render time.
  const SETTINGS_SCHEMA = [
    { section: N('Gameplay') },
    { key: 'interfaceMode', label: N('Interface'), type: 'select', options: [['3d', N('3D glasshouse')], ['2d', N('2D cards')]], note: N('2D is fully playable and works without WebGL.') },
    { key: 'theme', label: N('Theme'), type: 'select', options: THEMES.map((t) => [t.id, t.name]) },
    { graphics: true },
    { section: N('Audio') },
    { key: 'volumes.music', label: N('Music'), type: 'range' },
    { key: 'volumes.effects', label: N('Effects'), type: 'range' },
    { key: 'volumes.ambience', label: N('Ambience'), type: 'range' },
    { key: 'muted', label: N('Mute all'), type: 'check' },
    { section: N('Accessibility') },
    { key: 'reducedMotion', label: N('Reduced motion'), type: 'check', note: N('Removes camera drift, shake and particles; timing unchanged.') },
    { key: 'highContrast', label: N('High contrast'), type: 'check' },
    { key: 'largeText', label: N('Larger text'), type: 'check' },
    { key: 'colorblindPalette', label: N('Color-vision palette'), type: 'select', options: [['default', N('Default')], ['deuteranopia', N('Deuteranopia')], ['protanopia', N('Protanopia')], ['tritanopia', N('Tritanopia')]], note: N('Suits are always labeled with symbols as well as color.') },
    { key: 'leftHanded', label: N('Left-handed controls'), type: 'check' },
    { key: 'timingAssist', label: N('Timing assistance'), type: 'check', note: N('Adds a grace buffer to timed challenges.') },
    { key: 'haptics', label: N('Haptics'), type: 'check' },
    { key: 'cameraDrift', label: N('Camera idle drift'), type: 'check' },
  ];
  // The Graphics host stays the same element across re-renders: the shared
  // game-options.js sections (frame rate, language, sound, report) live in it,
  // after the game's own #gfx-box.
  let gfxHost = null;
  let lastSettings = null;

  function renderSettings(settings) {
    lastSettings = settings;
    const host = $('settings-body');
    // Clear everything but the Graphics host (removing it would drop focus
    // and the shared sections inside it); rows are re-inserted around it.
    for (const child of [...host.children]) if (child !== gfxHost) child.remove();
    let graphicsPlaced = false;
    const place = (node) => {
      if (graphicsPlaced || !gfxHost || !gfxHost.isConnected) host.appendChild(node);
      else host.insertBefore(node, gfxHost);
    };
    for (const item of SETTINGS_SCHEMA) {
      if (item.graphics) {
        if (!gfxHost) {
          gfxHost = document.createElement('div');
          gfxHost.id = 'gfx-section';
          gfxHost.className = 'gfx-section';
          gfxHost.dataset.optionsGraphics = '';
          const box = document.createElement('div');
          box.id = 'gfx-box';
          gfxHost.appendChild(box);
        }
        if (!gfxHost.isConnected) host.appendChild(gfxHost);
        graphicsPlaced = true;
        if (lastGfx) renderGraphics(...lastGfx);
        continue;
      }
      if (item.section) {
        const h = document.createElement('h3');
        h.className = 'settings-section';
        h.textContent = T(item.section);
        place(h);
        continue;
      }
      const row = document.createElement('div');
      row.className = 'setting';
      const value = item.key.split('.').reduce((o, k) => o?.[k], settings);
      const label = `<label for="set-${item.key}">${T(item.label)}${item.note ? `<span class="note">${T(item.note)}</span>` : ''}</label>`;
      let control;
      if (item.type === 'select') {
        control = `<select id="set-${item.key}">${item.options.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${T(l)}</option>`).join('')}</select>`;
      } else if (item.type === 'range') {
        control = `<input type="range" id="set-${item.key}" min="0" max="1" step="0.05" value="${value}">`;
      } else {
        control = `<input type="checkbox" id="set-${item.key}" ${value ? 'checked' : ''}>`;
      }
      row.innerHTML = label + control;
      const input = row.querySelector('select, input');
      input.addEventListener('change', () => {
        const v = input.type === 'checkbox' ? input.checked : input.type === 'range' ? +input.value : input.value;
        handlers.onSettingsChange(item.key, v);
      });
      place(row);
    }
  }

  // ---- graphics section ------------------------------------------------------------
  // Quality preset, render scale, one override per effect category, adaptive
  // resolution, frame-rate readout and a "GPU · cost · pixels" summary. Every
  // change is handed to handlers.onGraphicsChange(newGraphicsObject).

  // Graphics strings live in gfx-i18n.js and follow the game language.
  let GT = gfxStrings(pickGfxLocale([getLang()]));
  let lastGfx = null;

  function gfxSummaryText(info) {
    const gpu = info.gpu || GT.unknownGpu;
    const level = info.level != null ? ` · ${GT.level.replace('{n}', info.level)}` : '';
    return `${gpu}${level} · ${describe(info.resolved, info.pixels, GT.words)}`;
  }

  function updateGraphicsInfo(info) {
    const sum = $('gfx-summary');
    if (!sum) return;
    sum.textContent = gfxSummaryText(info) + (info.fps ? ` · ${info.fps} fps` : '');
    const note = $('gfx-note');
    const msg = info.postFailed ? GT.postFailed : info.noRenderer ? GT.noRenderer : '';
    note.textContent = msg;
    note.hidden = !msg;
  }

  function renderGraphics(saved, info) {
    lastGfx = [saved, info];
    GT = gfxStrings(pickGfxLocale([getLang()]));
    const host = $('gfx-box');
    if (!host) return;
    const focusId = host.contains(document.activeElement) ? document.activeElement.id : null;
    const g = { preset: 'auto', render_scale: 1, adaptive: true, show_fps: false, ...(saved || {}) };
    const r = info.resolved;
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const tierName = (t) => GT.tiers[t] || t;
    const opt = (v, label, sel) => `<option value="${v}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
    const presetOpts = [opt('auto', GT.auto.replace('{tier}', GT.presets[info.detected] || info.detected), !PRESETS.includes(g.preset))]
      .concat(PRESETS.map((p) => opt(p, GT.presets[p], g.preset === p))).join('');
    const scalePct = Math.round(Math.min(2, Math.max(0.5, Number(g.render_scale) || 1)) * 100);
    const cats = Object.entries(CATEGORIES).map(([cat, tiers]) => {
      const own = tiers.includes(g[cat]) ? g[cat] : 'preset';
      const opts = [opt('preset', GT.fromPreset.replace('{tier}', tierName(presetTier(r.preset, cat))), own === 'preset')]
        .concat(tiers.map((t) => opt(t, tierName(t), own === t))).join('');
      return `<div class="setting"><label for="gfx-cat-${cat}">${esc(GT.cats[cat])}</label>
        <select id="gfx-cat-${cat}" data-gfx-cat="${cat}">${opts}</select></div>`;
    }).join('');
    host.innerHTML = `
      <h3 class="settings-section" id="gfx-heading">${esc(GT.section)}</h3>
      <p id="gfx-summary" class="gfx-summary" aria-live="polite"></p>
      <p id="gfx-note" class="gfx-note" hidden></p>
      <div class="setting"><label for="gfx-preset">${esc(GT.quality)}</label>
        <select id="gfx-preset" data-gfx="preset">${presetOpts}</select></div>
      <div class="setting"><label for="gfx-scale">${esc(GT.renderScale)}</label>
        <span class="gfx-range"><input type="range" id="gfx-scale" data-gfx="render_scale" min="50" max="200" step="10" value="${scalePct}">
        <output id="gfx-scale-val" for="gfx-scale">${scalePct}%</output></span></div>
      ${cats}
      <div class="setting"><label for="gfx-adaptive">${esc(GT.adaptive)}<span class="note">${esc(GT.adaptiveNote)}</span></label>
        <input type="checkbox" id="gfx-adaptive" data-gfx="adaptive"${g.adaptive !== false ? ' checked' : ''}></div>
      <div class="setting"><label for="gfx-fps">${esc(GT.showFps)}</label>
        <input type="checkbox" id="gfx-fps" data-gfx="show_fps"${g.show_fps ? ' checked' : ''}></div>`;
    updateGraphicsInfo(info);

    const commit = (next) => handlers.onGraphicsChange && handlers.onGraphicsChange(next);
    host.querySelector('#gfx-preset').addEventListener('change', (e) => commit(choosePreset(g, e.target.value)));
    const scale = host.querySelector('#gfx-scale');
    scale.addEventListener('input', () => { host.querySelector('#gfx-scale-val').textContent = `${scale.value}%`; });
    scale.addEventListener('change', () => commit({ ...g, render_scale: Number(scale.value) / 100 }));
    for (const sel of host.querySelectorAll('[data-gfx-cat]')) {
      sel.addEventListener('change', () => {
        const next = { ...g };
        if (sel.value === 'preset') delete next[sel.dataset.gfxCat];
        else next[sel.dataset.gfxCat] = sel.value;
        commit(next);
      });
    }
    host.querySelector('#gfx-adaptive').addEventListener('change', (e) => commit({ ...g, adaptive: e.target.checked }));
    host.querySelector('#gfx-fps').addEventListener('change', (e) => commit({ ...g, show_fps: e.target.checked }));
    if (focusId) { const el = $(focusId); if (el) el.focus({ preventScroll: true }); }
  }

  // ---- help ----------------------------------------------------------------------

  function keyLabel(code) {
    const named = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', Space: T('Space'), NumpadEnter: T('Num Enter') };
    if (named[code]) return named[code];
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit\d$/.test(code)) return code.slice(5);
    return String(code).replace(/[^\w ]/g, '');
  }
  const kbds = (codes) => (codes || []).map((c) => `<kbd>${keyLabel(c)}</kbd>`).join('/');

  let lastBindings = {};
  function renderHelp(b = {}) {
    lastBindings = b;
    const k = (action, fallback) => (b[action] && b[action].length ? kbds(b[action]) : fallback);
    const card = (demo, h, p) => `<div class="rule-card"><div class="demo">${demo}</div><div><h4>${h}</h4><p>${p}</p></div></div>`;
    $('help-body').innerHTML = `
      <p>${T('Build four <b>foundations</b> from Ace to King, one suit each. On the <b>tableau</b>, build <b>down</b> in <b>alternating colors</b>. Uncover every hidden card.')}</p>
      ${card('🂿', T('Stock &amp; waste'), T('Activate the stock ({key} or tap) to draw. When it runs out, tap again to recycle the waste — recycling costs points.', { key: k('draw', '<kbd>D</kbd>') }))}
      ${card('<span style="color:#b03a2e">8♥</span>→<span>9♠</span>', T('Alternating runs'), T('Place a card on a tableau card one rank higher and of the opposite color. Face-up runs move together.'))}
      ${card('K♣', T('Empty rows'), T('Only a King may move to an empty tableau row.'))}
      ${card('A♥→❀', T('Foundations'), T('Bank Aces first, then upward by suit. Double-tap a card to send it to its foundation. Banking early is usually safe.'))}
      ${card('❀', T('Auto-finish'), T('When nothing is hidden and the stock is empty, Auto-finish ({key}) banks everything for you.', { key: k('autofinish', '<kbd>A</kbd>') }))}
      <h3>${T('Controls')}</h3>
      ${card('⌨', T('Keyboard'), T('{left} {right} {up} {down} move focus between piles · {select} select or place · {draw} draw · {undo} undo · {hint} hint · {finish} auto-finish · {pause} pause.', {
        left: k('focus_left', '←'), right: k('focus_right', '→'), up: k('focus_up', '↑'), down: k('focus_down', '↓'),
        select: k('select', '<kbd>Enter</kbd>'), draw: k('draw', '<kbd>D</kbd>'), undo: k('undo', '<kbd>U</kbd>'),
        hint: k('hint', '<kbd>H</kbd>'), finish: k('autofinish', '<kbd>A</kbd>'), pause: k('pause', '<kbd>Esc</kbd>'),
      }))}
      ${card('🎮', T('Gamepad'), T('D-pad or left stick moves focus · A selects or places · B cancels or pauses · X undo · Y hint · Start pauses.'))}
      ${card('👆', T('Pointer &amp; touch'), T('Tap a card to select, tap a target to place — or drag runs directly. Double-tap banks to a foundation. Tap the stock to draw.'))}
      ${card('✦', T('Assists'), T('Undo and Hint are always available in Practice and Journey. Assisted runs are flagged on the board.'))}`;
  }

  // ---- profile / scores -------------------------------------------------------------

  function renderProfile(stats, achievements, progress, playerName = null) {
    const lessonsDone = Object.keys(progress.lessons).length;
    const row = (label, v) => `<tr><td>${T(label)}</td><td>${v}</td></tr>`;
    $('profile-body').innerHTML = `
      <h3 id="profile-player-h" hidden>${T('Gardener')}</h3>
      <p id="profile-player" hidden></p>
      <h3>${T('Career')}</h3>
      <table class="score-table">
        ${row(N('Games played'), stats.games)}
        ${row(N('Wins'), stats.wins)}
        ${row(N('Losses'), stats.losses)}
        ${row(N('Best streak'), stats.bestStreak)}
        ${row(N('Current streak'), stats.streak)}
        ${row(N('Cards banked'), stats.foundationsBanked)}
        ${row(N('Best score'), stats.bestScore)}
        ${row(N('Fastest win'), stats.bestWinMs == null ? '—' : fmtTime(stats.bestWinMs))}
        ${row(N('Dailies completed'), stats.dailyCompleted)}
        ${row(N('Lessons completed'), `${lessonsDone}/${LESSONS.length}`)}
        ${row(N('Journey stages'), `${Object.keys(progress.journey).length}/${JOURNEY.length}`)}
      </table>
      <h3>${T('Achievements')}</h3>
      ${ACHIEVEMENTS.map((a) => {
        const un = achievements.unlocked[a.key];
        return `<div class="rule-card"><div class="demo">${un ? '❀' : '·'}</div><div>
          <h4>${T(a.name)} ${un ? '<span class="dim">✓</span>' : ''}</h4><p>${T(a.text)}</p></div></div>`;
      }).join('')}`;
    const head = $('profile-player-h');
    const line = $('profile-player');
    if (playerName) {
      head.hidden = false;
      line.hidden = false;
      line.textContent = `❀ ${playerName}`;
    }
  }

  function renderScores(entries, globalBoards = null) {
    const host = $('scores-body');
    if (!entries.length && !globalBoards) {
      host.innerHTML = `<p class="dim">${T('No results yet. Play the Daily or a Score Chase table.')}</p>`;
      return;
    }
    const MODE_NAMES = { daily: N('Daily'), score: N('Score Chase') };
    const byMode = {};
    for (const e of entries) (byMode[e.mode] ||= []).push(e);
    let html = Object.entries(byMode).map(([mode, list]) => {
      const name = T(MODE_NAMES[mode] || mode);
      return `
      <h3>${globalBoards ? T('{mode} — local', { mode: name }) : name}</h3>
      <table class="score-table">
        ${list.slice(0, 10).map((e, i) => `<tr><td>${i + 1}. ${T('{n} pts', { n: e.score })}</td><td class="dim">${T('{n} moves', { n: e.moves })} · ${fmtTime(e.ms)}${e.assists ? ` · ${T('assists')}` : ''}</td></tr>`).join('')}
      </table>`;
    }).join('');
    if (globalBoards) {
      for (const board of globalBoards) {
        html += `<h3>${T(board.title)}</h3>`;
        if (!board.rows.length) html += `<p class="dim">${T('No entries yet.')}</p>`;
        else {
          html += `<table class="score-table">
            ${board.rows.map((r) => `<tr><td>${r.rank}. <span class="board-name"></span> — ${T('{n} pts', { n: r.score })}</td><td class="dim">${r.detail || ''}</td></tr>`).join('')}
          </table>`;
        }
      }
    }
    host.innerHTML = html;
    if (globalBoards) {
      // Nicknames arrive resolved from the platform; insert as text, never HTML.
      let i = 0;
      for (const board of globalBoards) {
        for (const r of board.rows) {
          const slot = host.querySelectorAll('.board-name')[i++];
          if (slot) slot.textContent = r.name;
        }
      }
    }
  }

  // ---- misc --------------------------------------------------------------------------

  function setBoard2DVisible(visible) {
    els.boardDom.hidden = !visible;
    els.canvas.style.visibility = visible ? 'hidden' : 'visible';
  }

  function setRailsCollapsed(collapsed) {
    $('rail-left').classList.toggle('collapsed', collapsed);
    $('rail-right').classList.toggle('collapsed', collapsed);
  }

  function compatNote(text) {
    const el = $('compat-note');
    if (!text) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = text;
  }

  /** Re-render the UI layer's own text after a language change (main.js re-renders the rest). */
  function refreshLanguage() {
    if (lastSettings) renderSettings(lastSettings);
    else if (lastGfx) renderGraphics(...lastGfx);
    renderHelp(lastBindings);
    labelPiles();
  }

  return {
    els, showScreen, refreshLanguage, currentScreen, openOverlay, closeOverlay, toast, hideToast, announce, coach,
    setTitleInfo, setPlayerInfo, setAccountButtons, setAccountLabels, onAccountAction, renderModes, renderSetup, getSetupConfig, updateDailyCountdown,
    renderJourney, renderLessons, updateHUD, setActions,
    buildBoard, renderBoard2D, clearBoardHint, sizeBoard2D, setBoard2DVisible,
    renderResults, renderSettings, renderGraphics, updateGraphicsInfo, renderHelp, renderProfile, renderScores,
    setRailsCollapsed, compatNote,
  };
}
