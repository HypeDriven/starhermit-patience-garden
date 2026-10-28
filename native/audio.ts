// Sound, as the browser build's js/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per game event; the quiet glasshouse
// ambience (pinkish noise through a 900 Hz band-pass whose centre a 0.07 Hz
// LFO sweeps by ±120 Hz, looped) and the adaptive music (slow sine notes
// from a C pentatonic scale every 2.2–4.8 s, sometimes with a fifth above,
// louder as the foundations fill). The browser build ran both live
// (WebAudio oscillators and a noise loop); here they are rendered once into
// clips (createClip, a slice a frame): the ambience loops on the music bus
// (the runtime has no ambience bus; its gain folds in the old ambience
// slider's 40 % default against music's 50 %), and the music plays one
// rendered note clip at each note's pitch. The runtime's Options own the
// volumes, the mute and the voice limit. The oscillator blips the browser
// build synthesized while a sample decoded are not ported (a live synthesis
// graph makes clip loads fail on the engine's web runtime), so a clip still
// loading is silent. Clips load once the mixer runs (natively at once, in a
// browser after the first press), one at a time.
import { frame } from "starhermit:engine";
import { context, createClip, loadClip, play as playClip, type AudioClip, type Sound } from "starhermit:audio";
import { createRng } from "../js/rng.js";

/** audio.js SFX_SAMPLES. */
const SFX: Record<string, string> = {
  select: "card-select", draw: "card-draw", flip: "card-flip", place: "card-place", invalid: "invalid-move", bank: "foundation-bank",
  reveal: "card-reveal", undo: "undo-rewind", hint: "hint-chime", pause: "pause-click", win: "win-fanfare", lose: "lose-sigh",
};
export type Sfx = keyof typeof SFX;
const clips = new Map<string, AudioClip>();
const queue: string[] = [];
let loading = false;
let wantClips = false;
let suspended = false;

/** Asks for the clips; they load once the mixer runs (see update). */
export function loadSfx(): void { wantClips = true; }

/** audio.js playSfx(name). */
export function play(event: Sfx): void {
  const file = SFX[event];
  if (!file || suspended) return;
  const clip = clips.get(file);
  if (!clip) return;
  try { playClip(clip, { bus: "effects" }); }
  catch { clips.delete(file); if (!queue.includes(file)) queue.push(file); }
}

// -- the ambience ---------------------------------------------------------------------------------
const RATE = 22050;
const AMB_N = RATE * 2;
const amb = new Float32Array(AMB_N);
let ambPos = 0, ambLast = 0, ambS = 7;
// RBJ band-pass state (constant 0 dB peak gain, Q 0.4), run twice round so the loop joins.
let bx1 = 0, bx2 = 0, by1 = 0, by2 = 0;
const raw = new Float32Array(AMB_N);
function renderAmbience(count: number): boolean {
  const end = Math.min(2 * AMB_N, ambPos + count);
  for (; ambPos < end; ambPos++) {
    const i = ambPos % AMB_N;
    if (ambPos < AMB_N) {
      ambS = (Math.imul(ambS, 1664525) + 1013904223) >>> 0;
      const white = (ambS / 4294967296) * 2 - 1;
      ambLast = ambLast * 0.96 + white * 0.04;
      raw[i] = ambLast * 2.4;
    }
    // The LFO's period (14 s) does not fit 2 s: sweep a whole cycle per loop instead.
    const f0 = 900 + 120 * Math.sin((2 * Math.PI * i) / AMB_N);
    const w0 = (2 * Math.PI * f0) / RATE, alpha = Math.sin(w0) / (2 * 0.4), a0 = 1 + alpha;
    const b0 = alpha / a0, b2 = -alpha / a0, a1 = (-2 * Math.cos(w0)) / a0, a2 = (1 - alpha) / a0;
    const x = raw[i]!;
    const y = b0 * x + b2 * bx2 - a1 * by1 - a2 * by2;
    bx2 = bx1; bx1 = x; by2 = by1; by1 = y;
    if (ambPos >= AMB_N) amb[i] = y;
  }
  return ambPos >= 2 * AMB_N;
}
// -- the music: one sine note (C4), its blip envelope over 4 s, played at each note's pitch ----------------
const NOTE_HZ = 261.6, NOTE_S = 4;
const SCALE = [261.6, 293.7, 329.6, 392.0, 440.0, 523.3];
const note = new Float32Array(RATE * NOTE_S);
let notePos = 0;
function renderNote(count: number): boolean {
  const end = Math.min(note.length, notePos + count);
  for (; notePos < end; notePos++) {
    const t = notePos / RATE;
    const env = t < 0.008 ? t / 0.008 : Math.exp(Math.log(0.0001) * ((t - 0.008) / (NOTE_S - 0.008)));
    note[notePos] = Math.sin(2 * Math.PI * NOTE_HZ * t) * env;
  }
  return notePos >= note.length;
}
let ambClip: AudioClip | null = null, noteClip: AudioClip | null = null;
let ambVoice: Sound | null = null;
let intensity = 0.3;
const rng = createRng(2024) as unknown as () => number;
let nextNoteAt = 0;
let fifth: { at: number; hz: number } | null = null;
/** audio.js setMusicIntensity(0..1). */
export function setMusicIntensity(x: number): void { intensity = Math.max(0, Math.min(1, x)); }
/** audio.js setBackgrounded: the pause menu and a hidden window silence the garden. */
export function setSuspended(on: boolean): void {
  if (on === suspended) return;
  suspended = on;
  try { ambVoice?.fade(on ? 0 : 0.8, 0.2); } catch { /* gone */ }
}

/** Each frame: the clips once the mixer runs (one at a time), then the ambience and the music notes. */
export function update(): void {
  if (context.state !== "running") return;
  if (wantClips) {
    wantClips = false;
    for (const n of Object.values(SFX)) if (!queue.includes(n)) queue.push(n);
  }
  if (!loading && queue.length) {
    const name = queue.shift()!;
    if (!clips.has(name)) {
      loading = true;
      loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); loading = false; }, (e: unknown) => { console.warn(`sfx ${name}: ${String(e)}`); loading = false; });
    }
    return;
  }
  if (loading) return;
  if (!ambClip) {
    if (!renderAmbience(6000)) return;
    try { ambClip = createClip([amb], RATE); } catch (e) { console.warn(`audio: ${String(e)}`); ambPos = 0; }
    return;
  }
  if (!ambVoice) {
    try { ambVoice = playClip(ambClip, { bus: "music", gain: suspended ? 0 : 0.8, loop: true }); } catch { ambVoice = null; }
    return;
  }
  if (!noteClip) {
    if (!renderNote(6000)) return;
    try { noteClip = createClip([note], RATE); } catch (e) { console.warn(`audio: ${String(e)}`); notePos = 0; }
    return;
  }
  const t = frame().time;
  if (fifth && t >= fifth.at) {
    try { if (!suspended) playClip(noteClip, { bus: "music", gain: 0.03, pitch: (fifth.hz * 1.5) / NOTE_HZ }); } catch { /* the mixer lost it */ }
    fifth = null;
  }
  if (t < nextNoteAt) return;
  nextNoteAt = t + 2.2 + rng() * 2.6;
  if (suspended) return;
  const hz = SCALE[Math.floor(rng() * SCALE.length)]!;
  try {
    playClip(noteClip, { bus: "music", gain: 0.05 + intensity * 0.04, pitch: hz / NOTE_HZ });
    if (rng() < 0.4 + intensity * 0.3) fifth = { at: t + 0.4, hz };
  } catch { /* the mixer lost it */ }
}
