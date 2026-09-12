// Patience Garden — 3D renderer (Three.js r160, vendored).
// Self-contained presentation module: it owns a botanical glasshouse scene,
// procedural cards (canvas textures), pile layout, picking, drag/selection
// feedback, hints, and tiered event VFX. All card positions derive from the
// rules-engine snapshot passed to setState(); the renderer keeps only
// presentation state (tweens, markers, particles).
//
// Export: createRenderer(opts) -> renderer  (see README of the API below).

import * as THREE from '../vendor/three.module.js';

// ---------------------------------------------------------------------------
// Constants — card metrics, layout, art palette
// ---------------------------------------------------------------------------

const CARD_W = 1.0;
const CARD_H = 1.4;
const CARD_R = 0.09;   // corner radius
const CARD_T = 0.024;  // thickness

const COL_STEP = 1.22;        // horizontal distance between tableau columns
const Z_TOP = -4.6;           // z of the stock/waste/foundation row (card centres)
const Z_TAB0 = -3.35;         // z of the first card in a tableau pile
const TAB_FAN_MAX = 7.0;      // max vertical fan depth for a tableau pile
const UP_GAP = 0.42;          // fan spacing after a face-up card
const DOWN_GAP = 0.26;        // fan spacing after a face-down card
const STACK_DY = 0.03;        // vertical step per card within a pile
const STOCK_DY = 0.016;       // thinner stacking for the face-down stock
const FAN_X = 0.38;           // waste fan step (draw-3)
const FELT_Y = 0.0;           // playing surface height
const CARD_Y0 = 0.028;        // rest height of the first card in a pile
const DRAG_Y = 0.85;          // height of cards while dragged
const SEL_LIFT = 0.24;        // selection lift

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUIT_GLYPHS = ['\u2660', '\u2665', '\u2666', '\u2663']; // ♠ ♥ ♦ ♣
const INK_RED = '#b03428';
const INK_BLACK = '#262630';

const TILT = 0.88;            // camera elevation from horizontal (radians, ~50°)

// ---------------------------------------------------------------------------
// Small utilities (no per-frame allocation: temps live at module scope)
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);
const easeInOutCubic = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _s1 = new THREE.Vector3(1, 1, 1);
const _e1 = new THREE.Euler();
const _ndc = new THREE.Vector2();
const _planePoint = new THREE.Vector3();
const UP_AXIS = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Canvas texture painting — card faces, backs, pockets, sprites, sky
// ---------------------------------------------------------------------------

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Classic pip arrangements, indexed by rank-1 ('2'..'10'). [x, y, inverted]
const PIPS = (() => {
  const L = 0.3, R = 0.7, M = 0.5;
  const four = [[L, 0.15, 1], [R, 0.15, 1], [L, 0.85], [R, 0.85]];
  const six = [[L, 0.15, 1], [R, 0.15, 1], [L, 0.5], [R, 0.5], [L, 0.85], [R, 0.85]];
  return {
    1: [[M, 0.15, 1], [M, 0.85]],
    2: [[M, 0.15, 1], [M, 0.5], [M, 0.85]],
    3: four,
    4: [...four, [M, 0.5]],
    5: six,
    6: [...six, [M, 0.32, 1]],
    7: [...six, [M, 0.32, 1], [M, 0.68]],
    8: [[L, 0.14, 1], [R, 0.14, 1], [L, 0.38, 1], [R, 0.38, 1], [M, 0.5],
        [L, 0.62], [R, 0.62], [L, 0.86], [R, 0.86]],
    9: [[L, 0.13, 1], [R, 0.13, 1], [M, 0.25, 1], [L, 0.37, 1], [R, 0.37, 1],
        [L, 0.63], [R, 0.63], [M, 0.75], [L, 0.87], [R, 0.87]],
  };
})();

function drawLaurel(ctx, cx, cy, radius, color) {
  // Two symmetric sprays of small leaves framing the centre motif.
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  for (const side of [-1, 1]) {
    const a0 = side < 0 ? Math.PI * 0.72 : Math.PI * 0.28;
    const a1 = side < 0 ? Math.PI * 1.28 : -Math.PI * 0.28;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, Math.min(a0, a1), Math.max(a0, a1));
    ctx.globalAlpha = 0.35;
    ctx.stroke();
    for (let i = 0; i <= 6; i++) {
      const a = a0 + (a1 - a0) * (i / 6);
      const lx = cx + Math.cos(a) * radius;
      const ly = cy + Math.sin(a) * radius;
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(a + (side < 0 ? -0.7 : 0.7) + Math.PI / 2);
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, 4.5, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
}

function drawCorner(ctx, x, y, label, glyph, ink) {
  // Larger index than a printed deck: the exposed strip of a stacked card is
  // all a phone player sees, so rank and suit must read at ~40px card widths.
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 54px Georgia, "Times New Roman", serif';
  ctx.fillText(label, x, y);
  ctx.font = '46px Georgia, "DejaVu Sans", serif';
  ctx.fillText(glyph, x + (label.length > 1 ? 62 : 52), y);
}

function paintFaceTexture(cardId) {
  const W = 256, H = 364;
  const cv = makeCanvas(W, H);
  const ctx = cv.getContext('2d');
  const suit = Math.floor(cardId / 13);
  const rank = cardId % 13;
  const ink = (suit === 1 || suit === 2) ? INK_RED : INK_BLACK;
  const glyph = SUIT_GLYPHS[suit];
  const label = RANKS[rank];

  // ivory stock with a soft top-light gradient
  const g = ctx.createLinearGradient(0, 0, W * 0.3, H);
  g.addColorStop(0, '#fbf7ec');
  g.addColorStop(1, '#efe6d2');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // border rules
  roundedRectPath(ctx, 7, 7, W - 14, H - 14, 16);
  ctx.strokeStyle = 'rgba(96,74,44,0.4)';
  ctx.lineWidth = 3;
  ctx.stroke();
  roundedRectPath(ctx, 14, 14, W - 28, H - 28, 11);
  ctx.strokeStyle = 'rgba(96,74,44,0.18)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // corner indices (both orientations)
  drawCorner(ctx, 36, 40, label, glyph, ink);
  ctx.save();
  ctx.translate(W - 36, H - 40);
  ctx.rotate(Math.PI);
  drawCorner(ctx, 0, 0, label, glyph, ink);
  ctx.restore();

  const cx = W / 2, cy = H / 2;
  if (rank >= 1 && rank <= 9) {
    // small pips for 2..10
    const areaW = W * 0.56, areaH = H * 0.62;
    ctx.fillStyle = ink;
    ctx.font = '40px Georgia, "DejaVu Sans", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [px, py, flip] of PIPS[rank]) {
      ctx.save();
      ctx.translate(cx + (px - 0.5) * areaW, cy + (py - 0.5) * areaH);
      if (flip) ctx.rotate(Math.PI);
      ctx.fillText(glyph, 0, 0);
      ctx.restore();
    }
  } else if (rank === 0) {
    // Ace: large centred suit with laurel
    drawLaurel(ctx, cx, cy, 92, '#7d9b6a');
    ctx.fillStyle = ink;
    ctx.font = '150px Georgia, "DejaVu Sans", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, cx, cy + 6);
  } else {
    // Court cards: medallion with letter, suit and laurel (no portrait art).
    drawLaurel(ctx, cx, cy, 96, '#7d9b6a');
    ctx.beginPath();
    ctx.arc(cx, cy, 66, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,252,244,0.7)';
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 56, 0, Math.PI * 2);
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 74px Georgia, serif';
    ctx.fillText(label, cx, cy - 12);
    ctx.font = '44px Georgia, "DejaVu Sans", serif';
    ctx.fillText(glyph, cx, cy + 36);
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function paintLeaf(ctx, x, y, len, wid, angle, fill) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(0, -len / 2);
  ctx.quadraticCurveTo(wid, -len * 0.1, 0, len / 2);
  ctx.quadraticCurveTo(-wid, -len * 0.1, 0, -len / 2);
  ctx.fill();
  ctx.restore();
}

function paintBackTexture(theme) {
  const W = 256, H = 364;
  const cv = makeCanvas(W, H);
  const ctx = cv.getContext('2d');
  const [c0, c1] = theme.cardBack;

  ctx.fillStyle = c0;
  ctx.fillRect(0, 0, W, H);

  // diagonal vine lattice
  ctx.strokeStyle = c1;
  ctx.globalAlpha = 0.16;
  ctx.lineWidth = 2;
  for (let d = -H; d < W + H; d += 30) {
    ctx.beginPath(); ctx.moveTo(d, 0); ctx.lineTo(d + H, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(d + H, 0); ctx.lineTo(d, H); ctx.stroke();
  }
  // leaves at lattice nodes
  ctx.globalAlpha = 0.5;
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 6; gx++) {
      if ((gx + gy) % 2 === 0) continue;
      const x = 24 + gx * 42, y = 26 + gy * 44;
      paintLeaf(ctx, x, y, 20, 7, (gx * 0.9 + gy * 0.6) % Math.PI, c1);
    }
  }
  // central medallion flower
  ctx.globalAlpha = 0.75;
  const cx = W / 2, cy = H / 2;
  for (let i = 0; i < 6; i++) {
    paintLeaf(ctx, cx + Math.cos(i * Math.PI / 3) * 22, cy + Math.sin(i * Math.PI / 3) * 22,
      30, 10, i * Math.PI / 3 + Math.PI / 2, c1);
  }
  ctx.globalAlpha = 0.9;
  ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fillStyle = c1; ctx.fill();

  // border
  ctx.globalAlpha = 0.9;
  roundedRectPath(ctx, 8, 8, W - 16, H - 16, 15);
  ctx.strokeStyle = c1;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.globalAlpha = 0.35;
  roundedRectPath(ctx, 17, 17, W - 34, H - 34, 10);
  ctx.lineWidth = 2;
  ctx.stroke();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function paintPocketTexture(suit) {
  // Recessed foundation pocket: dark inset + faint suit silhouette.
  const W = 128, H = 180;
  const cv = makeCanvas(W, H);
  const ctx = cv.getContext('2d');
  roundedRectPath(ctx, 3, 3, W - 6, H - 6, 12);
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  ctx.fill();
  roundedRectPath(ctx, 8, 8, W - 16, H - 16, 9);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,250,235,0.20)';
  ctx.font = '76px Georgia, "DejaVu Sans", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(SUIT_GLYPHS[suit], W / 2, H / 2 + 4);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function paintFeltTexture(hex) {
  // woven felt: soft centre light, darker edges, faint fibre speckle
  const S = 512;
  const cv = makeCanvas(S, S);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, S, S);
  const g = ctx.createRadialGradient(S * 0.5, S * 0.42, S * 0.1, S * 0.5, S * 0.5, S * 0.72);
  g.addColorStop(0, 'rgba(255,250,235,0.10)');
  g.addColorStop(0.55, 'rgba(255,250,235,0.02)');
  g.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const rnd = mulberry32(99);
  for (let i = 0; i < 2200; i++) {
    const x = rnd() * S, y = rnd() * S;
    ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.03)';
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function paintStockSlotTexture() {
  const W = 128, H = 180;
  const cv = makeCanvas(W, H);
  const ctx = cv.getContext('2d');
  roundedRectPath(ctx, 4, 4, W - 8, H - 8, 12);
  ctx.strokeStyle = 'rgba(255,250,235,0.22)';
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 7]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,250,235,0.30)';
  ctx.font = '64px Georgia, "DejaVu Sans", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('\u21BB', W / 2, H / 2 + 2); // ↻ redeal hint
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function paintSkyTexture(theme) {
  const cv = makeCanvas(32, 512);
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  // warm theme glow sits low (the visible horizon band behind the glasshouse)
  g.addColorStop(0, shade(theme.sky[1], -0.15));
  g.addColorStop(0.55, theme.sky[1]);
  g.addColorStop(0.88, theme.sky[0]);
  g.addColorStop(1, theme.sky[0]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 512);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function paintSoftDotTexture() {
  const cv = makeCanvas(64, 64);
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,244,214,1)');
  g.addColorStop(0.4, 'rgba(255,244,214,0.5)');
  g.addColorStop(1, 'rgba(255,244,214,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function paintPetalTexture(theme) {
  const cv = makeCanvas(64, 64);
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 6, 0, 58);
  g.addColorStop(0, theme.accent);
  g.addColorStop(0.45, theme.leaf);
  g.addColorStop(1, shade(theme.leaf, -0.3));
  paintLeaf(ctx, 32, 32, 52, 16, 0, g);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// lighten/darken a #rrggbb colour by amount in [-1, 1]
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = amt < 0 ? 0 : 255;
  const p = Math.abs(amt);
  r = Math.round(r + (f - r) * p);
  g = Math.round(g + (f - g) * p);
  b = Math.round(b + (f - b) * p);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

// Card body: thin rounded-rect extrusion. The bottom cap carries the card-back
// texture (top cap is hidden beneath the face overlay mesh).
function buildCardBodyGeometry() {
  const shape = roundedRectShape(CARD_W, CARD_H, CARD_R);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: CARD_T,
    bevelEnabled: false,
    curveSegments: 6,
    UVGenerator: {
      generateTopUV(geometry, vertices, indexA, indexB, indexC) {
        const uv = (i) => new THREE.Vector2(
          vertices[i * 3] / CARD_W + 0.5,
          vertices[i * 3 + 1] / CARD_H + 0.5);
        return [uv(indexA), uv(indexB), uv(indexC)];
      },
      generateSideWallUV() {
        return [new THREE.Vector2(0, 0), new THREE.Vector2(1, 0),
          new THREE.Vector2(1, 1), new THREE.Vector2(0, 1)];
      },
    },
  });
  geo.translate(0, 0, -CARD_T / 2);
  return geo;
}

function buildCardFaceGeometry() {
  const geo = new THREE.ShapeGeometry(roundedRectShape(CARD_W, CARD_H, CARD_R), 6);
  // ShapeGeometry UVs are raw shape coords; remap to 0..1.
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, pos.getX(i) / CARD_W + 0.5, pos.getY(i) / CARD_H + 0.5);
  }
  return geo;
}

function frameShape(w, h, r, inset) {
  // Rounded-rect outline (shape with a hole) for empty tableau columns.
  const s = roundedRectShape(w, h, r);
  const hole = roundedRectShape(w - inset * 2, h - inset * 2, Math.max(0.02, r - inset));
  s.holes.push(hole);
  return s;
}

// ---------------------------------------------------------------------------
// createRenderer
// ---------------------------------------------------------------------------

export function createRenderer(opts) {
  const canvas = opts.canvas;
  let theme = opts.theme;
  let quality = opts.quality || 'medium';
  let reducedMotion = !!opts.reducedMotion;
  const rng = mulberry32(opts.seed || 1);

  // --- WebGL bootstrap (caller falls back to DOM rendering on failure) -----
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    if (!renderer.getContext()) throw new Error('no context');
  } catch (e) {
    throw new Error('webgl-unavailable');
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false; // stats() reads counts after render; reset per frame

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 120);
  const camTarget = new THREE.Vector3(0, 0, -0.45);
  const camBase = new THREE.Vector3();

  // --- Lighting -------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(theme.sky[0], '#3a2f26', 0.65);
  scene.add(hemi);

  const keyLight = new THREE.DirectionalLight('#ffd9a8', 1.7);
  keyLight.position.set(6, 12, 5);
  keyLight.castShadow = quality === 'high';
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -9; keyLight.shadow.camera.right = 9;
  keyLight.shadow.camera.top = 9; keyLight.shadow.camera.bottom = -9;
  keyLight.shadow.camera.near = 2; keyLight.shadow.camera.far = 32;
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.02;
  scene.add(keyLight);
  scene.add(keyLight.target);

  const accentLight = new THREE.PointLight(theme.accent, 14, 18, 2);
  accentLight.position.set(-3, 3.2, 2.5);
  scene.add(accentLight);
  const accentBase = accentLight.intensity;

  // --- Themed material registry (retargeted by setTheme) --------------------
  const themed = {
    feltMats: [], feltDeepMats: [], woodMats: [], leafMats: [], potMats: [],
    backMats: [], pocketMats: [], frameMats: [],
  };
  let feltTex = null, feltTexDeep = null;

  // --- Shared textures -------------------------------------------------------
  const faceTextures = new Map(); // cardId -> CanvasTexture (theme independent)
  let backTex = paintBackTexture(theme);
  let skyTex = paintSkyTexture(theme);
  let petalTex = paintPetalTexture(theme);
  const softDotTex = paintSoftDotTexture();
  const pocketTex = [0, 1, 2, 3].map(paintPocketTexture);
  const stockSlotTex = paintStockSlotTexture();
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  for (const t of [backTex, skyTex]) t.anisotropy = maxAniso;

  function faceTextureOf(id) {
    let tex = faceTextures.get(id);
    if (!tex) {
      tex = paintFaceTexture(id);
      tex.anisotropy = maxAniso;
      faceTextures.set(id, tex);
    }
    return tex;
  }

  // --- Environment: sky backdrop, floor, table, glasshouse, plants ----------

  scene.background = new THREE.Color(theme.sky[1]);
  renderer.setClearColor(theme.sky[1], 1);
  scene.fog = new THREE.Fog(new THREE.Color(theme.sky[1]).multiplyScalar(0.55), 20, 48);

  const skyMat = new THREE.MeshBasicMaterial({ map: skyTex, fog: false });
  const skyPlane = new THREE.Mesh(new THREE.PlaneGeometry(64, 32), skyMat);
  skyPlane.position.set(0, 7, -11.5);
  scene.add(skyPlane);

  const floorMat = new THREE.MeshStandardMaterial({ color: '#2c332e', roughness: 1 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(15, 40), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -3.3;
  floor.receiveShadow = true;
  scene.add(floor);

  // Table: wood slab with felt-deep border and felt inlay, on a turned base.
  const tableGroup = new THREE.Group();
  scene.add(tableGroup);
  {
    const woodMat = new THREE.MeshStandardMaterial({ color: theme.table, roughness: 0.7, metalness: 0.05 });
    themed.woodMats.push(woodMat);
    const slabGeo = new THREE.ExtrudeGeometry(roundedRectShape(12.6, 15.2, 1.3), { depth: 0.4, bevelEnabled: false, curveSegments: 8 });
    slabGeo.translate(0, 0, -0.2);
    const slab = new THREE.Mesh(slabGeo, woodMat);
    slab.rotation.x = -Math.PI / 2;
    slab.position.set(0, -0.10 - 0.2, -0.45);
    slab.castShadow = true;
    slab.receiveShadow = true;
    tableGroup.add(slab);

    // turned pedestal (lathe) + floor foot
    const prof = [
      new THREE.Vector2(1.55, 0), new THREE.Vector2(1.6, 0.1), new THREE.Vector2(0.62, 0.22),
      new THREE.Vector2(0.45, 0.6), new THREE.Vector2(0.52, 1.7), new THREE.Vector2(1.05, 2.5),
      new THREE.Vector2(1.3, 2.66), new THREE.Vector2(1.28, 2.8),
    ];
    const pedestal = new THREE.Mesh(new THREE.LatheGeometry(prof, 24), woodMat);
    pedestal.position.set(0, -3.3, -0.45);
    pedestal.castShadow = false; // card shadows are the readable ones; keep env out of the shadow pass
    tableGroup.add(pedestal);

    const remapUv = (geo, w, h) => {
      const pos = geo.attributes.position, uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
      return geo;
    };

    feltTexDeep = paintFeltTexture(theme.feltDeep);
    feltTexDeep.anisotropy = maxAniso;
    const deepMat = new THREE.MeshStandardMaterial({ map: feltTexDeep, roughness: 0.95 });
    themed.feltDeepMats.push(deepMat);
    const deep = new THREE.Mesh(remapUv(new THREE.ShapeGeometry(roundedRectShape(11.4, 14.0, 1.1), 8), 11.4, 14.0), deepMat);
    deep.rotation.x = -Math.PI / 2;
    deep.position.set(0, -0.02, -0.45);
    deep.receiveShadow = true;
    tableGroup.add(deep);

    feltTex = paintFeltTexture(theme.felt);
    feltTex.anisotropy = maxAniso;
    const feltMat = new THREE.MeshStandardMaterial({ map: feltTex, roughness: 0.98 });
    themed.feltMats.push(feltMat);
    const felt = new THREE.Mesh(remapUv(new THREE.ShapeGeometry(roundedRectShape(10.7, 13.3, 0.95), 8), 10.7, 13.3), feltMat);
    felt.rotation.x = -Math.PI / 2;
    felt.position.set(0, FELT_Y, -0.45);
    felt.receiveShadow = true;
    tableGroup.add(felt);
  }

  // Glasshouse: iron mullion posts, arches, beams, faint glass sheen.
  const glasshouse = new THREE.Group();
  scene.add(glasshouse);
  {
    const ironMat = new THREE.MeshStandardMaterial({ color: '#2a2d2b', roughness: 0.55, metalness: 0.6 });
    const postGeo = new THREE.BoxGeometry(0.16, 8.4, 0.16);
    for (const px of [-8, -4, 0, 4, 8]) {
      const post = new THREE.Mesh(postGeo, ironMat);
      post.position.set(px, 0.9, -8.6);
      glasshouse.add(post);
    }
    const beamGeo = new THREE.BoxGeometry(16.4, 0.14, 0.14);
    for (const by of [2.2, 5.1]) {
      const beam = new THREE.Mesh(beamGeo, ironMat);
      beam.position.set(0, by, -8.6);
      glasshouse.add(beam);
    }
    const archGeo = new THREE.TorusGeometry(1.98, 0.09, 8, 28, Math.PI);
    for (const ax of [-6, -2, 2, 6]) {
      const arch = new THREE.Mesh(archGeo, ironMat);
      arch.position.set(ax, 5.1, -8.6);
      glasshouse.add(arch);
    }
    // roof ridge hint
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(16.4, 0.12, 0.12), ironMat);
    ridge.position.set(0, 7.15, -8.6);
    glasshouse.add(ridge);
    const glassMat = new THREE.MeshBasicMaterial({
      color: '#ffffff', transparent: true, opacity: 0.055, depthWrite: false,
    });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(16.4, 8.4), glassMat);
    glass.position.set(0, 0.9, -8.66);
    glasshouse.add(glass);
  }

  // Plants — procedural pots, deformed foliage blobs, ferns, hanging vines.
  const envCore = new THREE.Group();
  const envExtra = new THREE.Group();
  scene.add(envCore, envExtra);
  const leafMat = new THREE.MeshStandardMaterial({ color: theme.leaf, roughness: 0.9, side: THREE.DoubleSide });
  const leafMat2 = new THREE.MeshStandardMaterial({ color: shade(theme.leaf, -0.25), roughness: 0.9, side: THREE.DoubleSide });
  themed.leafMats.push(leafMat, leafMat2);
  const potMat = new THREE.MeshStandardMaterial({ color: '#9a5a3a', roughness: 0.85 });
  themed.potMats.push(potMat);
  const soilMat = new THREE.MeshStandardMaterial({ color: '#2e2119', roughness: 1 });

  // Plants — procedural pots/foliage, consolidated into one InstancedMesh per
  // part type so the whole garden costs ~8 draw calls instead of dozens.
  // Deterministic placement comes from the deal seed (opts.seed).
  const potGeo = new THREE.LatheGeometry([
    new THREE.Vector2(0.34, 0), new THREE.Vector2(0.42, 0.04), new THREE.Vector2(0.5, 0.42),
    new THREE.Vector2(0.56, 0.5), new THREE.Vector2(0.58, 0.58), new THREE.Vector2(0.5, 0.58),
  ], 18);
  const soilGeo = new THREE.CircleGeometry(0.46, 14);
  const blobGeo = new THREE.IcosahedronGeometry(0.55, 1);
  {
    // organic blob: jitter vertices once, reuse for every bush
    const pos = blobGeo.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const j = 1 + (rng() - 0.5) * 0.42;
      pos.setXYZ(v, pos.getX(v) * j, pos.getY(v) * j * 0.85, pos.getZ(v) * j);
    }
    blobGeo.computeVertexNormals();
  }
  const coneGeo = new THREE.ConeGeometry(0.5, 0.62, 9);
  const bladeGeo = new THREE.PlaneGeometry(0.22, 1.5, 1, 5);
  {
    // fern blade: base at origin, tips curl outward
    const pos = bladeGeo.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v) + 0.75;
      pos.setY(v, y);
      pos.setZ(v, Math.pow(y / 1.5, 2) * 0.55);
    }
    bladeGeo.computeVertexNormals();
  }

  const PLANT_MAX = 8;
  const pots = new THREE.InstancedMesh(potGeo, potMat, PLANT_MAX);
  const soils = new THREE.InstancedMesh(soilGeo, soilMat, PLANT_MAX);
  const blobsA = new THREE.InstancedMesh(blobGeo, leafMat, 8);
  const blobsB = new THREE.InstancedMesh(blobGeo, leafMat2, 8);
  const conesA = new THREE.InstancedMesh(coneGeo, leafMat, 8);
  const conesB = new THREE.InstancedMesh(coneGeo, leafMat2, 8);
  const bladesA = new THREE.InstancedMesh(bladeGeo, leafMat, 16);
  const bladesB = new THREE.InstancedMesh(bladeGeo, leafMat2, 16);
  const plantMeshes = { core: [], extra: [] };
  for (const m of [pots, soils, blobsA, blobsB, conesA, conesB, bladesA, bladesB]) {
    m.count = 0;
    m.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  }
  soils.count = pots.count = 0;
  const counters = { pot: 0, soil: 0, blobA: 0, blobB: 0, coneA: 0, coneB: 0, bladeA: 0, bladeB: 0 };

  function setInst(mesh, idx, px, py, pz, euler, sx, sy, sz) {
    _v1.set(px, py, pz);
    _q1.setFromEuler(euler);
    _s1.set(sx, sy, sz);
    _m1.compose(_v1, _q1, _s1);
    mesh.setMatrixAt(idx, _m1);
  }

  const _identityEuler = new THREE.Euler();
  const _flatEuler = new THREE.Euler(-Math.PI / 2, 0, 0);
  const _e2 = new THREE.Euler();

  function makePlant(x, z, s, kind, extra) {
    const y0 = -3.3;
    setInst(pots, counters.pot++, x, y0, z, _identityEuler, s, s, s);
    setInst(soils, counters.soil++, x, y0 + 0.55 * s, z, _flatEuler, s, s, s);
    if (kind === 0) {
      for (let i = 0; i < 4; i++) {
        const r = 0.42 + rng() * 0.3;
        _e2.set(rng() * 0.4, rng() * Math.PI, rng() * 0.4);
        setInst(i % 2 ? blobsA : blobsB, i % 2 ? counters.blobA++ : counters.blobB++,
          x + (rng() - 0.5) * 0.5 * s, y0 + (0.85 + i * 0.32 + rng() * 0.15) * s, z + (rng() - 0.5) * 0.5 * s,
          _e2, r * s / 0.55, r * s / 0.55, r * s / 0.55);
      }
    } else if (kind === 1) {
      for (let i = 0; i < 4; i++) {
        const r = 0.62 - i * 0.12;
        _e2.set(0, rng() * Math.PI, 0);
        setInst(i % 2 ? conesA : conesB, i % 2 ? counters.coneA++ : counters.coneB++,
          x, y0 + (0.9 + i * 0.42) * s, z, _e2, r * s / 0.5, s, r * s / 0.5);
      }
    } else {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + rng() * 0.4;
        _e2.set(-0.5 - rng() * 0.3, a, 0, 'YXZ');
        _q1.setFromEuler(_e2);
        _v2.set(0, 0.4 * s, 0).applyQuaternion(_q1);
        setInst(i % 2 ? bladesA : bladesB, i % 2 ? counters.bladeA++ : counters.bladeB++,
          x + _v2.x, y0 + 0.56 * s + _v2.y, z + _v2.z, _e2, s, s, s);
      }
    }
    (extra ? plantMeshes.extra : plantMeshes.core); // grouping handled via env groups below
  }

  {
    const spots = [
      // two flank the table's far corners so foliage crests above the rim;
      // the rest sit at the visible floor edges
      [-5.7, -6.3, 1.7, 0, false], [5.8, -6.5, 1.9, 1, false], [-6.5, -0.6, 1.3, 2, false],
      [6.6, 0.6, 1.4, 2, true], [5.8, 4.9, 1.1, 0, true], [-6.1, 4.6, 1.2, 1, true],
    ];
    for (const [x, z, s, kind, extra] of spots) makePlant(x, z, s, kind, extra);
    pots.count = counters.pot; soils.count = counters.soil;
    blobsA.count = counters.blobA; blobsB.count = counters.blobB;
    conesA.count = counters.coneA; conesB.count = counters.coneB;
    bladesA.count = counters.bladeA; bladesB.count = counters.bladeB;
    envCore.add(pots, soils, blobsA, blobsB, conesA, conesB);
    // extra-tier foliage lives in envExtra so setQuality('low') can hide it
    envExtra.add(bladesA, bladesB);
  }

  // Hanging vines: tube stems + one InstancedMesh for all leaves (1 draw call).
  const vineLeaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.16, 0.26), leafMat, 40);
  vineLeaves.count = 0;
  envExtra.add(vineLeaves);
  let vineLeafCount = 0;

  function makeVine(x, z, len) {
    const g = new THREE.Group();
    const pts = [];
    const n = 6;
    for (let i = 0; i <= n; i++) {
      pts.push(new THREE.Vector3(
        x + Math.sin(i * 1.7 + x) * 0.22,
        2.7 - (i / n) * len,
        z + Math.cos(i * 2.1 + x) * 0.16));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const stem = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.028, 5), leafMat2);
    g.add(stem);
    for (let i = 1; i <= 10 && vineLeafCount < 40; i++) {
      const p = curve.getPoint(i / 11);
      _e1.set(rng() * 0.9 - 0.45, rng() * Math.PI, rng() * 0.9 - 0.45);
      _q1.setFromEuler(_e1);
      _s1.setScalar(1);
      _m1.compose(p, _q1, _s1);
      vineLeaves.setMatrixAt(vineLeafCount++, _m1);
    }
    return g;
  }

  {
    envExtra.add(makeVine(-3.2, -8.4, 2.2));
    envExtra.add(makeVine(2.6, -8.4, 2.6));
    envExtra.add(makeVine(5.4, -8.4, 1.8));
    vineLeaves.count = vineLeafCount;
    vineLeaves.instanceMatrix.needsUpdate = true;
  }

  // --- Ambient dust motes (pooled Points, bounded drift) ---------------------
  const MOTE_MAX = 200;
  const moteGeo = new THREE.BufferGeometry();
  const motePos = new Float32Array(MOTE_MAX * 3);
  const moteVel = new Float32Array(MOTE_MAX * 3);
  for (let i = 0; i < MOTE_MAX; i++) {
    motePos[i * 3] = (rng() - 0.5) * 17;
    motePos[i * 3 + 1] = 0.3 + rng() * 5.5;
    motePos[i * 3 + 2] = -7.5 + rng() * 13;
    moteVel[i * 3] = (rng() - 0.5) * 0.12;
    moteVel[i * 3 + 1] = 0.04 + rng() * 0.08;
    moteVel[i * 3 + 2] = (rng() - 0.5) * 0.1;
  }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const moteMat = new THREE.PointsMaterial({
    size: 0.07, map: softDotTex, transparent: true, opacity: 0.5,
    depthWrite: false, blending: THREE.AdditiveBlending, color: '#ffe9c0',
  });
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.frustumCulled = false;
  scene.add(motes);

  // --- Dust puff pool (place/flip feedback) ----------------------------------
  const PUFF_MAX = 48;
  const puffGeo = new THREE.BufferGeometry();
  const puffPos = new Float32Array(PUFF_MAX * 3);
  const puffVel = new Float32Array(PUFF_MAX * 3);
  const puffLife = new Float32Array(PUFF_MAX); // remaining seconds, 0 = dead
  puffGeo.setAttribute('position', new THREE.BufferAttribute(puffPos, 3));
  const puffMat = new THREE.PointsMaterial({
    size: 0.16, map: softDotTex, transparent: true, opacity: 0.55,
    depthWrite: false, color: '#e8dcc2',
  });
  const puff = new THREE.Points(puffGeo, puffMat);
  puff.frustumCulled = false;
  puffGeo.setDrawRange(0, 0);
  scene.add(puff);

  function spawnPuff(x, y, z, count, spread) {
    let placed = 0;
    for (let i = 0; i < PUFF_MAX && placed < count; i++) {
      if (puffLife[i] > 0) continue;
      puffPos[i * 3] = x + (rng() - 0.5) * 0.5;
      puffPos[i * 3 + 1] = y + rng() * 0.1;
      puffPos[i * 3 + 2] = z + (rng() - 0.5) * 0.5;
      puffVel[i * 3] = (rng() - 0.5) * spread;
      puffVel[i * 3 + 1] = 0.35 + rng() * 0.5;
      puffVel[i * 3 + 2] = (rng() - 0.5) * spread;
      puffLife[i] = 0.55 + rng() * 0.25;
      placed++;
    }
  }

  // --- Win petals (pooled InstancedMesh) --------------------------------------
  const PETAL_MAX = 300;
  const petalGeo = new THREE.PlaneGeometry(0.17, 0.24);
  const petalMat = new THREE.MeshBasicMaterial({
    map: petalTex, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const petals = new THREE.InstancedMesh(petalGeo, petalMat, PETAL_MAX);
  petals.count = 0;
  petals.frustumCulled = false;
  petals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(petals);
  const petalState = []; // {x,y,z,vx,vy,vz,rx,ry,rz,spin,sway,life}
  for (let i = 0; i < PETAL_MAX; i++) {
    petalState.push({ x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, spin: 0, sway: 0, life: 0 });
    petals.setColorAt(i, new THREE.Color('#ffffff'));
  }
  let petalCap = 300;
  let petalActive = 0;
  let petalSpawnLeft = 0;

  // --- Cards -----------------------------------------------------------------
  const cardBodyGeo = buildCardBodyGeometry();
  const cardFaceGeo = buildCardFaceGeometry();
  const edgeMat = new THREE.MeshStandardMaterial({ color: '#efe7d2', roughness: 0.85 });
  const backCapMat = new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.85 });
  themed.backMats.push(backCapMat);

  const cardsRoot = new THREE.Group();
  scene.add(cardsRoot);
  const cards = new Map();   // cardId -> card record
  const locMap = new Map();  // "zone/pile/index" -> card record

  function createCard(id) {
    const faceMat = new THREE.MeshStandardMaterial({
      map: faceTextureOf(id), roughness: 0.8, metalness: 0.0,
      polygonOffset: true, polygonOffsetFactor: -1,
    });
    const group = new THREE.Group();
    const inner = new THREE.Group();
    inner.rotation.x = -Math.PI / 2;
    group.add(inner);
    const body = new THREE.Mesh(cardBodyGeo, [backCapMat, edgeMat]);
    body.castShadow = true;
    inner.add(body);
    const face = new THREE.Mesh(cardFaceGeo, faceMat);
    face.position.z = CARD_T / 2 + 0.002;
    inner.add(face);
    cardsRoot.add(group);
    const card = {
      id, group, inner, body, face, faceMat,
      pose: { x: 0, y: 0, z: 0, rot: Math.PI },   // current presented pose
      target: null,                                // snapshot-derived pose
      tween: null,
      zone: null, pile: 0, index: 0, up: false,
      interactive: false, selected: false, dragK: -1,
      shakeT0: -1, pulseT0: -1,
    };
    body.userData.card = card;
    return card;
  }

  // --- Layout: snapshot -> world poses (single source of truth) --------------
  const tabX = (p) => (p - 3) * COL_STEP;
  const foundX = (s) => s * COL_STEP;
  const STOCK_X = tabX(0);
  const WASTE_X = tabX(1);

  let lastSnapshot = null;
  let lastMovePos = { x: 0, z: 0 };
  let lastMoveCard = null;
  let dealt = false;
  let layoutMaxZ = 4.35;

  // per-pile drop position for markers: [{x,z} x7 tableau, x4 foundation]
  const dropPos = { tableau: [], foundation: [] };
  for (let p = 0; p < 7; p++) dropPos.tableau.push({ x: tabX(p), z: Z_TAB0 });
  for (let s = 0; s < 4; s++) dropPos.foundation.push({ x: foundX(s), z: Z_TOP });

  function computeTargets(state) {
    const targets = new Map();
    let maxTabZ = Z_TAB0 + 0.7; // deepest tableau card bottom edge this layout
    const stockN = state.stock.length;
    state.stock.forEach((id, i) => {
      targets.set(id, {
        x: STOCK_X, y: CARD_Y0 + i * STOCK_DY, z: Z_TOP, rot: Math.PI,
        zone: 'stock', pile: 0, index: i, up: false,
        interactive: i === stockN - 1,
        hidden: i < stockN - 4, // buried stock cards are invisible: skip their draw calls
      });
    });
    const w = state.waste, wn = w.length;
    const draw3 = state.ruleset && state.ruleset.drawCount === 3;
    const shown = draw3 ? Math.min(3, wn) : Math.min(1, wn);
    w.forEach((id, i) => {
      const k = i - (wn - shown); // fanned position for visible cards
      targets.set(id, {
        x: k >= 0 ? WASTE_X + k * FAN_X : WASTE_X,
        y: CARD_Y0 + i * STACK_DY, z: Z_TOP, rot: 0,
        zone: 'waste', pile: 0, index: i, up: true,
        interactive: k >= 0,
      });
    });
    state.foundations.forEach((pile, s) => {
      pile.forEach((id, i) => {
        targets.set(id, {
          x: foundX(s), y: CARD_Y0 + i * STACK_DY, z: Z_TOP, rot: 0,
          zone: 'foundation', pile: s, index: i, up: true,
          interactive: i === pile.length - 1,
        });
      });
    });
    state.tableau.forEach((pile, p) => {
      // fan depth, compressed if the pile grows beyond the available run
      let total = 0;
      const gaps = [];
      for (let i = 1; i < pile.length; i++) {
        const gp = pile[i - 1].up ? UP_GAP : DOWN_GAP;
        gaps.push(gp); total += gp;
      }
      const scale = total > TAB_FAN_MAX ? TAB_FAN_MAX / total : 1;
      let z = Z_TAB0;
      pile.forEach((e, i) => {
        if (i > 0) z += gaps[i - 1] * scale;
        targets.set(e.c, {
          x: tabX(p), y: CARD_Y0 + i * STACK_DY, z, rot: e.up ? 0 : Math.PI,
          zone: 'tableau', pile: p, index: i, up: e.up,
          interactive: e.up,
        });
      });
      dropPos.tableau[p] = pile.length
        ? { x: tabX(p), z }
        : { x: tabX(p), z: Z_TAB0 };
      maxTabZ = Math.max(maxTabZ, (pile.length ? z : Z_TAB0) + 0.7);
    });
    layoutMaxZ = maxTabZ;
    return targets;
  }

  function posesDiffer(a, b) {
    return Math.abs(a.x - b.x) > 1e-4 || Math.abs(a.y - b.y) > 1e-4 ||
      Math.abs(a.z - b.z) > 1e-4 || Math.abs(a.rot - b.rot) > 1e-4;
  }

  function startTween(card, to, delay, dur, arc) {
    card.tween = {
      t0: simTime + delay, dur: Math.max(0.01, dur),
      fx: card.pose.x, fy: card.pose.y, fz: card.pose.z, fr: card.pose.rot,
      x: to.x, y: to.y, z: to.z, r: to.rot, arc,
    };
    card.target = { ...to };
  }

  function setState(snapshot, sopts) {
    const instant = !!(sopts && sopts.instant);
    lastSnapshot = snapshot;
    const targets = computeTargets(snapshot);
    const isDeal = !dealt && !instant;
    dealt = true;
    locMap.clear();

    // deal order: tableau piles first (in deal order), then the rest
    const orderOf = (t) => t.zone === 'tableau' ? t.pile * 32 + t.index
      : t.zone === 'stock' ? 300 + t.index
      : t.zone === 'waste' ? 400 + t.index : 500 + t.pile * 16 + t.index;
    const ordered = [...targets.entries()].sort((a, b) => orderOf(a[1]) - orderOf(b[1]));

    let delayIdx = 0;
    let moved = null;
    for (const [id, t] of ordered) {
      let card = cards.get(id);
      if (!card) card = createCard(id);
      cards.set(id, card);
      locMap.set(`${t.zone}/${t.pile}/${t.index}`, card);
      card.zone = t.zone; card.pile = t.pile; card.index = t.index;
      card.up = t.up; card.interactive = t.interactive;
      card.hidden = !!t.hidden;

      if (card.dragK >= 0) {
        // mid-drag: retarget silently; the drag pose stays in control until release
        card.target = { ...t };
      } else if (instant) {
        card.tween = null;
        card.target = { ...t };
        card.pose = { x: t.x, y: t.y, z: t.z, rot: t.rot };
      } else if (isDeal) {
        // deal-in: cards start stacked above the stock and arc out to their places
        card.pose = { x: STOCK_X, y: 0.7, z: Z_TOP, rot: Math.PI };
        const dur = reducedMotion ? 0.18 : 0.7;
        const delay = reducedMotion ? 0 : delayIdx++ * 0.035;
        startTween(card, t, delay, dur, reducedMotion ? 0.15 : 1.3);
      } else if (!card.target || posesDiffer(card.target, t)) {
        const dist = Math.hypot(t.x - card.pose.x, t.z - card.pose.z);
        const flipOnly = dist < 0.01;
        let dur = flipOnly ? 0.5 : Math.min(0.32 + dist * 0.07, 0.85);
        let arc = flipOnly ? 0.32 : Math.min(0.4 + dist * 0.12, 1.5);
        if (reducedMotion) { dur *= 0.35; arc *= 0.2; }
        startTween(card, t, 0, dur, arc);
        if (!flipOnly) {
          moved = card;
        }
      }
    }
    if (moved) {
      lastMoveCard = moved;
      lastMovePos = { x: moved.target.x, z: moved.target.z };
    }

    // cards absent from the snapshot (ruleset change): remove their meshes
    for (const [id, card] of cards) {
      if (!targets.has(id)) {
        cardsRoot.remove(card.group);
        card.faceMat.dispose();
        cards.delete(id);
      }
    }

    // stock redeal slot visible only when the stock is empty
    stockSlot.visible = snapshot.stock.length === 0;

    // refit the camera if the tableau grew/shrank meaningfully, keeping a
    // pile-growth headroom buffer so lengthening piles stay in frame
    const needFit = layoutMaxZ + 0.8;
    if (Math.abs(needFit - fitBottomZ) > 0.6) {
      fitBottomZ = needFit;
      refit();
    }
  }

  // --- Slot meshes: foundation pockets, tableau frames, stock slot -----------
  // These double as explicit interaction meshes (pickable even when empty).
  const slotMeshes = [];

  function flatPlane(w, h, mat, x, z, y) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    return m;
  }

  const pockets = [];
  for (let s = 0; s < 4; s++) {
    const mat = new THREE.MeshBasicMaterial({
      map: pocketTex[s], transparent: true, depthWrite: false,
    });
    themed.pocketMats.push(mat);
    const m = flatPlane(CARD_W, CARD_H, mat, foundX(s), Z_TOP, 0.006);
    m.userData.slot = { zone: 'foundation', pile: s, index: -1 };
    scene.add(m);
    pockets.push(m);
    slotMeshes.push(m);
  }

  const frameMat = new THREE.MeshBasicMaterial({
    color: shade(theme.feltDeep, -0.25), transparent: true, opacity: 0.55, depthWrite: false,
  });
  themed.frameMats.push(frameMat);
  const frameGeo = new THREE.ShapeGeometry(frameShape(CARD_W + 0.08, CARD_H + 0.08, CARD_R + 0.03, 0.055), 6);
  // one instanced mesh for all seven column frames; instanceId = pile index
  const frameMesh = new THREE.InstancedMesh(frameGeo, frameMat, 7);
  for (let p = 0; p < 7; p++) {
    _e1.set(-Math.PI / 2, 0, 0);
    _q1.setFromEuler(_e1);
    _v1.set(tabX(p), 0.006, Z_TAB0);
    _s1.setScalar(1);
    _m1.compose(_v1, _q1, _s1);
    frameMesh.setMatrixAt(p, _m1);
  }
  frameMesh.userData.slotFrames = true;
  scene.add(frameMesh);
  slotMeshes.push(frameMesh);

  const stockSlot = flatPlane(CARD_W, CARD_H,
    new THREE.MeshBasicMaterial({ map: stockSlotTex, transparent: true, depthWrite: false }),
    STOCK_X, Z_TOP, 0.006);
  stockSlot.userData.slot = { zone: 'stock', pile: 0, index: -1 };
  stockSlot.visible = false;
  scene.add(stockSlot);
  slotMeshes.push(stockSlot);

  // --- Grounded markers: selection, legal targets, hint ----------------------
  const markerRingGeo = new THREE.RingGeometry(0.62, 0.76, 40);
  const markerDiscGeo = new THREE.CircleGeometry(0.85, 36);

  function makeMarker(color, withDisc) {
    const g = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.7, depthWrite: false,
    });
    const ring = new THREE.Mesh(markerRingGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.scale.set(1, 1.35, 1); // local y maps to world z after the flat rotation
    g.add(ring);
    let disc = null;
    if (withDisc) {
      disc = new THREE.Mesh(markerDiscGeo, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.14, depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      disc.rotation.x = -Math.PI / 2;
      disc.scale.set(1, 1.35, 1);
      g.add(disc);
    }
    g.position.y = 0.012;
    g.visible = false;
    scene.add(g);
    return { group: g, ring, disc, mat: ringMat, phase: rng() * Math.PI * 2 };
  }

  const selMarker = makeMarker(theme.accent, true);
  const legalMarkers = [];
  for (let i = 0; i < 12; i++) legalMarkers.push(makeMarker('#8fce6e', false));
  const hintFromMarker = makeMarker(theme.accent, false);
  const hintToMarker = makeMarker(theme.accent, false);
  const stockHintMarker = makeMarker(theme.accent, false);
  stockHintMarker.group.position.set(STOCK_X, 0.012, Z_TOP);

  // hint guide: dashed arc + travelling arrowhead
  const hintLineMat = new THREE.LineDashedMaterial({
    color: theme.accent, dashSize: 0.16, gapSize: 0.12, transparent: true, opacity: 0.85,
  });
  const hintLine = new THREE.Line(new THREE.BufferGeometry(), hintLineMat);
  hintLine.visible = false;
  hintLine.frustumCulled = false;
  scene.add(hintLine);
  const hintCone = new THREE.Mesh(
    new THREE.ConeGeometry(0.09, 0.26, 10),
    new THREE.MeshBasicMaterial({ color: theme.accent, transparent: true, opacity: 0.95 }));
  hintCone.visible = false;
  scene.add(hintCone);
  let hintCurve = null;

  function locPos(loc) {
    // world position of a {zone,pile,index?} reference, from current layout
    if (loc.zone === 'stock') return { x: STOCK_X, z: Z_TOP };
    if (loc.zone === 'waste') {
      const n = lastSnapshot ? lastSnapshot.waste.length : 0;
      if (n > 0) {
        const c = locMap.get(`waste/0/${n - 1}`);
        if (c) return { x: c.target.x, z: c.target.z };
      }
      return { x: WASTE_X, z: Z_TOP };
    }
    if (loc.zone === 'foundation') return { x: foundX(loc.pile), z: Z_TOP };
    // tableau
    if (loc.index != null) {
      const c = locMap.get(`tableau/${loc.pile}/${loc.index}`);
      if (c) return { x: c.target.x, z: c.target.z };
    }
    return dropPos.tableau[loc.pile] || { x: tabX(loc.pile), z: Z_TAB0 };
  }

  function runCardsAt(loc) {
    // cards of the movable run starting at loc (mirrors rules.resolveRun)
    if (!lastSnapshot) return [];
    const out = [];
    if (loc.zone === 'waste') {
      const n = lastSnapshot.waste.length;
      if (n > 0) {
        const c = locMap.get(`waste/0/${n - 1}`);
        if (c) out.push(c);
      }
    } else if (loc.zone === 'foundation') {
      const pile = lastSnapshot.foundations[loc.pile] || [];
      const c = locMap.get(`foundation/${loc.pile}/${pile.length - 1}`);
      if (c) out.push(c);
    } else if (loc.zone === 'tableau') {
      const pile = lastSnapshot.tableau[loc.pile] || [];
      const start = loc.index == null ? pile.length - 1 : loc.index;
      for (let i = start; i < pile.length; i++) {
        const c = locMap.get(`tableau/${loc.pile}/${i}`);
        if (c) out.push(c);
      }
    }
    return out;
  }

  // --- Selection / drag state --------------------------------------------------
  let selection = null;   // {cards:[...], from}
  let drag = null;        // {cards:[...], x, z}

  function clearSelection() {
    if (!selection) return;
    for (const c of selection.cards) c.selected = false;
    selection = null;
    selMarker.group.visible = false;
  }

  function setSelection(sel) {
    clearSelection();
    if (!sel) return;
    const run = runCardsAt(sel);
    if (run.length === 0) return;
    selection = { cards: run, from: sel };
    for (const c of run) c.selected = true;
    const p = locPos(sel);
    selMarker.group.position.set(p.x, 0.012, p.z);
    selMarker.group.visible = true;
    // input ack: small scale pulse on the grabbed run
    for (const c of run) c.pulseT0 = simTime;
  }

  function setDragged(info) {
    if (drag) {
      // release: fly the dragged cards back to their snapshot poses
      for (const c of drag.cards) {
        c.pose.x = drag.x;
        c.pose.y = DRAG_Y + c.dragK * 0.05;
        c.pose.z = drag.z + c.dragK * UP_GAP * 0.92;
        c.pose.rot = 0;
        c.dragK = -1;
        if (c.target) startTween(c, c.target, 0, reducedMotion ? 0.08 : 0.3, 0.25);
      }
      drag = null;
    }
    if (!info) return;
    const run = runCardsAt(info.from);
    if (run.length === 0) return;
    drag = { cards: run, x: info.x, z: info.z };
    run.forEach((c, i) => { c.dragK = i; c.tween = null; });
  }

  function setLegalTargets(targets) {
    for (const m of legalMarkers) m.group.visible = false;
    if (!targets) return;
    targets.slice(0, legalMarkers.length).forEach((t, i) => {
      const p = locPos(t);
      legalMarkers[i].group.position.set(p.x, 0.012, p.z);
      legalMarkers[i].group.visible = true;
    });
  }

  function setHint(hint) {
    hintFromMarker.group.visible = false;
    hintToMarker.group.visible = false;
    stockHintMarker.group.visible = false;
    hintLine.visible = false;
    hintCone.visible = false;
    hintCurve = null;
    if (!hint) return;
    if (hint.draw) {
      stockHintMarker.group.visible = true;
      return;
    }
    const a = locPos(hint.from);
    const b = locPos(hint.to);
    hintFromMarker.group.position.set(a.x, 0.012, a.z);
    hintFromMarker.group.visible = true;
    hintToMarker.group.position.set(b.x, 0.012, b.z);
    hintToMarker.group.visible = true;
    hintCurve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(a.x, 0.3, a.z),
      new THREE.Vector3((a.x + b.x) / 2, 1.7, (a.z + b.z) / 2),
      new THREE.Vector3(b.x, 0.3, b.z));
    hintLine.geometry.dispose();
    hintLine.geometry = new THREE.BufferGeometry().setFromPoints(hintCurve.getPoints(32));
    hintLine.computeLineDistances();
    hintLine.visible = true;
    hintCone.visible = true;
  }

  // --- Events: tiered VFX ------------------------------------------------------
  let winT0 = -1; // simTime of win start, -1 = idle

  function playEvent(evt) {
    if (!evt) return;
    if (evt.type === 'win') {
      winT0 = simTime;
      if (!reducedMotion) {
        petalSpawnLeft = Math.min(petalCap, PETAL_MAX);
      }
    } else if (evt.type === 'place') {
      spawnPuff(lastMovePos.x, 0.15, lastMovePos.z, 12, 1.4);
      if (lastMoveCard) lastMoveCard.pulseT0 = simTime;
    } else if (evt.type === 'flip') {
      spawnPuff(lastMovePos.x, 0.25, lastMovePos.z, 6, 0.7);
    } else if (evt.type === 'invalid') {
      const targets = (selection && selection.cards.length)
        ? selection.cards
        : (lastMoveCard ? [lastMoveCard] : []);
      for (const c of targets) c.shakeT0 = simTime;
    }
  }

  // --- Picking ------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(FELT_Y + CARD_Y0));
  const pickList = []; // reused scratch array (event-driven, not per-frame)

  function setNdc(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    _ndc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1);
  }

  function pick(clientX, clientY) {
    setNdc(clientX, clientY);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(_ndc, camera);
    pickList.length = 0;
    for (const m of slotMeshes) pickList.push(m);
    for (const card of cards.values()) {
      if (card.interactive && card.dragK < 0) pickList.push(card.body);
    }
    const hits = raycaster.intersectObjects(pickList, false);
    for (const h of hits) {
      const ud = h.object.userData;
      if (ud.card) {
        const c = ud.card;
        return { zone: c.zone, pile: c.pile, index: c.index };
      }
      if (ud.slotFrames) {
        return { zone: 'tableau', pile: h.instanceId, index: -1 };
      }
      if (ud.slot) {
        // only expose the stock slot when empty (redeal target)
        if (ud.slot.zone === 'stock' && lastSnapshot && lastSnapshot.stock.length > 0) continue;
        return { zone: ud.slot.zone, pile: ud.slot.pile, index: ud.slot.index };
      }
    }
    return null;
  }

  function pointerToWorld(clientX, clientY) {
    setNdc(clientX, clientY);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(_ndc, camera);
    if (raycaster.ray.intersectPlane(dragPlane, _planePoint)) {
      return { x: _planePoint.x, z: _planePoint.z };
    }
    return { x: 0, z: 0 };
  }

  // --- Per-frame presentation update -------------------------------------------
  let simTime = 0;
  let lastFrame = -1;
  let watchdog = 0;
  let rafId = 0;
  let paused = false;
  let disposed = false;
  let statCalls = 0, statTris = 0;

  function applyCard(card) {
    // tween evaluation (authored durations + easing; ends exactly on target)
    const tw = card.tween;
    if (tw) {
      let p = (simTime - tw.t0) / tw.dur;
      if (p >= 1) {
        card.pose.x = tw.x; card.pose.y = tw.y; card.pose.z = tw.z; card.pose.rot = tw.r;
        card.tween = null;
      } else {
        if (p < 0) p = 0;
        const e = easeOutCubic(p);
        card.pose.x = tw.fx + (tw.x - tw.fx) * e;
        card.pose.y = tw.fy + (tw.y - tw.fy) * e + Math.sin(p * Math.PI) * tw.arc;
        card.pose.z = tw.fz + (tw.z - tw.fz) * e;
        card.pose.rot = tw.fr + (tw.r - tw.fr) * easeInOutCubic(p);
      }
    }

    let x = card.pose.x, y = card.pose.y, z = card.pose.z, rot = card.pose.rot;
    let scale = 1;

    if (card.dragK >= 0 && drag) {
      x = drag.x;
      z = drag.z + card.dragK * UP_GAP * 0.92;
      y = DRAG_Y + card.dragK * 0.05;
      rot = 0;
    } else if (card.selected) {
      y += SEL_LIFT;
    }

    if (card.shakeT0 >= 0) {
      const p = (simTime - card.shakeT0) / 0.4;
      if (p >= 1) card.shakeT0 = -1;
      else x += Math.sin(p * Math.PI * 6) * (1 - p) * 0.07;
    }
    if (card.pulseT0 >= 0) {
      const p = (simTime - card.pulseT0) / 0.28;
      if (p >= 1) card.pulseT0 = -1;
      else scale = 1 + Math.sin(p * Math.PI) * 0.07;
    }

    card.group.position.set(x, y, z);
    card.group.rotation.z = rot;
    card.group.scale.setScalar(scale);
    // hidden stock cards skip rendering entirely (unless mid-flight)
    card.group.visible = !card.hidden || !!card.tween || card.dragK >= 0;
    // show the face texture only when the face side points up (swap at 90° mid-flip)
    card.face.visible = Math.cos(rot) > 0;

    // rim/emissive feedback
    let ei = 0, ec = null;
    if (card.selected) {
      ei = 0.28 + Math.sin(simTime * 5) * 0.1;
      ec = theme.accent;
    }
    if (card.shakeT0 >= 0) {
      const p = (simTime - card.shakeT0) / 0.4;
      ei = (1 - p) * 0.7;
      ec = '#c0392b';
    }
    if (ei > 0) {
      card.faceMat.emissive.set(ec);
      card.faceMat.emissiveIntensity = ei;
    } else if (card.faceMat.emissiveIntensity !== 0) {
      card.faceMat.emissiveIntensity = 0;
    }
  }

  function updateParticles(dt) {
    // dust motes: bounded drift, wrap in a volume over the table
    if (!reducedMotion) {
      for (let i = 0; i < MOTE_MAX; i++) {
        let y = motePos[i * 3 + 1] + moteVel[i * 3 + 1] * dt;
        let x = motePos[i * 3] + (moteVel[i * 3] + Math.sin(simTime * 0.5 + i) * 0.03) * dt;
        let z = motePos[i * 3 + 2] + moteVel[i * 3 + 2] * dt;
        if (y > 6) y = 0.3;
        if (x > 8.5) x = -8.5; else if (x < -8.5) x = 8.5;
        if (z > 5.5) z = -7.5; else if (z < -7.5) z = 5.5;
        motePos[i * 3] = x; motePos[i * 3 + 1] = y; motePos[i * 3 + 2] = z;
      }
      moteGeo.attributes.position.needsUpdate = true;
    }

    // dust puff
    let puffAlive = 0;
    for (let i = 0; i < PUFF_MAX; i++) {
      if (puffLife[i] <= 0) continue;
      puffLife[i] -= dt;
      if (puffLife[i] <= 0) continue;
      puffAlive++;
      puffVel[i * 3 + 1] -= 1.1 * dt; // gentle settle
      puffPos[i * 3] += puffVel[i * 3] * dt;
      puffPos[i * 3 + 1] = Math.max(0.02, puffPos[i * 3 + 1] + puffVel[i * 3 + 1] * dt);
      puffPos[i * 3 + 2] += puffVel[i * 3 + 2] * dt;
    }
    puffGeo.attributes.position.needsUpdate = true;
    puffGeo.setDrawRange(0, puffAlive > 0 ? PUFF_MAX : 0);
    puffMat.opacity = puffAlive > 0 ? 0.55 : 0;

    // win petals: spawn for ~1s, fall and tumble, then retire
    if (petalSpawnLeft > 0) {
      const spawnN = Math.min(petalSpawnLeft, Math.ceil(dt * petalCap * 1.1));
      let spawned = 0;
      for (let i = 0; i < petalCap && spawned < spawnN; i++) {
        const ps = petalState[i];
        if (ps.life > 0) continue;
        ps.x = (rng() - 0.5) * 9;
        ps.y = 2.2 + rng() * 2.2;
        ps.z = -5.5 + rng() * 9;
        ps.vx = (rng() - 0.5) * 0.4;
        ps.vy = -(1.1 + rng() * 0.9);
        ps.vz = (rng() - 0.5) * 0.3;
        ps.rx = rng() * Math.PI; ps.ry = rng() * Math.PI; ps.rz = rng() * Math.PI;
        ps.spin = 2 + rng() * 4;
        ps.sway = rng() * Math.PI * 2;
        ps.life = 3.2;
        spawned++;
      }
      petalSpawnLeft -= spawnN;
    }
    petalActive = 0;
    for (let i = 0; i < petalCap; i++) {
      const ps = petalState[i];
      if (ps.life <= 0) continue;
      ps.life -= dt;
      if (ps.life <= 0 || ps.y < 0.02) { ps.life = 0; continue; }
      ps.vy = Math.max(ps.vy - 0.4 * dt, -1.6);
      ps.x += (ps.vx + Math.sin(simTime * 3 + ps.sway) * 0.35) * dt;
      ps.y += ps.vy * dt;
      ps.z += ps.vz * dt;
      ps.rx += ps.spin * dt; ps.ry += ps.spin * 0.7 * dt;
      _e1.set(ps.rx, ps.ry, ps.rz);
      _q1.setFromEuler(_e1);
      _v1.set(ps.x, ps.y, ps.z);
      const fade = Math.min(1, ps.life / 0.6);
      _s1.setScalar(fade);
      _m1.compose(_v1, _q1, _s1);
      petals.setMatrixAt(petalActive, _m1);
      petalActive++;
    }
    petals.count = petalActive;
    if (petalActive > 0) petals.instanceMatrix.needsUpdate = true;
  }

  function updateMarkers() {
    const pulse = (m, base, amp, speed) => {
      const s = 1 + Math.sin(simTime * speed + m.phase) * amp;
      m.group.scale.set(s, 1, s);
      m.mat.opacity = base + Math.sin(simTime * speed + m.phase) * 0.18;
    };
    if (selMarker.group.visible) pulse(selMarker, 0.7, 0.05, 4);
    for (const m of legalMarkers) if (m.group.visible) pulse(m, 0.5, 0.1, 3.2);
    if (hintFromMarker.group.visible) pulse(hintFromMarker, 0.9, 0.14, 5.5);
    if (hintToMarker.group.visible) pulse(hintToMarker, 0.9, 0.14, 5.5);
    if (stockHintMarker.group.visible) pulse(stockHintMarker, 0.9, 0.14, 5.5);
    if (hintCurve && hintCone.visible) {
      const t = (simTime * 0.45) % 1;
      hintCurve.getPoint(t, _v1);
      hintCurve.getTangent(t, _v2);
      hintCone.position.copy(_v1);
      _v2.normalize();
      hintCone.quaternion.setFromUnitVectors(UP_AXIS, _v2);
    }
  }

  function updateCamera() {
    if (reducedMotion) {
      camera.position.copy(camBase);
    } else {
      camera.position.set(
        camBase.x + Math.sin(simTime * 0.11) * 0.22,
        camBase.y + Math.sin(simTime * 0.073 + 1.7) * 0.14,
        camBase.z + Math.sin(simTime * 0.057 + 0.6) * 0.12);
    }
    camera.lookAt(camTarget);
  }

  function updateWin() {
    if (winT0 < 0) return;
    const p = (simTime - winT0) / 3.8;
    if (p >= 1) {
      winT0 = -1;
      accentLight.intensity = accentBase;
      return;
    }
    // golden light swell: up then ease back down
    accentLight.intensity = accentBase * (1 + Math.sin(p * Math.PI) * 3.2);
  }

  function frame(nowMs) {
    if (disposed || paused) return;
    const now = nowMs / 1000;
    const dt = lastFrame < 0 ? 0.016 : Math.min(now - lastFrame, 0.05);
    lastFrame = now;
    simTime += dt;

    // Size watchdog: if the canvas's real CSS box diverges from the size we
    // were last given (early/hidden resize, orientation change, host CSS),
    // refit to the element itself. Cheap check, ~2×/second.
    if ((watchdog += 1) >= 30) {
      watchdog = 0;
      const cw = canvas.clientWidth | 0, ch = canvas.clientHeight | 0;
      if (cw >= 8 && ch >= 8 && (cw !== lastCssW || ch !== lastCssH)) resize(cw, ch);
    }

    for (const card of cards.values()) applyCard(card);
    updateParticles(dt);
    updateMarkers();
    updateCamera();
    updateWin();

    renderer.info.reset();
    renderer.render(scene, camera);
    statCalls = renderer.info.render.calls;
    statTris = renderer.info.render.triangles;
    rafId = requestAnimationFrame(frame);
  }

  // --- Sizing / camera fit --------------------------------------------------------
  let lastCssW = 960, lastCssH = 640;
  let fitBottomZ = 4.35; // deepest tableau extent the camera currently fits

  function refit() {
    // Fit the board as actually used (deepest tableau pile + growth headroom),
    // with margin. Vertical screen extent maps to world depth compressed by
    // sin(elevation); on narrow/portrait aspects the width term dominates and
    // simply pulls the camera back until all 7 columns fit.
    // Narrow viewports get a tighter margin so the 7 columns use the width
    // (the decorative glasshouse is not framed on phones).
    const narrow = camera.aspect < 0.9;
    const boardW = 8.32 + (narrow ? 0.7 : 2.2);
    const boardD = (5.3 + fitBottomZ) * Math.sin(TILT) + (narrow ? 1.2 : 2.3);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const d = Math.max(boardW / (2 * tanHalf * camera.aspect), boardD / (2 * tanHalf));
    camTarget.z = (Z_TOP - 0.7 + fitBottomZ) / 2 - 0.3; // slight bias: glasshouse headroom at top
    camBase.set(
      camTarget.x,
      camTarget.y + d * Math.sin(TILT),
      camTarget.z + d * Math.cos(TILT));
    camera.position.copy(camBase);
    camera.lookAt(camTarget);
    camera.updateProjectionMatrix();
  }

  function resize(cssWidth, cssHeight) {
    // Sanitize: callers may measure while the canvas is hidden (0×0 rect).
    // Fall back to the element's real box, then the window.
    let w = cssWidth | 0, h = cssHeight | 0;
    if (w < 8 || h < 8) { w = canvas.clientWidth | 0; h = canvas.clientHeight | 0; }
    if (w < 8 || h < 8) { w = window.innerWidth | 0; h = window.innerHeight | 0; }
    w = Math.max(8, w); h = Math.max(8, h);
    lastCssW = w; lastCssH = h;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,
      quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1));
    // buffer size only — the canvas's display size belongs to the host CSS
    // ("canvas fills its container"); pinning inline px here would freeze it.
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    refit();
  }

  // --- Quality / theme / motion ---------------------------------------------------
  function setQuality(q) {
    if (q !== 'low' && q !== 'medium' && q !== 'high') return;
    quality = q;
    const shadows = q === 'high';
    renderer.shadowMap.enabled = shadows;
    keyLight.castShadow = shadows;
    keyLight.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024);
    if (keyLight.shadow.map) {
      keyLight.shadow.map.dispose();
      keyLight.shadow.map = null;
    }
    moteGeo.setDrawRange(0, q === 'high' ? 200 : q === 'medium' ? 140 : 60);
    petalCap = q === 'high' ? 300 : q === 'medium' ? 200 : 120;
    envExtra.visible = q !== 'low';
    // shadow toggling requires shader recompilation
    scene.traverse((o) => {
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => { m.needsUpdate = true; });
        else o.material.needsUpdate = true;
      }
    });
    // re-apply pixel ratio at the current size
    resize(lastCssW, lastCssH);
  }

  function setReducedMotion(b) {
    reducedMotion = !!b;
    motes.visible = !reducedMotion;
    if (reducedMotion) {
      petalSpawnLeft = 0;
      for (const ps of petalState) ps.life = 0;
    }
  }

  function setTheme(t) {
    theme = t;
    const oldFelt = feltTex, oldDeep = feltTexDeep;
    feltTex = paintFeltTexture(t.felt);
    feltTex.anisotropy = maxAniso;
    feltTexDeep = paintFeltTexture(t.feltDeep);
    feltTexDeep.anisotropy = maxAniso;
    themed.feltMats[0].map = feltTex;
    themed.feltDeepMats[0].map = feltTexDeep;
    oldFelt.dispose(); oldDeep.dispose();
    for (const m of themed.woodMats) m.color.set(t.table);
    leafMat.color.set(t.leaf);
    leafMat2.color.set(shade(t.leaf, -0.25));
    frameMat.color.set(shade(t.feltDeep, -0.25));
    hemi.color.set(t.sky[0]);
    accentLight.color.set(t.accent);
    scene.background.set(t.sky[1]);
    renderer.setClearColor(t.sky[1], 1);
    scene.fog.color.set(new THREE.Color(t.sky[1]).multiplyScalar(0.55));

    const oldSky = skyTex, oldBack = backTex, oldPetal = petalTex;
    skyTex = paintSkyTexture(t);
    skyTex.anisotropy = maxAniso;
    skyMat.map = skyTex;
    backTex = paintBackTexture(t);
    backTex.anisotropy = maxAniso;
    backCapMat.map = backTex;
    petalTex = paintPetalTexture(t);
    petalMat.map = petalTex;
    oldSky.dispose(); oldBack.dispose(); oldPetal.dispose();

    for (let s = 0; s < 4; s++) {
      const old = pocketTex[s];
      pocketTex[s] = paintPocketTexture(s);
      pockets[s].material.map = pocketTex[s];
      old.dispose();
    }
    selMarker.mat.color.set(t.accent);
    selMarker.disc.material.color.set(t.accent);
    hintFromMarker.mat.color.set(t.accent);
    hintToMarker.mat.color.set(t.accent);
    stockHintMarker.mat.color.set(t.accent);
    hintLineMat.color.set(t.accent);
    hintCone.material.color.set(t.accent);
  }

  // --- Lifecycle --------------------------------------------------------------------
  function pause() {
    paused = true;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function resume() {
    if (disposed || !paused) return;
    paused = false;
    lastFrame = -1; // avoid a dt spike after the hidden interval
    rafId = requestAnimationFrame(frame);
  }

  function settle() {
    // fast-forward: every card exactly at its snapshot pose
    for (const card of cards.values()) {
      card.tween = null;
      if (card.target) {
        card.pose.x = card.target.x;
        card.pose.y = card.target.y;
        card.pose.z = card.target.z;
        card.pose.rot = card.target.rot;
      }
      card.shakeT0 = -1;
      card.pulseT0 = -1;
    }
  }

  function dispose() {
    disposed = true;
    if (rafId) cancelAnimationFrame(rafId);
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          for (const key of Object.keys(m)) {
            if (m[key] && m[key].isTexture) m[key].dispose();
          }
          m.dispose();
        }
      }
    });
    for (const tex of faceTextures.values()) tex.dispose();
    faceTextures.clear();
    renderer.dispose();
    if (renderer.forceContextLoss) renderer.forceContextLoss();
  }

  // --- Boot --------------------------------------------------------------------------
  moteGeo.setDrawRange(0, quality === 'high' ? 200 : quality === 'medium' ? 140 : 60);
  petalCap = quality === 'high' ? 300 : quality === 'medium' ? 200 : 120;
  envExtra.visible = quality !== 'low';
  motes.visible = !reducedMotion;
  resize(canvas.clientWidth || 960, canvas.clientHeight || 640);
  rafId = requestAnimationFrame(frame);

  return {
    setState,
    pick,
    pointerToWorld,
    setDragged,
    setSelection,
    setLegalTargets,
    setHint,
    playEvent,
    setTheme,
    setQuality,
    setReducedMotion,
    resize,
    pause,
    resume,
    settle,
    stats: () => ({ drawCalls: statCalls, triangles: statTris }),
    dispose,
  };
}
