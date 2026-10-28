// The browser build's pure game modules (shared with the node tests), typed
// for this client: the rules (js/rules.js: deal, legality, commands, scoring,
// hints, replay), the deal generator (js/solver.js: constructive winnable
// deals), the content (js/content.js: themes, the 40 Journey stages,
// challenges, practice levels, the Daily, lessons, achievements, modes), the
// session (js/session.js: validated commands, the pause-aware clock,
// constraints, the replay envelope, snapshots, results) and the save
// (js/save.js with js/save-merge.js).
import * as rules from "../js/rules.js";
import * as solver from "../js/solver.js";
import * as content from "../js/content.js";
import * as session from "../js/session.js";
import * as save from "../js/save.js";

export type Zone = "stock" | "waste" | "foundation" | "tableau";
export interface Loc { zone: Zone; pile: number; index?: number }
export interface Ruleset { drawCount: number; maxRedeals: number; suitCount: number; redealPenalty: number; allowUndo: boolean; allFaceUp: boolean }
export interface State {
  seed: number; ruleset: Ruleset; stock: number[]; waste: number[]; foundations: number[][]; tableau: { c: number; up: boolean }[][];
  moves: number; invalids: number; undos: number; hints: number; redealsUsed: number; turn: number; elapsedMs: number;
  status: "active" | "won" | "lost"; terminalReason: string | null; history?: unknown[];
  score: Record<string, number>;
}
export interface Action { type: "draw" | "move" | string; from: Loc; to: Loc; cards: number[] }
export interface GameEvent { type: string; to?: Loc; from?: Loc; cards?: number[]; reason?: string }
export interface Constraint { type: "moves" | "time" | "redeals"; limit?: number; limitMs?: number }
export interface Theme {
  id: string; name: string; felt: string; feltDeep: string; table: string; accent: string; sky: [string, string]; cardBack: [string, string]; leaf: string;
  ui: { bg: string; panel: string; text: string; accent: string };
}
export interface Stage {
  id: string; index: number; title: string; text: string; profile: string; band: string; seed: number; ruleset: Partial<Ruleset> & { targets?: number[] };
  par: { moves: number; timeMs: number }; mastery: boolean; theme: string; expectedMinutes: number;
}
export interface Descriptor { id: string; seed: number; ruleset: Partial<Ruleset> & { targets?: number[] }; ranked?: boolean; constraint?: Constraint | null }
export interface Challenge extends Descriptor { name: string; theme: string; text: string; expectedMinutes: number; constraint: Constraint | null }
export interface Daily extends Descriptor { day: string; version: number; expectedMinutes: number }
export interface LessonStep { id: string; text: string; expect: { type: string; [k: string]: unknown } }
export interface Lesson { id: string; title: string; theme: string; ruleset: Partial<Ruleset>; layout: unknown; steps: LessonStep[] }
export interface PracticeLevel { id: string; label: string; profile: string; band: string; text: string }
export interface Mode { id: string; name: string; icon: string; assists: string; duration: string; blurb: string }
export interface Achievement { key: string; name: string; text: string }
export interface Breakdown {
  rows: [string, number][]; total: number; moves: number; invalids: number; undos: number; hints: number; ms: number;
  foundations: number; status: string; reason: string | null; seed: number;
}
export interface Snapshot { state: unknown; mode: string; contentId: string; [k: string]: unknown }
export interface Session {
  mode: string; contentId: string; ranked: boolean; constraint: Constraint | null; lessonSteps: LessonStep[] | null; lessonIndex: number;
  sessionId: string; paused: boolean; ended: boolean; state: State; envelope: unknown; _journeyStage?: Stage | null;
  elapsedMs(): number; pause(): void; resume(): void; currentStep(): LessonStep | null;
  dispatch(cmd: Record<string, unknown>): { ok: boolean; events: GameEvent[]; error?: string };
  tick(): GameEvent[] | null; undo(): { ok: boolean; events: GameEvent[]; error?: string }; hint(): Action | null;
  canAutoFinish(): boolean; isFinished(): boolean; finalizeIfEnded(): boolean; breakdown(): Breakdown; snapshot(): Snapshot;
}
export interface Progress {
  journey: Record<string, { stars: number; bestMoves: number; bestTimeMs: number; completedAt: number }>;
  lessons: Record<string, { completedAt: number }>;
  challenges: Record<string, { completed: boolean; bestScore: number; bestMs: number }>;
  dailies: Record<string, { score: number; moves: number; ms: number; won: boolean }>;
  mastery: { stagesCompleted: number };
}
export interface Stats {
  games: number; wins: number; losses: number; streak: number; bestStreak: number; totalMoves: number; totalTimeMs: number;
  foundationsBanked: number; bestScore: number; bestWinMs: number | null; dailyCompleted: number;
}
export interface ScoreEntry { mode: string; seed: number; rulesetKey: string; score: number; moves: number; ms: number; assists: boolean; date?: string; status: string; invalids: number; sessionId: string; when?: number }
export interface SaveDoc {
  version: number; progress: Progress; stats: Stats; achievements: { version: number; unlocked: Record<string, number> };
  scores: { version: number; entries: ScoreEntry[] }; session: (Snapshot & { restartConfig?: unknown }) | null;
}
export interface Options {
  interfaceMode: "3d" | "2d"; theme: string; colorblindPalette: string; leftHanded: boolean; timingAssist: boolean;
  haptics: boolean; cameraDrift: boolean; tutorialDone: boolean;
}

interface RulesApi {
  SUIT_SYMBOLS: string[]; RANK_LABELS: string[];
  rankOf(c: number): number; suitOf(c: number): number; colorOf(c: number): "red" | "black";
  createCustomGame(layout: unknown, ruleset: unknown, seed: number): State & { custom?: boolean };
  legalActions(s: State): Action[]; canMove(s: State, from: Loc, to: Loc): { ok: boolean; reason?: string };
  resolveRun(s: State, from: Loc): { cards: number[] } | null; totalScore(s: State): number;
  foundationCount(s: State): number; hiddenCount(s: State): number; isFinished(s: State): boolean;
}
interface SolverApi { generateWinnableLayout(seed: number, ruleset: unknown): { layout: unknown; certificate: Record<string, unknown>[] } }
interface ContentApi {
  CONTENT_VERSION: number; THEMES: Theme[]; JOURNEY: Stage[]; LESSONS: Lesson[]; CHALLENGES: Challenge[]; PRACTICE_LEVELS: PracticeLevel[];
  ACHIEVEMENTS: Achievement[]; MODES: Mode[]; BAND_LABELS: Record<string, string>; PROFILES: Record<string, { label: string }>;
  themeById(id: string): Theme; lessonById(id: string): Lesson | undefined; challengeById(id: string): Challenge | undefined;
  practiceDeal(level: string, salt: number): Descriptor; dailyInfo(d?: Date): Daily; msUntilNextDaily(d?: Date): number;
  scoreChaseDeal(profile: string, band: string, index: number): Descriptor; journeyStage(i: number): Stage;
}
interface SaveApi {
  emptySave(): SaveDoc; normalize(raw: unknown): SaveDoc; mergeSave(remote: unknown, local: unknown): SaveDoc; sameSave(a: unknown, b: unknown): boolean;
  readForeign(text: string): { save: SaveDoc; settings: Record<string, unknown> } | null;
  unlockAchievement(s: SaveDoc, key: string, now?: number): boolean; addScore(s: SaveDoc, e: Partial<ScoreEntry>, now?: number): ScoreEntry[];
  DEFAULT_OPTIONS: Options; OPTION_KEYS: (keyof Options)[]; BROWSER_KEYS: string[]; THEME_IDS: string[]; PALETTES: string[];
  pickOptions(raw: unknown): Partial<Options>;
}
interface SessionCtor {
  new (opts: Record<string, unknown>): Session;
  restore(snap: unknown, now: () => number): Session | null;
}

export const Rules = rules as unknown as RulesApi;
export const Solver = solver as unknown as SolverApi;
export const Content = content as unknown as ContentApi;
export const Save = save as unknown as SaveApi;
export const SessionClass = (session as unknown as { Session: SessionCtor }).Session;
export const THEMES = Content.THEMES;
