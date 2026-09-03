# Patience Garden

A botanical glasshouse solitaire: build four suit foundations while arranging
descending, alternating-colour tableau runs. Browser game, no build step.

## Run

Serve this directory with any static file server and open `index.html`:

```
python3 -m http.server 8080
# → http://localhost:8080
```

(ES modules require http(s); opening the file directly via `file://` won't work.)

## Layout

- `index.html`, `css/` — semantic HTML shell and styles
- `js/rng.js` — seeded random streams, checksums
- `js/rules.js` — pure deterministic rules engine (legality, commands, scoring, replay)
- `js/solver.js` — constructive winnable-deal generation + solvability/difficulty metrics
- `js/content.js`, `js/content-seeds.js` — themes, 40-stage journey, challenges, lessons, daily
- `js/session.js` — round controller (commands, clock, constraints, replay envelope)
- `js/render3d.js` + `vendor/three.module.js` — Three.js glasshouse scene
- `js/ui.js`, `js/main.js` — DOM UI (fully playable 2D layer), input, state machine
- `js/audio.js`, `js/storage.js` — procedural WebAudio, local persistence
- `server.js` — authoritative validation script (daily seeds, replay checks)
- `starhermit.txt` — host packaging manifest
- `tests/` — `node --test tests/*.test.mjs`
- `tools/precompute.mjs` — regenerates `js/content-seeds.js` (offline content validation)

## Modes

Learn (guided lessons) · Journey (40 authored stages) · Daily (shared UTC seed) ·
Practice (difficulty select, undo/hints, unrated) · Challenge (move/time/layout
constraints) · Score Chase (local leaderboard on validated seeds).
