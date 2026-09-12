// Patience Garden — StarHermit platform adapter.
// Reads the launch token from the URL fragment, refreshes it on schedule,
// resolves the account nickname, mirrors the local save documents to the
// cloud slot, submits ranked replays for validation, and reads the platform
// leaderboard (read-only). Everything degrades to pure local play when no
// token was read: same-origin fetches only, no hard-coded API base, no
// tokens ever persisted.

const REFRESH_MS = 45 * 60 * 1000; // token lifetime is 60 min; refresh ahead of it
const REFRESH_RETRY_MS = 60 * 1000;
const SAVE_DEBOUNCE_MS = 2000;

function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1];
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Stored-zip helper (single stored entry, no compression, CRC32 included).
// Cloud saves are small JSON documents; stored entries are fine.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(name, dataBytes) {
  const enc = new TextEncoder();
  const nameB = enc.encode(name);
  const crc = crc32(dataBytes);
  const out = [];
  const u16 = (v) => out.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v) => out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0);
  u32(crc); u32(dataBytes.length); u32(dataBytes.length);
  u16(nameB.length); u16(0);
  const head = new Uint8Array(out);
  const cd = [];
  const c16 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff);
  const c32 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  c32(0x02014b50); c16(20); c16(20); c16(0); c16(0); c16(0); c16(0);
  c32(crc); c32(dataBytes.length); c32(dataBytes.length);
  c16(nameB.length); c16(0); c16(0); c16(0); c16(0); c32(0); c32(0); // attrs + local-header offset
  const cdHead = new Uint8Array(cd);
  const cdOff = head.length + nameB.length + dataBytes.length;
  const parts = [head, nameB, dataBytes, cdHead, nameB];
  const eocd = [];
  const e32 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  const e16 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff);
  e32(0x06054b50); e16(0); e16(0); e16(1); e16(1);
  e32(cdHead.length + nameB.length); e32(cdOff); e16(0);
  parts.push(new Uint8Array(eocd));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf;
}
function unzipFirstEntry(zipBytes) {
  // Stored single-entry reader: scan local headers for compression 0.
  const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let off = 0;
  while (off + 30 <= zipBytes.length && dv.getUint32(off, true) === 0x04034b50) {
    const method = dv.getUint16(off + 8, true);
    const size = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const dataOff = off + 30 + nameLen + extraLen;
    if (method !== 0) throw new Error('unsupported zip entry');
    return zipBytes.slice(dataOff, dataOff + size);
  }
  throw new Error('bad zip');
}
function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToBytes(b64) {
  const s = atob(b64);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

// ---------------------------------------------------------------------------
// Adapter state
// ---------------------------------------------------------------------------

const state = {
  token: null,          // launch token, in memory only
  sub: null,            // user id from the token payload
  gameKey: null,        // game slug from game_scope — never hard-coded
  nickname: null,
  hosted: false,
  sync: 'offline',      // offline | syncing | synced | error
  timeOffsetMs: 0,      // round-trip adjusted, from GET /api/v1/time
};

const statusListeners = new Set();
function setSync(status) {
  if (state.sync === status) return;
  state.sync = status;
  for (const fn of statusListeners) fn(status);
}
export function onSyncStatus(fn) { statusListeners.add(fn); }
export function syncStatus() { return state.sync; }

/** Read the launch token once (fragment first; query fallbacks for local dev). */
function readToken() {
  let token = null;
  const hash = window.location.hash;
  if (hash.startsWith('#game_token=')) {
    token = new URLSearchParams(hash.slice(1)).get('game_token');
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  if (!token) {
    // Local dev only: the platform delivers the token in the fragment.
    token = new URLSearchParams(window.location.search).get('token')
      || new URLSearchParams(window.location.search).get('game_token');
  }
  return token;
}

async function api(path, { method = 'GET', body = null, binary = false } = {}) {
  const headers = { authorization: `Bearer ${state.token}` };
  if (body !== null && !binary) headers['content-type'] = 'application/json';
  const res = await fetch(path, {
    method,
    headers,
    body: body === null ? null : binary ? body : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = new Error(`api ${path} failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return binary ? res.arrayBuffer() : res.json();
}

// --- token refresh ----------------------------------------------------------

function scheduleRefresh(delay = REFRESH_MS) {
  setTimeout(async () => {
    try {
      const r = await api(`/api/v1/games/${encodeURIComponent(state.gameKey)}/launch-token`, {
        method: 'POST',
        body: { token: state.token },
      });
      if (r && typeof r.token === 'string' && r.token) state.token = r.token;
      scheduleRefresh();
    } catch {
      // transient — retry shortly, keep playing on the current token
      scheduleRefresh(REFRESH_RETRY_MS);
    }
  }, delay);
}

// --- identity ---------------------------------------------------------------

const profileCache = new Map();

/** Display name for a user id: nickname only, never username. Cached. */
export async function getNickname(userId) {
  if (!userId) return 'Player';
  if (profileCache.has(userId)) return profileCache.get(userId);
  let name = `Player ${String(userId).slice(0, 8)}`;
  try {
    const p = await api(`/api/v1/users/${encodeURIComponent(userId)}/profile`);
    if (p && typeof p.nickname === 'string' && p.nickname) name = p.nickname;
  } catch { /* fallback name stands */ }
  profileCache.set(userId, name);
  return name;
}

async function loadOwnProfile() {
  state.nickname = await getNickname(state.sub);
}

// --- cloud save (one slot, zip+base64; localStorage stays the offline cache) -

let pendingDoc = null;   // latest doc waiting for the debounced PUT
let saveTimer = null;
let saveInFlight = null;

function encodeDoc(doc) {
  return bytesToBase64(zipStore('save.json', new TextEncoder().encode(JSON.stringify(doc))));
}

function decodeDoc(bytes) {
  const raw = new TextDecoder().decode(unzipFirstEntry(new Uint8Array(bytes)));
  const doc = JSON.parse(raw);
  if (!doc || typeof doc !== 'object' || doc.version !== 1) throw new Error('bad cloud doc');
  return doc;
}

async function putCloud(doc) {
  await api(`/api/v1/me/cloud-saves/${encodeURIComponent(state.gameKey)}`, {
    method: 'PUT',
    body: { dataBase64: encodeDoc(doc) },
  });
}

/** Remote doc, or null when there is none / the platform is unreachable. */
export async function loadCloudDoc() {
  if (!state.hosted) return null;
  try {
    const buf = await api(`/api/v1/me/cloud-saves/${encodeURIComponent(state.gameKey)}`, { binary: true });
    const doc = decodeDoc(buf);
    setSync('synced');
    return doc;
  } catch (err) {
    // 404 = no cloud save yet — up to date, nothing to adopt
    setSync(err && err.status === 404 ? 'synced' : 'error');
    return null;
  }
}

function flushSave() {
  if (!state.hosted || pendingDoc === null || saveInFlight) return;
  const doc = pendingDoc;
  saveInFlight = putCloud(doc)
    .then(() => { if (pendingDoc === doc) pendingDoc = null; setSync('synced'); })
    .catch(() => setSync('error'))
    .finally(() => { saveInFlight = null; });
}

/** Debounced cloud mirror of the local save documents. */
export function queueCloudSave(doc) {
  if (!state.hosted) return;
  pendingDoc = doc;
  setSync('syncing');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
}

// --- server time ------------------------------------------------------------

async function syncClock() {
  try {
    const t0 = Date.now();
    const r = await api('/api/v1/time');
    const rtt = Date.now() - t0;
    if (r && typeof r.now === 'string') {
      state.timeOffsetMs = new Date(r.now).getTime() + rtt / 2 - Date.now();
    }
  } catch { /* local clock stands */ }
}

/** Round-trip adjusted server time (falls back to the local clock). */
export function serverNow() {
  return new Date(Date.now() + state.timeOffsetMs);
}

// --- ranked replay validation -------------------------------------------------
// The authoritative script (server.js) exposes POST /api/v1/validate. It is
// its-backend: reachable when the script serves the game, absent otherwise.
// Any failure leaves the result local — the board is labelled casual.

export async function validateReplay(envelope) {
  if (!state.hosted) return { ok: false, reason: 'offline' };
  try {
    const r = await api('/api/v1/validate', { method: 'POST', body: envelope });
    return { ok: true, accepted: !!r.accept, reason: r.reason || null, detail: r.detail || null };
  } catch (err) {
    return { ok: false, reason: err && err.status ? `http-${err.status}` : 'unreachable' };
  }
}

// --- leaderboards (read-only; personal bests stay local + cloud-saved) ------

/** Platform board info for this game, or null when none is configured. */
export async function leaderboardInfo() {
  if (!state.hosted) return null;
  try {
    const g = await api(`/api/v1/games/${encodeURIComponent(state.gameKey)}`);
    return g && g.leaderboardId ? { id: g.leaderboardId, me: g.me || null } : null;
  } catch {
    return null;
  }
}

/** Board entries with nicknames resolved (never usernames). */
export async function leaderboardEntries(leaderboardId, { friendsOnly = false, page = 1, pageSize = 20 } = {}) {
  const q = new URLSearchParams({ friendsOnly: String(friendsOnly), page: String(page), pageSize: String(pageSize) });
  const r = await api(`/api/v1/leaderboards/${encodeURIComponent(leaderboardId)}/entries?${q}`);
  const list = Array.isArray(r) ? r : (r && Array.isArray(r.entries)) ? r.entries : [];
  return Promise.all(list.map(async (e, i) => ({
    rank: e.rank ?? (page - 1) * pageSize + i + 1,
    name: await getNickname(e.userId ?? e.user_id ?? e.playerId),
    score: e.score ?? e.value ?? 0,
    detail: e.ms != null ? `${Math.floor(e.ms / 60000)}:${String(Math.floor(e.ms / 1000) % 60).padStart(2, '0')}` : '',
  })));
}

// --- boot -------------------------------------------------------------------

/**
 * Parse the launch token and, when hosted, load profile + cloud save and
 * schedule token refresh. Returns { hosted, ready } where `ready` resolves
 * after the initial remote round-trips (profile, cloud doc, clock).
 */
export function initPlatform() {
  const token = readToken();
  const payload = token ? decodeJwtPayload(token) : null;
  state.hosted = !!(token && payload && payload.sub && payload.game_scope);
  if (state.hosted) {
    state.token = token;
    state.sub = String(payload.sub);
    state.gameKey = String(payload.game_scope);
    setSync('syncing');
    scheduleRefresh();
    window.addEventListener('pagehide', () => { clearTimeout(saveTimer); flushSave(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { clearTimeout(saveTimer); flushSave(); }
    });
  }
  const ready = state.hosted
    ? Promise.allSettled([loadOwnProfile(), syncClock()]).then(() => loadCloudDoc())
    : Promise.resolve(null);
  return { hosted: state.hosted, ready };
}

export function playerId() { return state.sub; }
export function nickname() { return state.nickname; }
export function isHosted() { return state.hosted; }
