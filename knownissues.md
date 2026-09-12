# Known Issues — Patience Garden

QA pass 2026-08-20. Static review driven by Qwen3.8 27B on spark105 (OBLITERATED Q5_K_M),
alongside the game's own unit tests and a headless-Chrome boot/mode/crawl sweep.

## Resolved — fixed 2026-09-07

Follow-up review (Kimi). Each defect was reproduced first, fixed minimally, and
re-verified with `npm test` (34/34, incl. a new regression test) and `tests/e2e.mjs`
(PASS, both viewports).

### 5. Undo on a hash-checkpointed turn broke the authoritative replay — RESOLVED

Periodic replay hashes were keyed by `turn`, but undo keeps `turn` monotonic yet
non-unique: an undo landing on a turn divisible by 10 recorded a second hash for the
same turn, and `verifyReplay` matched the first — every such envelope failed with
`hash-mismatch`. Hashes are now keyed by command index (`at`), with turn-matching
kept only for legacy envelopes.

- `js/session.js:129-133,191-193` — hashes pushed as `{ at, turn, hash }`.
- `js/rules.js:620-636` — `verifyReplay` matches by `at` when present.
- `tests/rules.test.mjs` — regression test "replay survives an undo on a
  hash-checkpointed turn".

### 6. Restarting a resumed Challenge/Learn round crashed; resumed Journey wins recorded nothing — RESOLVED

`resumeSavedGame` rebuilt `pendingConfig` as `{ mode }` only, so Pause → "Restart
this deal" after a resume threw (`challengeById(undefined)` / `lessonById(undefined)`)
leaving the game stuck on "Dealing…", and `session._journeyStage` was lost across
resume, so a resumed Journey win recorded no stars/progress.

- `js/main.js` — snapshots now carry `restartConfig`; `resumeSavedGame` restores it
  (with `configForSession` fallback for older snapshots) and re-derives
  `session._journeyStage` from `contentId`.

### 7. Mute was lost after backgrounding; AudioContext created before first gesture — RESOLVED

`setBackgrounded(false)` restored the master gain to 1 even while muted, and boot
(`initAudio`/`setVolumes`/`setMuted`) created the AudioContext before any user
gesture, tripping the browser autoplay console warning. The context is now created
on first unlock; volumes/mute are stored and applied at creation, and un-hiding
restores `muted ? 0 : 1` (`js/audio.js`).

### 8. Smaller defects — RESOLVED

- `index.html` — removed the stale data-URI favicon that overrode the authored
  `favicon.svg`.
- `js/main.js` — `stats.losses` is now incremented on a lost round (the field
  existed but stayed 0); the Profile table shows it (`js/ui.js`).
- `js/main.js` — `Esc` now also closes the Profile and Score Chase overlays
  (previously only Settings and Help).
- `js/content.js` — the "Hundred Moves" challenge limited 150 moves; renamed to
  "Move Miser" so the name no longer contradicts its rules.
- `server.js` — `validateSubmission` now rejects stale rules builds
  (`build < RULES_VERSION`, previously accepted) and its `detail` carries the
  authoritative replay values (moves/invalids/elapsed ms/assists) so hosts need
  not trust client-declared `envelope.result` fields (resolves "Suspected" #1
  and #2 below). The standalone static server no longer serves dotfiles,
  `.git`, or `node_modules`.
- `LICENSE.md` — added the required PolyForm Noncommercial 1.0.0 text.


## Test results

| Check | Result |
| --- | --- |
| `npm test` | 34/34 pass (`node --test tests/rules.test.mjs`) |
| `node --check` on all modules | clean (11 modules + `server.js`) |
| `tests/e2e.mjs` (headless Chrome) | PASS — desktop 1280×800 and mobile 390×844, no page errors |

The `tests/e2e.mjs` run plays a real deal to a win through DOM clicks in both viewports; it
previously failed at the `boardClick` `waitForFunction` timeout and now completes cleanly
(E2E PASS line, both viewports). The ad-hoc CDP boot/mode/crawl sweep from 2026-08-20 is
superseded by the committed e2e.

Note on the test command: the header of `tests/rules.test.mjs` documents `node --test tests/`.
On this machine's Node v22.22.1 a *directory* argument to `--test` fails
(`Cannot find module '.../test'`), but that is a Node behaviour, not a game defect — the same
thing happens in other games in this repo. `npm test` runs the file directly and passes.

## Resolved — fixed 2026-09-05

The four confirmed defects below were each re-verified against the current source, fixed with
minimal changes, and confirmed no longer reproducible by running `npm test` (33/33) and
`tests/e2e.mjs` (PASS, both viewports). They have been moved here from "Confirmed defects".

### 1. Hint usage is invisible to the authoritative replay, so the assist flag is client-declared — RESOLVED

Hints are now recorded as an authoritative `hint` command through the same replay log as every
other action, so `verifyReplay` reconstructs the exact assist count and a hinted run can no longer
be published as unassisted.

- `js/rules.js:478-483` — `applyCommand` handles a `hint` command (`state.hints += 1`).
- `js/rules.js:506` — `hint` is excluded from the move count (an assist, not a move), matching
  `autofinish`; turns still advance so replay hashes line up.
- `js/session.js:177-196` — `Session.hint()` no longer mutates state outside the log; it
  dispatches the `hint` command via `applyCommand`, records it in `envelope.commands`, and pushes
  periodic hashes (the same path every other command takes).
- `server.js:38-39` — `validateSubmission` rejects an envelope whose `result.hints` / `result.undos`
  disagree with the authoritative replay (`hints-mismatch` / `undos-mismatch`).

### 2. Daily and Score Chase are labelled "ranked" although nothing is ever validated or shared — RESOLVED

The client performs no network I/O and the authoritative validator is not wired for competitive
ranking, so per spec.md:204 ("If validation is unavailable, label the board casual") the ranked
labelling was dropped rather than pretending a board is competitive.

- `js/content.js:478`, `js/content.js:484` — MODES `daily` and `score` set `ranked: false`.
- `js/content.js:249`, `js/content.js:294` — `scoreChaseDeal` / `dailyInfo` return `ranked: false`.
- `js/ui.js:202`, `js/ui.js:220`, `js/ui.js:582`, `js/ui.js:614` — setup, mode and help copy no
  longer claim the boards are "Ranked".

### 3. Local board ordering ignores the spec tie-break, and `compareResults` is dead code — RESOLVED

`addScore` now sorts by score, then by `compareResults` — the spec's four-key order (objective
completion, fewer invalid actions, lower authoritative elapsed time, stable session identifier).

- `js/storage.js:6` — import `compareResults` from `js/rules.js`.
- `js/storage.js:135` — sort key `b.score - a.score || compareResults(a, b)`.
- `js/storage.js:128-133` — entries now carry the fields `compareResults` reads
  (`status`, `invalids`, `elapsedMs`, `sessionId`); `js/main.js:773`, `js/main.js:789` pass them.

### 4. `addScore` caps the board globally at 200, not "the best 100 entries per mode" — RESOLVED

- `js/storage.js:137-147` — retention is now best-100-per-mode: entries are grouped by `mode`,
  each group kept to its top 100, then re-sorted. The doc comment (`js/storage.js:122`,
  "Keeps the best 100 entries per mode by score") is now accurate and a prolific mode can no
  longer evict another mode's entries.

## Suspected — not confirmed

### 1. Client-declared `moves` / `ms` on leaderboard entries — addressed 2026-09-07

- **File:** `server.js:59-60`
- **Concern:** `leaderboardEntry` copies `envelope.result.moves` and `envelope.result.ms`
  straight from the client, although `verifyReplay` produces authoritative values.
  spec.md:38 requires ties to use "lower **authoritative** elapsed time".
- **Status:** `validateSubmission().detail` now carries the authoritative replay values
  (score, moves, invalids, ms, hints, undos); a host wiring `leaderboardEntry` should
  read from `detail`. See "Resolved — fixed 2026-09-07" §8.

### 2. `envelope.build < RULES_VERSION` is accepted — addressed 2026-09-07

- **File:** `server.js:23`
- **Concern:** Only `envelope.build > RULES_VERSION` was rejected ("future-version"); an older
  build replays against the *current* rules engine, which may score differently.
- **Status:** older builds are now rejected as `stale-version`.

## Investigated and rejected

### Model claim: `canPlaceOnFoundation` uses the wrong comparison

The model review claimed `js/rules.js:223` (`return f.length === rankOf(card);`) is wrong and
should read `f.length === 13`. **This is false.** Ranks are zero-based —
`export const rankOf = (card) => card % 13;` with `RANK_LABELS = ['A', '2', … 'K']`
(`js/rules.js:23-25`) — so an empty foundation (length 0) accepts an Ace (rank 0), a
foundation holding one card accepts a Two, and so on. The suggested change would let any card
onto any foundation until it held 13. The unit suite's foundation-banking tests pass.

## Checked, no defects found

- Suspend/resume: entered a round, performed an action, reloaded the page, and confirmed the
  game re-boots with its snapshot intact and no console errors or failed requests.
- `js/rules.js` (24 KB): deal, move legality, `isValidRun`, foundation banking, undo,
  `autofinish`, terminal reasons, scoring components, `stateHash`, `verifyReplay` — 33 unit tests
  pass, including deterministic replay and solver certificates.
- `js/solver.js` / `js/rng.js`: winnable-layout generation, certificate verification, stream
  independence — covered by the passing tests and read without finding a contradiction.
- UI: 150 random clicks across two crawls (title, modes, setup, in-round HUD, pause, settings,
  help, profile, scores overlays) produced zero console errors or page exceptions.
- Persistence: `patience-garden/settings`, `/save`, `/scores`, `/session` each replaced with five
  kinds of corrupt payload; the game booted cleanly every time.
- `server.js` static behaviour: it only exposes `/api/v1/time`, `/api/v1/daily` and
  `/api/v1/validate`; it deliberately serves no files, and the 1 MB request cap is enforced.

## Not tested

- `js/render3d.js` (68 KB) beyond "it boots and draws without errors" — headless SwiftShader
  cannot judge the visual acceptance criteria in spec.md §4.
- The `/api/v1/validate` round trip against the live hosted platform: the client now submits a
  genuine full-game envelope for Daily / Score Chase results (js/main.js `submitRankedReplay`),
  but hosted acceptance still needs a platform-side run; locally it falls back gracefully.
- Touch and gamepad input paths.
