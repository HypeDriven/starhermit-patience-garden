// StarHermit adapter (js/platform.js) over the shared SDK with a stubbed fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The SDK is a classic browser script (this package is ESM): evaluate it the
// way a <script> tag would, against a stand-in global.
const holder = {};
new Function('self', 'module', readFileSync(new URL('../starhermit-sdk.js', import.meta.url), 'utf8'))(holder, undefined);
const SDK = holder.StarHermit;

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = () => `h.${b64u({ sub: 'user-1234567', game_scope: 'pg-slug', exp: Math.floor(Date.now() / 1000) + 3600 })}.s`;

function harness(hash, hostname = 'localhost') {
  const calls = [];
  const saves = {};
  const etags = {};
  let version = 0;
  const kv = { volumes: { music: 0.1, effects: 0.2, ambience: 0.3, voice: 0 } };
  const fetch = async (url, init = {}) => {
    calls.push({ method: init.method || 'GET', url, body: init.body });
    const r = (status, body) => new Response(body, { status });
    if (url.endsWith('/profile')) return r(200, JSON.stringify({ username: 'u', nickname: 'Fern' }));
    if (url.includes('/cloud-saves/')) {
      // Conditional writes like the platform: If-Match / If-None-Match after a
      // load, 412 with the current etag when stale, { etag } on success.
      const tail = decodeURIComponent(url.split('/cloud-saves/')[1]);
      const key = tail.replace(/\/info$/, '');
      const hd = new Headers(init.headers || {});
      if (tail.endsWith('/info')) return r(200, JSON.stringify(saves[key] ? { exists: true, etag: etags[key] } : { exists: false }));
      if (init.method === 'PUT') {
        if ((hd.get('If-Match') && hd.get('If-Match') !== etags[key]) || (hd.get('If-None-Match') === '*' && saves[key])) return r(412, JSON.stringify({ etag: etags[key] || null }));
        saves[key] = Buffer.from(JSON.parse(init.body).dataBase64, 'base64');
        etags[key] = `"v${++version}"`;
        return r(200, JSON.stringify({ etag: etags[key] }));
      }
      return saves[key] ? r(200, saves[key]) : r(404, '');
    }
    if (url.endsWith('/settings') && init.method === 'PATCH') { Object.assign(kv, JSON.parse(init.body).settings); return r(200, '{}'); }
    if (url.endsWith('/settings')) return r(200, JSON.stringify({ settings: kv }));
    if (url.endsWith('/controls')) return r(200, JSON.stringify({ actions: [{ action: 'draw', codes: ['KeyS'] }] }));
    return r(404, '');
  };
  const win = {
    location: { hash, search: '', pathname: '/', origin: `http://${hostname}`, hostname, href: `http://${hostname}/` },
    history: { replaceState() {} },
  };
  globalThis.window = { addEventListener() {} };
  globalThis.document = { addEventListener() {}, hidden: false };
  globalThis.StarHermit = SDK.create({ window: win, fetch, setTimeout: () => 0, clearTimeout: () => {} });
  return { calls, saves, kv, etags, bump(key) { etags[key] = `"v${++version}"`; } };
}

test('hosted: token, nickname, cloud save game:<slug>, settings, bindings', async () => {
  const h = harness(`#game_token=${token()}`);
  const platform = await import('../js/platform.js?hosted');
  const boot = platform.initPlatform();
  assert.equal(boot.hosted, true);
  assert.equal(platform.playerId(), 'user-1234567');
  assert.equal(await boot.ready, null, 'no cloud save yet');
  assert.equal(platform.nickname(), 'Fern');
  assert.match(platform.inviteLink(), /\/game-invite\/user-1234567\/pg-slug$/);

  const doc = { version: 1, progress: { journey: { a: 1 } } };
  platform.queueCloudSave(doc);
  assert.equal(await platform.flushCloudSave(), true);
  assert.deepEqual(Object.keys(h.saves), ['game:pg-slug']);
  assert.ok(h.calls.some((c) => c.method === 'PUT' && c.url === '/api/v1/me/cloud-saves/game%3Apg-slug'));
  assert.deepEqual(await platform.loadCloudDoc(), doc);

  const remote = await platform.loadRemoteSettings();
  assert.equal(remote.volumes.music, 0.1);
  await platform.syncSettings({ version: 1, volumes: remote.volumes, muted: true });
  const patch = h.calls.filter((c) => c.method === 'PATCH');
  assert.equal(patch.length, 1);
  assert.deepEqual(JSON.parse(patch[0].body), { settings: { muted: true } }, 'only changed keys are patched');
  assert.equal(h.kv.muted, true);

  const b = await platform.loadBindings({ draw: ['KeyD'], undo: ['KeyU'] });
  assert.deepEqual(b, { draw: ['KeyS'], undo: ['KeyU'] });
});

test('standalone: no token means no fetch and local defaults', async () => {
  const h = harness('');
  const platform = await import('../js/platform.js?standalone');
  const boot = platform.initPlatform();
  assert.equal(boot.hosted, false);
  assert.equal(await boot.ready, null);
  assert.equal(platform.nickname(), null);
  assert.equal(platform.inviteLink(), null);
  assert.equal(platform.canSignIn(), false, 'no sign-in button off the starhermit domain');
  platform.queueCloudSave({ version: 1 });
  assert.deepEqual(await platform.loadRemoteSettings(), {});
  assert.equal(await platform.syncSettings({ muted: true }), null);
  assert.deepEqual(await platform.loadBindings({ draw: ['KeyD'] }), { draw: ['KeyD'] });
  assert.equal(await platform.globalBoardRows(), null);
  assert.equal(h.calls.length, 0);
});

test('sign-in is offered on a StarHermit UUID host without a token', async () => {
  harness('', '0b9d6f2e-3c4a-4e5b-9a7c-1d2e3f405162.starhermit.com');
  const platform = await import('../js/platform.js?uuid-host');
  assert.equal(platform.initPlatform().hosted, false);
  assert.equal(platform.canSignIn(), true);
});

test('cloud-save conflict: a write that lost to another device is reported, re-read and merged', async () => {
  const h = harness(`#game_token=${token()}`);
  const platform = await import('../js/platform.js?conflict');
  const { mergeSaveDocs } = await import('../js/save-merge.js');
  const boot = platform.initPlatform();
  await boot.ready;
  const mine = { version: 1, settings: {}, progress: { journey: { 'journey-01': { stars: 3, bestMoves: 90, completedAt: 5 } } }, stats: { games: 3, wins: 2 }, achievements: { unlocked: { first_bloom: 50 } }, scores: { entries: [] } };
  platform.queueCloudSave(mine);
  assert.equal(await platform.flushCloudSave(), true);
  await platform.loadCloudDoc(); // writes are conditional on this version from now on
  // Another device saves a newer document.
  const other = { version: 1, settings: { theme: 'dusk-orchid' }, progress: { journey: { 'journey-01': { stars: 2, bestMoves: 80, completedAt: 9 }, 'journey-02': { stars: 1, completedAt: 10 } } }, stats: { games: 7, wins: 4 }, achievements: { unlocked: { first_bloom: 70, graduate: 80 } }, scores: { entries: [] } };
  h.saves['game:pg-slug'] = Buffer.from(await globalThis.StarHermit._zip('save.json', new TextEncoder().encode(JSON.stringify(other))));
  h.bump('game:pg-slug');
  let conflicts = 0;
  platform.onSaveConflict(() => { conflicts++; });
  platform.queueCloudSave({ ...mine, stats: { games: 4, wins: 3 } });
  assert.equal(await platform.flushCloudSave(), false);
  assert.equal(conflicts, 1);
  const remote = await platform.loadCloudDoc();
  assert.equal(remote.stats.games, 7, 'the other device\'s save survived');
  const merged = mergeSaveDocs(remote, { ...mine, stats: { games: 4, wins: 3 } });
  assert.equal(merged.progress.journey['journey-01'].stars, 3);
  assert.equal(merged.progress.journey['journey-01'].bestMoves, 80);
  assert.ok(merged.progress.journey['journey-02']);
  assert.equal(merged.stats.games, 7);
  assert.equal(merged.stats.wins, 4);
  assert.deepEqual(merged.achievements.unlocked, { first_bloom: 50, graduate: 80 });
  assert.equal(merged.settings.theme, 'dusk-orchid', 'settings follow the account');
  platform.queueCloudSave(merged);
  assert.equal(await platform.flushCloudSave(), true);
  assert.equal((await platform.loadCloudDoc()).progress.journey['journey-01'].stars, 3);
});
