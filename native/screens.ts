// The browser build's DOM shell (index.html + js/ui.js) as starhermit:ui,
// built every frame: the game screen's HUD bar (pause, mode and goal, score /
// moves / time, the ℹ rail toggle), the Objective rail (objective, the four
// foundation rings, the constraint) and the Garden rail (seed, assists, the
// keys), the action tray (Undo, Hint, Draw, Auto-finish; mirrored for the
// left-handed option), the lesson coach, the toast, the named targets of the
// glasshouse's cards and piles (for screen readers and play scripts), and
// every screen: the title, mode select, setup, Journey, Learn, pause,
// results, settings, help, profile and Score Chase. The old media queries are
// layouts picked by the window's logical size: wide (≥ 1024 px: both rails
// beside the table) and narrow (the rails in a drawer behind ℹ), with a
// two-row tray on phone portrait. The table is framed in the playfield
// rectangle left between them (main.ts view → render.ts / board2d.ts).
import { frame, openMenu } from "starhermit:engine";
import { bindings, requestRebind } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { board2d } from "./board2d.ts";
import { Content, Rules, Save, type Loc } from "./game.ts";
import { N, S, T, cardLabel, fmtTime, suitName } from "./i18n.ts";
import * as platform from "./platform.ts";
import * as render from "./render.ts";
import {
  MODE_NAMES, PAGES, ackLesson, actions, app, boardIs2D, closeTop, constraintText, dailyInfo, doAutofinish, doDraw, doHint, doUndo, fresh,
  hasSavedRound, hudRects, later, leaderboardLine, leaveGame, nextJourneyIndex, objectiveText, openOverlay, pauseGame, restartGame,
  resultsAction, resumeGame, showScreen, top, view, type Screen, type SetupMode,
} from "./main.ts";
import { token } from "./style.ts";

// ------------------------------------------------------------------ layout
interface Layout { lw: number; lh: number; sc: number; wide: boolean; phone: boolean; short: boolean }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  return { lw, lh, sc, wide: lw >= 1024, phone: lw <= 700 && lh > lw, short: lh <= 520 && lw > lh };
}
const lastSize = new Map<string, number>();
function textWidth(text: string, style: string, kind?: "button" | "heading"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style: [style] }).width / ui.preferences().scale;
}
interface Btn { id: string; text: string; style?: string; act: () => void; disabled?: boolean; name?: string; selected?: boolean; content?: () => void }
const buttonWidth = (text: string, style: string): number => textWidth(text, style, "button") + 4;
/** A button `width` wide (null: its text's); a label too long for it wraps inside. */
function button(b: Btn, width: number | null = null): void {
  const style = b.style ?? "btn";
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  if (b.selected) opts.selected = true;
  const s: ui.Style = width != null ? { width } : {};
  if (b.content) opts.content = b.content;
  else if (b.name && b.name !== b.text) {
    const dark = style === "btn-primary" || style === "btn-big";
    opts.content = () => { ui.style(dark ? { text: { color: "#201503", weight: "bold" } } : {}).label(b.text); };
  } else if (width != null && buttonWidth(b.text, style) > width) {
    const inner = Math.max(20, width - 34);
    opts.content = () => { ui.style({ text: { align: "center" } }).paragraph(b.text, inner); };
  }
  if (ui.style(style, s).id(b.id).button(b.name ?? b.text, opts) && fresh()) later(b.act);
}
/** Buttons at their own widths in rows that wrap at `width` (.title-row, .row-end). */
function flow(label: string, list: Btn[], width: number, gap = 10, justify: "start" | "center" | "end" = "center"): ui.Rect {
  const rows: Btn[][] = [[]];
  let used = 0;
  const bw = (b: Btn): number => Math.min(width, buttonWidth(b.text, b.style ?? "btn"));
  for (const b of list) {
    const w = bw(b);
    if (rows[rows.length - 1]!.length && used + gap + w > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + w;
    rows[rows.length - 1]!.push(b);
  }
  return ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => {
      for (const b of row) button(b, bw(b) >= width ? width : null);
    }, { spacing: gap, width, justify }));
  }, { spacing: gap, width });
}
/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, cls = "text", id?: string): void {
  if (!text) return;
  let u = ui.style(cls);
  if (id) u = u.id(id);
  if (textWidth(text, cls) <= width) u.label(text);
  else u.paragraph(text, Math.max(20, width));
}
function heading(cls: string, text: string, width: number, id?: string): void {
  if (textWidth(text, cls, "heading") <= width) (id ? ui.id(id) : ui).style(cls).heading(text);
  else ui.style(cls).paragraph(text, width);
}
function rect(r: ui.Rect): void { hudRects.push({ x: r.x, y: r.y, width: r.width, height: r.height }); }
/** Rich text authored as HTML (<b>, <kbd>, &amp;) as plain text. */
const plain = (s: string): string => s.replace(/<\/?(b|kbd|strong)>/g, "").replace(/&amp;/g, "&");
/** A box over a window rectangle (window px) in a class, drawn as a placed role-none widget. */
function paint(id: string, x: number, y: number, w: number, h: number, cls: string): void {
  if (w <= 0 || h <= 0) return;
  const sc = ui.preferences().scale, sa = frame().safeArea;
  ui.place(id, { anchor: "top-start", x: (x - sa.left) / sc, y: (y - sa.top) / sc }, () => {
    ui.widget("", { role: "none", size: { width: w / sc, height: h / sc }, draw: (r) => draw.box(r.x, r.y, r.width, r.height, cls) });
  });
}
/** A grid of cells `min` px wide at least (CSS repeat(auto-fill, minmax(min, 1fr))). */
function cardGrid(id: string, count: number, w: number, min: number, gap: number, cell: (i: number, cw: number) => void): void {
  const cols = Math.max(1, Math.floor((w + gap) / (min + gap)));
  const cw = (w - (cols - 1) * gap) / cols;
  ui.column(id, () => {
    for (let r = 0; r * cols < count; r++) {
      ui.row(`${id}-r${r}`, () => { for (let i = r * cols; i < Math.min(count, (r + 1) * cols); i++) cell(i, cw); }, { spacing: gap, align: "stretch" });
    }
  }, { spacing: gap, width: w });
}
function keyLabel(code: string): string {
  const GLYPH: Record<string, string> = { "Arrow Up": "↑", "Arrow Down": "↓", "Arrow Left": "←", "Arrow Right": "→", Escape: "Esc" };
  return GLYPH[code] ?? code;
}
/** The effective keyboard keys of an action, e.g. "D" or "Enter/Space". */
export function keysFor(action: string): string {
  let list: string[] = [];
  try { list = bindings(action).filter((b) => b.device === "keyboard").map((b) => keyLabel(b.label)); } catch { /* not yet */ }
  return [...new Set(list)].join("/") || "—";
}

// ------------------------------------------------------------------ the frame
export function drawScreens(): void {
  const L = layoutNow();
  const f = frame();
  const s = top();
  const page = !!s && PAGES.has(s.name);
  if (app.session && !page) gameScreen(L);
  else { view.width = 0; view.height = 0; paint("page-bg", 0, 0, f.width, f.height, "page"); }
  toasts(L);
  screens(L);
  if (app.focusNext) {
    const age = f.frame - app.openedFrame;
    if (age >= 1) ui.setFocus(app.focusNext);
    if (age >= 3) app.focusNext = null;
  }
}

// ------------------------------------------------------------------ the game screen (index.html #screen-game)
function gameScreen(L: Layout): void {
  const f = frame(), sc = L.sc, sa = f.safeArea;
  const s = app.session!;
  const live = !app.screens.length && app.phase === "active";
  const ox = sa.left, oy = sa.top;
  const barH = lastSize.get("hud") ?? 61;
  const trayH = lastSize.get("tray") ?? 65;
  const rw = L.wide ? 230 : 0;
  // The playfield: between the bar and the tray, and the wide layout's rails.
  const bx = rw, by = barH, bw = L.lw - 2 * rw, bh = Math.max(40, L.lh - barH - trayH);
  view.x = ox + bx * sc; view.y = oy + by * sc;
  view.width = Math.max(1, bw * sc); view.height = Math.max(1, bh * sc);
  const W = f.width, H = f.height;
  if (boardIs2D()) paint("page-bg", 0, 0, W, H, "page");
  else {
    paint("bg-top", 0, 0, W, view.y, "page");
    paint("bg-bottom", 0, view.y + view.height, W, H - view.y - view.height, "page");
    paint("bg-left", 0, view.y, view.x, view.height, "page");
    paint("bg-right", view.x + view.width, view.y, W - view.x - view.width, view.height, "page");
  }
  if (boardIs2D()) board2d({ x: bx, y: by, width: bw, height: bh });
  else boardTargets();

  // ---- HUD bar
  const st = s.state;
  const stats = [`❦ ${Rules.totalScore(st)}`, `↦ ${st.moves}`, `⏱ ${fmtTime(s.elapsedMs())}`];
  const goal = T("{banked}/{total} banked · {hidden} hidden", { banked: Rules.foundationCount(st), total: 13 * st.ruleset.suitCount, hidden: Rules.hiddenCount(st) });
  const bar = ui.place("hud-top", { anchor: "top-start", x: 0, y: 0 }, () => {
    ui.row("hud-row", () => {
      button({ id: "btn-pause", text: "❚❚", name: T("Pause (Esc)"), style: "btn-icon", act: pauseGame, disabled: !live });
      const statsW = stats.reduce((a, t) => a + textWidth(t, "hud-stat-b") + 14, 0);
      const room = L.lw - 24 - 60 - statsW - (L.wide ? 0 : 62) - 20;
      const mode = T(MODE_NAMES[s.mode] ?? s.mode);
      const mw = textWidth(mode, "hud-mode");
      ui.row("hud-objective", () => {
        if (mw <= room) ui.style("hud-mode").id("hud-mode-name").label(mode);
        if (L.lw > 420 && mw + 10 + textWidth(goal, "hud-goal") <= room) ui.style("hud-goal").id("hud-goal").label(goal);
      }, { spacing: 10, align: "center" });
      ui.spacer();
      ui.row("hud-stats", () => {
        ui.style("hud-stat-b").id("hud-score").tooltip(T("Score")).label(stats[0]!);
        ui.style("hud-stat-b").id("hud-moves").tooltip(T("Moves")).label(stats[1]!);
        ui.style("hud-stat-b").id("hud-time").tooltip(T("Time")).label(stats[2]!);
      }, { spacing: L.phone ? 10 : 16, align: "center" });
      if (!L.wide) button({ id: "btn-rail-toggle", text: "ℹ", name: T("Toggle objective panel"), style: "btn-icon", selected: app.railsOpen, act: () => { app.railsOpen = !app.railsOpen; } });
    }, { style: "hud-top", width: L.lw, spacing: 14, align: "center" });
  });
  rect(bar);
  lastSize.set("hud", bar.height / sc);

  // ---- tray
  const acts = Rules.legalActions(st);
  const finished = Rules.isFinished(st);
  let items: Btn[] = [
    { id: "btn-undo", text: `↩ ${T("Undo")}`, act: doUndo, disabled: !live || !(st.ruleset.allowUndo && (st.history?.length || 0) > 0) },
    { id: "btn-hint", text: `✦ ${T("Hint")}`, act: doHint, disabled: !live || finished || acts.length === 0 },
    { id: "btn-draw", text: `⟳ ${T("Draw")}`, act: doDraw, disabled: !live || finished || !acts.some((a) => a.type === "draw") },
  ];
  if (s.canAutoFinish()) items.push({ id: "btn-autofinish", text: `❀ ${T("Auto-finish")}`, style: "btn-primary", act: doAutofinish, disabled: !live });
  if (platform.options.leftHanded) items = items.reverse();
  const tray = ui.place("tray", { anchor: "bottom-start", x: 0, y: 0 }, () => {
    ui.column("tray-col", () => {
      if (L.phone) {
        const bw2 = (L.lw - 24 - 10) / 2;
        for (let r = 0; r * 2 < items.length; r++) {
          ui.row(`tray-r${r}`, () => { for (const b of items.slice(r * 2, r * 2 + 2)) button(b, items.length - r * 2 === 1 ? L.lw - 24 : bw2); }, { spacing: 10, width: L.lw - 24 });
        }
      } else ui.row("tray-row", () => { for (const b of items) button(b); }, { spacing: 10, justify: "center", width: L.lw - 24 });
    }, { style: "tray", width: L.lw, spacing: 10, padding: L.short ? { top: 4, bottom: 4, start: 12, end: 12 } : undefined });
  });
  rect(tray);
  lastSize.set("tray", tray.height / sc);

  // ---- rails
  if (L.wide) {
    railPanel("rail-left", "top-start", "rail-left", barH, rw, bh, (w) => objectiveRail(w));
    railPanel("rail-right", "top-end", "rail-right", barH, rw, bh, (w) => gardenRail(w));
  } else if (app.railsOpen) {
    const w = Math.min(300, L.lw * 0.84);
    railPanel("drawer", "top-start", "drawer-left", barH, w, bh, (iw) => { objectiveRail(iw); ui.spacer(12); gardenRail(iw); });
  }

  // ---- the lesson coach (.coach)
  const step = s.mode === "learn" ? s.currentStep() : null;
  if (step && !app.screens.length) {
    const cwid = Math.min(520, bw * 0.92);
    const coach = ui.place("coach", { anchor: "bottom", x: (bx + bw / 2) - L.lw / 2, y: trayH + 14 }, () => {
      ui.column("coach-col", () => {
        para(T(step.text), cwid - 36, "coach-text", "coach-text");
        if (step.expect.type === "ack") ui.row("coach-row", () => { ui.spacer(); button({ id: "coach-ack", text: T("Continue"), style: "btn-primary", act: ackLesson }); }, { width: cwid - 36 });
      }, { style: "coach", width: cwid, spacing: 10 });
    });
    rect(coach);
  }
}
function railPanel(id: string, anchor: "top-start" | "top-end", cls: string, topY: number, w: number, h: number, build: (w: number) => void): void {
  const inner = w - 28;
  const scroll = (lastSize.get(id) ?? 0) > h - 32;
  const r = ui.place(id, { anchor, x: 0, y: topY }, () => {
    ui.column(id, () => {
      const body = (): void => {
        const c = ui.column(`${id}-in`, () => build(inner - (scroll ? 14 : 0)), { spacing: 8, width: inner - (scroll ? 14 : 0) });
        lastSize.set(id, c.height / ui.preferences().scale);
      };
      if (scroll) ui.scrollArea(`${id}-scroll`, { width: inner, height: h - 32 }, body);
      else body();
    }, { style: cls, width: w, height: h, spacing: 0 });
  });
  rect(r);
}
/** #rail-left: the objective, the foundation rings, the constraint. */
function objectiveRail(w: number): void {
  const s = app.session!;
  heading("rail-h3", T("Objective").toUpperCase(), w);
  para(objectiveText(), w, "rail-text", "rail-objective");
  const fl = s.state.foundations.map((p) => p.length);
  ui.row("rail-progress", () => {
    fl.forEach((n, i) => {
      ui.widget(T("{suit}: {n}/13", { suit: suitName(i), n }), {
        role: "image", size: { width: 34, height: 34 },
        draw: (r, stt) => {
          const k = stt.scale, cx = r.x + r.width / 2, cy = r.y + r.height / 2, R = 17 * k;
          draw.circle(cx, cy, R, token("line-14"));
          if (n > 0) draw.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + (n / 13) * Math.PI * 2, token("accent-2"));
          if (n > 0 && n < 13) draw.polygon([[cx, cy], [cx, cy - R], [cx + Math.sin((n / 13) * Math.PI * 2) * R, cy - Math.cos((n / 13) * Math.PI * 2) * R]], token("accent-2"));
          draw.circle(cx, cy, 12 * k, token("panel"));
          draw.text(Rules.SUIT_SYMBOLS[i]!, cx, cy - 6 * k, { size: 11 * k, color: token("text"), align: "center" });
        },
      });
    });
  }, { spacing: 8 });
  para(constraintText(), w, "rail-dim", "rail-constraint");
}
/** #rail-right: the seed, the assists and the keys. */
function gardenRail(w: number): void {
  const s = app.session!;
  heading("rail-h3", T("Garden").toUpperCase(), w);
  para(T("seed {seed}", { seed: s.state.seed.toString(16) }), w, "rail-mono", "rail-seed");
  para(T("assists: {undos} undo · {hints} hints", { undos: s.state.undos, hints: s.state.hints }), w, "rail-text", "rail-assists");
  ui.column("rail-keys", () => {
    for (const [action, word] of [["draw", N("draw")], ["undo", N("undo")], ["hint", N("hint")], ["autofinish", N("finish")]] as const) {
      ui.row(`key-${action}`, () => {
        ui.column(`kbd-${action}`, () => ui.style("kbd-text").label(keysFor(action)), { style: "kbd" });
        ui.style("keys-text").label(T(word));
      }, { spacing: 6, align: "center" });
    }
  }, { spacing: 4 });
}

/** The glasshouse's named targets: each pile's card or slot (the DOM board's buttons: screen readers and play scripts find them). */
function boardTargets(): void {
  const s = app.session;
  if (!s || app.screens.length) return;
  const st = s.state;
  const target = (name: string, loc: render.Loc): void => {
    const r = render.screenRect(loc);
    if (r && r.width > 0 && r.height > 0) ui.target(name, r, { role: "button" });
  };
  target(st.stock.length ? T("Stock, {n} cards. Activate to draw.", { n: st.stock.length }) : st.waste.length ? T("Stock empty. Activate to recycle the waste.") : T("Stock empty."), { zone: "stock", pile: 0 });
  if (st.waste.length) target(cardLabel(st.waste[st.waste.length - 1]!), { zone: "waste", pile: 0 });
  for (let f = 0; f < 4; f++) {
    const p = st.foundations[f]!;
    const name = T("Foundation {suit}", { suit: suitName(f) });
    target(p.length ? `${cardLabel(p[p.length - 1]!)}, ${name}` : name, { zone: "foundation", pile: f });
  }
  for (let p = 0; p < 7; p++) {
    const pile = st.tableau[p]!;
    if (!pile.length) { target(T("Row {n}, empty", { n: p + 1 }), { zone: "tableau", pile: p, index: -1 }); continue; }
    pile.forEach((e, i) => { if (e.up) target(cardLabel(e.c), { zone: "tableau", pile: p, index: i }); });
  }
}

// ------------------------------------------------------------------ toasts (#toast)
function toasts(L: Layout): void {
  if (!app.toast) return;
  const bottom = app.session && !(top() && PAGES.has(top()!.name)) ? (lastSize.get("tray") ?? 65) + 12 : 24;
  const w = Math.min(L.lw * 0.9, 480);
  ui.place("toast", { anchor: "bottom", y: bottom }, () =>
    ui.column("toast-col", () => para(app.toast!.text, w - 44, "toast-text", "toast-text"), { style: app.toast!.error ? "toast-error" : "toast", align: "center" }));
}

// ------------------------------------------------------------------ screens (index.html sections)
const WIDE = new Set(["modes", "journey", "learn", "settings", "help", "profile", "scores"]);
function screenTitle(s: Screen): string {
  switch (s.name) {
    case "title": return "Patience Garden";
    case "modes": return T("Choose your table");
    case "setup": return setupTitle(s.mode!);
    case "journey": return T("The Journey");
    case "learn": return T("Lessons");
    case "pause": return T("Paused");
    case "results": return app.results ? app.results().headline : "";
    case "settings": return T("Settings");
    case "help": return T("How to Play");
    case "profile": return T("Gardener Profile");
    case "scores": return T("Score Chase");
  }
}
function setupTitle(mode: SetupMode): string {
  if (mode === "practice") return T("Practice — pick a difficulty");
  if (mode === "challenge") return T("Challenges — constrained goals");
  if (mode === "daily") return T("Daily — {day}", { day: dailyInfo().day });
  if (mode === "journey") { const st = Content.journeyStage(nextJourneyIndex()); return T("Stage {n} — {title}", { n: st.index + 1, title: T(st.title) }); }
  return T("Score Chase — pick a table");
}
function screens(L: Layout): void {
  const s = top();
  if (!s) return;
  const f = frame();
  const outer = Math.min(WIDE.has(s.name) ? 860 : 560, L.lw - 32);
  const padX = L.lw < 700 ? 20 : 32;
  const inner = outer - 2 * padX - 4;
  const avail = Math.max(120, L.lh - 32);
  const key = `screen-${app.screens.length}-${s.name}`;
  const h = lastSize.get(key) ?? 0;
  const scroll = h > avail;
  const opening = f.frame - app.openedFrame <= 6;
  const title = screenTitle(s);
  const page = PAGES.has(s.name);
  // The screen's footer row (.row-end: Back, Begin, Done …) stays pinned under a scrolling body.
  const padY = L.lw < 700 ? 20 : 28;
  const footH = lastSize.get(`${key}-foot`) ?? 0;
  const open = (page ? ui.style("page-dialog") : ui).dialog(title, "", true, () => {
    ui.column(`${key}-col`, () => {
      const iw = inner - (scroll ? 14 : 0);
      footer = null;
      const body = (): void => {
        const r = ui.column(`${key}-body`, () => {
          if (s.name !== "title") heading("screen-title", title, iw, "screen-title");
          build(s, iw, L);
        }, { width: iw, spacing: 12 });
        lastSize.set(key, r.height / L.sc + footH + 2 * padY + 12);
      };
      if (scroll) ui.scrollArea(`${key}-scroll`, { width: inner, height: Math.max(80, avail - footH - 2 * padY - 12) }, body, opening ? { scrollTo: { top: 0 } } : undefined);
      else body();
      const f2 = footer as { id: string; list: Btn[] } | null;
      if (f2) { const r = flow(f2.id, f2.list, inner, 10, "end"); lastSize.set(`${key}-foot`, r.height / L.sc); }
      else lastSize.set(`${key}-foot`, 0);
    }, { style: "screen", width: outer, spacing: 12, padding: { top: padY, bottom: padY, start: padX, end: padX } });
  });
  // Back / Escape closes an overlay (not on the frame it opened); on a page it goes back a page.
  if (!open && fresh()) later(() => {
    if (s.name === "title") return;
    if (s.name === "results") { resultsAction("home"); return; }
    if (page) { showScreen({ name: s.name === "setup" && s.mode !== "journey" ? "modes" : "title" }); return; }
    closeTop();
  });
}
function build(s: Screen, w: number, L: Layout): void {
  switch (s.name) {
    case "title": titleScreen(w); break;
    case "modes": modesScreen(w); break;
    case "setup": setupScreen(s.mode!, w); break;
    case "journey": journeyScreen(w); break;
    case "learn": learnScreen(w); break;
    case "pause": pauseScreen(w); break;
    case "results": resultsScreen(w); break;
    case "settings": settingsScreen(w); break;
    case "help": helpScreen(w); break;
    case "profile": profileScreen(w); break;
    case "scores": scoresScreen(w); break;
  }
  void L;
}
const back = (to: "title" | "modes"): Btn => ({ id: "btn-back", text: T("← Back"), style: "btn-ghost", act: () => showScreen({ name: to }) });
let footer: { id: string; list: Btn[] } | null = null;
/** The screen's .row-end buttons, drawn pinned under its body (screens()). */
function rowEnd(id: string, list: Btn[], _w: number): void { footer = { id, list }; }

// ------------------------------------------------------------------ title (#screen-title)
function titleScreen(w: number): void {
  const save = platform.save();
  ui.column("title-hero", () => {
    para(T("A botanical glasshouse solitaire").toUpperCase(), w, "kicker", "title-kicker");
    const pw = textWidth("Patience ", "title-h1") + textWidth("Garden", "title-accent");
    if (pw <= w) ui.row("title-h1", () => { ui.style("title-h1").heading("Patience"); ui.style("title-accent").heading("Garden"); }, { spacing: 14 });
    else { ui.style("title-h1").heading("Patience"); ui.style("title-accent").heading("Garden"); }
    para(T("Build four foundations. Uncover the garden. Take your time."), Math.min(w, 420), "tagline", "title-tag");
  }, { width: w, align: "center", spacing: 6 });
  ui.row("title-play", () => {
    button({ id: "btn-play", text: hasSavedRound() ? T("Resume garden") : T("Play"), style: "btn-big", act: actions.play });
  }, { width: w, justify: "center" });
  const day = dailyInfo().day;
  const tiles: { id: string; ic: string; label: string; small: string; act: () => void }[] = [
    { id: "btn-daily", ic: "☀", label: T("Daily"), small: save.progress.dailies[day] ? T("done today ✓") : T("new today"), act: () => actions.quickStart("daily") },
    { id: "btn-journey", ic: "❀", label: T("Journey"), small: `${Object.keys(save.progress.journey).length}/${Content.JOURNEY.length}`, act: () => showScreen({ name: "journey" }) },
    { id: "btn-learn", ic: "✿", label: T("Learn"), small: "", act: () => showScreen({ name: "learn" }) },
  ];
  const tw = (w - 20) / 3;
  ui.row("title-grid", () => {
    for (const t of tiles) {
      button({
        id: t.id, text: t.label, style: "btn-tile", act: t.act,
        content: () => ui.column(`${t.id}-face`, () => {
          ui.style("tile-ic").label(t.ic);
          ui.style("tile-label").label(t.label);
          if (t.small) ui.style("tile-small").label(t.small);
        }, { align: "center", spacing: 2 }),
      }, tw);
    }
  }, { spacing: 10, width: w, align: "stretch" });
  const row: Btn[] = [
    { id: "btn-scores", text: `❦ ${T("Score Chase")}`, style: "btn-ghost", act: () => openOverlay({ name: "scores" }) },
    { id: "btn-profile", text: T("Profile"), style: "btn-ghost", act: () => openOverlay({ name: "profile" }) },
    { id: "btn-help", text: T("How to Play"), style: "btn-ghost", act: () => openOverlay({ name: "help" }) },
    { id: "btn-settings", text: T("Settings"), style: "btn-ghost", act: () => openOverlay({ name: "settings" }) },
  ];
  if (platform.inviteLink()) row.push({ id: "btn-invite", text: S("invite"), style: "btn-ghost", act: actions.invite });
  if (!platform.signedIn()) row.push({ id: "btn-signin", text: S("signIn"), style: "btn-ghost", act: actions.signIn });
  flow("title-row", row, w, 8);
  if (platform.signedIn()) {
    const sync = platform.syncState();
    const label = sync === "saving" ? T("saving…") : sync === "synced" ? T("cloud saved") : sync === "error" ? T("cloud save failed") : "";
    para(`❀ ${platform.displayName() || T("Player")}${label ? ` · ${label}` : ""}`, w, "player-line", "player-line");
  }
  para(T("Patience Garden · content v{version}", { version: Content.CONTENT_VERSION }), w, "build-note", "build-note");
}

// ------------------------------------------------------------------ mode select (#screen-modes)
function modesScreen(w: number): void {
  cardGrid("mode-list", Content.MODES.length, w, 220, 12, (i, cw) => {
    const m = Content.MODES[i]!;
    ui.column(`mode-${m.id}`, () => {
      ui.row(`mode-${m.id}-h`, () => {
        ui.style("mode-icon").label(m.icon);
        ui.spacer();
        button({ id: `mode-${m.id}-btn`, text: T(m.name), style: "btn-card", act: () => actions.modeSelect(m.id) });
      }, { width: cw - 32, align: "center" });
      para(T(m.blurb), cw - 32, "card-p");
      para([T("1 player"), T(m.duration), T("assists: {list}", { list: T(m.assists) })].join("   "), cw - 32, "meta");
    }, { style: "mode-card", width: cw, spacing: 6 });
  });
  rowEnd("modes-end", [back("title")], w);
}

// ------------------------------------------------------------------ setup (#screen-setup)
function pickGrid(id: string, items: { key: string; title: string; text: string; meta: string }[], chosen: string, w: number, pick: (k: string) => void): void {
  cardGrid(id, items.length, w, 220, 12, (i, cw) => {
    const it = items[i]!;
    button({
      id: `${id}-${it.key}`, text: it.title, style: "btn-pick", selected: it.key === chosen, act: () => pick(it.key),
      content: () => ui.column(`${id}-${it.key}-face`, () => {
        para(it.title, cw - 36, "h3");
        para(it.text, cw - 36, "card-p");
        if (it.meta) para(it.meta, cw - 36, "meta");
      }, { spacing: 6, width: cw - 34 }),
    }, cw);
  });
}
function ruleCard(id: string, demo: string, title: string, lines: [string, string][], w: number, demoCls = "demo-text"): void {
  const dw = 96;
  ui.row(id, () => {
    ui.column(`${id}-demo`, () => ui.style(demoCls).label(demo), { style: "demo", width: dw, height: 64, align: "center", justify: "center" });
    ui.column(`${id}-txt`, () => {
      para(title, w - dw - 40, "h4");
      for (const [t, cls] of lines) para(t, w - dw - 40, cls);
    }, { spacing: 4, width: w - dw - 40 });
  }, { style: "rule-card", width: w, spacing: 14 });
}
function setupScreen(mode: SetupMode, w: number): void {
  const su = app.setup;
  const save = platform.save();
  if (mode === "practice") {
    pickGrid("practice", Content.PRACTICE_LEVELS.map((l) => ({ key: l.id, title: T(l.label), text: T(l.text), meta: `${T("unrated")}   ${T("undo + hints allowed")}` })), su.level, w, (k) => { su.level = k; });
  } else if (mode === "challenge") {
    pickGrid("challenge", Content.CHALLENGES.map((c) => {
      const done = save.progress.challenges[c.id]?.completed;
      return { key: c.id, title: `${done ? "✓ " : ""}${T(c.name)}`, text: T(c.text), meta: `${T("~{n} min", { n: c.expectedMinutes })}${done ? `   ${T("best {score}", { score: save.progress.challenges[c.id]!.bestScore })}` : ""}` };
    }), su.challengeId, w, (k) => { su.challengeId = k; });
  } else if (mode === "daily") {
    const d = dailyInfo();
    ruleCard("daily-card", "☀", T("One garden, worldwide"), [
      [T("Everyone plays the same seed today. Draw 1, unlimited recycles. Undo and hints are allowed but flagged as assists on the board."), "card-p"],
      [T("seed {seed} · ruleset v{version}", { seed: d.seed.toString(16), version: d.version }), "mono"],
    ], w);
    para(T("Local board. Next daily in {time}.", { time: fmtTime(Content.msUntilNextDaily(platform.now())) }), w, "dim", "daily-countdown");
  } else if (mode === "journey") {
    const st = Content.journeyStage(nextJourneyIndex());
    ruleCard("stage-card", st.mastery ? "❀" : "❧", T(st.title), [
      [T(st.text), "card-p"],
      [T("Par: {moves} moves · about {min} min · {table}", { moves: st.par.moves, min: st.expectedMinutes, table: tableLabel(st.band, st.profile) }), "dim-small"],
    ], w);
  } else {
    const bands: [string, string][] = [["medium", "wildwood"], ["hard", "wildwood"], ["easy", "thicket"]];
    pickGrid("score", bands.map(([band, profile]) => ({
      key: `${band}/${profile}`, title: tableLabel(band, profile),
      text: T("A fixed, validated seed — difficulty: {band}. Local board; assists flagged.", { band: T(Content.BAND_LABELS[band]!) }), meta: "",
    })), `${su.scoreBand}/${su.scoreProfile}`, w, (k) => { const [b, p] = k.split("/"); su.scoreBand = b!; su.scoreProfile = p!; });
  }
  rowEnd("setup-end", [back(mode === "journey" ? "title" : "modes"), { id: "btn-start-game", text: T("Begin"), style: "btn-primary", act: () => actions.startSetup(mode) }], w);
}
function tableLabel(band: string, profile: string): string {
  return T("{band} {profile}", { band: T(Content.BAND_LABELS[band] ?? band), profile: T(Content.PROFILES[profile]?.label ?? profile) });
}

// ------------------------------------------------------------------ journey (#screen-journey) and learn
function journeyScreen(w: number): void {
  const p = platform.save().progress;
  para(T("Forty stages through the glasshouse. Mastery stages gate each act."), w, "dim");
  cardGrid("journey-map", Content.JOURNEY.length, w, 64, 10, (i, cw) => {
    const st = Content.JOURNEY[i]!;
    const rec = p.journey[st.id];
    const unlocked = i === 0 || !!p.journey[Content.JOURNEY[i - 1]!.id];
    const status = rec ? T("{n} stars.", { n: rec.stars }) : unlocked ? T("Unlocked.") : T("Locked.");
    const cls = !rec && unlocked ? "jnode-current" : st.mastery ? "jnode-mastery" : "jnode";
    const d = Math.min(cw, 76);
    const opts: ui.ButtonOptions = {
      content: () => ui.column(`j${i}-face`, () => {
        ui.style("jnode-n").label(String(i + 1));
        if (rec) ui.style("jnode-stars").label("★".repeat(rec.stars) + "☆".repeat(3 - rec.stars));
      }, { align: "center", spacing: 0 }),
    };
    if (!unlocked) opts.disabled = true;
    ui.column(`jcell-${i}`, () => {
      if (ui.style(cls, { width: d, height: d }).id(`stage-${i + 1}`).tooltip(`${T(st.title)} — ${T(Content.BAND_LABELS[st.band]!)}`)
        .button(T("Stage {n}: {title}. {status}", { n: i + 1, title: T(st.title), status }), opts) && fresh() && unlocked) later(() => actions.journeyPick(i));
    }, { width: cw, align: "center" });
  });
  rowEnd("journey-end", [back("title")], w);
}
function learnScreen(w: number): void {
  const p = platform.save().progress;
  para(T("One rule at a time. You perform each action yourself."), w, "dim");
  cardGrid("lesson-list", Content.LESSONS.length, w, 220, 12, (i, cw) => {
    const l = Content.LESSONS[i]!;
    const done = !!p.lessons[l.id];
    const title = `${done ? "✓ " : ""}${T(l.title)}`;
    button({
      id: `lesson-${i + 1}`, text: title, style: "btn-pick", selected: done, act: () => actions.lessonPick(l.id),
      content: () => ui.column(`lesson-${i}-face`, () => { para(title, cw - 36, "h3"); para(T("{n} guided steps", { n: l.steps.length }), cw - 36, "card-p"); }, { spacing: 6, width: cw - 34 }),
    }, cw);
  });
  rowEnd("learn-end", [back("title")], w);
}

// ------------------------------------------------------------------ pause (#screen-pause)
function pauseScreen(w: number): void {
  const bw = Math.min(w, 320);
  ui.column("pause-stack", () => {
    button({ id: "btn-resume", text: T("Resume"), style: "btn-big", act: () => { closeTop(); } }, bw);
    button({ id: "btn-pause-settings", text: T("Settings"), act: () => openOverlay({ name: "settings" }) }, bw);
    button({ id: "btn-pause-help", text: T("How to Play"), act: () => openOverlay({ name: "help" }) }, bw);
    button({ id: "btn-restart", text: T("Restart this deal"), act: restartGame }, bw);
    button({ id: "btn-leave", text: T("Leave game"), style: "btn-danger", act: leaveGame }, bw);
  }, { spacing: 10, width: w, align: "center" });
  void resumeGame;
}

// ------------------------------------------------------------------ results (#screen-results)
function resultsScreen(w: number): void {
  if (!app.results) return;
  const r = app.results();
  para(r.sub, w, "dim", "results-sub");
  if (r.stars) para("★".repeat(r.stars) + "☆".repeat(3 - r.stars), w, "stars", "results-stars");
  const b = r.breakdown;
  const rows: [string, string][] = b.rows.filter(([, v]) => v !== 0).map(([label, v]) => [T(label), `${v > 0 ? "+" : ""}${v}`]);
  rows.push([T("Moves"), String(b.moves)], [T("Time"), fmtTime(b.ms)], [T("Assists"), T("{undos} undo · {hints} hint · {invalids} invalid", { undos: b.undos, hints: b.hints, invalids: b.invalids })]);
  const c2 = Math.min(w * 0.5, Math.max(90, ...rows.map(([, v]) => textWidth(v, "score-num") + 14)));
  ui.column("results-table", () => {
    rows.forEach(([label, v], i) => ui.row(`res-${i}`, () => {
      ui.column(`res-${i}-a`, () => para(label, w - c2 - 16, "text"), { width: w - c2 });
      ui.column(`res-${i}-b`, () => para(v, c2 - 8, "score-num"), { width: c2, align: "end" });
    }, { style: "score-row", width: w, spacing: 0 }));
    ui.row("res-total", () => {
      ui.column("res-total-a", () => para(T("Total score"), w - c2 - 16, "total"), { width: w - c2 });
      ui.column("res-total-b", () => para(String(b.total), c2 - 8, "total-num", "results-total"), { width: c2, align: "end" });
    }, { style: "score-row-last", width: w, spacing: 0 });
  }, { width: w, spacing: 0 });
  para(r.progressNote, w, "dim", "results-progress");
  const lb = leaderboardLine();
  if (lb) para(lb, w, "dim", "results-lb");
  for (const [i, a] of r.achievements.entries()) {
    ui.column(`ach-pop-${i}`, () => para(`❀ ${T("{name} unlocked", { name: T(a) })}`, w - 30, "ach-text"), { style: "ach-pop" });
  }
  const list: Btn[] = [{ id: "btn-results-replay", text: `↻ ${T("Replay deal")}`, act: () => resultsAction("replay") }];
  if (r.nextLabel) list.push({ id: "btn-results-next", text: r.nextLabel, style: "btn-primary", act: () => resultsAction("next") });
  list.push({ id: "btn-results-home", text: T("Home"), style: "btn-ghost", act: () => resultsAction("home") });
  rowEnd("results-end", list, w);
}

// ------------------------------------------------------------------ settings (#screen-settings: the game's own; the rest is Options)
/** A labelled select (.setting with a <select>). */
function field(id: string, label: string, note: string, idx: number, options: string[], w: number, set: (i: number) => void): void {
  const sw = Math.min(260, w * 0.5);
  ui.row(`${id}-row`, () => {
    ui.column(`${id}-l`, () => { para(label, w - sw - 16, "text", `${id}-label`); if (note) para(note, w - sw - 16, "note"); }, { width: w - sw - 16, spacing: 2 });
    const pick = ui.id(id).select(label, idx, options, { width: sw } as ui.WidgetOptions);
    if (pick !== idx && fresh()) later(() => set(pick));
  }, { style: "setting-row", width: w, spacing: 16, align: "center" });
}
/** A check box with its label and note (wrapped; built-in check box labels don't). */
function toggle(id: string, label: string, note: string, on: boolean, w: number, set: (v: boolean) => void): void {
  const tw = w - 60;
  ui.row(`${id}-row`, () => {
    ui.column(`${id}-txt`, () => { para(T(label), tw, "text"); if (note) para(T(note), tw, "note"); }, { spacing: 2, width: tw });
    ui.spacer();
    const res = ui.id(id).widget(T(label), {
      role: "checkbox", checked: on, size: { width: 44, height: 44 }, description: note ? T(note) : undefined,
      draw: (r, st) => {
        const s = st.scale, box = 22 * s, bx = r.x + (r.width - box) / 2, by = r.y + (r.height - box) / 2;
        draw.roundRect(bx, by, box, box, 5 * s, on ? token("accent") : token("panel-2"));
        draw.strokeRoundRect(bx, by, box, box, 5 * s, token("line-25"), 1 * s);
        if (on) draw.text("✓", bx + box / 2, by + 1 * s, { size: 17 * s, color: "#201503", align: "center", weight: "bold" });
      },
    } as ui.WidgetSpec);
    if (res.activated && fresh()) later(() => set(!on));
  }, { style: "setting-row", width: w, spacing: 12, align: "center" });
}
const PALETTE_LABELS: [string, string][] = [["default", N("Default")], ["deuteranopia", N("Deuteranopia")], ["protanopia", N("Protanopia")], ["tritanopia", N("Tritanopia")]];
function settingsScreen(w: number): void {
  const o = platform.options;
  para(T("Sound, graphics, language, larger text, high contrast and reduced motion are in the StarHermit Options."), w, "dim", "options-note");
  flow("settings-runtime", [
    { id: "btn-options", text: T("Open Options"), act: () => openMenu() },
    { id: "btn-rebind", text: T("Key bindings"), act: () => requestRebind() },
  ], w, 10, "start");
  heading("section-h", T("Gameplay").toUpperCase(), w);
  field("set-interface", T("Interface"), T("2D is fully playable and works without WebGL."), o.interfaceMode === "2d" ? 1 : 0, [T("3D glasshouse"), T("2D cards")], w,
    (i) => platform.setOption("interfaceMode", i === 1 ? "2d" : "3d"));
  field("set-theme", T("Theme"), "", Math.max(0, Content.THEMES.findIndex((t) => t.id === o.theme)), Content.THEMES.map((t) => T(t.name)), w, (i) => {
    const id = Content.THEMES[i]!.id;
    if (Save.THEME_IDS.includes(id)) platform.setOption("theme", id);
  });
  heading("section-h", T("Accessibility").toUpperCase(), w);
  field("set-palette", T("Color-vision palette"), T("Suits are always labeled with symbols as well as color."), Math.max(0, PALETTE_LABELS.findIndex(([id]) => id === o.colorblindPalette)),
    PALETTE_LABELS.map(([, l]) => T(l)), w, (i) => platform.setOption("colorblindPalette", PALETTE_LABELS[i]![0]));
  toggle("set-left", N("Left-handed controls"), N("Mirrors the action tray."), o.leftHanded, w, (v) => platform.setOption("leftHanded", v));
  toggle("set-timing", N("Timing assistance"), N("Adds a grace buffer to timed challenges."), o.timingAssist, w, (v) => platform.setOption("timingAssist", v));
  toggle("set-haptics", N("Haptics"), N("Vibration feedback on supporting devices."), o.haptics, w, (v) => platform.setOption("haptics", v));
  toggle("set-drift", N("Camera idle drift"), "", o.cameraDrift, w, (v) => platform.setOption("cameraDrift", v));
  rowEnd("settings-end", [{ id: "btn-settings-close", text: T("Done"), style: "btn-primary", act: closeTop }], w);
}

// ------------------------------------------------------------------ help (#screen-help)
function helpScreen(w: number): void {
  const k = keysFor;
  para(plain(T("Build four <b>foundations</b> from Ace to King, one suit each. On the <b>tableau</b>, build <b>down</b> in <b>alternating colors</b>. Uncover every hidden card.")), w, "text", "help-intro");
  ruleCard("help-stock", "🂠", plain(T("Stock &amp; waste")), [[plain(T("Activate the stock ({key} or tap) to draw. When it runs out, tap again to recycle the waste — recycling costs points.", { key: k("draw") })), "card-p"]], w);
  ruleCard("help-runs", "8♥→9♠", T("Alternating runs"), [[T("Place a card on a tableau card one rank higher and of the opposite color. Face-up runs move together."), "card-p"]], w);
  ruleCard("help-kings", "K♣", T("Empty rows"), [[T("Only a King may move to an empty tableau row."), "card-p"]], w);
  ruleCard("help-found", "A♥→❀", T("Foundations"), [[T("Bank Aces first, then upward by suit. Double-tap a card to send it to its foundation. Banking early is usually safe."), "card-p"]], w);
  ruleCard("help-auto", "❀", T("Auto-finish"), [[T("When nothing is hidden and the stock is empty, Auto-finish ({key}) banks everything for you.", { key: k("autofinish") }), "card-p"]], w);
  heading("h3", T("Controls"), w);
  ruleCard("help-keys", "⌨", T("Keyboard"), [[plain(T("{left} {right} {up} {down} move focus between piles · {select} select or place · {draw} draw · {undo} undo · {hint} hint · {finish} auto-finish · {pause} pause.", {
    left: k("focus_left"), right: k("focus_right"), up: k("focus_up"), down: k("focus_down"), select: k("select"), draw: k("draw"), undo: k("undo"),
    hint: k("hint"), finish: k("autofinish"), pause: k("pause"),
  })), "card-p"]], w);
  ruleCard("help-pad", "🎮", T("Gamepad"), [[T("D-pad or left stick moves focus · A selects or places · B cancels or pauses · X undo · Y hint · Start pauses."), "card-p"]], w);
  ruleCard("help-touch", "👆", plain(T("Pointer &amp; touch")), [[T("Tap a card to select, tap a target to place — or drag runs directly. Double-tap banks to a foundation. Tap the stock to draw."), "card-p"]], w);
  ruleCard("help-assists", "✦", T("Assists"), [[T("Undo and Hint are always available in Practice and Journey. Assisted runs are flagged on the board."), "card-p"]], w);
  rowEnd("help-end", [{ id: "btn-help-close", text: T("Done"), style: "btn-primary", act: closeTop }], w);
}

// ------------------------------------------------------------------ profile (#screen-profile)
function twoCol(id: string, rows: [string, string][], w: number): void {
  const c2 = Math.min(w * 0.45, Math.max(80, ...rows.map(([, v]) => textWidth(v, "score-num") + 14)));
  ui.column(id, () => rows.forEach(([a, b], i) => ui.row(`${id}-${i}`, () => {
    ui.column(`${id}-${i}-a`, () => para(a, w - c2 - 16, "text"), { width: w - c2 });
    ui.column(`${id}-${i}-b`, () => para(b, c2 - 8, "score-num"), { width: c2, align: "end" });
  }, { style: i === rows.length - 1 ? "score-row-last" : "score-row", width: w, spacing: 0 })), { width: w, spacing: 0 });
}
function profileScreen(w: number): void {
  const save = platform.save();
  const st = save.stats, p = save.progress;
  if (platform.signedIn()) {
    heading("h3", T("Gardener"), w);
    para(`❀ ${platform.displayName() || T("Player")}`, w, "text", "profile-player");
  }
  heading("h3", T("Career"), w);
  twoCol("career", [
    [T("Games played"), String(st.games)], [T("Wins"), String(st.wins)], [T("Losses"), String(st.losses)], [T("Best streak"), String(st.bestStreak)],
    [T("Current streak"), String(st.streak)], [T("Cards banked"), String(st.foundationsBanked)], [T("Best score"), String(st.bestScore)],
    [T("Fastest win"), st.bestWinMs == null ? "—" : fmtTime(st.bestWinMs)], [T("Dailies completed"), String(st.dailyCompleted)],
    [T("Lessons completed"), `${Object.keys(p.lessons).length}/${Content.LESSONS.length}`], [T("Journey stages"), `${Object.keys(p.journey).length}/${Content.JOURNEY.length}`],
  ], w);
  heading("h3", T("Achievements"), w);
  for (const a of Content.ACHIEVEMENTS) {
    const un = !!save.achievements.unlocked[a.key];
    ruleCard(`ach-${a.key}`, un ? "❀" : "·", `${T(a.name)}${un ? " ✓" : ""}`, [[T(a.text), "card-p"]], w);
  }
  rowEnd("profile-end", [{ id: "btn-profile-close", text: T("Done"), style: "btn-primary", act: closeTop }], w);
}

// ------------------------------------------------------------------ Score Chase boards (#screen-scores)
let hosted: platform.HostedRow[] | null | undefined;
let hostedFor = -1;
function scoresScreen(w: number): void {
  para(T("Local leaderboard on validated seeds. Global boards activate when hosted."), w, "dim");
  if (platform.signedIn() && hostedFor !== app.openedFrame) { hostedFor = app.openedFrame; hosted = undefined; void platform.hostedBoard().then((r) => { hosted = r; }); }
  const entries = platform.save().scores.entries;
  const global = platform.signedIn() && hosted ? hosted : null;
  if (!entries.length && !global) para(T("No results yet. Play the Daily or a Score Chase table."), w, "dim", "scores-empty");
  const byMode: Record<string, typeof entries> = {};
  for (const e of entries) (byMode[e.mode] ||= []).push(e);
  const NAMES: Record<string, string> = { daily: N("Daily"), score: N("Score Chase") };
  for (const [mode, list] of Object.entries(byMode)) {
    const name = T(NAMES[mode] ?? mode);
    heading("h3", global ? T("{mode} — local", { mode: name }) : name, w);
    twoCol(`board-${mode}`, list.slice(0, 10).map((e, i) => [`${i + 1}. ${T("{n} pts", { n: e.score })}`, `${T("{n} moves", { n: e.moves })} · ${fmtTime(e.ms)}${e.assists ? ` · ${T("assists")}` : ""}`]), w);
  }
  if (global) {
    heading("h3", T("Global"), w);
    if (!global.length) para(T("No entries yet."), w, "dim");
    else twoCol("board-global", global.map((r) => [`${r.rank}. ${r.name || T("Player")}${r.me ? " ❀" : ""}`, T("{n} pts", { n: r.score })]), w);
  }
  rowEnd("scores-end", [{ id: "btn-scores-close", text: T("Done"), style: "btn-primary", act: closeTop }], w);
}

export type { Loc };
