// Every player-facing string exists in all nine locales (node --test).
// Keys are the US-English source strings (see tests/i18n-keys.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DICTS, LOCALES, T, setLocale, getLang, onLanguage } from '../js/i18n.js';
import { gfxStrings, pickGfxLocale } from '../js/gfx-i18n.js';
import { platformStrings } from '../js/platform-i18n.js';
import { ALL } from './i18n-keys.mjs';

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const tags = (s) => (String(s).match(/<[^>]+>/g) || []).join('');

test('the key set is non-trivial', () => {
  assert.ok(ALL.size > 400, `only ${ALL.size} keys found`);
});

for (const locale of LOCALES.filter((l) => l !== 'en-US' && l !== 'en-GB')) {
  test(`${locale}: every key used in markup, code and content is translated with the same placeholders and markup`, () => {
    const dict = DICTS[locale];
    const missing = [...ALL].filter((k) => !Object.prototype.hasOwnProperty.call(dict, k));
    assert.deepEqual(missing, [], `${missing.length} missing in ${locale}`);
    assert.deepEqual([...ALL].filter((k) => placeholders(dict[k]) !== placeholders(k)), [], 'placeholder mismatch');
    assert.deepEqual([...ALL].filter((k) => tags(dict[k]) !== tags(k)), [], 'markup mismatch');
  });
}

test('no locale carries keys that no longer exist', () => {
  for (const locale of LOCALES) {
    const stray = Object.keys(DICTS[locale]).filter((k) => !ALL.has(k));
    assert.deepEqual(stray, [], locale);
  }
});

test('Graphics and account strings exist for every game locale', () => {
  for (const locale of LOCALES) {
    const picked = pickGfxLocale([locale]);
    assert.equal(picked, locale);
    assert.ok(gfxStrings(picked).section, locale);
    assert.ok(platformStrings(picked).signIn, locale);
  }
  assert.equal(gfxStrings('de-DE').section, 'Grafik');
});

test('T falls back to the key and fills placeholders; regional variants inherit', () => {
  setLocale('de-DE');
  assert.equal(T('Not a real key {x}', { x: 1 }), 'Not a real key 1');
  assert.equal(T('{n} moves', { n: 3 }), '3 Züge');
  assert.equal(T('{rank} of {suit}', { rank: T('Queen'), suit: T('Hearts') }), 'Herz-Dame');
  setLocale('fr-CA');
  assert.equal(T('Score'), 'Pointage');
  assert.equal(T('Hint'), 'Indice');
  setLocale('es-ES');
  assert.equal(T('Settings'), 'Ajustes');
  assert.equal(T('Hint'), 'Pista');
  setLocale('en-GB');
  assert.equal(T('Color-vision palette'), 'Colour-vision palette');
  assert.equal(T('Hint'), 'Hint');
  setLocale('xx-YY');
  assert.equal(getLang(), 'en-US');
});

test('onLanguage listeners fire only when the locale changes', () => {
  setLocale('en-US');
  const seen = [];
  const off = onLanguage((l) => seen.push(l));
  setLocale('it-IT');
  setLocale('it-IT');
  setLocale('pt-BR');
  off();
  setLocale('en-US');
  assert.deepEqual(seen, ['it-IT', 'pt-BR']);
});
