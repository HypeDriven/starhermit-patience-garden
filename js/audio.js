// Patience Garden — procedural audio: original short transients tied to
// logical events, a quiet glasshouse ambience, and adaptive music pads.
// Everything is synthesized with WebAudio — no audio assets. Seeded variant
// selection keeps replays consistent.

import { createRng } from './rng.js';

const BUS = { music: 0.5, effects: 0.8, ambience: 0.4, voice: 0.0 };

let ctx = null;
let buses = null;
let rng = createRng(1234);
let ambienceNodes = null;
let musicTimer = null;
let started = false;

function ensureContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  const master = ctx.createGain();
  master.connect(ctx.destination);
  buses = { master };
  for (const name of Object.keys(BUS)) {
    const g = ctx.createGain();
    g.gain.value = BUS[name];
    g.connect(master);
    buses[name] = g;
  }
  return ctx;
}

export function initAudio(seed = 1234) {
  rng = createRng(seed >>> 0);
  ensureContext();
}

/** Must be called from a user gesture at least once. */
export function unlockAudio() {
  if (!ensureContext()) return;
  if (ctx.state === 'suspended') ctx.resume();
  if (!started) {
    started = true;
    startAmbience();
    startMusic();
  }
}

export function setVolumes(vols) {
  if (!ensureContext()) return;
  for (const [k, v] of Object.entries(vols)) {
    if (buses[k]) buses[k].gain.setTargetAtTime(Math.max(0, Math.min(1, v)), ctx.currentTime, 0.05);
  }
}

export function setMuted(muted) {
  if (!ensureContext()) return;
  buses.master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.03);
}

// --- synthesis helpers -------------------------------------------------------

function blip(bus, { freq = 440, dur = 0.08, type = 'sine', gain = 0.2, slide = 0, delay = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(bus);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function thock(bus, { freq = 180, dur = 0.06, gain = 0.25 }) {
  if (!ctx) return;
  // short filtered noise burst = card-on-felt impact
  const t = ctx.currentTime;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = freq * 6;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(bus);
  src.start(t);
}

// --- public event map ---------------------------------------------------------
// Event hierarchy: ack < legal move < goal < round completion.

export function playSfx(name) {
  if (!ctx || ctx.state !== 'running') return;
  const fx = buses.effects;
  const variant = 1 + (rng() - 0.5) * 0.12; // seeded pitch variants
  switch (name) {
    case 'select':  blip(fx, { freq: 660 * variant, dur: 0.05, gain: 0.10 }); break;
    case 'draw':    thock(fx, { freq: 220, gain: 0.18 }); blip(fx, { freq: 520 * variant, dur: 0.05, gain: 0.07, delay: 0.01 }); break;
    case 'flip':    blip(fx, { freq: 880 * variant, dur: 0.07, type: 'triangle', gain: 0.12, slide: 220 }); break;
    case 'place':   thock(fx, { freq: 160, gain: 0.22 }); break;
    case 'invalid': blip(fx, { freq: 180, dur: 0.12, type: 'square', gain: 0.06, slide: -60 }); break;
    case 'bank':    blip(fx, { freq: 740 * variant, dur: 0.09, type: 'triangle', gain: 0.14, slide: 180 }); thock(fx, { freq: 200, gain: 0.12 }); break;
    case 'reveal':  blip(fx, { freq: 990 * variant, dur: 0.1, type: 'sine', gain: 0.12, slide: 330 }); break;
    case 'undo':    blip(fx, { freq: 440, dur: 0.08, type: 'triangle', gain: 0.1, slide: -140 }); break;
    case 'hint':    blip(fx, { freq: 1180, dur: 0.12, gain: 0.09, slide: 240 }); break;
    case 'pause':   blip(fx, { freq: 330, dur: 0.09, gain: 0.08 }); break;
    case 'win':
      [523, 659, 784, 1047, 1319].forEach((f, i) =>
        blip(fx, { freq: f, dur: 0.35, type: 'triangle', gain: 0.12, delay: i * 0.09 }));
      break;
    case 'lose':
      [392, 330, 262].forEach((f, i) =>
        blip(fx, { freq: f, dur: 0.3, type: 'sine', gain: 0.1, delay: i * 0.12 }));
      break;
  }
}

// --- ambience: filtered rain-on-glass + room tone ----------------------------

function startAmbience() {
  if (!ctx || ambienceNodes) return;
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = last * 0.96 + white * 0.04; // pinkish
    data[i] = last * 2.4;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 900;
  f.Q.value = 0.4;
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.07;
  lfoGain.gain.value = 120;
  lfo.connect(lfoGain).connect(f.frequency);
  src.connect(f).connect(buses.ambience);
  src.start();
  lfo.start();
  ambienceNodes = { src, lfo };
}

// --- adaptive music: slow generative pads, intensity follows progress --------

const SCALES = {
  calm: [261.6, 293.7, 329.6, 392.0, 440.0, 523.3], // C pentatonic-ish
};
let musicIntensity = 0.3;

export function setMusicIntensity(v) {
  musicIntensity = Math.max(0, Math.min(1, v));
}

function startMusic() {
  if (!ctx || musicTimer) return;
  const tick = () => {
    if (ctx.state === 'running' && !document.hidden) {
      const scale = SCALES.calm;
      const note = scale[Math.floor(rng() * scale.length)];
      const dur = 2.5 + rng() * 2.5;
      blip(buses.music, { freq: note, dur, type: 'sine', gain: 0.05 + musicIntensity * 0.04 });
      if (rng() < 0.4 + musicIntensity * 0.3) {
        blip(buses.music, { freq: note * 1.5, dur: dur * 0.8, type: 'sine', gain: 0.03, delay: 0.4 });
      }
    }
    musicTimer = setTimeout(tick, 2200 + rng() * 2600);
  };
  tick();
}

/** Lower everything while hidden; restore on return. */
export function setBackgrounded(hidden) {
  if (!ctx) return;
  buses.master.gain.setTargetAtTime(hidden ? 0 : 1, ctx.currentTime, 0.2);
}
