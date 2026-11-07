// Sound, as the browser build's js/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per game event; the quiet glasshouse
// ambience (pinkish noise through a 900 Hz band-pass whose centre a 0.07 Hz
// LFO sweeps by ±120 Hz, looped) and the adaptive music (slow sine notes
// from a C pentatonic scale every 2.2–4.8 s, sometimes with a fifth above,
// louder as the foundations fill). The browser build ran both live
// (WebAudio oscillators and a noise loop); here they are rendered once at
// start (OfflineAudioContext, one a stem): the ambience loops on the music bus
// (the runtime has no ambience bus; its gain folds in the old ambience
// slider's 40 % default against music's 50 %), and the music plays one
// rendered note clip at each note's pitch. The runtime's Options own the
// volumes, the mute and the voice limit. The oscillator blips the browser
// build synthesized while a sample decoded are not ported (a live synthesis
// graph makes clip loads fail on the engine's web runtime), so a clip still
// loading is silent. Clips all load at once in onStart; the ambience and the
// music wait for the mixer (natively at once, in a browser after the first press).
import { frame } from "starhermit:engine";
import { OfflineAudioContext, context, createClip, loadClip, play as playClip, type AudioClip, type Sound } from "starhermit:audio";
import { createRng } from "../js/rng.js";

/** audio.js SFX_SAMPLES. */
const SFX: Record<string, string> = {
  select: "card-select", draw: "card-draw", flip: "card-flip", place: "card-place", invalid: "invalid-move", bank: "foundation-bank",
  reveal: "card-reveal", undo: "undo-rewind", hint: "hint-chime", pause: "pause-click", win: "win-fanfare", lose: "lose-sigh",
};
export type Sfx = keyof typeof SFX;
const clips = new Map<string, AudioClip>();
let suspended = false;

/** Loads every clip at once (onStart); a cue whose clip is still loading is skipped. */
export function loadSfx(): void {
  for (const name of new Set(Object.values(SFX))) {
    loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); }, (e: unknown) => console.warn(`sfx ${name}: ${String(e)}`));
  }
  const failed = (e: unknown): void => { console.warn(`audio: ${String(e)}`); };
  renderAmbience().then((c) => { ambClip = c; }, failed);
  renderNote().then((c) => { noteClip = c; }, failed);
}

/** audio.js playSfx(name). */
export function play(event: Sfx): void {
  const file = SFX[event];
  if (!file || suspended) return;
  const clip = clips.get(file);
  if (!clip) return;
  try { playClip(clip, { bus: "effects" }); }
  catch { /* the mixer is full this frame: skip it */ }
}

// -- the ambience ---------------------------------------------------------------------------------
const RATE = 22050;
const AMB_LEVEL = 3.486; // the old stem's rms 0.103 (one-pole × 2.4, RBJ band-pass over its LCG noise), measured
/** audio.js startAmbience: pinkish noise (one pole, 143 Hz) through the band-pass (Q 0.4) that an LFO sweeps by ±120 Hz round
 * 900 Hz. The LFO's period (14 s) does not fit 2 s: a whole cycle per loop instead, and everything repeats in 2 s, so once settled the loop joins. */
async function renderAmbience(): Promise<AudioClip> {
  const n = RATE * 2, settle = Math.round(0.5 * RATE);
  const off = new OfflineAudioContext(1, settle + n, RATE);
  const noise = off.createNoise({ seed: 7, seconds: 2 });
  const pink = off.createBiquadFilter(); pink.type = "lowpass"; pink.frequency.value = 143;
  const band = off.createBiquadFilter(); band.type = "bandpass"; band.frequency.value = 900; band.Q.value = 0.4;
  const lfo = off.createOscillator(); lfo.frequency.value = 0.5;
  const depth = off.createGain(); depth.gain.value = 120;
  lfo.connect(depth).connect(band.frequency); lfo.start();
  const g = off.createGain(); g.gain.value = AMB_LEVEL;
  noise.connect(pink).connect(band).connect(g).connect(off.destination); noise.start();
  const r = await off.startRendering();
  return createClip([r.getChannelData(0).slice(settle)], RATE);
}
// -- the music: one sine note (C4), its blip envelope over 4 s, played at each note's pitch ----------------
const NOTE_HZ = 261.6, NOTE_S = 4;
const SCALE = [261.6, 293.7, 329.6, 392.0, 440.0, 523.3];
async function renderNote(): Promise<AudioClip> {
  const off = new OfflineAudioContext(1, RATE * NOTE_S, RATE);
  const osc = off.createOscillator(); osc.frequency.value = NOTE_HZ;
  const g = off.createGain();
  g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(1, 0.008); g.gain.exponentialRampToValueAtTime(0.0001, NOTE_S);
  osc.connect(g).connect(off.destination); osc.start();
  return createClip(await off.startRendering());
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

/** Each frame, once the mixer runs: the ambience and the music notes. */
export function update(): void {
  if (context.state !== "running") return;
  if (ambClip && !ambVoice) {
    try { ambVoice = playClip(ambClip, { bus: "music", gain: suspended ? 0 : 0.8, loop: true }); } catch { ambVoice = null; }
  }
  if (!noteClip) return;
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
