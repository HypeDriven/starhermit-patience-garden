// Key extraction for the i18n coverage test (run directly to list the keys).
// Keys are the US-English source strings: literal T('…') / N('…') calls in js/
// and in the engine client (native/*.ts), the session's score-breakdown
// labels, and the content tables' display text
// (modes, lessons and their steps, Journey stages, practice levels,
// challenges, themes, table profiles and bands, achievements).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MODES, LESSONS, JOURNEY, PRACTICE_LEVELS, CHALLENGES, THEMES, PROFILES, BAND_LABELS, ACHIEVEMENTS } from '../js/content.js';

const ROOT = new URL('..', import.meta.url).pathname;
const SKIP = new Set(['i18n.js', 'platform-i18n.js']);
const unescape = (s) => s.replace(/\\(['"`\\])/g, '$1');

export function sourceKeys() {
  const keys = new Set();
  const call = /(?<![\w.$])(?:T|N)\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")/g;
  for (const dir of ['js', 'native']) {
    for (const f of readdirSync(join(ROOT, dir))) {
      if (!(f.endsWith('.js') || f.endsWith('.ts')) || SKIP.has(f)) continue;
      const src = readFileSync(join(ROOT, dir, f), 'utf8');
      for (const m of src.matchAll(call)) keys.add(unescape(m[1] ?? m[2]));
    }
  }
  // Score-breakdown row labels (session.js breakdown(), translated by ui.js).
  const session = readFileSync(join(ROOT, 'js', 'session.js'), 'utf8');
  const rows = session.slice(session.indexOf('const rows = ['), session.indexOf('];', session.indexOf('const rows = [')));
  for (const m of rows.matchAll(/\['([^']+)'/g)) keys.add(m[1]);
  return keys;
}

export function contentKeys() {
  const keys = new Set();
  const add = (s) => { if (typeof s === 'string' && s) keys.add(s); };
  for (const m of MODES) { add(m.name); add(m.blurb); add(m.duration); add(m.assists); }
  for (const l of LESSONS) { add(l.title); for (const s of l.steps) add(s.text); }
  for (const s of JOURNEY) { add(s.title); add(s.text); }
  for (const p of PRACTICE_LEVELS) { add(p.label); add(p.text); }
  for (const c of CHALLENGES) { add(c.name); add(c.text); }
  for (const t of THEMES) add(t.name);
  for (const p of Object.values(PROFILES)) add(p.label);
  for (const b of Object.values(BAND_LABELS)) add(b);
  for (const a of ACHIEVEMENTS) { add(a.name); add(a.text); }
  return keys;
}

export const ALL = new Set([...sourceKeys(), ...contentKeys()]);

if (process.argv[1] && process.argv[1].endsWith('i18n-keys.mjs')) console.log(JSON.stringify([...ALL], null, 1));
