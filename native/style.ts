// The look of the HUD, rails, tray and screens: the browser build's
// css/style.css, rewritten class-based in tools/ui-style.css and converted
// once with `starhermit css` into assets/ui-style.json (`npm run css`),
// registered at start with the theme the runtime's own widgets (scroll bars,
// focus rings, selects, check boxes) take. The garden theme (main.js
// applySettings: --bg, --panel, --panel-2, --text, --accent from the theme's
// ui colours) and the runtime's high contrast (body.high-contrast) are token
// sets; the colour-mix() shades the sheet used are recomputed here.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";
import { Content } from "./game.ts";

type Tokens = Record<string, string>;
const hex = (c: string): number[] => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (v: number[]): string => `#${v.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("")}`;
/** color-mix(in srgb, a p, b). */
export function mix(a: string, p: number, b: string): string {
  const x = hex(a), y = hex(b);
  return toHex(x.map((v, i) => v * p + y[i]! * (1 - p)));
}
const alpha = (c: string, a: number): string => c.slice(0, 7) + Math.round(a * 255).toString(16).padStart(2, "0");

let current: Tokens = {};
/** The tokens for a theme and contrast, with the sheet's derived shades. */
export function tokensFor(themeId: string, highContrast: boolean): Tokens {
  const th = Content.themeById(themeId);
  const t: Tokens = {
    bg: th.ui.bg, panel: th.ui.panel, "panel-2": mix(th.ui.panel, 0.93, "#ffffff"), text: th.ui.text, "text-dim": "#b9b09a",
    accent: th.ui.accent, "accent-2": "#a4d65e", danger: "#d0564b",
  };
  if (highContrast) Object.assign(t, { text: "#ffffff", "text-dim": "#d8d8d8", panel: "#10281c", "panel-2": "#163526", bg: "#07130d" });
  t.focus = t.accent!;
  t.glass = alpha(t.panel!, 0.88);
  t.hud = alpha(t.bg!, 0.82);
  t["rail-bg"] = alpha(t.bg!, 0.7);
  t.drawer = alpha(t.panel!, 0.96);
  t.coach = alpha(t.panel!, 0.94);
  for (const p of [8, 10, 12, 14, 16, 20, 25]) t[`line-${p}`] = alpha(t.text!, p / 100);
  t.hover = mix(t["panel-2"]!, 0.92, t.text!);
  t["accent-22"] = alpha(t.accent!, 0.22);
  t["accent-35"] = alpha(t.accent!, 0.35);
  t.demo = alpha(t.bg!, 0.6);
  return t;
}

export function initStyles(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  ui.setFont({ family: "sans-serif" });
  ui.setTheme({
    fontSize: 16, smallSize: 13.6, headingSize: 24, padding: 8, spacing: 10, radius: 10,
    text: "#f2ead8", muted: "#b9b09a", panel: "#27392f", control: "#2f4436", hovered: "#3e5243",
    pressed: "#27392f", field: "#2f4436", accent: "#e8a13c", focus: "#e8a13c", outline: "#f2ead829",
  });
  ui.setTokens(css.tokens);
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$text" } },
    paragraph: { text: { color: "$text" } },
    heading: { text: { color: "$text" } },
    widget: { focusRing: { color: "$focus", width: 3, offset: 2 } },
    scrollArea: { parts: { bar: { background: "$text-dim", radius: 4 } } },
    tooltip: { background: "$panel", text: { color: "$text" }, radius: 6, padding: 6 },
    // .screen.overlay: the screen over a dim of the table behind it.
    dialog: { background: "#00000000", padding: 0, parts: { backdrop: { background: "#080c0a9e" } } },
    // The full-page screens (title, modes, setup, Journey, Learn) sit on the page colour, undimmed.
    ".page-dialog": { background: "#00000000", padding: 0, parts: { backdrop: { background: "#00000000" } } },
  });
}

let key = "";
/** Applies the theme / contrast tokens (cheap when unchanged). */
export function applyTokens(themeId: string, highContrast: boolean): void {
  const k = `${themeId}:${highContrast}`;
  if (k === key) return;
  key = k;
  current = tokensFor(themeId, highContrast);
  ui.setTokens(current);
}
/** A token's current colour (for draw calls, which take real colours). */
export function token(name: string): string { return current[name] ?? "#000000"; }
