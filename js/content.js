// Patience Garden — versioned content: themes, journey progression,
// challenges, daily challenge, and interactive lessons.
// Content is data: identifier, seed, initial-state recipe, goals, allowed
// mechanics, par values, tutorial flags, and presentation theme.

import { hashString } from './rng.js';
import { SEED_TABLE, SEED_TABLE_VERSION } from './content-seeds.js';

export const CONTENT_VERSION = 1;
export { SEED_TABLE_VERSION };

// ---------------------------------------------------------------------------
// Themes (five visual themes; cosmetic only — never affect rules)
// ---------------------------------------------------------------------------

export const THEMES = [
  {
    id: 'dawn-glasshouse', name: 'Dawn Glasshouse',
    felt: '#3d6b4f', feltDeep: '#2c5140', table: '#6b4a2f', accent: '#e8a13c',
    sky: ['#f7d9a0', '#a8c8b8'], cardBack: ['#b8452e', '#e8a13c'], leaf: '#4e7d4e',
    ui: { bg: '#1d2b24', panel: '#27392f', text: '#f2ead8', accent: '#e8a13c' },
  },
  {
    id: 'verdant-canopy', name: 'Verdant Canopy',
    felt: '#2e5d3a', feltDeep: '#1f4429', table: '#54402a', accent: '#a4d65e',
    sky: ['#bfe3c0', '#5d9463'], cardBack: ['#1f4429', '#a4d65e'], leaf: '#3f7d3a',
    ui: { bg: '#16241a', panel: '#223526', text: '#eef6e4', accent: '#a4d65e' },
  },
  {
    id: 'dusk-orchid', name: 'Dusk Orchid',
    felt: '#4a3560', feltDeep: '#382647', table: '#4f3a2e', accent: '#e08cc0',
    sky: ['#e8b4d0', '#6a4a80'], cardBack: ['#382647', '#e08cc0'], leaf: '#5a4a70',
    ui: { bg: '#221a2b', panel: '#302239', text: '#f3e9f4', accent: '#e08cc0' },
  },
  {
    id: 'midnight-conservatory', name: 'Midnight Conservatory',
    felt: '#24344e', feltDeep: '#1a2438', table: '#3a3230', accent: '#7cc4e8',
    sky: ['#28405e', '#101a2a'], cardBack: ['#1a2438', '#7cc4e8'], leaf: '#2e4a44',
    ui: { bg: '#101722', panel: '#1a2434', text: '#e2ecf6', accent: '#7cc4e8' },
  },
  {
    id: 'desert-bloom', name: 'Desert Bloom',
    felt: '#8a5a3a', feltDeep: '#6b422a', table: '#5c4630', accent: '#f2c14e',
    sky: ['#f6d8a8', '#c88a58'], cardBack: ['#6b422a', '#f2c14e'], leaf: '#7a8a4a',
    ui: { bg: '#241a12', panel: '#33251a', text: '#f6ecdc', accent: '#f2c14e' },
  },
];

export const DEFAULT_THEME = THEMES[0].id;
export const themeById = (id) => THEMES.find((t) => t.id === id) || THEMES[0];

// ---------------------------------------------------------------------------
// Deal profiles (construction recipes used with the seed table)
// ---------------------------------------------------------------------------

export const PROFILES = {
  sprout:   { label: 'Sprout',   suitCount: 3, targets: [1, 1, 2, 2, 3, 3, 4] },
  meadow:   { label: 'Meadow',   suitCount: 3, targets: [1, 2, 3, 4, 5, 6, 7] },
  thicket:  { label: 'Thicket',  suitCount: 4, targets: [1, 1, 2, 2, 3, 4, 5] },
  wildwood: { label: 'Wildwood', suitCount: 4, targets: [1, 2, 3, 4, 5, 6, 7] },
};

export const BAND_LABELS = {
  gentle: 'Gentle', easy: 'Easy', medium: 'Medium', hard: 'Hard', thorny: 'Thorny',
};

function pickSeed(profile, band, index) {
  const list = SEED_TABLE[profile]?.[band] || [];
  if (list.length === 0) {
    // Defensive fallback: derive a deterministic seed outside the table.
    return { seed: (hashString(`${profile}/${band}/${index}`) % 500) + 1, winRate: null, avgSteps: null };
  }
  return list[index % list.length];
}

// ---------------------------------------------------------------------------
// Journey — 40 authored stages, one concept at a time, mastery gates
// ---------------------------------------------------------------------------
// Each stage: id, title, profile+band (seed source), ruleset overrides,
// goals, par, theme, mechanics taught, and expected duration.

const JOURNEY_PLAN = [
  // --- Act I: Sprout (three suits, shallow tableaux) -----------------------
  { t: 'First Sprouts',      p: 'sprout', b: 'gentle', i: 0, mech: ['draw', 'foundation'], faceUp: true,
    text: 'All cards face up. Learn the rhythm: draw, place, bank.' },
  { t: 'Sunlit Rows',        p: 'sprout', b: 'gentle', i: 1, mech: ['tableau'], faceUp: true,
    text: 'Build descending runs in alternating colours.' },
  { t: 'Hidden Depths',      p: 'sprout', b: 'gentle', i: 2, mech: ['reveal'],
    text: 'Face-down cards appear. Uncover them by moving what covers them.' },
  { t: 'Empty Soil',         p: 'sprout', b: 'gentle', i: 3, mech: ['kings'],
    text: 'Only Kings may root in an empty row.' },
  { t: 'Sprout Mastery',     p: 'sprout', b: 'easy',   i: 0, mech: ['mastery'], mastery: true,
    text: 'Combine everything: reveals, runs, Kings, and the foundations.' },
  // --- Act II: Meadow (three suits, full staircase) ------------------------
  { t: 'Open Meadow',        p: 'meadow', b: 'easy',   i: 1, mech: ['stock-cycle'],
    text: 'A full staircase. The stock cycles — plan your passes.' },
  { t: 'Crosswinds',         p: 'meadow', b: 'easy',   i: 2, mech: [],
    text: 'Longer runs ask for patience.' },
  { t: 'Trellis Work',       p: 'meadow', b: 'easy',   i: 3, mech: [],
    text: 'Move whole runs to open the hidden cards beneath.' },
  { t: 'Careful Pruning',    p: 'meadow', b: 'medium', i: 0, mech: [],
    text: 'Sometimes the obvious bank is not the wise one.' },
  { t: 'Meadow Mastery',     p: 'meadow', b: 'medium', i: 1, mech: ['mastery'], mastery: true,
    text: 'A sterner meadow. Keep your foundations balanced.' },
  // --- Act III: Thicket (four suits arrive, still shallow) ------------------
  { t: 'Fourth Suit',        p: 'thicket', b: 'easy',  i: 0, mech: ['four-suits'],
    text: 'Clubs join the garden — four suits, four foundations.' },
  { t: 'Bramble Paths',      p: 'thicket', b: 'easy',  i: 1, mech: [],
    text: 'More suits, more choices. Watch both colours.' },
  { t: 'Seedling Rows',      p: 'thicket', b: 'easy',  i: 2, mech: [],
    text: 'Short rows reward tidy play.' },
  { t: 'Undergrowth',        p: 'thicket', b: 'medium', i: 2, mech: [],
    text: 'The thicket thickens.' },
  { t: 'Thicket Mastery',    p: 'thicket', b: 'medium', i: 3, mech: ['mastery'], mastery: true,
    text: 'Prove your footing among four suits.' },
  // --- Act IV: Wildwood (full Klondike) -------------------------------------
  { t: 'Into the Wildwood',  p: 'wildwood', b: 'easy',  i: 0, mech: ['full-game'],
    text: 'The full garden: 52 cards, seven rows, no shortcuts.' },
  { t: 'Fern Gullies',       p: 'wildwood', b: 'easy',  i: 1, mech: [], text: 'Read the table before you touch the stock.' },
  { t: 'Canopy Light',       p: 'wildwood', b: 'easy',  i: 2, mech: [], text: 'Bank early when it is safe.' },
  { t: 'Root Tangles',       p: 'wildwood', b: 'medium', i: 4, mech: [], text: 'Buried Kings demand planning.' },
  { t: 'Wildwood Mastery',   p: 'wildwood', b: 'medium', i: 5, mech: ['mastery'], mastery: true, text: 'A full-strength tangle.' },
  // --- Act V: Conservatory (advanced full-game studies) ----------------------
  { t: 'Glasshouse Trial I',   p: 'wildwood', b: 'medium', i: 6,  mech: [], text: 'Advanced study: conserve your passes.' },
  { t: 'Glasshouse Trial II',  p: 'wildwood', b: 'medium', i: 7,  mech: [], text: 'Advanced study: empty rows are precious.' },
  { t: 'Glasshouse Trial III', p: 'wildwood', b: 'hard',   i: 0,  mech: [], text: 'Advanced study: every reveal counts.' },
  { t: 'Glasshouse Trial IV',  p: 'wildwood', b: 'hard',   i: 1,  mech: [], text: 'Advanced study: resist premature banks.' },
  { t: 'Conservatory Mastery', p: 'wildwood', b: 'hard',   i: 2,  mech: ['mastery'], mastery: true, text: 'The conservatory watches.' },
  // --- Act VI: Night Garden (hardest authored line) --------------------------
  { t: 'Night Garden I',   p: 'wildwood', b: 'hard', i: 3, mech: [], text: 'By lantern light: hard deals, full rules.' },
  { t: 'Night Garden II',  p: 'wildwood', b: 'hard', i: 4, mech: [], text: 'By lantern light: trust the long plan.' },
  { t: 'Night Garden III', p: 'wildwood', b: 'hard', i: 5, mech: [], text: 'By lantern light: waste nothing.' },
  { t: 'Night Garden IV',  p: 'wildwood', b: 'hard', i: 6, mech: [], text: 'By lantern light: patience above all.' },
  { t: 'Midnight Mastery', p: 'wildwood', b: 'hard', i: 7, mech: ['mastery'], mastery: true, text: 'The night garden yields to no one quickly.' },
  // --- Act VII: Grand Atrium (final gauntlet) --------------------------------
  { t: 'Grand Atrium I',   p: 'wildwood', b: 'hard',   i: 8,  mech: [], text: 'The final glasshouse opens.' },
  { t: 'Grand Atrium II',  p: 'wildwood', b: 'hard',   i: 9,  mech: [], text: 'A thorny path, fairly dealt.' },
  { t: 'Grand Atrium III', p: 'wildwood', b: 'thorny', i: 0,  mech: [], text: 'The hardest seeds we dare publish.' },
  { t: 'Grand Atrium IV',  p: 'wildwood', b: 'thorny', i: 1,  mech: [], text: 'Everything you have learned, at once.' },
  { t: 'Head Gardener',    p: 'wildwood', b: 'thorny', i: 2,  mech: ['mastery'], mastery: true, text: 'Earn the title.' },
  // --- Act VIII: Evergreen (open-ended excellence) ---------------------------
  { t: 'Evergreen I',   p: 'wildwood', b: 'medium', i: 8,  mech: [], text: 'Mastery is a habit, not a moment.' },
  { t: 'Evergreen II',  p: 'wildwood', b: 'hard',   i: 10, mech: [], text: 'Mastery is a habit, not a moment.' },
  { t: 'Evergreen III', p: 'wildwood', b: 'hard',   i: 11, mech: [], text: 'Mastery is a habit, not a moment.' },
  { t: 'Evergreen IV',  p: 'wildwood', b: 'thorny', i: 3,  mech: [], text: 'Mastery is a habit, not a moment.' },
  { t: 'Evergreen V',   p: 'wildwood', b: 'thorny', i: 4,  mech: ['mastery'], mastery: true, text: 'The garden is yours.' },
];

export const JOURNEY = JOURNEY_PLAN.map((s, idx) => {
  const picked = pickSeed(s.p, s.b, s.i);
  const profile = PROFILES[s.p];
  const ruleset = {
    suitCount: profile.suitCount,
    targets: profile.targets,
    drawCount: 1,
    maxRedeals: Infinity,
    allFaceUp: !!s.faceUp,
  };
  const parMoves = picked.avgSteps ? Math.round(picked.avgSteps * 1.35) : 160;
  return {
    id: `journey-${String(idx + 1).padStart(2, '0')}`,
    index: idx,
    version: CONTENT_VERSION,
    title: s.t,
    text: s.text,
    profile: s.p,
    band: s.b,
    seed: picked.seed,
    ruleset,
    goals: { win: true, maxMoves: parMoves, maxTimeMs: Math.max(120000, parMoves * 4200) },
    par: { moves: parMoves, timeMs: Math.max(120000, parMoves * 4200) },
    mechanics: s.mech,
    mastery: !!s.mastery,
    theme: THEMES[Math.min(THEMES.length - 1, Math.floor(idx / 8))].id,
    expectedMinutes: Math.max(2, Math.round(parMoves * 3 / 60)),
  };
});

export const journeyStage = (index) => JOURNEY[Math.max(0, Math.min(JOURNEY.length - 1, index))];

// ---------------------------------------------------------------------------
// Challenges — constrained goals and altered layouts
// ---------------------------------------------------------------------------

export const CHALLENGES = [
  {
    id: 'one-pass', name: 'One Pass', theme: 'dusk-orchid',
    text: 'The stock never recycles. One pass, no regrets.',
    seed: pickSeed('wildwood', 'easy', 3).seed,
    ruleset: { suitCount: 4, targets: PROFILES.wildwood.targets, maxRedeals: 0 },
    constraint: { type: 'redeals', limit: 0 },
    expectedMinutes: 8,
  },
  {
    id: 'speed-bloom', name: 'Speed Bloom', theme: 'dawn-glasshouse',
    text: 'A gentle deal, a strict clock: finish in six minutes.',
    seed: pickSeed('thicket', 'gentle', 0).seed,
    ruleset: { suitCount: 4, targets: PROFILES.thicket.targets },
    constraint: { type: 'time', limitMs: 6 * 60 * 1000 },
    expectedMinutes: 6,
  },
  {
    id: 'hundred-moves', name: 'Move Miser', theme: 'verdant-canopy',
    text: 'Win in 150 moves or fewer. Every move is a seed spent.',
    seed: pickSeed('meadow', 'gentle', 0).seed,
    ruleset: { suitCount: 3, targets: PROFILES.meadow.targets },
    constraint: { type: 'moves', limit: 150 },
    expectedMinutes: 10,
  },
  {
    id: 'open-garden', name: 'Open Garden', theme: 'midnight-conservatory',
    text: 'Every card face up from the start. Pure planning, no surprises.',
    seed: pickSeed('wildwood', 'medium', 9).seed,
    ruleset: { suitCount: 4, targets: PROFILES.wildwood.targets, allFaceUp: true },
    constraint: null,
    expectedMinutes: 12,
  },
  {
    id: 'triple-draw', name: 'Triple Draw', theme: 'desert-bloom',
    text: 'Draw three, recycle twice. The classic hard mode.',
    seed: pickSeed('wildwood', 'easy', 4).seed,
    ruleset: { suitCount: 4, targets: PROFILES.wildwood.targets, drawCount: 3, maxRedeals: 2 },
    constraint: { type: 'redeals', limit: 2 },
    expectedMinutes: 15,
  },
  {
    id: 'master-gardener', name: 'Master Gardener', theme: 'midnight-conservatory',
    text: 'A thorny seed, draw three, no undo. For the patient few.',
    seed: pickSeed('wildwood', 'hard', 12).seed,
    ruleset: { suitCount: 4, targets: PROFILES.wildwood.targets, drawCount: 3, maxRedeals: 2, allowUndo: false },
    constraint: { type: 'redeals', limit: 2 },
    expectedMinutes: 20,
  },
];

export const challengeById = (id) => CHALLENGES.find((c) => c.id === id);

/** Deterministic seed from the precomputed difficulty-banded table. */
export function seedFromTable(profile, band, index = 0) {
  return pickSeed(profile, band, index);
}

/** Score-chase deal descriptor (ranked locally, validated seed). */
export function scoreChaseDeal(profile, band, index = 0) {
  const picked = pickSeed(profile, band, index);
  const prof = PROFILES[profile] || PROFILES.wildwood;
  return {
    id: `score-${profile}-${band}-${index}`,
    version: CONTENT_VERSION,
    seed: picked.seed,
    ruleset: { suitCount: prof.suitCount, targets: prof.targets.slice() },
    ranked: false,
    label: `${BAND_LABELS[band]} ${prof.label}`,
  };
}

// ---------------------------------------------------------------------------
// Practice — selectable difficulty, restart, undo, unrated
// ---------------------------------------------------------------------------

export const PRACTICE_LEVELS = [
  { id: 'gentle',  label: 'Gentle',  profile: 'sprout',   band: 'gentle', text: 'Three suits, shallow rows. Learn and relax.' },
  { id: 'easy',    label: 'Easy',    profile: 'meadow',   band: 'easy',   text: 'Three suits, full staircase.' },
  { id: 'medium',  label: 'Medium',  profile: 'thicket',  band: 'medium', text: 'Four suits, shallow rows.' },
  { id: 'hard',    label: 'Hard',    profile: 'wildwood', band: 'medium', text: 'The full garden.' },
  { id: 'thorny',  label: 'Thorny',  profile: 'wildwood', band: 'hard',   text: 'The full garden, unkind.' },
];

export function practiceDeal(levelId, salt = 0) {
  const level = PRACTICE_LEVELS.find((l) => l.id === levelId) || PRACTICE_LEVELS[1];
  const picked = pickSeed(level.profile, level.band, salt);
  const profile = PROFILES[level.profile];
  return {
    id: `practice-${level.id}-${salt}`,
    version: CONTENT_VERSION,
    seed: picked.seed,
    ruleset: { suitCount: profile.suitCount, targets: profile.targets.slice() },
    ranked: false,
    level: level.id,
    label: level.label,
  };
}

// ---------------------------------------------------------------------------
// Daily — one shared seed and ruleset per UTC day
// ---------------------------------------------------------------------------

export function dailyInfo(date = new Date()) {
  const day = date.toISOString().slice(0, 10); // UTC day boundary
  const seed = hashString(`patience-garden/daily/${day}`) >>> 0;
  return {
    id: `daily-${day}`,
    version: CONTENT_VERSION,
    day,
    seed,
    ruleset: { suitCount: 4, targets: PROFILES.wildwood.targets.slice() },
    ranked: false,
    expectedMinutes: 12,
  };
}

export function msUntilNextDaily(now = new Date()) {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

// ---------------------------------------------------------------------------
// Learn — interactive lessons, one rule at a time, scripted layouts
// ---------------------------------------------------------------------------

const C = (s, r) => s * 13 + r; // card helper for lesson layouts
const up = (c) => ({ c, up: true });
const down = (c) => ({ c, up: false });

export const LESSONS = [
  {
    id: 'learn-draw', title: 'Drawing from the Stock',
    theme: 'dawn-glasshouse',
    ruleset: {},
    layout: {
      stock: [C(0, 0), C(1, 7)], // top of stock is the LAST entry: 8 of hearts
      waste: [],
      foundations: [[], [], [], []],
      tableau: [
        [up(C(0, 8))], // 9 of spades
        [], [], [], [], [], [],
      ],
    },
    steps: [
      { id: 'd1', text: 'Tap the stock (the face-down deck, top left) to draw a card.', expect: { type: 'draw' } },
      { id: 'd2', text: 'You drew the 8 of Hearts. It is red — place it on the black 9 of Spades to start a descending run.', expect: { type: 'move', fromZone: 'waste', toZone: 'tableau', toPile: 0 } },
      { id: 'd3', text: 'Well done. Finish the lesson: draw the last card.', expect: { type: 'draw' } },
      { id: 'd4', text: 'That is the Ace of Spades. Double-tap it (or drag it to a foundation slot, top right) to bank it.', expect: { type: 'move', fromZone: 'waste', toZone: 'foundation' } },
    ],
  },
  {
    id: 'learn-tableau', title: 'Alternating Colours',
    theme: 'verdant-canopy',
    ruleset: {},
    layout: {
      stock: [], waste: [],
      foundations: [[], [], [], []],
      tableau: [
        [up(C(1, 8))],  // 9 hearts
        [up(C(0, 7))],  // 8 spades
        [up(C(2, 6))],  // 7 diamonds
        [], [], [], [],
      ],
    },
    steps: [
      { id: 't1', text: 'Tableau rows build DOWN in alternating colours. Move the black 8 of Spades onto the red 9 of Hearts.', expect: { type: 'move', fromZone: 'tableau', fromPile: 1, toZone: 'tableau', toPile: 0 } },
      { id: 't2', text: 'Now the red 7 of Diamonds can continue the run onto the 8 of Spades.', expect: { type: 'move', fromZone: 'tableau', fromPile: 2, toZone: 'tableau', toPile: 0 } },
    ],
  },
  {
    id: 'learn-runs', title: 'Moving Runs & Reveals',
    theme: 'verdant-canopy',
    ruleset: {},
    layout: {
      stock: [], waste: [],
      foundations: [[], [], [], []],
      tableau: [
        [down(C(3, 0)), up(C(0, 8)), up(C(1, 7))], // hidden ace of clubs, 9♠, 8♥
        [up(C(2, 9))],  // 10 diamonds
        [], [], [], [], [],
      ],
    },
    steps: [
      { id: 'r1', text: 'Face-up runs move together. Drag the 9 of Spades (and the 8 riding on it) onto the red 10 of Diamonds.', expect: { type: 'move', fromZone: 'tableau', fromPile: 0, toZone: 'tableau', toPile: 1 } },
      { id: 'r2', text: 'The hidden card flipped face up — an Ace of Clubs! Bank it to its foundation.', expect: { type: 'move', fromZone: 'tableau', fromPile: 0, toZone: 'foundation' } },
    ],
  },
  {
    id: 'learn-kings', title: 'Kings and Empty Rows',
    theme: 'dusk-orchid',
    ruleset: {},
    layout: {
      stock: [], waste: [],
      foundations: [[], [], [], []],
      tableau: [
        [up(C(0, 12))], // K spades
        [up(C(1, 11))], // Q hearts
        [up(C(2, 4))],  // 5 diamonds
        [], [], [], [],
      ],
    },
    steps: [
      { id: 'k1', text: 'Only a King may move to an empty row. Move the King of Spades to the empty row on the right.', expect: { type: 'move', fromZone: 'tableau', fromPile: 0, toZone: 'tableau', toPile: 3 } },
      { id: 'k2', text: 'The red Queen of Hearts can now join her King.', expect: { type: 'move', fromZone: 'tableau', fromPile: 1, toZone: 'tableau', toPile: 3 } },
    ],
  },
  {
    id: 'learn-redeal', title: 'Cycling the Stock',
    theme: 'dusk-orchid',
    ruleset: {},
    layout: {
      stock: [C(0, 2)],
      waste: [C(1, 5), C(3, 9)],
      foundations: [[], [], [], []],
      tableau: [
        [up(C(2, 8))], [], [], [], [], [], [],
      ],
    },
    steps: [
      { id: 's1', text: 'Draw the last stock card.', expect: { type: 'draw' } },
      { id: 's2', text: 'The stock is empty. Tap its outline to recycle the waste into a fresh stock.', expect: { type: 'draw', redeal: true } },
      { id: 's3', text: 'The waste turned over into a new stock. Draw again.', expect: { type: 'draw' } },
    ],
  },
  {
    id: 'learn-foundations', title: 'Growing the Foundations',
    theme: 'midnight-conservatory',
    ruleset: {},
    layout: {
      stock: [], waste: [],
      foundations: [[], [], [], []],
      tableau: [
        [up(C(1, 0))], // A hearts
        [up(C(1, 1))], // 2 hearts
        [up(C(1, 2))], // 3 hearts
        [], [], [], [],
      ],
    },
    steps: [
      { id: 'f1', text: 'Foundations grow upward from Ace to King, one suit each. Bank the Ace of Hearts (double-tap works).', expect: { type: 'move', fromZone: 'tableau', fromPile: 0, toZone: 'foundation' } },
      { id: 'f2', text: 'Now the 2 of Hearts can follow.', expect: { type: 'move', fromZone: 'tableau', fromPile: 1, toZone: 'foundation' } },
      { id: 'f3', text: 'And the 3. Foundations are how you win: bank all four suits.', expect: { type: 'move', fromZone: 'tableau', fromPile: 2, toZone: 'foundation' } },
    ],
  },
  {
    id: 'learn-finale', title: 'The Autofinish',
    theme: 'desert-bloom',
    ruleset: {},
    layout: {
      stock: [], waste: [],
      foundations: [
        Array.from({ length: 12 }, (_, r) => C(0, r)),
        Array.from({ length: 12 }, (_, r) => C(1, r)),
        Array.from({ length: 12 }, (_, r) => C(2, r)),
        Array.from({ length: 12 }, (_, r) => C(3, r)),
      ],
      tableau: [
        [up(C(0, 12))], [up(C(1, 12))], [up(C(2, 12))], [up(C(3, 12))], [], [], [],
      ],
    },
    steps: [
      { id: 'w1', text: 'Only the four Kings remain. When nothing is hidden and the stock is empty, the Auto-finish button appears. Press it.', expect: { type: 'autofinish' } },
      { id: 'w2', text: 'A complete garden. You are ready for the Journey.', expect: { type: 'ack' } },
    ],
  },
];

export const lessonById = (id) => LESSONS.find((l) => l.id === id);

// ---------------------------------------------------------------------------
// Achievements — small static set, stable lowercase keys, idempotent unlocks
// ---------------------------------------------------------------------------

export const ACHIEVEMENTS = [
  { key: 'first_bloom',      name: 'First Bloom',      text: 'Win your first game.' },
  { key: 'graduate',         name: 'Graduate',         text: 'Complete every lesson in Learn.' },
  { key: 'green_streak',     name: 'Green Streak',     text: 'Win three games in a row.' },
  { key: 'head_gardener',    name: 'Head Gardener',    text: 'Complete Journey stage 20, “Wildwood Mastery”.' },
  { key: 'thousand_leaves',  name: 'Thousand Leaves',  text: 'Bank 1,000 cards to foundations over your career.' },
  { key: 'daily_devotion',   name: 'Daily Devotion',   text: 'Complete five daily challenges.' },
];

// ---------------------------------------------------------------------------
// Modes metadata for the mode-select screen
// ---------------------------------------------------------------------------

export const MODES = [
  { id: 'practice',  name: 'Practice',  icon: '☘', ranked: false, players: 1, assists: 'all', duration: 'you choose',
    blurb: 'Pick a difficulty, restart freely, undo and hint without consequence.' },
  { id: 'learn',     name: 'Learn',     icon: '✿', ranked: false, players: 1, assists: 'guided', duration: '2 min',
    blurb: 'Interactive lessons. One rule at a time — you perform each action.' },
  { id: 'journey',   name: 'Journey',   icon: '❀', ranked: false, players: 1, assists: 'undo, hints', duration: '3–15 min',
    blurb: 'Forty authored stages through the glasshouse, ending in mastery trials.' },
  { id: 'daily',     name: 'Daily',     icon: '☀', ranked: false, players: 1, assists: 'undo, hints (flagged)', duration: '~12 min',
    blurb: 'One shared seed per UTC day. Same garden for every player.' },
  { id: 'challenge', name: 'Challenge', icon: '✦', ranked: false, players: 1, assists: 'varies', duration: '6–20 min',
    blurb: 'Constrained goals: move limits, speed targets, altered layouts.' },
  { id: 'score',     name: 'Score Chase', icon: '❦', ranked: false, players: 1, assists: 'undo, hints (flagged)', duration: '~12 min',
    blurb: 'Chase the local leaderboard on validated seeds. Compare with friends.' },
];

// ---------------------------------------------------------------------------
// Offline content validator (used by tests and tools)
// ---------------------------------------------------------------------------

export function validateContentIndex() {
  const problems = [];
  const ids = new Set();
  for (const s of JOURNEY) {
    if (ids.has(s.id)) problems.push(`duplicate journey id ${s.id}`);
    ids.add(s.id);
    if (!Number.isInteger(s.seed)) problems.push(`${s.id}: bad seed`);
    if (!s.goals.win) problems.push(`${s.id}: missing win goal`);
  }
  for (const c of CHALLENGES) {
    if (ids.has(c.id)) problems.push(`duplicate id ${c.id}`);
    ids.add(c.id);
  }
  for (const l of LESSONS) {
    if (ids.has(l.id)) problems.push(`duplicate id ${l.id}`);
    ids.add(l.id);
    if (!l.steps.length) problems.push(`${l.id}: no steps`);
  }
  return problems;
}
