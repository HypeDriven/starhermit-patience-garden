// The 2D card table (Settings › Interface: 2D cards), as the browser build's
// semantic DOM board (js/ui.js buildBoard / renderBoard2D, css/style.css
// .pcard): the stock, the waste fanned up to three cards, the four
// foundations and the seven rows as ui widgets — each card a button named
// for screen readers and play scripts ("Queen of Hearts"), each empty pile a
// button ("Row 3, empty") — with the selected run lifted and outlined, the
// legal targets glowing, the hinted card pulsing and the keyboard / pad pile
// focus framed. Covered cards take the pointer only on their visible strip
// (later widgets draw on top). A tap selects or places, a second tap within
// 0.4 s banks (main.ts tap), as the DOM board's click / dblclick did.
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { frame } from "starhermit:engine";
import { Content, Rules } from "./game.ts";
import { T, cardLabel, suitName } from "./i18n.ts";
import { app, fresh, kbTarget, later, legalTargetsForSelection, tap } from "./main.ts";
import * as platform from "./platform.ts";
import { token } from "./style.ts";

/** body.cb-* .pcard.red (css/style.css): suits keep their symbols; the red hue changes. */
const RED: Record<string, string> = { default: "#b03a2e", deuteranopia: "#8a5a00", protanopia: "#005a8a", tritanopia: "#a00050" };
const BLACK = "#23282e";

interface Box { x: number; y: number; w: number; h: number }
let n = 0;
/** A widget at a logical box inside the placed table. */
function widget(label: string, b: Box, role: "button" | "none", drawFn: (r: ui.Rect, s: number) => void, act?: () => void): void {
  const id = `b2d-${n++}`;
  ui.place(id, { anchor: "top-start", x: b.x, y: b.y }, () => {
    const res = ui.id(id).widget(label, { role, size: { width: Math.max(1, b.w), height: Math.max(1, b.h) }, draw: (r, st) => drawFn(r, st.scale) });
    if (act && res.activated && fresh()) later(act);
  });
}

/** Draws the table inside `region` (logical pixels, relative to the safe area). */
export function board2d(region: { x: number; y: number; width: number; height: number }): void {
  const s = app.session;
  if (!s) return;
  n = 0;
  const st = s.state;
  const theme = Content.themeById(platform.options.theme);
  const red = RED[platform.options.colorblindPalette] ?? RED.default!;
  const hc = ui.preferences().highContrast;
  const reduced = ui.preferences().reducedMotion;
  const t = frame().time;
  // sizeBoard2D: the card width from the region (38 … 96 logical px).
  const cw = Math.max(38, Math.floor(Math.min((region.width - 24 - 6 * 8) / 7, (region.height - 60) / 5.2, 96)));
  const ch = cw * 1.4, rad = cw * 0.11, gap = cw * 0.14;
  const upGap = cw * 0.32, downGap = cw * 0.14;
  const sel = app.selection;
  const targets = legalTargetsForSelection();
  const isTarget = (zone: string, pile: number): boolean => targets.some((x) => x.zone === zone && x.pile === pile);
  const hint = app.hintShown && app.hintShown.type === "move" ? app.hintShown.from : null;
  const kb = app.kbActive && !sel ? kbTarget() : null;

  const face = (r: ui.Rect, sc: number, card: number, opts: { lift?: boolean; hinted?: boolean }): void => {
    const y = r.y - (opts.lift ? ch * 0.1 * sc : 0);
    const W = cw * sc, H = ch * sc;
    draw.box(r.x, y, W, H, {
      background: "#f7f2e6", radius: rad, border: { width: hc ? 2 : 1, color: hc ? "#000000" : opts.lift ? token("accent") : "#00000040" },
      shadow: opts.lift ? { x: 0, y: 8, blur: 18, color: "#00000080" } : { x: 0, y: 2, blur: 5, color: "#00000059" },
    });
    const ink = Rules.colorOf(card) === "red" ? red : BLACK;
    const rank = Rules.RANK_LABELS[Rules.rankOf(card)]!, suit = Rules.SUIT_SYMBOLS[Rules.suitOf(card)]!;
    const fs = cw * 0.24 * sc;
    draw.text(rank, r.x + cw * 0.07 * sc + fs * 0.4, y + cw * 0.04 * sc, { size: fs, color: ink, weight: "bold", align: "center" });
    draw.text(suit, r.x + cw * 0.07 * sc + fs * 0.4, y + cw * 0.04 * sc + fs * 1.05, { size: cw * 0.22 * sc, color: ink, align: "center" });
    draw.text(rank, r.x + W - cw * 0.07 * sc - fs * 0.4, y + H - cw * 0.04 * sc - fs * 1.05, { size: fs, color: ink, weight: "bold", align: "center", rotation: Math.PI, origin: { x: r.x + W - cw * 0.07 * sc - fs * 0.4, y: y + H - cw * 0.04 * sc - fs * 0.55 } });
    draw.text(suit, r.x + W / 2, y + H / 2 - cw * 0.3 * sc, { size: cw * 0.52 * sc, color: ink, align: "center" });
    if (opts.hinted) {
      const k = reduced ? 1 : 0.5 + 0.5 * Math.sin(t * 7);
      draw.strokeRoundRect(r.x - 3 * sc, y - 3 * sc, W + 6 * sc, H + 6 * sc, rad * sc + 3 * sc, token("accent"), (2 + 3 * k) * sc);
    }
  };
  const back = (r: ui.Rect, sc: number): void => {
    const W = cw * sc, H = ch * sc;
    draw.box(r.x, r.y, W, H, {
      background: [
        { type: "linear", angle: 45, stops: [{ color: "#ffffff00", at: 0 }, { color: "#ffffff00", at: 6 }, { color: "#ffffff1a", at: 6 }, { color: "#ffffff1a", at: 8 }], repeating: true },
        { type: "linear", angle: 160, stops: [theme.cardBack[0], theme.cardBack[1]] },
      ],
      radius: rad, border: { width: hc ? 2 : 1, color: hc ? "#000000" : "#00000066" }, shadow: { x: 0, y: 2, blur: 5, color: "#00000059" },
    });
    draw.circle(r.x + W / 2, r.y + H / 2, W * 0.18, token("accent") + "8c");
  };
  /** An empty pile's dashed label (.pile-label) with the target glow / origin outline / pile focus. */
  const slot = (r: ui.Rect, sc: number, glyph: string, zone: string, pile: number, drawLabel: boolean): void => {
    const W = cw * sc, H = ch * sc;
    if (isTarget(zone, pile)) draw.box(r.x, r.y, W, H, { radius: rad, border: { width: 2, color: token("accent-2") }, shadow: { x: 0, y: 0, blur: 12, color: token("accent-2") + "99" } });
    else if (drawLabel) draw.box(r.x, r.y, W, H, { radius: rad, border: { width: 2, color: token("line-20") } });
    if (drawLabel && glyph) draw.text(glyph, r.x + W / 2, r.y + H / 2 - cw * 0.3 * sc, { size: cw * 0.5 * sc, color: token("line-25") === "#000000" ? "#ffffff55" : token("text") + "59", align: "center" });
  };
  const outline = (b: Box, color: string, width: number): void => {
    const id = `b2d-o${n++}`;
    ui.place(id, { anchor: "top-start", x: b.x - 4, y: b.y - 4 }, () => {
      ui.widget("", { role: "none", size: { width: 0, height: 0 }, draw: (r, s2) => draw.strokeRoundRect(r.x, r.y, (b.w + 8) * s2.scale, (b.h + 8) * s2.scale, (rad + 4) * s2.scale, color, width * s2.scale) });
    });
  };

  // ---- the rows' geometry (.dom-row: centered, gaps 0.14 cw; the tableau 0.18 cw below)
  const wasteW = cw * 1.56;
  const topW = cw + gap + wasteW + gap + cw * 0.8 + gap + 4 * cw + 3 * gap;
  const tabW = 7 * cw + 6 * gap;
  const x0 = region.x + Math.max(12, (region.width - Math.max(topW, tabW)) / 2);
  const top = { x: region.x + (region.width - topW) / 2, y: region.y + 12 };
  if (top.x < region.x + 4) top.x = region.x + 4;
  void x0;
  const stockBox: Box = { x: top.x, y: top.y, w: cw, h: ch };
  const wasteBox: Box = { x: top.x + cw + gap, y: top.y, w: wasteW, h: ch };
  const fBox = (i: number): Box => ({ x: wasteBox.x + wasteW + gap + cw * 0.8 + gap + i * (cw + gap), y: top.y, w: cw, h: ch });
  const tabY = top.y + ch + cw * 0.18;
  const tX = region.x + Math.max(4, (region.width - tabW) / 2);
  const tBox = (p: number): Box => ({ x: tX + p * (cw + gap), y: tabY, w: cw, h: ch });
  const availH = region.y + region.height - tabY - 8;

  // ---- stock
  const stockLabel = st.stock.length ? T("Stock, {n} cards. Activate to draw.", { n: st.stock.length })
    : st.waste.length ? T("Stock empty. Activate to recycle the waste.") : T("Stock empty.");
  widget(stockLabel, stockBox, "button", (r, sc) => {
    slot(r, sc, "⟳", "stock", 0, true);
    if (st.stock.length) back(r, sc);
  }, () => tap({ zone: "stock", pile: 0 }));
  if (kb?.zone === "stock") outline(stockBox, token("accent"), 3);

  // ---- waste (fan up to three)
  widget(T("Waste"), wasteBox, "none", (r, sc) => slot(r, sc, "", "waste", 0, false));
  const fan = st.waste.slice(-3);
  fan.forEach((c, i) => {
    const idx = st.waste.length - fan.length + i;
    const topCard = idx === st.waste.length - 1;
    const b: Box = { x: wasteBox.x + i * cw * 0.28, y: wasteBox.y, w: topCard ? cw : cw * 0.28, h: ch };
    const lift = !!sel && sel.zone === "waste";
    widget(cardLabel(c), b, "button", (r, sc) => face(r, sc, c, { lift: lift && topCard, hinted: !!hint && hint.zone === "waste" && topCard }),
      () => tap({ zone: "waste", pile: 0, index: idx }));
  });
  if (kb?.zone === "waste") outline(wasteBox, token("accent"), 3);
  if (sel?.zone === "waste") outline({ x: wasteBox.x + (fan.length - 1) * cw * 0.28, y: wasteBox.y - ch * 0.1, w: cw, h: ch }, token("accent"), 3);

  // ---- foundations
  for (let f = 0; f < 4; f++) {
    const b = fBox(f);
    const pile = st.foundations[f]!;
    const topCard = pile[pile.length - 1];
    const name = topCard !== undefined ? `${cardLabel(topCard)}, ${T("Foundation {suit}", { suit: suitName(f) })}` : T("Foundation {suit}", { suit: suitName(f) });
    const lift = sel?.zone === "foundation" && sel.pile === f;
    widget(name, b, "button", (r, sc) => {
      slot(r, sc, Rules.SUIT_SYMBOLS[f]!, "foundation", f, true);
      if (topCard !== undefined) face(r, sc, topCard, { lift, hinted: !!hint && hint.zone === "foundation" && hint.pile === f });
      if (topCard !== undefined && isTarget("foundation", f)) slot(r, sc, "", "foundation", f, false);
    }, () => tap(topCard !== undefined ? { zone: "foundation", pile: f, index: pile.length - 1 } : { zone: "foundation", pile: f, index: -1 }));
    if (kb?.zone === "foundation" && kb.pile === f) outline(b, token("accent"), 3);
  }

  // ---- the seven rows
  for (let p = 0; p < 7; p++) {
    const b = tBox(p);
    const pile = st.tableau[p]!;
    if (!pile.length) {
      widget(T("Row {n}, empty", { n: p + 1 }), b, "button", (r, sc) => slot(r, sc, "", "tableau", p, true), () => tap({ zone: "tableau", pile: p, index: -1 }));
    } else {
      widget("", b, "none", (r, sc) => slot(r, sc, "", "tableau", p, false));
      let total = 0;
      for (let i = 1; i < pile.length; i++) total += pile[i - 1]!.up ? upGap : downGap;
      const k = total + ch > availH && total > 0 ? Math.max(0.35, (availH - ch) / total) : 1;
      let y = b.y;
      pile.forEach((e, i) => {
        const last = i === pile.length - 1;
        const step = last ? ch : (e.up ? upGap : downGap) * k;
        const lift = !!sel && sel.zone === "tableau" && sel.pile === p && i >= (sel.index ?? 0);
        const hinted = !!hint && hint.zone === "tableau" && hint.pile === p && (hint.index ?? pile.length - 1) === i;
        const label = e.up ? cardLabel(e.c) : T("Face-down card");
        const cardY = y;
        widget(label, { x: b.x, y: cardY, w: cw, h: Math.max(4, step) }, "button", (r, sc) => {
          if (e.up) face(r, sc, e.c, { lift, hinted }); else back(r, sc);
        }, () => tap({ zone: "tableau", pile: p, index: i }));
        y += last ? 0 : step;
      });
      if (isTarget("tableau", p)) outline({ x: b.x, y: b.y, w: cw, h: y - b.y + ch }, token("accent-2"), 2);
      if (sel?.zone === "tableau" && sel.pile === p) outline({ x: b.x, y: b.y - ch * 0.1, w: cw, h: y - b.y + ch }, token("accent"), 3);
    }
    if (kb?.zone === "tableau" && kb.pile === p) {
      let h = ch;
      let total = 0;
      for (let i = 1; i < pile.length; i++) total += pile[i - 1]!.up ? upGap : downGap;
      const k = total + ch > availH && total > 0 ? Math.max(0.35, (availH - ch) / total) : 1;
      h += total * k;
      outline({ x: b.x, y: b.y, w: cw, h }, token("accent"), 3);
    }
  }
}
