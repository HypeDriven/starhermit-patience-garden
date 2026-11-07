// Localization: the engine's string tables (assets/strings.json, US-English text as the keys, the nine
// StarHermit locales; the account strings are the engine's starhermit.* keys) in the interface language the
// runtime reports (the player's choice in Options › Language, else the account's preferred language or the
// device's). Every string is drawn through T() each frame, so a change shows on the next frame and never
// restarts the round.
import { strings } from "starhermit:engine";
import * as ui from "starhermit:ui";
import { Rules } from "./game.ts";

strings.load("assets/strings.json");
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
