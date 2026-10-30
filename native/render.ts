// The botanical glasshouse on starhermit:scene, as the browser build's
// js/render3d.js drew it with three.js r160: the sky backdrop beyond the glass
// with its tree lines, the iron mullions, arches and beams, the wooden table
// on its turned pedestal with the deep felt border and the felt inlay, the
// potted plants (instanced pots, foliage blobs, cones and fern blades from the
// deal's seed) and the hanging vines, the window light lying on the felt, the
// dust motes, the 52 rounded cards (extruded bodies with the theme's back, the
// faces from one atlas), the foundation pockets, the column frames and the
// recycle slot, the selection / legal-target / hint markers with the dashed
// hint arc and its travelling arrowhead, the place puffs, the win petals and
// the golden light swell, the camera's idle drift and the deal-in. Card poses
// derive from each rules snapshot (computeTargets); moves tween with authored
// durations and an arc, settle() fast-forwards them.
//
// From three.js r160 (physically based lights; engine.minor 28): the punctual and hemisphere
// intensities, shadow box and bias as render3d.js set them; ACES at 1.1. The
// old EffectComposer chain (GTAO, UnrealBloom on linear HDR, OutputPass, the
// display-space GradeShader, SMAA / FXAA / MSAA) is the runtime's renderer.ao /
// bloom / grade ("display") / antialias. Per-material envMapIntensity with
// scene.environment is ignored at minor 20, so each standard material carries
// the environment as its own envMap. The canvas painters are baked images
// (tools/bake-textures.mjs). The canvas sat between the top bar, rails and
// tray: the window is the playfield's view, offset (setViewOffset).
import {
  ACESFilmicToneMapping, AdditiveBlending, BufferAttribute, BufferGeometry, CatmullRomCurve3, CircleGeometry, Color, ConeGeometry,
  DirectionalLight, DoubleSide, Euler, ExtrudeGeometry, Fog, Group, HemisphereLight, IcosahedronGeometry, InstancedMesh, LatheGeometry,
  LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial,
  PerspectiveCamera, Plane, PlaneGeometry, PMREMGenerator, PointLight, Points, PointsMaterial, Quaternion, QuadraticBezierCurve3, Raycaster,
  OrthographicCamera, RepeatWrapping, RingGeometry, RoomEnvironment, SRGBColorSpace, Shape, ShapeGeometry, TextureLoader, TorusGeometry, TubeGeometry, Vector2,
  Vector3, BoxGeometry, pointerToNdc, renderer, scene,
  type Material, type Object3D, type Texture,
} from "starhermit:scene";
import { THEMES, type Theme } from "./game.ts";
import { MOTE_MAX, PETAL_MAX, moteCount, petalCount, type Look } from "./quality.ts";

// ---------------------------------------------------------------- constants (render3d.js)
const CARD_W = 1.0, CARD_H = 1.4, CARD_R = 0.09, CARD_T = 0.024;
const COL_STEP = 1.22, Z_TOP = -4.6, Z_TAB0 = -3.35, TAB_FAN_MAX = 7.0, UP_GAP = 0.42, DOWN_GAP = 0.26;
const STACK_DY = 0.03, STOCK_DY = 0.016, FAN_X = 0.38, FELT_Y = 0.0, CARD_Y0 = 0.028, DRAG_Y = 0.85, SEL_LIFT = 0.24;
const TILT = 0.88;
const BLOOM_THRESHOLD = 2.4;
const PI = Math.PI;

export type Zone = "stock" | "waste" | "foundation" | "tableau";
export interface Loc { zone: Zone; pile: number; index?: number }
export interface Snapshot {
  stock: number[]; waste: number[]; foundations: number[][]; tableau: { c: number; up: boolean }[][];
  ruleset: { drawCount: number };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const easeOutCubic = (p: number): number => 1 - Math.pow(1 - p, 3);
const easeInOutCubic = (p: number): number => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
/** lighten/darken a #rrggbb colour by amount in [-1, 1] (render3d.js shade). */
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = amt < 0 ? 0 : 255, p = Math.abs(amt);
  r = Math.round(r + (f - r) * p); g = Math.round(g + (f - g) * p); b = Math.round(b + (f - b) * p);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
const _v1 = new Vector3(), _v2 = new Vector3(), _q1 = new Quaternion(), _m1 = new Matrix4(), _s1 = new Vector3(1, 1, 1), _e1 = new Euler();
const UP_AXIS = new Vector3(0, 1, 0);

// ---------------------------------------------------------------- textures (baked)
const loader = new TextureLoader();
const textures = new Map<string, Texture>();
function image(name: string, opts: { repeat?: [number, number]; srgb?: boolean } = {}): Texture {
  const key = `${name}|${opts.repeat ? opts.repeat.join("x") : ""}`;
  let t = textures.get(key);
  if (!t) {
    t = loader.load(`assets/textures/${name}`, undefined, undefined, (e: unknown) => console.warn(`${name}: ${e instanceof Error ? e.message : String(e)}`));
    if (opts.srgb !== false) t.colorSpace = SRGBColorSpace;
    t.anisotropy = 8;
    if (opts.repeat) { t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(opts.repeat[0], opts.repeat[1]); }
    textures.set(key, t);
  }
  return t;
}

// ---------------------------------------------------------------- shapes
function roundedRectShape(w: number, h: number, r: number): Shape {
  const s = new Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, PI / 2, PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, PI, PI * 1.5, false);
  return s;
}
/** Card body: a thin rounded-rect extrusion; both caps carry the back (the top one lies under the face). */
function buildCardBodyGeometry(): BufferGeometry {
  const geo = new ExtrudeGeometry(roundedRectShape(CARD_W, CARD_H, CARD_R), {
    depth: CARD_T, bevelEnabled: false, curveSegments: 6,
    UVGenerator: {
      generateTopUV: (_g, v, a, b, c) => [a, b, c].map((i) => new Vector2(v[i * 3]! / CARD_W + 0.5, v[i * 3 + 1]! / CARD_H + 0.5)),
      generateSideWallUV: () => [new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1), new Vector2(0, 1)],
    },
  });
  geo.translate(0, 0, -CARD_T / 2);
  return geo;
}
/** A face: the rounded rectangle mapped onto the card's cell of the face atlas (9 × 6 cells). */
function buildCardFaceGeometry(id: number): BufferGeometry {
  const geo = new ShapeGeometry(roundedRectShape(CARD_W, CARD_H, CARD_R), 6);
  const pos = geo.getAttribute("position")!, uv = geo.getAttribute("uv")!;
  const col = id % 9, row = Math.floor(id / 9), inset = 0.002;
  for (let i = 0; i < uv.count; i++) {
    const u = pos.getX(i) / CARD_W + 0.5, v = pos.getY(i) / CARD_H + 0.5;
    uv.setXY(i, (col + inset + u * (1 - 2 * inset)) / 9, 1 - (row + inset + (1 - v) * (1 - 2 * inset)) / 6);
  }
  return geo;
}
function frameShape(w: number, h: number, r: number, inset: number): Shape {
  const s = roundedRectShape(w, h, r);
  s.holes.push(roundedRectShape(w - inset * 2, h - inset * 2, Math.max(0.02, r - inset)));
  return s;
}
function remapUv(geo: BufferGeometry, w: number, h: number): BufferGeometry {
  const pos = geo.getAttribute("position")!, uv = geo.getAttribute("uv")!;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
  return geo;
}

// ---------------------------------------------------------------- the fixed scene
const camera = new PerspectiveCamera(35, 1, 0.1, 120);
const camTarget = new Vector3(0, 0, -0.45);
const camBase = new Vector3();
let theme: Theme = THEMES[0]!;
let look: Look | null = null;
let reducedMotion = false;
let cameraDrift = true;
let seed = 1;
let rng = mulberry32(1);

const LIGHT = { hemi: 0.65, hemiIbl: 0.55, key: 1.7, accent: 14, exposure: 1.1 };
const hemi = new HemisphereLight(theme.sky[0], "#3a2f26", LIGHT.hemi);
const keyLight = new DirectionalLight("#ffd9a8", LIGHT.key);
keyLight.position.set(6, 12, 4.55);
keyLight.target.position.set(0, 0, -0.45);
keyLight.shadow.bias = -0.0004;
keyLight.shadow.normalBias = 0.02;
// render3d.js fitted the shadow frustum to the table top (12.6 x 15.2 slab centred at z=-0.45) as seen from the light.
{
  const sc = keyLight.shadow.camera as OrthographicCamera;
  Object.assign(sc, { left: -7.4, right: 7.4, top: 7.2, bottom: -7.2, near: 6, far: 22 });
  sc.updateProjectionMatrix();
}
const accentLight = new PointLight(theme.accent, LIGHT.accent, 18, 2);
accentLight.position.set(-3, 3.2, 2.5);
scene.add(hemi, keyLight, keyLight.target, accentLight);

let envTex: Texture | null = null;
function ensureEnvironment(): Texture | null {
  if (!envTex) {
    try { envTex = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture; }
    catch (e) { console.warn(`environment: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return envTex;
}

// Materials whose look follows the theme / detail (rebuilt by buildEnvironment).
type StdMat = MeshStandardMaterial | MeshLambertMaterial;
/** envMapIntensity per standard material (applied as its own envMap's intensity). */
const envIntensity = new Map<Material, number>();
function std(params: { color?: string; map?: Texture | null; roughness?: number; metalness?: number; envMapIntensity: number; side?: typeof DoubleSide }): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: new Color(params.color ?? "#ffffff"), roughness: params.roughness ?? 1, metalness: params.metalness ?? 0 });
  if (params.map) m.map = params.map;
  if (params.side !== undefined) m.side = params.side;
  envIntensity.set(m, params.envMapIntensity);
  return m;
}

let envRoot: Group | null = null;
let skyMat: MeshBasicMaterial | null = null;
let windowLightMat: MeshBasicMaterial | null = null;
let windowTex: Texture | null = null;
const vines: { group: Group; phase: number }[] = [];
let envExtra: Group | null = null;
let leafMat: MeshStandardMaterial | null = null;
const pockets: Mesh[] = [];
let stockSlot: Mesh | null = null;
interface SlotHit { mesh: Object3D; loc: Loc }
let slotMeshes: SlotHit[] = [];

function disposeTree(root: Object3D): void {
  const geos = new Set<BufferGeometry>(), mats = new Set<Material>();
  root.traverse((o) => {
    const m = o as Mesh;
    if (m.geometry) geos.add(m.geometry);
    if (m.material) for (const x of Array.isArray(m.material) ? m.material : [m.material]) mats.add(x);
  });
  for (const g of geos) g.dispose();
  for (const m of mats) { envIntensity.delete(m); m.dispose(); }
}

const tabX = (p: number): number => (p - 3) * COL_STEP;
const foundX = (s: number): number => s * COL_STEP;
const STOCK_X = tabX(0), WASTE_X = tabX(1);

function setInst(mesh: InstancedMesh, idx: number, px: number, py: number, pz: number, euler: Euler, sx: number, sy: number, sz: number): void {
  _v1.set(px, py, pz);
  _q1.setFromEuler(euler);
  _s1.set(sx, sy, sz);
  _m1.compose(_v1, _q1, _s1);
  mesh.setMatrixAt(idx, _m1);
}

/** render3d.js's environment: sky, floor, table, glasshouse, plants, vines, window light, slots (theme and detail). */
function buildEnvironment(): void {
  if (envRoot) { scene.remove(envRoot); disposeTree(envRoot); }
  const L = look!;
  rng = mulberry32(seed || 1);
  const root = envRoot = new Group();
  scene.add(root);
  vines.length = 0;
  pockets.length = 0;
  slotMeshes = [];

  scene.background = new Color(theme.sky[1]);
  scene.fog = new Fog(new Color(theme.sky[1]).multiplyScalar(0.55), 20, 48);
  hemi.color.set(theme.sky[0]);
  accentLight.color.set(theme.accent);

  skyMat = new MeshBasicMaterial({ map: image(`sky-${theme.id}.webp`) });
  skyMat.fog = false;
  const skyPlane = new Mesh(new PlaneGeometry(64, 24), skyMat);
  skyPlane.position.set(0, 3, -11.5);
  root.add(skyPlane);

  const floor = new Mesh(new CircleGeometry(15, 40), std({ color: "#2c332e", roughness: 1, envMapIntensity: 0.15 }));
  floor.rotation.x = -PI / 2;
  floor.position.y = -3.3;
  floor.receiveShadow = true;
  root.add(floor);

  // Table: wood slab, deep felt border and the felt inlay, on a turned pedestal.
  const woodMat = std({ color: theme.table, roughness: 0.62, metalness: 0.05, envMapIntensity: 0.3, map: L.detailed ? image("wood.webp", { repeat: [0.11, 0.11] }) : null });
  const slabGeo = new ExtrudeGeometry(roundedRectShape(12.6, 15.2, 1.3), { depth: 0.4, bevelEnabled: false, curveSegments: 8 });
  slabGeo.translate(0, 0, -0.2);
  const slab = new Mesh(slabGeo, woodMat);
  slab.rotation.x = -PI / 2;
  slab.position.set(0, -0.3, -0.45);
  slab.castShadow = true;
  slab.receiveShadow = true;
  root.add(slab);
  const prof = [[1.55, 0], [1.6, 0.1], [0.62, 0.22], [0.45, 0.6], [0.52, 1.7], [1.05, 2.5], [1.3, 2.66], [1.28, 2.8]].map(([x, y]) => new Vector2(x!, y!));
  const pedestal = new Mesh(new LatheGeometry(prof, 24), woodMat);
  pedestal.position.set(0, -3.3, -0.45);
  root.add(pedestal);
  const feltBump = L.detailed ? image("felt-bump.png", { repeat: [7, 9], srgb: false }) : null;
  const deepMat = std({ map: image(`felt-deep-${theme.id}.webp`), roughness: 0.95, envMapIntensity: 0.06 });
  const feltMat = std({ map: image(`felt-${theme.id}.webp`), roughness: 0.98, envMapIntensity: 0.06 });
  if (feltBump) for (const m of [deepMat, feltMat]) { m.bumpMap = feltBump; m.bumpScale = 0.6; }
  const deep = new Mesh(remapUv(new ShapeGeometry(roundedRectShape(11.4, 14.0, 1.1), 8), 11.4, 14.0), deepMat);
  deep.rotation.x = -PI / 2;
  deep.position.set(0, -0.02, -0.45);
  deep.receiveShadow = true;
  root.add(deep);
  const felt = new Mesh(remapUv(new ShapeGeometry(roundedRectShape(10.7, 13.3, 0.95), 8), 10.7, 13.3), feltMat);
  felt.rotation.x = -PI / 2;
  felt.position.set(0, FELT_Y, -0.45);
  felt.receiveShadow = true;
  root.add(felt);

  // Glasshouse: iron posts, beams, arches, the ridge and a faint sheen of glass.
  const ironMat = std({ color: "#2a2d2b", roughness: 0.4, metalness: 0.7, envMapIntensity: 0.8 });
  const postGeo = new BoxGeometry(0.16, 8.4, 0.16);
  for (const px of [-8, -4, 0, 4, 8]) { const p = new Mesh(postGeo, ironMat); p.position.set(px, 0.9, -8.6); root.add(p); }
  const beamGeo = new BoxGeometry(16.4, 0.14, 0.14);
  for (const by of [2.2, 5.1]) { const b = new Mesh(beamGeo, ironMat); b.position.set(0, by, -8.6); root.add(b); }
  const archGeo = new TorusGeometry(1.98, 0.09, 8, 28, PI);
  for (const ax of [-6, -2, 2, 6]) { const a = new Mesh(archGeo, ironMat); a.position.set(ax, 5.1, -8.6); root.add(a); }
  const ridge = new Mesh(new BoxGeometry(16.4, 0.12, 0.12), ironMat);
  ridge.position.set(0, 7.15, -8.6);
  root.add(ridge);
  const glass = new Mesh(new PlaneGeometry(16.4, 8.4), new MeshBasicMaterial({ color: new Color("#ffffff"), transparent: true, opacity: 0.055, depthWrite: false }));
  glass.position.set(0, 0.9, -8.66);
  root.add(glass);

  // Plants: one InstancedMesh per part type; placement from the deal's seed.
  leafMat = std({ color: theme.leaf, roughness: 0.75, side: DoubleSide, envMapIntensity: 0.25 });
  const leafMat2 = std({ color: shade(theme.leaf, -0.25), roughness: 0.8, side: DoubleSide, envMapIntensity: 0.25 });
  const potMat = std({ color: "#9a5a3a", roughness: 0.85, envMapIntensity: 0.25 });
  const soilMat = std({ color: "#2e2119", roughness: 1, envMapIntensity: 0.1 });
  const potGeo = new LatheGeometry([[0.34, 0], [0.42, 0.04], [0.5, 0.42], [0.56, 0.5], [0.58, 0.58], [0.5, 0.58]].map(([x, y]) => new Vector2(x!, y!)), 18);
  const soilGeo = new CircleGeometry(0.46, 14);
  const blobGeo = new IcosahedronGeometry(0.55, 1);
  {
    const pos = blobGeo.getAttribute("position")!;
    for (let v = 0; v < pos.count; v++) {
      const j = 1 + (rng() - 0.5) * 0.42;
      pos.setXYZ(v, pos.getX(v) * j, pos.getY(v) * j * 0.85, pos.getZ(v) * j);
    }
    blobGeo.computeVertexNormals();
  }
  const coneGeo = new ConeGeometry(0.5, 0.62, 9);
  const bladeGeo = new PlaneGeometry(0.22, 1.5, 1, 5);
  {
    const pos = bladeGeo.getAttribute("position")!;
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v) + 0.75;
      pos.setY(v, y);
      pos.setZ(v, Math.pow(y / 1.5, 2) * 0.55);
    }
    bladeGeo.computeVertexNormals();
  }
  const pots = new InstancedMesh(potGeo, potMat, 8), soils = new InstancedMesh(soilGeo, soilMat, 8);
  const blobsA = new InstancedMesh(blobGeo, leafMat, 8), blobsB = new InstancedMesh(blobGeo, leafMat2, 8);
  const conesA = new InstancedMesh(coneGeo, leafMat, 8), conesB = new InstancedMesh(coneGeo, leafMat2, 8);
  const bladesA = new InstancedMesh(bladeGeo, leafMat, 16), bladesB = new InstancedMesh(bladeGeo, leafMat2, 16);
  const n = { pot: 0, soil: 0, blobA: 0, blobB: 0, coneA: 0, coneB: 0, bladeA: 0, bladeB: 0 };
  const ident = new Euler(), flat = new Euler(-PI / 2, 0, 0), e2 = new Euler();
  const makePlant = (x: number, z: number, s: number, kind: number): void => {
    const y0 = -3.3;
    setInst(pots, n.pot++, x, y0, z, ident, s, s, s);
    setInst(soils, n.soil++, x, y0 + 0.55 * s, z, flat, s, s, s);
    if (kind === 0) {
      for (let i = 0; i < 4; i++) {
        const r = 0.42 + rng() * 0.3;
        e2.set(rng() * 0.4, rng() * PI, rng() * 0.4);
        const k = r * s / 0.55;
        const px = x + (rng() - 0.5) * 0.5 * s, py = y0 + (0.85 + i * 0.32 + rng() * 0.15) * s, pz = z + (rng() - 0.5) * 0.5 * s;
        if (i % 2) setInst(blobsA, n.blobA++, px, py, pz, e2, k, k, k); else setInst(blobsB, n.blobB++, px, py, pz, e2, k, k, k);
      }
    } else if (kind === 1) {
      for (let i = 0; i < 4; i++) {
        const r = 0.62 - i * 0.12;
        e2.set(0, rng() * PI, 0);
        if (i % 2) setInst(conesA, n.coneA++, x, y0 + (0.9 + i * 0.42) * s, z, e2, r * s / 0.5, s, r * s / 0.5);
        else setInst(conesB, n.coneB++, x, y0 + (0.9 + i * 0.42) * s, z, e2, r * s / 0.5, s, r * s / 0.5);
      }
    } else {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * PI * 2 + rng() * 0.4;
        e2.set(-0.5 - rng() * 0.3, a, 0, "YXZ");
        _q1.setFromEuler(e2);
        _v2.set(0, 0.4 * s, 0).applyQuaternion(_q1);
        if (i % 2) setInst(bladesA, n.bladeA++, x + _v2.x, y0 + 0.56 * s + _v2.y, z + _v2.z, e2, s, s, s);
        else setInst(bladesB, n.bladeB++, x + _v2.x, y0 + 0.56 * s + _v2.y, z + _v2.z, e2, s, s, s);
      }
    }
  };
  for (const [x, z, s, kind] of [[-5.7, -6.3, 1.7, 0], [5.8, -6.5, 1.9, 1], [-6.5, -0.6, 1.3, 2], [6.6, 0.6, 1.4, 2], [5.8, 4.9, 1.1, 0], [-6.1, 4.6, 1.2, 1]] as const) {
    makePlant(x, z, s, kind);
  }
  pots.count = n.pot; soils.count = n.soil; blobsA.count = n.blobA; blobsB.count = n.blobB;
  conesA.count = n.coneA; conesB.count = n.coneB; bladesA.count = n.bladeA; bladesB.count = n.bladeB;
  for (const m of [pots, soils, blobsA, blobsB, conesA, conesB, bladesA, bladesB]) m.instanceMatrix.needsUpdate = true;
  root.add(pots, soils, blobsA, blobsB, conesA, conesB);
  // Detail "plain" hides the fern blades and the vines.
  envExtra = new Group();
  envExtra.visible = L.detailed;
  root.add(envExtra);
  envExtra.add(bladesA, bladesB);
  const vineLeafGeo = new PlaneGeometry(0.16, 0.26);
  const makeVine = (x: number, z: number, len: number): Group => {
    const g = new Group();
    g.position.set(x, 2.7, z);
    const pts: Vector3[] = [];
    for (let i = 0; i <= 6; i++) pts.push(new Vector3(Math.sin(i * 1.7 + x) * 0.22, -(i / 6) * len, Math.cos(i * 2.1 + x) * 0.16));
    const curve = new CatmullRomCurve3(pts);
    g.add(new Mesh(new TubeGeometry(curve, 24, 0.028, 5), leafMat2));
    const leaves = new InstancedMesh(vineLeafGeo, leafMat!, 10);
    for (let i = 1; i <= 10; i++) {
      const p = curve.getPoint(i / 11);
      _e1.set(rng() * 0.9 - 0.45, rng() * PI, rng() * 0.9 - 0.45);
      _q1.setFromEuler(_e1);
      _s1.set(1, 1, 1);
      _m1.compose(p, _q1, _s1);
      leaves.setMatrixAt(i - 1, _m1);
    }
    leaves.instanceMatrix.needsUpdate = true;
    g.add(leaves);
    vines.push({ group: g, phase: x * 1.3 });
    return g;
  };
  envExtra.add(makeVine(-3.2, -8.4, 2.2), makeVine(2.6, -8.4, 2.6), makeVine(5.4, -8.4, 1.8));

  // Window light (detail): a soft additive decal of roof panes and leaf dapple on the felt.
  windowTex = image("window-light.webp").clone();
  windowTex.center.set(0.5, 0.5);
  windowTex.rotation = 0.32;
  windowTex.repeat.set(1.1, 0.9);
  windowLightMat = new MeshBasicMaterial({ map: windowTex, color: new Color("#ffd9a0"), transparent: true, opacity: 0.12, depthWrite: false, blending: AdditiveBlending });
  windowLightMat.fog = false;
  const windowLight = new Mesh(new PlaneGeometry(10.7, 13.3), windowLightMat);
  windowLight.rotation.x = -PI / 2;
  windowLight.position.set(0, FELT_Y + 0.003, -0.45);
  windowLight.renderOrder = -1;
  windowLight.visible = L.detailed;
  root.add(windowLight);

  // Slots: foundation pockets, column frames (with a pickable card-sized area each), the recycle slot.
  const flatPlane = (w: number, h: number, mat: Material, x: number, z: number, y: number): Mesh => {
    const m = new Mesh(new PlaneGeometry(w, h), mat);
    m.rotation.x = -PI / 2;
    m.position.set(x, y, z);
    return m;
  };
  for (let s = 0; s < 4; s++) {
    const m = flatPlane(CARD_W, CARD_H, new MeshBasicMaterial({ map: image(`pocket-${s}.png`), transparent: true, depthWrite: false }), foundX(s), Z_TOP, 0.006);
    root.add(m);
    pockets.push(m);
    slotMeshes.push({ mesh: m, loc: { zone: "foundation", pile: s, index: -1 } });
  }
  const frameMat = new MeshBasicMaterial({ color: new Color(shade(theme.feltDeep, -0.25)), transparent: true, opacity: 0.55, depthWrite: false });
  const frameGeo = new ShapeGeometry(frameShape(CARD_W + 0.08, CARD_H + 0.08, CARD_R + 0.03, 0.055), 6);
  const areaMat = new MeshBasicMaterial({ color: new Color("#000000"), transparent: true, opacity: 0, depthWrite: false });
  for (let p = 0; p < 7; p++) {
    const f = new Mesh(frameGeo, frameMat);
    f.rotation.x = -PI / 2;
    f.position.set(tabX(p), 0.006, Z_TAB0);
    root.add(f);
    const area = flatPlane(CARD_W, CARD_H, areaMat, tabX(p), Z_TAB0, 0.005);
    root.add(area);
    slotMeshes.push({ mesh: area, loc: { zone: "tableau", pile: p, index: -1 } });
  }
  stockSlot = flatPlane(CARD_W, CARD_H, new MeshBasicMaterial({ map: image("stock-slot.png"), transparent: true, depthWrite: false }), STOCK_X, Z_TOP, 0.006);
  stockSlot.visible = !!lastSnapshot && lastSnapshot.stock.length === 0;
  root.add(stockSlot);
  slotMeshes.push({ mesh: stockSlot, loc: { zone: "stock", pile: 0, index: -1 } });
}

// ---------------------------------------------------------------- cards
interface Pose { x: number; y: number; z: number; rot: number }
interface Target extends Pose { zone: Zone; pile: number; index: number; up: boolean; interactive: boolean; hidden: boolean }
interface Tween { t0: number; dur: number; fx: number; fy: number; fz: number; fr: number; x: number; y: number; z: number; r: number; arc: number }
interface Card {
  id: number; group: Group; body: Mesh<Material[]>; face: Mesh; faceMat: StdMat;
  pose: Pose; target: Target | null; tween: Tween | null;
  zone: Zone | null; pile: number; index: number; up: boolean; interactive: boolean; hidden: boolean;
  selected: boolean; dragK: number; shakeT0: number; pulseT0: number;
}
const cardBodyGeo = buildCardBodyGeometry();
const faceGeos = new Map<number, BufferGeometry>();
let edgeMat: StdMat | null = null;
let backMat: StdMat | null = null;
const cardsRoot = new Group();
scene.add(cardsRoot);
const cards = new Map<number, Card>();
const locMap = new Map<string, Card>();

function makeFaceMat(): StdMat {
  const L = look!;
  const map = image(`faces-${L.budget.faces}.webp`);
  if (L.budget.material === "lambert") {
    const m = new MeshLambertMaterial({ map });
    m.polygonOffset = true; m.polygonOffsetFactor = -1;
    return m;
  }
  if (!L.detailed || L.budget.material !== "physical") {
    const m = std({ map, roughness: 0.8, envMapIntensity: 0.14 });
    m.polygonOffset = true; m.polygonOffsetFactor = -1;
    return m;
  }
  const m = new MeshPhysicalMaterial({ map, roughness: 0.66, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.3 });
  if (L.budget.paperBump) { m.bumpMap = image("paper-bump.png", { srgb: false }); m.bumpScale = 0.35; }
  m.polygonOffset = true; m.polygonOffsetFactor = -1;
  envIntensity.set(m, 0.14);
  return m;
}
function makeBackMat(): StdMat {
  const L = look!;
  const map = image(`back-${theme.id}.webp`);
  if (L.budget.material === "lambert") return new MeshLambertMaterial({ map });
  if (!L.detailed || L.budget.material !== "physical") return std({ map, roughness: 0.85, envMapIntensity: 0.14 });
  const m = new MeshPhysicalMaterial({ map, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.25 });
  envIntensity.set(m, 0.14);
  return m;
}
function makeEdgeMat(): StdMat {
  return look!.budget.material === "lambert" ? new MeshLambertMaterial({ color: new Color("#efe7d2") }) : std({ color: "#efe7d2", roughness: 0.85, envMapIntensity: 0.2 });
}
function createCard(id: number): Card {
  const group = new Group();
  const inner = new Group();
  inner.rotation.x = -PI / 2;
  group.add(inner);
  const body = new Mesh(cardBodyGeo, [backMat!, edgeMat!]);
  body.castShadow = look!.shadows > 0;
  inner.add(body);
  let fg = faceGeos.get(id);
  if (!fg) { fg = buildCardFaceGeometry(id); faceGeos.set(id, fg); }
  const faceMat = makeFaceMat();
  const face = new Mesh(fg, faceMat);
  face.position.z = CARD_T / 2 + 0.002;
  face.receiveShadow = true;
  inner.add(face);
  cardsRoot.add(group);
  const card: Card = {
    id, group, body, face, faceMat, pose: { x: 0, y: 0, z: 0, rot: PI }, target: null, tween: null,
    zone: null, pile: 0, index: 0, up: false, interactive: false, hidden: false, selected: false, dragK: -1, shakeT0: -1, pulseT0: -1,
  };
  body.userData.cardId = id;
  return card;
}
/** Card materials for the look / theme (positions kept). */
function rebuildCardMaterials(): void {
  const oldBack = backMat, oldEdge = edgeMat;
  backMat = makeBackMat();
  edgeMat = makeEdgeMat();
  for (const c of cards.values()) {
    const old = c.faceMat;
    c.faceMat = makeFaceMat();
    c.face.material = c.faceMat;
    envIntensity.delete(old);
    old.dispose();
    c.body.material = [backMat, edgeMat];
    c.body.castShadow = look!.shadows > 0;
  }
  for (const m of [oldBack, oldEdge]) if (m) { envIntensity.delete(m); m.dispose(); }
}

// ---------------------------------------------------------------- layout: snapshot → poses
let lastSnapshot: Snapshot | null = null;
let lastMovePos = { x: 0, z: 0 };
let lastMoveCard: Card | null = null;
let dealt = false;
let layoutMaxZ = 4.35;
const dropPos: { tableau: { x: number; z: number }[] } = { tableau: [] };
for (let p = 0; p < 7; p++) dropPos.tableau.push({ x: tabX(p), z: Z_TAB0 });

function computeTargets(state: Snapshot): Map<number, Target> {
  const targets = new Map<number, Target>();
  let maxTabZ = Z_TAB0 + 0.7;
  const stockN = state.stock.length;
  state.stock.forEach((id, i) => {
    targets.set(id, { x: STOCK_X, y: CARD_Y0 + i * STOCK_DY, z: Z_TOP, rot: PI, zone: "stock", pile: 0, index: i, up: false, interactive: i === stockN - 1, hidden: i < stockN - 4 });
  });
  const w = state.waste, wn = w.length;
  const shown = state.ruleset.drawCount === 3 ? Math.min(3, wn) : Math.min(1, wn);
  w.forEach((id, i) => {
    const k = i - (wn - shown);
    targets.set(id, { x: k >= 0 ? WASTE_X + k * FAN_X : WASTE_X, y: CARD_Y0 + i * STACK_DY, z: Z_TOP, rot: 0, zone: "waste", pile: 0, index: i, up: true, interactive: k >= 0, hidden: false });
  });
  state.foundations.forEach((pile, s) => pile.forEach((id, i) => {
    targets.set(id, { x: foundX(s), y: CARD_Y0 + i * STACK_DY, z: Z_TOP, rot: 0, zone: "foundation", pile: s, index: i, up: true, interactive: i === pile.length - 1, hidden: false });
  }));
  state.tableau.forEach((pile, p) => {
    let total = 0;
    const gaps: number[] = [];
    for (let i = 1; i < pile.length; i++) { const g = pile[i - 1]!.up ? UP_GAP : DOWN_GAP; gaps.push(g); total += g; }
    const scale = total > TAB_FAN_MAX ? TAB_FAN_MAX / total : 1;
    let z = Z_TAB0;
    pile.forEach((e, i) => {
      if (i > 0) z += gaps[i - 1]! * scale;
      targets.set(e.c, { x: tabX(p), y: CARD_Y0 + i * STACK_DY, z, rot: e.up ? 0 : PI, zone: "tableau", pile: p, index: i, up: e.up, interactive: e.up, hidden: false });
    });
    dropPos.tableau[p] = { x: tabX(p), z: pile.length ? z : Z_TAB0 };
    maxTabZ = Math.max(maxTabZ, (pile.length ? z : Z_TAB0) + 0.7);
  });
  layoutMaxZ = maxTabZ;
  return targets;
}
const posesDiffer = (a: Pose, b: Pose): boolean =>
  Math.abs(a.x - b.x) > 1e-4 || Math.abs(a.y - b.y) > 1e-4 || Math.abs(a.z - b.z) > 1e-4 || Math.abs(a.rot - b.rot) > 1e-4;
function startTween(card: Card, to: Target, delay: number, dur: number, arc: number): void {
  card.tween = { t0: simTime + delay, dur: Math.max(0.01, dur), fx: card.pose.x, fy: card.pose.y, fz: card.pose.z, fr: card.pose.rot, x: to.x, y: to.y, z: to.z, r: to.rot, arc };
  card.target = { ...to };
}

/** render3d.js setState: cards follow a rules snapshot (the first one of a deal deals in, unless instant). */
export function setState(snapshot: Snapshot, instant = false): void {
  lastSnapshot = snapshot;
  if (!look) return;
  const targets = computeTargets(snapshot);
  const isDeal = !dealt && !instant;
  dealt = true;
  locMap.clear();
  const orderOf = (t: Target): number => t.zone === "tableau" ? t.pile * 32 + t.index
    : t.zone === "stock" ? 300 + t.index : t.zone === "waste" ? 400 + t.index : 500 + t.pile * 16 + t.index;
  const ordered = [...targets.entries()].sort((a, b) => orderOf(a[1]) - orderOf(b[1]));
  let delayIdx = 0;
  let moved: Card | null = null;
  for (const [id, t] of ordered) {
    let card = cards.get(id);
    if (!card) { card = createCard(id); cards.set(id, card); }
    locMap.set(`${t.zone}/${t.pile}/${t.index}`, card);
    card.zone = t.zone; card.pile = t.pile; card.index = t.index;
    card.up = t.up; card.interactive = t.interactive; card.hidden = t.hidden;
    if (card.dragK >= 0) card.target = { ...t };
    else if (instant) {
      card.tween = null;
      card.target = { ...t };
      card.pose = { x: t.x, y: t.y, z: t.z, rot: t.rot };
    } else if (isDeal) {
      card.pose = { x: STOCK_X, y: 0.7, z: Z_TOP, rot: PI };
      startTween(card, t, reducedMotion ? 0 : delayIdx++ * 0.035, reducedMotion ? 0.18 : 0.7, reducedMotion ? 0.15 : 1.3);
    } else if (!card.target || posesDiffer(card.target, t)) {
      const dist = Math.hypot(t.x - card.pose.x, t.z - card.pose.z);
      const flipOnly = dist < 0.01;
      let dur = flipOnly ? 0.5 : Math.min(0.32 + dist * 0.07, 0.85);
      let arc = flipOnly ? 0.32 : Math.min(0.4 + dist * 0.12, 1.5);
      if (reducedMotion) { dur *= 0.35; arc *= 0.2; }
      startTween(card, t, 0, dur, arc);
      if (!flipOnly) moved = card;
    }
  }
  if (moved) { lastMoveCard = moved; lastMovePos = { x: moved.target!.x, z: moved.target!.z }; }
  for (const [id, card] of cards) {
    if (!targets.has(id)) { cardsRoot.remove(card.group); envIntensity.delete(card.faceMat); card.faceMat.dispose(); cards.delete(id); }
  }
  if (stockSlot) stockSlot.visible = snapshot.stock.length === 0;
  const needFit = layoutMaxZ + 0.8;
  if (Math.abs(needFit - fitBottomZ) > 0.6) { fitBottomZ = needFit; refit(); }
}
/** A new deal: the cards leave, the next snapshot deals in; the plants follow the deal's seed. */
export function newDeal(dealSeed: number): void {
  for (const card of cards.values()) { cardsRoot.remove(card.group); envIntensity.delete(card.faceMat); card.faceMat.dispose(); }
  cards.clear();
  locMap.clear();
  lastSnapshot = null;
  dealt = false;
  setSelection(null);
  setLegalTargets([]);
  setHint(null);
  drag = null;
  winT0 = -1;
  if (dealSeed !== seed) { seed = dealSeed; if (look) rebuild(); }
}
/** settle(): every card exactly at its snapshot pose. */
export function settle(): void {
  for (const card of cards.values()) {
    card.tween = null;
    if (card.target) card.pose = { x: card.target.x, y: card.target.y, z: card.target.z, rot: card.target.rot };
    card.shakeT0 = -1;
    card.pulseT0 = -1;
  }
}
export function isAnimating(): boolean { for (const c of cards.values()) if (c.tween) return true; return false; }

// ---------------------------------------------------------------- markers
const markerRingGeo = new RingGeometry(0.62, 0.76, 40);
const markerDiscGeo = new CircleGeometry(0.85, 36);
interface Marker { group: Group; mat: MeshBasicMaterial; disc: MeshBasicMaterial | null; phase: number; color: () => string }
const markers: Marker[] = [];
function makeMarker(color: () => string, withDisc: boolean): Marker {
  const g = new Group();
  const mat = new MeshBasicMaterial({ color: new Color(color()), transparent: true, opacity: 0.7, depthWrite: false });
  const ring = new Mesh(markerRingGeo, mat);
  ring.rotation.x = -PI / 2;
  ring.scale.set(1, 1.35, 1);
  g.add(ring);
  let disc: MeshBasicMaterial | null = null;
  if (withDisc) {
    disc = new MeshBasicMaterial({ color: new Color(color()), transparent: true, opacity: 0.14, depthWrite: false, blending: AdditiveBlending });
    const d = new Mesh(markerDiscGeo, disc);
    d.rotation.x = -PI / 2;
    d.scale.set(1, 1.35, 1);
    g.add(d);
  }
  g.position.y = 0.012;
  g.visible = false;
  scene.add(g);
  const m = { group: g, mat, disc, phase: Math.random() * PI * 2, color };
  markers.push(m);
  return m;
}
const accent = (): string => theme.accent;
const selMarker = makeMarker(accent, true);
const legalMarkers: Marker[] = [];
for (let i = 0; i < 12; i++) legalMarkers.push(makeMarker(() => "#8fce6e", false));
const hintFromMarker = makeMarker(accent, false);
const hintToMarker = makeMarker(accent, false);
const stockHintMarker = makeMarker(accent, false);
stockHintMarker.group.position.set(STOCK_X, 0.012, Z_TOP);
// The hint guide: a dashed arc (no dashed line material: the dashes are segments) and a travelling arrowhead.
const hintLineMat = new LineBasicMaterial({ color: new Color(theme.accent), transparent: true, opacity: 0.85 });
const hintLine = new LineSegments(new BufferGeometry(), hintLineMat);
hintLine.visible = false;
hintLine.frustumCulled = false;
scene.add(hintLine);
const hintConeMat = new MeshBasicMaterial({ color: new Color(theme.accent), transparent: true, opacity: 0.95 });
const hintCone = new Mesh(new ConeGeometry(0.09, 0.26, 10), hintConeMat);
hintCone.visible = false;
scene.add(hintCone);
let hintCurve: QuadraticBezierCurve3 | null = null;
/** With bloom on, the travelling hint arrowhead is pushed into HDR so it glows. */
function tintMarkers(): void {
  for (const m of markers) { m.mat.color.set(m.color()); m.disc?.color.set(m.color()); }
  hintLineMat.color.set(theme.accent);
  hintConeMat.color.set(theme.accent);
  if (look?.bloom) hintConeMat.color.multiplyScalar(3);
}

function locPos(loc: Loc): { x: number; z: number } {
  if (loc.zone === "stock") return { x: STOCK_X, z: Z_TOP };
  if (loc.zone === "waste") {
    const n = lastSnapshot ? lastSnapshot.waste.length : 0;
    const c = n > 0 ? locMap.get(`waste/0/${n - 1}`) : undefined;
    return c?.target ? { x: c.target.x, z: c.target.z } : { x: WASTE_X, z: Z_TOP };
  }
  if (loc.zone === "foundation") return { x: foundX(loc.pile), z: Z_TOP };
  if (loc.index != null && loc.index >= 0) {
    const c = locMap.get(`tableau/${loc.pile}/${loc.index}`);
    if (c?.target) return { x: c.target.x, z: c.target.z };
  }
  return dropPos.tableau[loc.pile] ?? { x: tabX(loc.pile), z: Z_TAB0 };
}
function runCardsAt(loc: Loc): Card[] {
  if (!lastSnapshot) return [];
  const out: Card[] = [];
  if (loc.zone === "waste") {
    const n = lastSnapshot.waste.length;
    const c = n > 0 ? locMap.get(`waste/0/${n - 1}`) : undefined;
    if (c) out.push(c);
  } else if (loc.zone === "foundation") {
    const pile = lastSnapshot.foundations[loc.pile] ?? [];
    const c = locMap.get(`foundation/${loc.pile}/${pile.length - 1}`);
    if (c) out.push(c);
  } else if (loc.zone === "tableau") {
    const pile = lastSnapshot.tableau[loc.pile] ?? [];
    const start = loc.index == null || loc.index < 0 ? pile.length - 1 : loc.index;
    for (let i = start; i < pile.length; i++) { const c = locMap.get(`tableau/${loc.pile}/${i}`); if (c) out.push(c); }
  }
  return out;
}

let selection: { cards: Card[]; from: Loc } | null = null;
let drag: { cards: Card[]; x: number; z: number } | null = null;
/** The selected run lifts and glows over a pulsing accent ring. */
export function setSelection(sel: Loc | null): void {
  if (selection) for (const c of selection.cards) c.selected = false;
  selection = null;
  selMarker.group.visible = false;
  if (!sel) return;
  const run = runCardsAt(sel);
  if (!run.length) return;
  selection = { cards: run, from: sel };
  for (const c of run) { c.selected = true; c.pulseT0 = simTime; }
  const p = locPos(sel);
  selMarker.group.position.set(p.x, 0.012, p.z);
  selMarker.group.visible = true;
}
/** The dragged run follows a world point over the table; null flies it back to its poses. */
export function setDragged(info: { from: Loc; x: number; z: number } | null): void {
  if (drag && !info) {
    for (const c of drag.cards) {
      c.pose = { x: drag.x, y: DRAG_Y + c.dragK * 0.05, z: drag.z + c.dragK * UP_GAP * 0.92, rot: 0 };
      c.dragK = -1;
      if (c.target) startTween(c, c.target, 0, reducedMotion ? 0.08 : 0.3, 0.25);
    }
    drag = null;
  }
  if (!info) return;
  if (drag) { drag.x = info.x; drag.z = info.z; return; }
  const run = runCardsAt(info.from);
  if (!run.length) return;
  drag = { cards: run, x: info.x, z: info.z };
  run.forEach((c, i) => { c.dragK = i; c.tween = null; });
}
export function setLegalTargets(targets: Loc[]): void {
  for (const m of legalMarkers) m.group.visible = false;
  targets.slice(0, legalMarkers.length).forEach((t, i) => {
    const p = locPos(t);
    legalMarkers[i]!.group.position.set(p.x, 0.012, p.z);
    legalMarkers[i]!.group.visible = true;
  });
}
export function setHint(hint: { draw: true } | { from: Loc; to: Loc } | null): void {
  hintFromMarker.group.visible = hintToMarker.group.visible = stockHintMarker.group.visible = false;
  hintLine.visible = hintCone.visible = false;
  hintCurve = null;
  if (!hint) return;
  if ("draw" in hint) { stockHintMarker.group.visible = true; return; }
  const a = locPos(hint.from), b = locPos(hint.to);
  hintFromMarker.group.position.set(a.x, 0.012, a.z);
  hintToMarker.group.position.set(b.x, 0.012, b.z);
  hintFromMarker.group.visible = hintToMarker.group.visible = true;
  hintCurve = new QuadraticBezierCurve3(new Vector3(a.x, 0.3, a.z), new Vector3((a.x + b.x) / 2, 1.7, (a.z + b.z) / 2), new Vector3(b.x, 0.3, b.z));
  // LineDashedMaterial dashSize 0.16 / gapSize 0.12, as segments along the arc.
  const pts = hintCurve.getPoints(96);
  const seg: Vector3[] = [];
  let along = 0;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1]!, p1 = pts[i]!;
    const mid = along + p0.distanceTo(p1) / 2;
    if (mid % 0.28 < 0.16) seg.push(p0, p1);
    along += p0.distanceTo(p1);
  }
  hintLine.geometry.dispose();
  hintLine.geometry = new BufferGeometry().setFromPoints(seg);
  hintLine.visible = hintCone.visible = true;
}

// ---------------------------------------------------------------- particles
let softDot: Texture | null = null;
let motes: { pts: Points; pos: Float32Array; vel: Float32Array; live: number } | null = null;
function ensureMotes(): void {
  if (motes) return;
  softDot ??= image("soft-dot.png");
  const r = mulberry32(seed || 1);
  const pos = new Float32Array(MOTE_MAX * 3), vel = new Float32Array(MOTE_MAX * 3);
  for (let i = 0; i < MOTE_MAX; i++) {
    pos[i * 3] = (r() - 0.5) * 17; pos[i * 3 + 1] = 0.3 + r() * 5.5; pos[i * 3 + 2] = -7.5 + r() * 13;
    vel[i * 3] = (r() - 0.5) * 0.12; vel[i * 3 + 1] = 0.04 + r() * 0.08; vel[i * 3 + 2] = (r() - 0.5) * 0.1;
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  const pts = new Points(geo, new PointsMaterial({ size: 0.07, map: softDot, transparent: true, opacity: 0.5, depthWrite: false, blending: AdditiveBlending, color: new Color("#ffe9c0") }));
  pts.frustumCulled = false;
  scene.add(pts);
  motes = { pts, pos, vel, live: 0 };
}
const PUFF_MAX = 48;
const puffPos = new Float32Array(PUFF_MAX * 3), puffVel = new Float32Array(PUFF_MAX * 3), puffLife = new Float32Array(PUFF_MAX);
const puffGeo = new BufferGeometry();
puffGeo.setAttribute("position", new BufferAttribute(puffPos, 3));
puffGeo.setDrawRange(0, 0);
const puffMat = new PointsMaterial({ size: 0.16, transparent: true, opacity: 0.55, depthWrite: false, color: new Color("#e8dcc2") });
const puff = new Points(puffGeo, puffMat);
puff.frustumCulled = false;
scene.add(puff);
function spawnPuff(x: number, y: number, z: number, count: number, spread: number): void {
  if (!look) return;
  puffMat.map ??= image("soft-dot.png");
  let placed = 0;
  for (let i = 0; i < PUFF_MAX && placed < count; i++) {
    if (puffLife[i]! > 0) continue;
    puffPos[i * 3] = x + (rng() - 0.5) * 0.5; puffPos[i * 3 + 1] = y + rng() * 0.1; puffPos[i * 3 + 2] = z + (rng() - 0.5) * 0.5;
    puffVel[i * 3] = (rng() - 0.5) * spread; puffVel[i * 3 + 1] = 0.35 + rng() * 0.5; puffVel[i * 3 + 2] = (rng() - 0.5) * spread;
    puffLife[i] = 0.55 + rng() * 0.25;
    placed++;
  }
}
interface Petal { x: number; y: number; z: number; vx: number; vy: number; vz: number; rx: number; ry: number; rz: number; spin: number; sway: number; life: number }
const petalGeo = new PlaneGeometry(0.17, 0.24);
let petalMat: MeshBasicMaterial | null = null;
let petals: InstancedMesh | null = null;
const petalState: Petal[] = [];
for (let i = 0; i < PETAL_MAX; i++) petalState.push({ x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, spin: 0, sway: 0, life: 0 });
let petalSpawnLeft = 0;
function ensurePetals(): InstancedMesh {
  if (!petals) {
    petalMat = new MeshBasicMaterial({ map: image(`petal-${theme.id}.png`), transparent: true, depthWrite: false, side: DoubleSide });
    petals = new InstancedMesh(petalGeo, petalMat, PETAL_MAX);
    petals.count = 0;
    petals.frustumCulled = false;
    scene.add(petals);
  }
  return petals;
}

let winT0 = -1;
/** Tiered event effects: the win petals and light swell, place / flip puffs, the invalid shake. */
export function playEvent(type: "win" | "place" | "flip" | "invalid"): void {
  if (type === "win") {
    winT0 = simTime;
    if (!reducedMotion && look) { ensurePetals(); petalSpawnLeft = Math.min(petalCount(look), PETAL_MAX); }
  } else if (type === "place") {
    spawnPuff(lastMovePos.x, 0.15, lastMovePos.z, 12, 1.4);
    if (lastMoveCard) lastMoveCard.pulseT0 = simTime;
  } else if (type === "flip") {
    spawnPuff(lastMovePos.x, 0.25, lastMovePos.z, 6, 0.7);
  } else {
    const list = selection && selection.cards.length ? selection.cards : lastMoveCard ? [lastMoveCard] : [];
    for (const c of list) c.shakeT0 = simTime;
  }
}

// ---------------------------------------------------------------- picking
const raycaster = new Raycaster();
const dragPlane = new Plane(new Vector3(0, 1, 0), -(FELT_Y + CARD_Y0));
/** Window pixels → the card or slot under them (render3d.js pick). */
export function pick(x: number, y: number): Loc | null {
  if (!renderer.camera) return null;
  raycaster.setFromCamera(pointerToNdc(x, y), camera);
  const list: Object3D[] = [];
  for (const c of cards.values()) if (c.interactive && c.dragK < 0) list.push(c.body);
  for (const s of slotMeshes) list.push(s.mesh);
  for (const h of raycaster.intersectObjects(list, false)) {
    const id = h.object.userData.cardId as number | undefined;
    if (id !== undefined) {
      const c = cards.get(id)!;
      return { zone: c.zone!, pile: c.pile, index: c.index };
    }
    const s = slotMeshes.find((m) => m.mesh === h.object);
    if (!s) continue;
    if (s.loc.zone === "stock" && lastSnapshot && lastSnapshot.stock.length > 0) continue;
    return { ...s.loc };
  }
  return null;
}
export function pointerToWorld(x: number, y: number): { x: number; z: number } {
  raycaster.setFromCamera(pointerToNdc(x, y), camera);
  const out = new Vector3();
  return raycaster.ray.intersectPlane(dragPlane, out) ? { x: out.x, z: out.z } : { x: 0, z: 0 };
}

/** The window rectangle of a location's pickable part: a fanned card's visible strip, the top card or a slot. */
export interface Rect { x: number; y: number; width: number; height: number }
export function screenRect(loc: Loc): Rect | null {
  if (!renderer.camera || !lastSnapshot) return null;
  let cx: number, cz: number, y = CARD_Y0, z1: number;
  const hh = CARD_H / 2, hw = CARD_W / 2;
  if (loc.zone === "tableau" && loc.index != null && loc.index >= 0) {
    const c = locMap.get(`tableau/${loc.pile}/${loc.index}`);
    if (!c?.target) return null;
    cx = c.target.x; cz = c.target.z; y = c.target.y;
    const next = locMap.get(`tableau/${loc.pile}/${loc.index + 1}`);
    z1 = next?.target ? next.target.z - hh : cz + hh;
  } else if (loc.zone === "waste") {
    const n = lastSnapshot.waste.length;
    const c = n ? locMap.get(`waste/0/${n - 1}`) : undefined;
    if (!c?.target) return null;
    cx = c.target.x; cz = c.target.z; y = c.target.y; z1 = cz + hh;
  } else {
    const p = locPos(loc);
    cx = p.x; cz = p.z; z1 = cz + hh;
  }
  const z0 = cz - hh;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [dx, dz] of [[-hw, z0], [hw, z0], [hw, z1], [-hw, z1]] as const) {
    const s = toScreen(cx + dx, y + CARD_T, dz);
    x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x); y1 = Math.max(y1, s.y);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
function toScreen(x: number, y: number, z: number): { x: number; y: number } {
  const v = new Vector3(x, y, z).project(camera);
  return { x: ((v.x + 1) / 2) * win.w, y: ((1 - v.y) / 2) * win.h };
}

// ---------------------------------------------------------------- camera
export interface ViewRect { x: number; y: number; width: number; height: number }
let view: ViewRect = { x: 0, y: 0, width: 1, height: 1 };
let win = { w: 1, h: 1 };
let frameKey = "";
let fitBottomZ = 4.35;
/** render3d.js refit: the board as used (deepest pile + headroom) in the playfield's aspect. */
function refit(): void {
  camera.aspect = view.width / Math.max(1, view.height);
  const narrow = camera.aspect < 0.9;
  const boardW = 8.32 + (narrow ? 0.7 : 2.2);
  const boardD = (5.3 + fitBottomZ) * Math.sin(TILT) + (narrow ? 1.2 : 2.3);
  const tanHalf = Math.tan((camera.fov * PI) / 360);
  const d = Math.max(boardW / (2 * tanHalf * camera.aspect), boardD / (2 * tanHalf));
  camTarget.z = (Z_TOP - 0.7 + fitBottomZ) / 2 - 0.3;
  camBase.set(camTarget.x, camTarget.y + d * Math.sin(TILT), camTarget.z + d * Math.cos(TILT));
  camera.position.copy(camBase);
  camera.lookAt(camTarget);
  camera.setViewOffset(view.width, view.height, -view.x, -view.y, win.w, win.h);
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- per frame
let simTime = 0;
function applyCard(card: Card): void {
  const tw = card.tween;
  if (tw) {
    let p = (simTime - tw.t0) / tw.dur;
    if (p >= 1) { card.pose = { x: tw.x, y: tw.y, z: tw.z, rot: tw.r }; card.tween = null; }
    else {
      if (p < 0) p = 0;
      const e = easeOutCubic(p);
      card.pose.x = tw.fx + (tw.x - tw.fx) * e;
      card.pose.y = tw.fy + (tw.y - tw.fy) * e + Math.sin(p * PI) * tw.arc;
      card.pose.z = tw.fz + (tw.z - tw.fz) * e;
      card.pose.rot = tw.fr + (tw.r - tw.fr) * easeInOutCubic(p);
    }
  }
  let { x, y, z, rot } = card.pose;
  let scale = 1;
  if (card.dragK >= 0 && drag) { x = drag.x; z = drag.z + card.dragK * UP_GAP * 0.92; y = DRAG_Y + card.dragK * 0.05; rot = 0; }
  else if (card.selected) y += SEL_LIFT;
  if (card.shakeT0 >= 0) {
    const p = (simTime - card.shakeT0) / 0.4;
    if (p >= 1) card.shakeT0 = -1; else x += Math.sin(p * PI * 6) * (1 - p) * 0.07;
  }
  if (card.pulseT0 >= 0) {
    const p = (simTime - card.pulseT0) / 0.28;
    if (p >= 1) card.pulseT0 = -1; else scale = 1 + Math.sin(p * PI) * 0.07;
  }
  card.group.position.set(x, y, z);
  card.group.rotation.z = rot;
  card.group.scale.set(scale, scale, scale);
  card.group.visible = !card.hidden || !!card.tween || card.dragK >= 0;
  card.face.visible = Math.cos(rot) > 0;
  let ei = 0, ec = "";
  if (card.selected) { ei = 0.28 + Math.sin(simTime * 5) * 0.1; ec = theme.accent; }
  if (card.shakeT0 >= 0) { ei = (1 - (simTime - card.shakeT0) / 0.4) * 0.7; ec = "#c0392b"; }
  const m = card.faceMat;
  if (ei > 0) { m.emissive.set(ec); m.emissiveIntensity = ei; }
  else if (m.emissiveIntensity !== 0) m.emissiveIntensity = 0;
}
function updateParticles(dt: number): void {
  const on = !!look && !reducedMotion;
  if (on) ensureMotes();
  if (motes) {
    motes.pts.visible = on;
    if (on) {
      const live = Math.min(MOTE_MAX, moteCount(look!));
      motes.pts.geometry.setDrawRange(0, live);
      const p = motes.pos, v = motes.vel;
      for (let i = 0; i < live; i++) {
        let yy = p[i * 3 + 1]! + v[i * 3 + 1]! * dt;
        let xx = p[i * 3]! + (v[i * 3]! + Math.sin(simTime * 0.5 + i) * 0.03) * dt;
        let zz = p[i * 3 + 2]! + v[i * 3 + 2]! * dt;
        if (yy > 6) yy = 0.3;
        if (xx > 8.5) xx = -8.5; else if (xx < -8.5) xx = 8.5;
        if (zz > 5.5) zz = -7.5; else if (zz < -7.5) zz = 5.5;
        p[i * 3] = xx; p[i * 3 + 1] = yy; p[i * 3 + 2] = zz;
      }
      motes.pts.geometry.getAttribute("position")!.needsUpdate = true;
    }
  }
  let alive = 0;
  for (let i = 0; i < PUFF_MAX; i++) {
    if (puffLife[i]! <= 0) continue;
    puffLife[i]! -= dt;
    if (puffLife[i]! <= 0) continue;
    alive++;
    puffVel[i * 3 + 1]! -= 1.1 * dt;
    puffPos[i * 3]! += puffVel[i * 3]! * dt;
    puffPos[i * 3 + 1] = Math.max(0.02, puffPos[i * 3 + 1]! + puffVel[i * 3 + 1]! * dt);
    puffPos[i * 3 + 2]! += puffVel[i * 3 + 2]! * dt;
  }
  puffGeo.getAttribute("position")!.needsUpdate = true;
  puffGeo.setDrawRange(0, alive > 0 ? PUFF_MAX : 0);
  puffMat.opacity = alive > 0 ? 0.55 : 0;
  if (!petals) return;
  const cap = look ? Math.min(PETAL_MAX, petalCount(look)) : 0;
  if (petalSpawnLeft > 0) {
    const n = Math.min(petalSpawnLeft, Math.ceil(dt * cap * 1.1));
    let spawned = 0;
    for (let i = 0; i < cap && spawned < n; i++) {
      const ps = petalState[i]!;
      if (ps.life > 0) continue;
      Object.assign(ps, {
        x: (rng() - 0.5) * 9, y: 2.2 + rng() * 2.2, z: -5.5 + rng() * 9, vx: (rng() - 0.5) * 0.4, vy: -(1.1 + rng() * 0.9), vz: (rng() - 0.5) * 0.3,
        rx: rng() * PI, ry: rng() * PI, rz: rng() * PI, spin: 2 + rng() * 4, sway: rng() * PI * 2, life: 3.2,
      });
      spawned++;
    }
    petalSpawnLeft -= n;
  }
  let active = 0;
  for (let i = 0; i < cap; i++) {
    const ps = petalState[i]!;
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
    _s1.set(fade, fade, fade);
    _m1.compose(_v1, _q1, _s1);
    petals.setMatrixAt(active++, _m1);
  }
  petals.count = active;
  if (active > 0) petals.instanceMatrix.needsUpdate = true;
}
function updateMarkers(): void {
  const pulse = (m: Marker, base: number, amp: number, speed: number): void => {
    const s = 1 + Math.sin(simTime * speed + m.phase) * amp;
    m.group.scale.set(s, 1, s);
    m.mat.opacity = base + Math.sin(simTime * speed + m.phase) * 0.18;
  };
  if (selMarker.group.visible) pulse(selMarker, 0.7, 0.05, 4);
  for (const m of legalMarkers) if (m.group.visible) pulse(m, 0.5, 0.1, 3.2);
  for (const m of [hintFromMarker, hintToMarker, stockHintMarker]) if (m.group.visible) pulse(m, 0.9, 0.14, 5.5);
  if (hintCurve && hintCone.visible) {
    const t = (simTime * 0.45) % 1;
    hintCurve.getPoint(t, _v1);
    hintCurve.getTangent(t, _v2);
    hintCone.position.copy(_v1);
    hintCone.quaternion.setFromUnitVectors(UP_AXIS, _v2.normalize());
  }
}
function updateCamera(): void {
  if (reducedMotion || !cameraDrift) camera.position.copy(camBase);
  else camera.position.set(camBase.x + Math.sin(simTime * 0.11) * 0.22, camBase.y + Math.sin(simTime * 0.073 + 1.7) * 0.14, camBase.z + Math.sin(simTime * 0.057 + 0.6) * 0.12);
  camera.lookAt(camTarget);
}
function updateWin(): void {
  if (winT0 < 0) return;
  const p = (simTime - winT0) / 3.8;
  if (p >= 1) { winT0 = -1; accentLight.intensity = LIGHT.accent; return; }
  accentLight.intensity = LIGHT.accent * (1 + Math.sin(p * PI) * 3.2);
}
/** Window-light drift and vine sway (Background animated, not reduced motion). */
function updateAmbient(): void {
  const moving = !!look?.animated && !reducedMotion;
  if (windowLightMat && windowTex && look?.detailed) {
    windowLightMat.opacity = moving ? 0.12 * (0.82 + 0.18 * Math.sin(simTime * 0.23) * Math.sin(simTime * 0.071 + 1.3)) : 0.12;
    windowTex.offset.set(moving ? Math.sin(simTime * 0.05) * 0.02 : 0, moving ? Math.sin(simTime * 0.037 + 0.8) * 0.015 : 0);
  }
  if (envExtra?.visible) for (const v of vines) {
    v.group.rotation.z = moving ? Math.sin(simTime * 0.6 + v.phase) * 0.035 : 0;
    v.group.rotation.x = moving ? Math.sin(simTime * 0.45 + v.phase * 0.7) * 0.025 : 0;
  }
}

/** Each frame: the framing for the window and the playfield (window px), cards, particles, markers, camera. */
export function update(dt: number, w: number, h: number, rect: ViewRect): void {
  const fk = `${w}x${h}:${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
  if (w > 0 && h > 0 && rect.width > 0 && rect.height > 0 && fk !== frameKey) {
    frameKey = fk;
    win = { w, h };
    view = { ...rect };
    refit();
  }
  dt = Math.min(0.05, dt);
  simTime += dt;
  for (const c of cards.values()) applyCard(c);
  updateParticles(dt);
  updateMarkers();
  updateCamera();
  updateWin();
  updateAmbient();
}

// ---------------------------------------------------------------- look, theme, motion
function applyReflections(): void {
  const env = look!.reflections ? ensureEnvironment() : null;
  for (const [m, k] of envIntensity) {
    const s = m as MeshStandardMaterial;
    s.envMap = env;
    s.envMapIntensity = k;
  }
  hemi.intensity = env ? LIGHT.hemiIbl : LIGHT.hemi;
}
function rebuild(): void {
  if (petals) { scene.remove(petals); petalMat?.dispose(); petals = null; petalMat = null; }
  buildEnvironment();
  rebuildCardMaterials();
  tintMarkers();
  applyReflections();
  if (lastSnapshot) {
    const s = lastSnapshot;
    const wasDealt = dealt;
    setState(s, true);
    dealt = wasDealt;
  }
  if (selection) setSelection(selection.from);
}
/** The look of a quality tier (quality.ts). */
export function applyLook(next: Look): void {
  if (look && JSON.stringify(look) === JSON.stringify(next)) return;
  look = next;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = LIGHT.exposure;
  renderer.shadowMap.enabled = next.shadows > 0;
  keyLight.castShadow = next.shadows > 0;
  if (next.shadows > 0) keyLight.shadow.mapSize = next.shadows;
  // GTAOPass: blendIntensity 0.75, radius 0.45, distanceExponent 1.4, thickness 0.6; samples / denoise per tier.
  const hi = next.ao === "high";
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: 0.75, radius: 0.45, distanceExponent: 1.4, thickness: 0.6, scale: 1, samples: hi ? 16 : 8, resolution: next.budget.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: hi ? 6 : 4, rings: 2, samples: hi ? 16 : 8, radiusExponent: 2 },
  };
  // UnrealBloomPass(0.45, 0.5, threshold 2.4) on the linear HDR scene, as the runtime blooms.
  // three r160 page: bloom model "r160" with the page's strength 0.45 (engine.minor 30).
  renderer.bloom = next.bloom ? { model: "r160", strength: 0.45, radius: 0.5, threshold: BLOOM_THRESHOLD, resolution: next.budget.bloomRes } : null;
  // GradeShader after OutputPass (display space): S-curve 0.28, saturation 1.14, cool shadows / warm highlights, vignette 0.26.
  renderer.grade = next.grade ? {
    space: "display", contrastCurve: "s", contrast: 0.28, saturation: 1.14, split: [0.25, 0.85], shadows: [0.97, 1.0, 1.03], highlights: [1.04, 1.01, 0.95],
    vignette: { amount: 0.26, inner: 0.38, outer: 0.9, scale: [1.1, 1] },
  } : null;
  renderer.antialias = next.antialias;
  rebuild();
}
/** The player's theme (content.js THEMES). */
export function setTheme(id: string): void {
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0]!;
  if (t === theme && envRoot) return;
  theme = t;
  if (look) rebuild();
}
export function setReducedMotion(on: boolean): void {
  reducedMotion = on;
  if (on) { petalSpawnLeft = 0; for (const p of petalState) p.life = 0; }
}
export function setCameraDrift(on: boolean): void { cameraDrift = on; }
/** Whether the glasshouse draws (the 2D table and the title cover it). */
export function setActive(on: boolean): void { renderer.camera = on ? camera : null; }
