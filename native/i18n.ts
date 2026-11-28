// Localization: the engine's string tables (assets/strings.json, US-English text as the keys, the nine
// StarHermit locales; the account strings are the engine's starhermit.* keys) in the interface language the
// runtime reports (the player's choice in Options › Language, else the account's preferred language or the
// device's). Every string is drawn through T() each frame, so a change shows on the next frame and never
// restarts the round.
import {files, preferences, strings} from "starhermit:engine";

// Locale tables are split per language. Only the player's fallback chain is
// parsed and kept (en-US first, so it remains the default). Other locales stay
// in the package until the language changes.
const __stringLocales = new Set<string>();
let __stringsBusy = false;
let __stringsWatching = false;
function loadGameStrings(dir: string): void {
  if (__stringsBusy) return;
  __stringsBusy = true;
  try {
    let tag = "en";
    try {
      const language = preferences().language;
      if (language) tag = language;
    } catch { /* preferences are not ready while the module is still loading */ }
    const want = stringLocalesFor(tag);
    const ordered = [...want.filter((locale) => locale === "en-US"), ...want.filter((locale) => locale !== "en-US")];
    const batch: { [locale: string]: unknown } = {};
    for (const locale of ordered) {
      if (__stringLocales.has(locale)) continue;
      const path = `${dir}/${locale}.json`;
      if (!files.exists(path)) continue;
      const table = files.readJson(path);
      if (!table || typeof table !== "object" || Array.isArray(table)) continue;
      batch[locale] = table;
    }
    const added = Object.keys(batch);
    if (added.length) {
      strings.load(batch);
      for (const locale of added) __stringLocales.add(locale);
    }
  } finally {
    __stringsBusy = false;
  }
  if (!__stringsWatching) {
    __stringsWatching = true;
    strings.onChange(() => loadGameStrings(dir));
  }
}
function stringLocalesFor(tag: string): string[] {
  const out: string[] = [];
  const add = (locale: string): void => { if (locale && !out.includes(locale)) out.push(locale); };
  const bits = tag.replace(/_/g, "-").split("-").filter(Boolean);
  const language = (bits[0] || "en").toLowerCase();
  const regionBit = bits.slice(1).find((part) => /^[A-Za-z]{2}$/.test(part) || /^\d{3}$/.test(part));
  const region = regionBit ? (/^\d{3}$/.test(regionBit) ? regionBit : regionBit.toUpperCase()) : "";
  add(region ? `${language}-${region}` : language);
  if (bits.length > 2) {
    add(bits.map((part, index) => index === 0 ? language : (/^[A-Za-z]{2}$/.test(part) ? part.toUpperCase() : part)).join("-"));
  }
  if (language === "en" && region && region !== "US" && region !== "CA") add("en-001");
  if (language === "en" && region && region !== "US") add("en-GB");
  if (language === "es" && region !== "ES") add("es-419");
  if (language === "es") add("es-ES");
  if (language === "fr") add("fr-FR");
  if (language === "fr" && region === "CA") add("fr-CA");
  if (language === "de") add("de-DE");
  if (language === "pt" && region !== "BR") add("pt-PT");
  if (language === "pt") add("pt-BR");
  if (language === "it") add("it-IT");
  if (language === "nl") add("nl-NL");
  if (language === "ja") add("ja-JP");
  if (language === "zh") {
    const traditional = region === "HK" || region === "TW" || region === "MO";
    add(traditional ? "zh-HK" : "zh-CN");
    if (!traditional) add("zh-SG");
  }
  if (language === "yue") add("yue-HK");
  if (language === "ru") add("ru-FI");
  add(language);
  add("en-US");
  return out;
}
import * as ui from "starhermit:ui";
import { Rules } from "./game.ts";

loadGameStrings("assets/l10n/strings");
strings.defaultLocale = "en-US";
ui.setLanguage(strings.locale);
strings.onChange((locale) => ui.setLanguage(locale));

export type Vars = Record<string, string | number>;
const fill = (s: string, vars?: Vars | null): string => s.replace(/\{(\w+)\}/g, (m, k: string) => (vars && vars[k] != null ? String(vars[k]) : m));
/** An English source string in the player's language (unknown strings pass through); `{name}` placeholders from vars. */
export function T(key: string | null | undefined, vars?: Vars | null): string {
  if (key == null) return "";
  const s = String(key);
  return strings.has(s) ? strings.t(s, vars ?? undefined) : fill(s, vars);
}
/** Marks an English key that is translated with T() where it is shown. */
export const N = (s: string): string => s;
const ACCOUNT = {
  signIn: "signIn", invite: "invite", inviteCopied: "inviteCopied", inviteFailed: "inviteLink", signedOut: "signedOut",
  lbPosting: "leaderboardPosting", lbRank: "leaderboardRank", lbPosted: "leaderboardPosted", lbNotPosted: "leaderboardNotPosted",
};
/** The engine's account strings (a failed copy shows the link: starhermit.inviteLink). */
export function S(key: keyof typeof ACCOUNT, vars?: Vars): string { return strings.t(`starhermit.${ACCOUNT[key]}`, vars); }

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
