# Patience Garden — Product and Game Specification

**Document status:** running specification of the game as built on the StarHermit engine 1.30.0 (host API 1.32, `engine.minor=32`).  
**Game index:** 30  
**Genre:** Card sequencing puzzle  
**Players:** 1 player; optional asynchronous score comparison  
**Targets:** the StarHermit client (native) and browsers through the engine's web runtime; desktop, phone portrait and landscape  
**Rendering direction:** a 3D glasshouse table on `starhermit:scene`, with a fully playable 2D card table as an option; every screen on `starhermit:ui`

## 1. Product vision

Patience Garden is a game in which players build four ordered suit foundations while arranging descending alternating-color tableau stacks. Its signature setting is a botanical glasshouse card table. The product should feel immediately understandable, responsive within one input, and polished enough that the board or playfield itself is the visual hero. Sessions should begin quickly, make the next useful action obvious without solving the game for the player, and end with a clear explanation of score and progress.

The experience must be original. Do not copy names, layouts, characters, iconography, writing, audio, progression maps, or level data from an existing title. Use an original visual language, original procedural assets, and internally authored content.

### Design pillars

1. **Readable before spectacular:** legal actions, hazards, selection, ownership, and goals remain legible with effects disabled.
2. **One-input confidence:** every press, tap, drag, key, or pointer action gives immediate visual and sonic acknowledgment.
3. **Short path to play:** a returning player reaches the primary playfield in at most two deliberate actions.
4. **Fair mastery:** randomness is seeded and inspectable; outcomes never depend on hidden purchases or invisible stat boosts.
5. **Scalable beauty:** the same art direction survives low-power mobile hardware and high-resolution desktop displays.

## 2. Core game design

### Objective and rules contract

Build four ordered suit foundations while arranging descending alternating-color tableau stacks.

The rules engine must represent legal actions independently from rendering. It must expose legal-action queries, deterministic resolution, serializable state, a monotonically increasing turn/tick number, and a terminal-state reason. Tutorials and hints call the same legal-action API used by play rather than duplicating rules.

### Core loop

The repeated loop is: **inspect tableau and stock, move a legal card or run, reveal hidden cards, and build foundations**. Input is locked only during the shortest non-interruptible resolution phase. Cosmetic animation may continue after the logical state is ready, but skip/fast-forward must settle every object into the exact deterministic end state.

### Scoring and victory

Record wins, moves, time, and streaks; generate only deals classified by solvability. Results show a component breakdown rather than one unexplained total. Store integers for score and simulation units; format values only in presentation. Ties use, in order: primary objective completion, fewer invalid actions, lower authoritative elapsed time, then stable session identifier.

### Modes

- **Learn:** interactive lessons introduce one rule at a time and require the player to perform the action.
- **Journey:** authored progression with gradually combined mechanics and periodic mastery stages.
- **Daily:** one shared seed and ruleset per UTC day, by the platform's clock (`serverNow`) when it answers, else the device's UTC date.
- **Practice:** selectable difficulty, restart, undo where rules permit, and no effect on competitive rating.
- **Challenge:** constrained goals such as move limits, speed targets, altered layouts, or restricted tools.
- **Score chase:** three fixed tables from the validated seed table, kept on a local board; signed in, the StarHermit high-score board shows beside it.

### Difficulty and content generation

- Represent content as versioned data: identifier, seed, initial state, goals, allowed mechanics, par values, tutorial flags, and presentation theme.
- Run offline validators to prove basic legality, reachable goals, bounded duration, and absence of soft locks. Logic puzzles additionally require a unique or explicitly accepted solution class.
- Difficulty is measured from solution depth, branching factor, time pressure, motor precision, hidden information, and recovery options—not merely larger numbers.
- Introduce one new concept in isolation, combine it with one known concept, then test mastery before adding another.
- Daily seeds are immutable after publication. If content is defective, mark the day excluded from ranking rather than silently replacing it.


### Game-state model

`title → mode select / setup / Journey / Learn → active ⇄ paused → results → (next round | title)` (`app.phase` in `native/main.ts`). Every transition has one owner. A hidden window (`onSuspend`) pauses the round; on return the toast says how long the garden waited (“While you were away …”, clock paused). The round in progress is saved as the session snapshot in the save (every 8 s of play, on every command, on pause and on suspend), and **Play** becomes **Resume garden**.

## 3. Interaction and user-interface design

### Screens and layouts

Screens are `starhermit:ui`, built every frame (`native/screens.ts`), from the browser build's `index.html` and `js/ui.js`:

- **Pages** (on the page colour, undimmed): the title (kicker, wordmark, tagline, Play / Resume garden, the Daily · Journey · Learn tiles with their status, Score Chase · Profile · How to Play · Settings, Invite a friend and Sign in with StarHermit when they apply, the player and cloud-save line, the content version), the mode select (six mode cards), setup (Practice levels, Challenges, the Daily rule card with its seed and the time to the next Daily, the next Journey stage, the three Score Chase tables), the Journey map (40 round nodes with stars; locked ones disabled) and the lesson list.
- **Overlays** (over a dim of the table): pause (Resume, Settings, How to Play, Restart this deal, Leave game), results (headline, sub line, stars, the score breakdown, moves, time, assists, total, the progress note, the leaderboard line, achievement pops; Replay deal, Next…, Home), Settings, How to Play, Profile (career table and achievements) and Score Chase boards.
- A screen taller than the window scrolls its body; its footer buttons (Back, Begin, Done …) stay pinned below it. Escape / Back closes an overlay or goes back a page (setup → modes, others → title).
- **The game screen**: the HUD bar (Pause, mode name, the banked / hidden goal, score ❦, moves ↦, time ⏱, and on narrow windows the ℹ toggle), the Objective rail (objective, four foundation rings, the constraint left) and the Garden rail (seed, assists, the draw / undo / hint / finish keys from the player's bindings), the tray (Undo, Hint, Draw, and Auto-finish when the garden can finish itself), the lesson coach above the tray (with Continue on acknowledgement steps), and the toast above the tray (hints, refusals, notices).
- **Layouts** by the window's logical size: wide (≥ 1024 px) puts both rails beside the table; narrower windows show the rails in a drawer behind ℹ (one drawer holding both); phone portrait (≤ 700 px wide, portrait) wraps the tray to two buttons a row and hides the goal text at ≤ 420 px; short landscape tightens the tray. The table is framed in the rectangle left between the bars and rails.

### Input

| Action | Keys (default) | Pointer / touch | Gamepad |
| --- | --- | --- | --- |
| Pile focus | Arrow keys (`focus_*`) | — | D-pad / left stick |
| Select or place | Enter, Numpad Enter, Space (`select`) | tap a card, then a target; drag a run onto its target | South |
| Cancel selection | Backspace (`cancel`) | tap the selected card again | East (pauses when nothing is selected) |
| Draw | D | tap the stock (its empty outline recycles) | left shoulder |
| Undo / Hint / Auto-finish | U / H / A | tray buttons | West / North / right shoulder |
| Pause / close | Escape | ❚❚ | Start |

- The pile focus walks the browser build's order (stock, waste, four foundations; seven rows below); Enter on it presses the top card. The focused pile shows a marker (3D) or frame (2D) and is announced.
- A tap selects a movable card or run; a second tap on a target places it; tapping the selected single card again banks it when legal; two taps within 0.4 s bank a single exposed card (the old double-click). A drag past 8 px lifts the run and drops it on the pile under the pointer (else it flies back). Any press fast-forwards running card animation to its end state.
- The first 0.22 s after a command (0.04 s with reduced motion) takes no new command, as the browser build's shortest resolution phase.
- Keys are rebindable in the runtime's Options (Settings › Key bindings opens it); the HUD, help and rails show the current bindings.

### Accessibility

- The runtime's Options own text size (Larger text), high contrast (the theme tokens switch to the old `body.high-contrast` set), reduced motion (no camera drift, petals or motes; shorter tweens) and the screen reader. Every card and pile of the 3D table is a named target (“Queen of Hearts”, “Row 3, empty”, “Foundation Hearts”, “Stock, 12 cards. Activate to draw.”); on the 2D table they are buttons. Moves, selections, hints, refusals and the pile focus are announced.
- The game's own Settings: Interface (3D glasshouse / 2D cards), Theme (five themes), Color-vision palette (the 2D cards' red ink: deuteranopia, protanopia, tritanopia; suits always carry symbols), Left-handed controls (mirrors the tray), Timing assistance (+15 % on timed challenges), Haptics (a short vibration on each move) and Camera idle drift. These are engine `settings`, synced with the account. Left-handed controls, haptics and camera drift were stored but had no effect in the browser build; they now work.

### Localization

Nine locales (en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT) in `js/locales/*.js`, keyed by the US-English text, picked from the runtime's interface language (Options › Language, else the account's or the device's). Every string is drawn through `T()` each frame, so a change shows at once without restarting the round. `tests/i18n.test.mjs` checks every key used by `js/` and `native/` (and the content tables) in every locale; `tools/i18n-sync.mjs` prunes unused keys and adds new translations.

## 4. Visual and audio design

### The glasshouse (3D)

`native/render.ts` draws the browser build's `js/render3d.js` scene: the sky and tree lines beyond the glass (per theme), the iron posts, beams, arches and ridge, the faint glass sheen, the wooden table on its turned pedestal with the deep felt border and the felt inlay, the potted plants (instanced pots, foliage blobs, cones and fern blades, placed from the deal's seed) and the hanging vines, the window light lying on the felt, the dust motes, and the 52 extruded rounded cards with the theme's back and the faces from one atlas. Foundation pockets, column frames and the recycle outline mark the piles. Selection lifts and glows the run over a pulsing ring; legal targets show green rings; a hint rings source and target and draws a dashed arc with a travelling arrowhead; invalid moves shake; place and flip raise puffs; a win rains petals under a golden light swell. Cards follow each rules snapshot with authored tweens (an arc, ease-out; flips mid-arc); the first snapshot of a deal deals in from the stock.

Lights are the r160 values ÷ π (the engine's legacy units), ACES at 1.1. The old post chain is the runtime's: GTAO (High/Ultra), bloom at threshold 2.4 on the linear HDR scene (Balanced and up), the display-space grade with its vignette (Balanced and up), and FXAA / SMAA / MSAA. The procedural canvas textures are baked images (`tools/bake-textures.mjs` runs the old painters in Chrome: faces at 2048 and 1024, backs, skies, felts and petals per theme, pockets, wood, felt and paper bumps, window light).

### Quality levels

The runtime's graphics level picks one of the browser build's presets (`native/quality.ts`, from `js/gfx.js`): Low (no shadows, Lambert cards, plain detail, 1024 faces, MSAA), Balanced (1024 shadows, standard cards, reflections, detail, bloom, grade, FXAA, animated background), High (2048 shadows, lacquered physical cards with paper bump, GTAO, SMAA, high particles), Ultra (4096 shadows, full-resolution GTAO and bloom, MSAA). Dust motes and win petals scale with the level within the tier (at most 2×). Auto, render scale, adaptive resolution, the frame-rate limit and readout are the runtime's Options; the old per-effect overrides are not offered.

### The 2D card table

`native/board2d.ts` draws the browser build's DOM board: ivory cards with corner indices and a centre suit, backs in the theme's colours with a stripe and accent medallion, dashed-style pile outlines with suit glyphs, the waste fanned up to three, rows fanned and compressed to fit, the selected run lifted and outlined, targets glowing, the hint pulsing and the pile focus framed.

### Audio

`native/audio.ts`: the twelve authored one-shots in `sfx/` (select, draw, flip, place, invalid, bank, reveal, undo, hint, pause, win, lose) on the effects bus; the glasshouse ambience (pinkish noise through a sweeping 900 Hz band-pass) rendered once into a looped clip, and the music's slow pentatonic sine notes (with an occasional fifth, louder as the foundations fill) played from one rendered note clip at each pitch, both on the music bus (the runtime has no ambience bus). Volumes, mute and the voice limit are the runtime's Options. The pause screen and a hidden window silence the garden.

## 5. Technical architecture

### Files

| File | Role |
| --- | --- |
| `js/rules.js`, `js/rng.js` | Pure rules (unchanged): legality, commands, scoring, hints, replay verification. |
| `js/solver.js`, `js/content.js`, `js/content-seeds.js` | Constructive winnable deals with certificates; themes, Journey, challenges, practice, Daily, lessons, achievements, modes. |
| `js/session.js` | Round controller: validated commands, the pause-aware clock (`now` injected), constraints, replay envelope, snapshot / restore, breakdown. |
| `js/save.js`, `js/save-merge.js` | The save document and its merge, local boards, achievements, the game's options, the old cloud slot reader. |
| `js/i18n.js`, `js/locales/*.js`, `js/platform-i18n.js` | String tables and the account strings. |
| `native/main.ts` | Entry: app state, modes, input, the round's end, lifecycle. |
| `native/screens.ts`, `native/board2d.ts` | Every screen, the HUD / rails / tray, the named targets; the 2D table. |
| `native/render.ts`, `native/quality.ts` | The glasshouse; the look per quality tier. |
| `native/platform.ts`, `native/audio.ts`, `native/i18n.ts`, `native/style.ts`, `native/game.ts` | Save, options, account and boards; sound; localization; UI tokens; the typed facade over `js/`. |
| `tools/ui-style.css` → `assets/ui-style.json` | The style sheet, class-based, converted with `npm run css`. |
| `score-script.js` | The platform script posting a won round's total to the `high-score` board (unchanged). |
| `server.js` | Development only (not packaged): the replay validator `validateSubmission` and a static dev server. |

### Determinism

The session's clock advances 1000/60 ms per fixed step while the window shows (60 Hz), so pauses, hidden windows and slow frames never move it and play scripts replay exactly; time-limited challenges are checked every second of game time. Deals come from the seeded generator; practice deals are pinned by the player's games played (Replay deal is identical). The replay envelope is still recorded with every round.

## 6. StarHermit integration

- **Manifest** (`starhermit.txt`): `engine.entry=native/main.ts`, `engine.version=1.30.0`, `engine.minor=32`, capabilities `platform, storage, clipboard`, `server=score-script.js`, `control.*` and `engine.gamepad.*` for every action. `npm run package` writes the web loader `index.html` and `starhermit-files.json`; `.starhermitignore` leaves out tests, tools, docs and the dev server.
- **Save**: `saves` (schema 1) holds `{ progress, stats, achievements, scores, session }`, on the device and in the player's cloud slot; another device's save merges in (save-merge.js: best record of every entry, earliest unlocks, scores unioned; this device's round in progress wins). The browser build's slot (`game:<slug>`, `{ version, savedAt, settings, progress, stats, achievements, scores }`) shows as foreign: it is merged in, its game options adopted unless set here since, and replaced once (`replaceForeign`). Its settings KV keys are adopted the same way and then removed (graphics, volumes, mute, reduced motion, contrast, larger text and language are the runtime's). Guests' old browser localStorage progress does not carry over.
- **Leaderboards**: signed in, every won round (any mode but lessons) posts its total through `score-script.js` (a practice session carrying `{ type: 'result', scores: { 'high-score': n } }`); the results show posting / rank / posted / not posted. Score Chase shows the local board per mode and, signed in, the high-score board's top 20.
- **Account**: Sign in with StarHermit (`requestSignIn`) for guests; Invite a friend copies the invite link; the title shows the player and the cloud-save state; a signed-out session keeps playing locally with a notice.
- **Achievements** (First Bloom, Graduate, Green Streak, Head Gardener, Thousand Leaves, Daily Devotion) are kept in the save, as before.

## 7. Content, economy, and retention

Five themes, 40 Journey stages in eight acts with mastery stages, six challenges, five practice levels, seven lessons, the Daily and three Score Chase tables; no purchases, no timers pressing the player, no streak punishment beyond the streak counter.

## 8. Analytics and privacy

The browser build's local funnel log (`patience-garden/funnel` in localStorage, never sent) is not kept. Nothing is collected.

## 9. Checks

- `npm run test:unit` (node --test): the rules suite (unchanged), the save (`tests/save.test.mjs`: normalizing, merging, the old cloud slot, boards, achievements, options), the save merge, and the i18n coverage.
- `npm run test:native` (`tests/native.mjs`): the web index matches the files, `tsc` with the generated declarations, `starhermit check .` with no warnings, and every `tests/native/*.play` as a guest render check: `journey-1.play` (Journey stage 1 won on the 3D table by mouse clicks on named targets, to its results and the next stage; generated by `tools/gen-plays.mjs` from the deal's certificate), `practice-2d-phone.play` (a Practice deal won on the 2D table on a phone by double touches; generated), `lessons-phone.play` (all seven lessons by touch to Graduate), `menus.play` (settings, help, profile, boards, modes and setup, the keyboard pile focus, undo, a mouse drag, hint, pause, restart, leave) and `landscape.play` (a phone sideways: the drawer, the tray, pause and settings).
- `npm run test:browser` (`tools/browser-play.mjs`): the packaged game in Chrome on the GPU at desktop, phone (DPR 3) and phone landscape: lesson 1 by mouse, a Practice deal by keyboard, lesson 3 by a finger drag and double tap, a hint and pause sideways; fails on console errors or warnings.

## 10. Port differences and known limitations

- The old Graphics panel (per-effect overrides, render scale, FPS readout), the sound sliders, the language selector, reduced motion, high contrast and larger text are the runtime's Options.
- Replay validation of Daily / Score Chase results (`/api/v1/validate` on the dev server) is not called: the platform never served that route, so the old “validated ✓ / not validated” suffix is gone; `server.js` keeps `validateSubmission` for development and tests. Score posting stays as before (client total range-checked by `score-script.js`, by the user's decision for solo games).
- On narrow windows the two rails share one drawer (the old build overlapped two drawers).
- The “no WebGL” fallback to the 2D table is moot (the runtime always draws); the 2D table remains a setting.
- The hint arc is drawn as dashes of line segments (no dashed line material).
- Known rules quirk kept for replay compatibility: none observed beyond those resolved in `knownissues.md`.
