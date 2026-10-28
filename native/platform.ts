// The game's data and the StarHermit platform, on the runtime's modules (what
// js/platform.js and js/storage.js did over the JS SDK and localStorage):
// - the save (starhermit:storage `saves`, schema 1: on the device and in the
//   player's cloud slot) is { progress, stats, achievements, scores, session }
//   (js/save.js); two devices' saves merge on a conflict (mergeSave: the
//   browser build's save-merge.js, which it also ran on its saveconflict);
//   the slot the browser build wrote through the JS SDK (game:<slug>, its
//   { version, savedAt, settings, progress, … } document) shows as foreign:
//   it is merged in (its game options adopted unless set here since) and
//   replaced once;
// - the game's own options (3D / 2D table, theme, colour-vision palette,
//   left-handed tray, timing assistance, haptics, camera drift, lessons
//   done) are engine `settings` (same keys, synced with the account); the
//   browser build's values in the account's settings KV are adopted (unless
//   set here since), then all its KV keys are removed (graphics, volumes,
//   mute, reduced motion, contrast, larger text and language are the
//   runtime's Options);
// - the player, the invite link, the platform's clock for the Daily,
//   posting a won round's total through score-script.js (a practice session
//   whose socket carries { type: 'result', scores }, as the JS SDK's
//   submitScores did) with the rank, and the high-score board for Score
//   Chase (read-only).
import type { JsonValue } from "starhermit:engine";
import {
  connectGame, inviteLink as fetchInviteLink, leaderboards, onPlayerChange, player, serverNow, serverTime, sessions, type Leaderboard,
} from "starhermit:platform";
import { saves, settings as store } from "starhermit:storage";
import { Save, type Options, type SaveDoc, type ScoreEntry } from "./game.ts";

// --- the save --------------------------------------------------------------------------------
let data: SaveDoc = Save.emptySave();
let lastSavedAt = 0;
const mergedListeners = new Set<() => void>();
/** fn() after progress from the account (another device, the browser build) was merged in. */
export function onProgressMerged(fn: () => void): void { mergedListeners.add(fn); }
function merged(): void { for (const fn of mergedListeners) fn(); }

function write(opts: { replaceForeign?: boolean } = {}): void {
  try {
    saves.save(data as unknown as JsonValue, { schema: 1, ...opts });
    lastSavedAt = saves.load()?.savedAt ?? lastSavedAt;
  } catch (e) { console.warn(`save: ${String(e)}`); }
}
/** The live save document (change it, then persist()). */
export function save(): SaveDoc { return data; }
/** Saves (the device at once, the account debounced by the runtime). */
export function persist(): void { write(); }
function adopt(other: unknown): boolean {
  const next = Save.mergeSave(other, data);
  if (Save.sameSave(next, data)) return false;
  data = next;
  write();
  return true;
}
saves.onConflict((mine, remote) => ({ merged: Save.mergeSave(remote.data, mine?.data ?? null) as unknown as JsonValue }));
saves.onStatus((_status, state) => {
  if (state === "foreign") { migrateForeign(); return; }
  const cur = saves.load();
  if (cur && cur.savedAt !== lastSavedAt) {
    lastSavedAt = cur.savedAt;
    if (adopt(cur.data)) merged();
  }
});
/** The browser build's cloud documents: merged with this device's save, saved over it once. */
function migrateForeign(): void {
  const old = saves.foreign();
  if (!old) return;
  const doc = old.text != null ? Save.readForeign(old.text) : null;
  let grew = false;
  if (doc) {
    const next = Save.mergeSave(doc.save, data);
    grew = !Save.sameSave(next, data);
    data = next;
    for (const [k, v] of Object.entries(Save.pickOptions(doc.settings))) adoptOption(k as keyof Options, v);
  }
  write({ replaceForeign: true });
  if (grew) merged();
}

/** The title's sync line: local (a guest) | saving | synced | error (main.js SYNC_LABELS). */
export function syncState(): "local" | "saving" | "synced" | "error" {
  if (!player()) return "local";
  const st = saves.state();
  if (st === "error" || st === "read-blocked") return "error";
  if (st === "loading" || st === "foreign" || st === "uploading" || saves.status() === "pending") return "saving";
  return "synced";
}
/** storage.js unlockAchievement: true when newly unlocked. */
export function unlock(key: string): boolean { return Save.unlockAchievement(data, key); }
/** storage.js addScore: a local-board entry (best 100 per mode). */
export function addScore(entry: Partial<ScoreEntry>): void { Save.addScore(data, entry); }
export function flush(): void { void saves.flush().catch(() => undefined); }

// --- the game's options -----------------------------------------------------------------------
export const options: Options = { ...Save.DEFAULT_OPTIONS };
const KEYS = Save.OPTION_KEYS;
const optionListeners = new Set<() => void>();
export function onOptionsChange(fn: () => void): void { optionListeners.add(fn); }
function optionsChanged(): void { for (const fn of optionListeners) fn(); }
function readOption(key: keyof Options): void {
  let v: JsonValue | undefined;
  try { v = store.get(key); } catch { return; }
  const ok = Save.pickOptions({ [key]: v })[key];
  if (ok !== undefined) (options as unknown as Record<string, unknown>)[key] = ok;
}
/** A migrated value, kept unless this game set the key since. */
function adoptOption(key: keyof Options, value: unknown): void {
  const v = Save.pickOptions({ [key]: value })[key];
  if (v === undefined) return;
  try {
    if (store.get(key) !== undefined) return;
    store.set(key, v as JsonValue);
    (options as unknown as Record<string, unknown>)[key] = v;
    optionsChanged();
  } catch { /* keep the device's */ }
}
/** Changes one of the game's options (device and account). */
export function setOption<K extends keyof Options>(key: K, value: Options[K]): void {
  if (options[key] === value) return;
  options[key] = value;
  try { store.set(key, value as JsonValue); } catch (e) { console.warn(`option ${key}: ${String(e)}`); }
  optionsChanged();
}
// The browser build patched its settings into the account's settings KV key by key (plus the language helper's
// ui.language): the game's options carry over (unless set here since), then all are removed.
function importLegacy(): void {
  const keys = store.legacyKeys();
  if (!keys) return;
  for (const key of keys) if ((KEYS as string[]).includes(key)) adoptOption(key as keyof Options, store.legacy(key));
  for (const key of keys) if (Save.BROWSER_KEYS.includes(key) || key.startsWith("ui.")) store.removeLegacy(key);
}

/** Reads the device's save and the game's options (from onStart). */
export function initPlatform(): void {
  const cur = saves.load();
  lastSavedAt = cur?.savedAt ?? 0;
  data = Save.normalize(cur?.data ?? null);
  for (const k of KEYS) readOption(k);
  store.onChange((key) => {
    if (!(KEYS as string[]).includes(key)) return;
    readOption(key as keyof Options);
    optionsChanged();
  });
  store.onLegacy(importLegacy);
  importLegacy();
  if (saves.state() === "foreign") migrateForeign();
  optionsChanged();
  refreshPlayer();
  void serverTime().then(() => { clockSynced = true; }, () => undefined);
}

// --- the player and the clock -----------------------------------------------------------------
export function signedIn(): boolean { return !!player(); }
export function displayName(): string { return player()?.displayName ?? ""; }
let invite: string | null = null;
/** The invite link, fetched ahead so a button press can copy it at once. */
export function inviteLink(): string | null { return player() ? invite : null; }
function refreshPlayer(): void {
  invite = null;
  board = undefined;
  if (!player()) return;
  fetchInviteLink().then((u) => { invite = u; }, () => { invite = null; });
}
onPlayerChange(() => refreshPlayer());

let clockSynced = false;
/** Whether the platform's clock answered (else the device's clock decides the Daily). */
export function synced(): boolean { return clockSynced; }
/** Now by the platform's clock when it has answered, else the device's (platform.js serverNow). */
export function now(): Date {
  let ms = Date.now();
  try { ms = serverNow() ?? ms; } catch { /* device clock */ }
  return new Date(ms);
}

// --- the high-score board ---------------------------------------------------------------------
let board: Leaderboard | null | undefined;
async function highScoreBoard(): Promise<Leaderboard | null> {
  if (board !== undefined) return board;
  const list = await leaderboards.list();
  board = list.find((b) => b.key === "high-score") ?? list[0] ?? null;
  return board;
}
export interface HostedRow { rank: number; name: string; score: number; me: boolean }
/** Score Chase's global board (platform.js globalBoardRows): its top 20, null when unavailable. */
export async function hostedBoard(): Promise<HostedRow[] | null> {
  const me = player();
  if (!me) return null;
  try {
    const b = await highScoreBoard();
    if (!b) return null;
    const r = await leaderboards.entries(b.id, { pageSize: 20 });
    return r.items.map((e, i) => ({ rank: e.rank ?? i + 1, name: e.displayName || e.username || "", score: Number.isFinite(e.score) ? e.score : 0, me: e.userId === me.userId }));
  } catch { return null; }
}
export interface Posted { posted: boolean; rank: number | null }
/** Signed in only: post a won round's total through score-script.js; { posted, rank }. Never rejects. */
export async function postScore(total: number): Promise<Posted> {
  const me = player();
  if (!me) return { posted: false, rank: null };
  const score = Math.max(0, Math.round(total));
  let accepted: string[] = [];
  try {
    const sessionId = await sessions.practice();
    accepted = await new Promise<string[]>((resolve) => {
      const socket = connectGame(sessionId);
      let done = false;
      const finish = (list: string[]): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.close();
        resolve(list);
      };
      const timer = setTimeout(() => finish([]), 15000);
      socket.on("open", () => { socket.sendCommand({ type: "result", scores: { "high-score": score } }); });
      socket.on("game", (d) => {
        const m = d as { type?: string; accepted?: string[] } | null;
        if (m && m.type === "result-ack") finish(Array.isArray(m.accepted) ? m.accepted : []);
      });
      socket.on("error", () => finish([]));
      socket.on("stopped", () => finish([]));
      socket.on("abandoned", () => finish([]));
    });
  } catch { return { posted: false, rank: null }; }
  if (!accepted.includes("high-score")) return { posted: false, rank: null };
  try {
    const b = await highScoreBoard();
    if (!b) return { posted: true, rank: null };
    const r = await leaderboards.entries(b.id, { pageSize: 100 });
    const mine = r.items.find((e) => e.userId === me.userId);
    return { posted: true, rank: mine ? mine.rank : null };
  } catch { return { posted: true, rank: null }; }
}
