# Patience Garden

A botanical glasshouse solitaire: build four suit foundations while arranging
descending, alternating-colour tableau runs. A StarHermit engine script game
(TypeScript on the host API, engine 1.23.0), played natively by the StarHermit
client and in browsers by the engine's web runtime.

## Run

```
starhermit .                 # natively (the published runtime)
npm run package              # regenerate the web loader index.html + starhermit-files.json
```

Browsers open the packaged folder's `index.html` (serve it over http).

## Layout

- `native/` — the engine client: `main.ts` (entry: modes, input, rounds), `screens.ts` (every screen),
  `render.ts` (the 3D glasshouse), `board2d.ts` (the 2D card table), `platform.ts` (save, options,
  account, leaderboard), `audio.ts`, `i18n.ts`, `style.ts`, `quality.ts`, `game.ts`
- `js/rules.js`, `js/rng.js` — pure deterministic rules engine (legality, commands, scoring, replay)
- `js/solver.js`, `js/content.js`, `js/content-seeds.js` — winnable-deal generation; themes, the
  40-stage Journey, challenges, lessons, the Daily
- `js/session.js` — round controller (commands, clock, constraints, replay envelope)
- `js/save.js`, `js/save-merge.js` — the save document and its merge
- `js/i18n.js`, `js/locales/` — nine locales
- `assets/` — baked textures (`npm run textures`) and the UI styles (`tools/ui-style.css`, `npm run css`)
- `score-script.js` — the platform script posting won rounds to the high-score board
- `server.js` — development only: the replay validator and a static server
- `tests/` — `npm test` (unit tests, then `tests/native.mjs`: tsc, `starhermit check`, play scripts);
  `npm run test:browser` plays the web package in Chrome

See `spec.md` for the full specification.

## Modes

Learn (guided lessons) · Journey (40 authored stages) · Daily (shared UTC seed) ·
Practice (difficulty select, undo/hints, unrated) · Challenge (move/time/recycle
constraints) · Score Chase (local and StarHermit boards on validated seeds).
