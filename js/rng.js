// Patience Garden — seeded random streams.
// Separate streams are used for rules, content decoration, and audiovisual
// variants so cosmetic randomness never influences rules outcomes.

/** Hash an arbitrary string to a 32-bit unsigned integer (FNV-1a). */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, deterministic PRNG. */
export function createRng(seed) {
  let a = seed >>> 0;
  const next = function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (n) => Math.floor(next() * n); // 0..n-1
  next.range = (lo, hi) => lo + next() * (hi - lo);
  next.pick = (arr) => arr[next.int(arr.length)];
  next.state = () => a >>> 0;
  return next;
}

/** Deterministic Fisher–Yates shuffle (returns a new array). */
export function shuffled(arr, rng) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

/** Stable checksum for saved documents / replay envelopes (hex string). */
export function checksum(value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}
