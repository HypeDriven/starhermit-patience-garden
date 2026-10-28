// Localization: the browser build's dictionaries (js/locales/*.js through
// js/i18n.js, US-English text as the keys, the nine StarHermit locales) and
// the account strings (js/platform-i18n.js), in the interface language the
// runtime reports (preferences().language: the player's choice in Options ›
// Language, else the account's preferred language or the device's). The
// runtime's Options replace the game's own Language setting (sh-language.js)
// and the DOM re-labelling: every string is drawn through T() each frame, so
// a change shows on the next frame and never restarts the round.
import { onPreferencesChange, preferences } from "starhermit:engine";
import * as ui from "starhermit:ui";
import { LOCALES, T as translate, setLocale } from "../js/i18n.js";
import { platformStrings } from "../js/platform-i18n.js";
import { Rules } from "./game.ts";

const PRIMARY: Record<string, string> = { en: "en-US", es: "es-419", de: "de-DE", fr: "fr-FR", pt: "pt-BR", it: "it-IT" };

/** The shipped locale nearest a BCP 47 tag (en-GB, es-ES and fr-CA by region; es-MX → es-419, pt-PT → pt-BR). */
export function pickLocale(tag: string): string {
  const s = String(tag || "en-US");
  const exact = (LOCALES as string[]).find((l) => l.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  const lang = s.split("-")[0]!.toLowerCase();
  if (lang === "en" && /-(gb|uk|ie|au|nz|za|in)$/i.test(s)) return "en-GB";
  if (lang === "es" && /-es$/i.test(s)) return "es-ES";
  if (lang === "fr" && /-ca$/i.test(s)) return "fr-CA";
  return PRIMARY[lang] ?? "en-US";
}

let locale = "";
function apply(tag: string): void {
  const next = pickLocale(tag);
  if (next === locale) return;
  locale = next;
  setLocale(locale);
  ui.setLanguage(locale);
}
apply(preferences().language);
onPreferencesChange((p) => apply(p.language));

export function currentLocale(): string { return locale; }
export type Vars = Record<string, string | number>;
/** An English source string in the player's language; `{name}` placeholders from vars. */
export function T(key: string, vars?: Vars | null): string { return translate(key, vars ?? undefined) as string; }
/** Marks an English key that is translated with T() where it is shown. */
export const N = (s: string): string => s;
/** The account strings (signIn, invite, inviteCopied, inviteFailed, signedOut, lbPosting, lbRank, lbPosted, lbNotPosted). */
export function S(key: string, vars?: Vars): string {
  let s = (platformStrings(locale) as Record<string, string>)[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

const SUIT_NAMES = [N("Spades"), N("Hearts"), N("Diamonds"), N("Clubs")];
const RANK_NAMES = [N("Ace"), N("Two"), N("Three"), N("Four"), N("Five"), N("Six"), N("Seven"), N("Eight"), N("Nine"), N("Ten"), N("Jack"), N("Queen"), N("King")];
/** Card name in the game language ("Queen of Hearts"; ui.js cardLabel). */
export function cardLabel(card: number): string {
  return T("{rank} of {suit}", { rank: T(RANK_NAMES[Rules.rankOf(card)]!), suit: T(SUIT_NAMES[Rules.suitOf(card)]!) });
}
export const suitName = (s: number): string => T(SUIT_NAMES[s]!);
/** m:ss (ui.js fmtTime). */
export function fmtTime(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
