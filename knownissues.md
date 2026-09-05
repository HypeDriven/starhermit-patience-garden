# Known Issues — Patience Garden

QA pass 2026-08-20. Static review driven by Qwen3.8 27B on spark105 (OBLITERATED Q5_K_M),
alongside the game's own unit tests and a headless-Chrome boot/mode/crawl sweep.

## Test results

| Check | Result |
| --- | --- |
| `npm test` | 33/33 pass (`node --test tests/rules.test.mjs`) |
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

### 1. Client-declared `moves` / `ms` on leaderboard entries

- **File:** `server.js:59-60`
- **Concern:** `leaderboardEntry` copies `envelope.result.moves` and `envelope.result.ms`
  straight from the client, although `verifyReplay` produces authoritative values.
  spec.md:38 requires ties to use "lower **authoritative** elapsed time".
- **Why unconfirmed:** Nothing in the repository calls `leaderboardEntry`, so how a host would
  combine it with `validateSubmission` (which does apply `MIN_MOVE_MS` and rate plausibility
  guards) cannot be established. If the host re-derives the fields, the issue disappears.

### 2. `envelope.build < RULES_VERSION` is accepted

- **File:** `server.js:23`
- **Concern:** Only `envelope.build > RULES_VERSION` is rejected ("future-version"); an older
  build replays against the *current* rules engine, which may score differently.
- **Why unconfirmed:** There is only one shipped `RULES_VERSION`, so no divergent build exists to
  demonstrate a wrong outcome.

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
- The `/api/v1/validate` endpoint against a genuine full-game envelope: the client never produces
  one, so no reference envelope exists to submit.
- Touch and gamepad input paths.
