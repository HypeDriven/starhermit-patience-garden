# Known Issues — Patience Garden

QA pass 2026-08-20. Static review driven by Qwen3.8 27B on spark105 (OBLITERATED Q5_K_M),
alongside the game's own unit tests and a headless-Chrome boot/mode/crawl sweep.

## Test results

| Check | Result |
| --- | --- |
| `npm test` | not present — there is no `package.json`; `node --test tests/rules.test.mjs` gives 33/33 pass |
| `node --check` on all modules | clean (11 modules + `server.js`) |
| `tests/e2e.mjs` (headless Chrome) | not present — replaced by an ad-hoc CDP boot/mode/crawl sweep (see below) |

Ad-hoc headless-Chrome coverage (served statically on port 39512, since `server.js` is an
API-only script and 404s on `/`): boot with 0 console errors, all six mode cards opened, a Daily
deal played through draw/hint/undo/pause/resume, two random UI crawls of 70 and 80 clicks
(0 errors), and a corrupt-`localStorage` reload matrix (`{"broken":`, `null`, `[]`, `{}`,
non-JSON — all booted cleanly).

Note on the test command: the header of `tests/rules.test.mjs` documents `node --test tests/`.
On this machine's Node v22.22.1 a *directory* argument to `--test` fails
(`Cannot find module '.../test'`), but that is a Node behaviour, not a game defect — the same
thing happens in other games in this repo. Bare `node --test` and
`node --test tests/rules.test.mjs` both pass 33/33.

## Confirmed defects

Defects below were each verified by reading the source, not just reported by the model.

### 1. Hint usage is invisible to the authoritative replay, so the assist flag is client-declared

- **File:** `js/session.js:180` (`Session.hint`), `server.js:55-67` (`leaderboardEntry`)
- **Trigger:** Play a ranked deal (Daily or Score Chase) using hints, then submit a result whose
  `result.hints` / `result.undos` are zeroed.
- **Behaviour:** `hint()` mutates the rules state outside the command log:

  ```js
  if (h) this.state = { ...this.state, hints: this.state.hints + 1 };
  ```

  There is no `hint` command in `applyCommand` (`js/rules.js` handles only `draw`, `move`,
  `autofinish`, `undo`, `concede`, `fail`), so `verifyReplay` always reconstructs a state with
  `hints: 0` (`js/rules.js:92` initialises it and nothing else ever increments it).
  `validateSubmission` (`server.js:20-46`) compares only `result.status` and `result.score`
  against the replay, and `leaderboardEntry` then derives the assist flag from the untrusted
  envelope:

  ```js
  assists: (envelope.result.undos || 0) + (envelope.result.hints || 0) > 0,
  ```

  A hinted run can therefore be published as unassisted. (`undos` *is* tracked authoritatively at
  `js/rules.js:472`, yet the entry still uses the client's copy.)
- **Expected:** spec.md:203 — "Include ruleset, content version, seed, assists, and duration with
  every submission; reject impossible or stale-version scores." The game's own help text
  (`js/ui.js:192`) promises "Undo and hints are allowed but flagged as assists on the board."
- **Evidence:** The four locations quoted above.

### 2. Daily and Score Chase are labelled "ranked" although nothing is ever validated or shared

- **File:** `js/content.js:478` and `js/content.js:484`; `js/storage.js:113`; `server.js:74-101`
- **Trigger:** Open the mode list; Daily and Score Chase carry a "ranked" badge.
- **Behaviour:** The client performs **no network I/O at all** — `grep -rn "fetch(\|XMLHttpRequest\|WebSocket" js/*.js`
  returns nothing. The only score path is `store.addScore(...)` at `js/main.js:773` and
  `js/main.js:789`, writing to the local board described by `js/storage.js:113`
  ("local leaderboard (score chase)"). The shipped authoritative validator
  (`server.js` `validateSubmission` / `leaderboardEntry`) is never called by the game and is not
  covered by `tests/rules.test.mjs` either.
- **Expected:** spec.md:203-204 — "Provide global and friends-filtered boards… For globally
  competitive boards, validate score claims through a lightweight authoritative script using
  replayable input logs and deterministic seeds. **If validation is unavailable, label the board
  casual** and apply plausibility/rate checks." Either wire the client to `server.js` or drop the
  ranked labelling.
- **Evidence:**

  ```js
  { id: 'daily', name: 'Daily', icon: '☀', ranked: true,  ... }   // js/content.js:478
  { id: 'score', name: 'Score Chase', icon: '❦', ranked: true, ... } // js/content.js:484
  ```

  plus the empty grep for any network call in `js/`.

### 3. Local board ordering ignores the spec tie-break, and `compareResults` is dead code

- **File:** `js/storage.js:126-127` (`addScore`), `js/rules.js:639-645` (`compareResults`)
- **Trigger:** Finish two runs with the same score.
- **Behaviour:** The board is sorted by score, then **moves**, then ms, then insertion time:

  ```js
  doc.entries.sort((a, b) =>
    b.score - a.score || a.moves - b.moves || a.ms - b.ms || String(a.when).localeCompare(String(b.when)));
  ```

  Completion status and invalid-action count are never consulted. The module that *does*
  implement the spec ordering — `compareResults` in `js/rules.js:639-645`, whose header comment
  reads "Tie-breaking (per spec): objective completion, fewer invalid actions, lower
  authoritative elapsed time, then stable session identifier" — is exported and then never called
  anywhere in the codebase (`grep -rn compareResults js/` matches only its own definition).
- **Expected:** spec.md:38's four-key ordering, i.e. use `compareResults`.
- **Evidence:** The two quoted locations plus the empty grep for call sites.

### 4. `addScore` caps the board globally at 200, not "the best 100 entries per mode"

- **File:** `js/storage.js:121` (doc comment) vs `js/storage.js:128`
- **Trigger:** Record more than 200 results, or many results in one mode.
- **Behaviour:** The documented contract is "Keeps the best 100 entries per mode by score", but
  the implementation keeps one flat list truncated at 200 with no grouping:

  ```js
  doc.entries = doc.entries.slice(0, 200);
  ```

  A prolific mode therefore evicts another mode's entries entirely, and the number is twice what
  the comment states.
- **Expected:** Per-mode retention as documented (or a corrected comment).
- **Evidence:** The quoted comment and line. Flagged by the model review and confirmed by reading
  `js/storage.js:113-131`.

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
