// Patience Garden — StarHermit platform adapter.
// Thin layer over the shared StarHermit SDK (starhermit-sdk.js, loaded as a
// classic script before the game modules): launch token + renewal, sign-in,
// account nickname, cloud mirror of the local save documents (slot
// game:<slug>), per-player settings KV, keyboard bindings, invite link,
// ranked replay validation through the game script and the read-only platform
// leaderboard. Without a launch token every call resolves locally and no
// network request is made.

const SAVE_DEBOUNCE_MS = 2000;

/** The SDK instance (window.StarHermit; tests may inject one on globalThis). */
function sdk() { return globalThis.StarHermit || null; }

const state = {
  nickname: null,
  sync: 'offline',      // offline | syncing | synced | error
  timeOffsetMs: 0,      // round-trip adjusted, from GET /api/v1/time
  sentSettings: {},     // key -> JSON last mirrored to the settings KV
  settingsLoaded: false, // no PATCH before the platform values were read
};

const statusListeners = new Set();
function setSync(status) {
  if (state.sync === status) return;
  state.sync = status;
  for (const fn of statusListeners) fn(status);
}
export function onSyncStatus(fn) { statusListeners.add(fn); }
export function syncStatus() { return state.sync; }

const authListeners = new Set();
/** fn({ signedIn }) after sign-out (token refused) or a new token. */
export function onAuthChange(fn) { authListeners.add(fn); }

export function isHosted() { return !!(sdk() && sdk().signedIn); }
export function playerId() { return isHosted() ? sdk().userId : null; }
export function nickname() { return isHosted() ? state.nickname : null; }

// --- sign-in / invite ---------------------------------------------------------

/** True only on <id>.starhermit.com without a token. */
export function canSignIn() { return !!(sdk() && sdk().canSignIn()); }
export function signIn() { return !!(sdk() && sdk().signIn()); }
/** Share link for "Invite a friend" (null when signed out). */
export function inviteLink() { return isHosted() ? sdk().inviteLink() : null; }

// --- identity -------------------------------------------------------------------

/** Display name for a user id: profile nickname, fallback "Player <id>". */
export async function getNickname(userId) {
  if (!userId) return 'Player';
  const p = isHosted() ? await sdk().profile(userId) : null;
  return p ? p.displayName : `Player ${String(userId).slice(0, 6)}`;
}

// --- cloud save (one slot; localStorage stays the offline cache) ----------------

function validDoc(doc) { return doc && typeof doc === 'object' && doc.version === 1 ? doc : null; }

/** Remote doc, or null when there is none / the platform is unreachable. */
export async function loadCloudDoc() {
  if (!isHosted()) return null;
  setSync('syncing');
  const doc = validDoc(await sdk().loadJSON());
  setSync('synced');
  return doc;
}

let saveWired = false;
function wireSaveEvents() {
  if (saveWired || !sdk()) return;
  saveWired = true;
  sdk().on('saved', (ok) => setSync(ok ? 'synced' : 'error'));
}

/** Debounced cloud mirror of the local save documents. */
export function queueCloudSave(doc) {
  if (!isHosted()) return;
  setSync('syncing');
  sdk().saveJSON(doc, SAVE_DEBOUNCE_MS);
}

/** Force the pending save out (pagehide / backgrounding). */
export function flushCloudSave(keepalive = true) {
  if (!isHosted()) return Promise.resolve(false);
  return sdk().flushSave(keepalive);
}

// --- per-player settings KV -------------------------------------------------------

/** Platform-stored preferences ({} when signed out / none). */
export async function loadRemoteSettings() {
  if (!isHosted()) return {};
  const s = await sdk().getSettings();
  state.settingsLoaded = true;
  for (const [k, v] of Object.entries(s || {})) state.sentSettings[k] = JSON.stringify(v);
  return s || {};
}

/** Mirror changed top-level preference keys with one PATCH. */
export function syncSettings(prefs) {
  if (!isHosted() || !state.settingsLoaded) return Promise.resolve(null);
  const patch = {};
  for (const [k, v] of Object.entries(prefs)) {
    if (k === 'version') continue;
    const json = JSON.stringify(v);
    if (state.sentSettings[k] !== json) { patch[k] = v; state.sentSettings[k] = json; }
  }
  return Object.keys(patch).length ? sdk().patchSettings(patch) : Promise.resolve(null);
}

// --- controls -----------------------------------------------------------------------

/** { action: codes[] } with the player's platform overrides applied. */
export function loadBindings(defaults) {
  const copy = () => Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, v.slice()]));
  if (!isHosted()) return Promise.resolve(copy());
  return sdk().loadBindings(defaults).catch(copy);
}

// --- server time ------------------------------------------------------------------

async function syncClock() {
  try {
    const t0 = Date.now();
    const r = await sdk().api('/api/v1/time');
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

// --- ranked replay validation -----------------------------------------------------
// The authoritative script (server.js) exposes POST /api/v1/validate when it
// serves the game. Any failure leaves the result local — the board is casual.

export async function validateReplay(envelope) {
  if (!isHosted()) return { ok: false, reason: 'offline' };
  try {
    const r = await sdk().api('/api/v1/validate', { method: 'POST', body: envelope });
    if (!r) return { ok: false, reason: 'unreachable' };
    return { ok: true, accepted: !!r.accept, reason: r.reason || null, detail: r.detail || null };
  } catch (err) {
    return { ok: false, reason: err && err.status ? `http-${err.status}` : 'unreachable' };
  }
}

// --- leaderboards (read-only; scores are written by the platform only) ----------

/** Rows of the game's first platform board, or null when none is configured. */
export async function globalBoardRows({ pageSize = 20 } = {}) {
  if (!isHosted()) return null;
  const r = await sdk().leaderboard(null, { pageSize });
  if (!r || !r.board) return null;
  const items = r.items || [];
  return Promise.all(items.map(async (e, i) => ({
    rank: e.rank ?? i + 1,
    name: await getNickname(e.userId),
    score: e.score ?? 0,
    detail: '',
  })));
}

// --- boot ---------------------------------------------------------------------------

async function loadOwnProfile() {
  const p = await sdk().profile();
  state.nickname = p ? p.displayName : null;
}

/**
 * Read the launch token (StarHermit.init) and, when hosted, load profile,
 * clock and cloud save. Returns { hosted, ready } where `ready` resolves to
 * the remote save doc (or null) after the initial round-trips.
 */
export function initPlatform() {
  const sh = sdk();
  if (!sh) return { hosted: false, ready: Promise.resolve(null) };
  if (!sh.signedIn) sh.init();
  wireSaveEvents();
  sh.on('auth', (a) => {
    if (!a.signedIn) { state.nickname = null; setSync('offline'); }
    for (const fn of authListeners) fn({ signedIn: !!a.signedIn });
  });
  const hosted = isHosted();
  if (hosted) {
    setSync('syncing');
    window.addEventListener('pagehide', () => { flushCloudSave(true); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushCloudSave(true); });
  }
  const ready = hosted
    ? Promise.allSettled([loadOwnProfile(), syncClock()]).then(() => loadCloudDoc())
    : Promise.resolve(null);
  return { hosted, ready };
}
