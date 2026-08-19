// Patience Garden — authoritative StarHermit game script.
// Used for seeded daily sessions, replay validation, and durable achievement
// delivery. Ordinary practice runs locally in the client; this script only
// validates competitive claims against deterministic replays.
//
// Runs in the StarHermit sandbox (host provides `host` API) and standalone
// under Node for testing (node server.js → serves /api/v1/time etc.).

import { verifyReplay, stateHash, totalScore, RULES_VERSION } from './js/rules.js';
import { dailyInfo } from './js/content.js';
import { checksum, hashString } from './js/rng.js';

export const SERVER_VERSION = 1;

// Plausibility bounds — a score claim outside these is rejected outright.
const MAX_MOVES_PER_MINUTE = 150; // generous; MIN_MOVE_MS is the real guard
const MIN_MOVE_MS = 250;

/** Validate a submitted result envelope. Returns {accept, reason?, detail?}. */
export function validateSubmission(envelope) {
  if (!envelope || typeof envelope !== 'object') return { accept: false, reason: 'malformed' };
  if (envelope.schema !== 1) return { accept: false, reason: 'stale-version' };
  if (envelope.build > RULES_VERSION) return { accept: false, reason: 'future-version' };
  if (!Array.isArray(envelope.commands) || envelope.commands.length > 5000) {
    return { accept: false, reason: 'bad-command-log' };
  }
  for (const c of envelope.commands) {
    if (!c || typeof c !== 'object' || typeof c.type !== 'string') return { accept: false, reason: 'bad-command' };
    if (JSON.stringify(c).length > 2048) return { accept: false, reason: 'oversize-command' };
  }
  const v = verifyReplay(envelope);
  if (!v.ok) return { accept: false, reason: `replay-${v.error}` };
  const state = v.state;
  if (envelope.result.status !== state.status) return { accept: false, reason: 'result-mismatch' };
  if (envelope.result.score !== totalScore(state)) return { accept: false, reason: 'score-mismatch' };
  // plausibility: elapsed time vs command count
  const lastMs = envelope.commands.length
    ? Math.max(...envelope.commands.map((c) => c.elapsedMs || 0)) : 0;
  if (envelope.commands.length > 0 && lastMs < envelope.commands.length * MIN_MOVE_MS) {
    return { accept: false, reason: 'implausibly-fast' };
  }
  if (lastMs > 0 && envelope.commands.length / (lastMs / 60000) > MAX_MOVES_PER_MINUTE) {
    return { accept: false, reason: 'rate-implausible' };
  }
  return { accept: true, detail: { score: totalScore(state), hash: stateHash(state) } };
}

/** Deterministic daily descriptor — immutable once published. */
export function dailyDescriptor(date /* Date | ISO string */) {
  const d = typeof date === 'string' ? new Date(date) : date;
  return dailyInfo(d);
}

/** Leaderboard entry shape recorded for ranked submissions. */
export function leaderboardEntry(envelope, playerId) {
  return {
    playerId,
    score: envelope.result.score,
    moves: envelope.result.moves,
    ms: envelope.result.ms,
    assists: (envelope.result.undos || 0) + (envelope.result.hints || 0) > 0,
    seed: envelope.seed,
    ruleset: envelope.ruleset,
    contentVersion: envelope.contentVersion,
    checksum: checksum(JSON.stringify(envelope.commands.map((c) => c.id))),
  };
}

// ---------------------------------------------------------------------------
// Standalone Node server (development / self-host). In the StarHermit sandbox
// the host imports the functions above and provides its own transport.
// ---------------------------------------------------------------------------

if (typeof process !== 'undefined' && process.argv?.[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const { createServer } = await import('node:http');
  const started = Date.now();
  createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/v1/time') {
      res.end(JSON.stringify({ now: new Date().toISOString(), serverStarted: started }));
    } else if (req.url?.startsWith('/api/v1/daily')) {
      res.end(JSON.stringify(dailyDescriptor(new Date())));
    } else if (req.url === '/api/v1/validate' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        try {
          res.end(JSON.stringify(validateSubmission(JSON.parse(body))));
        } catch {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'bad-json' }));
        }
      });
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not-found' }));
    }
  }).listen(Number(process.env.PG_PORT) || 8091, function () {
    console.log(`patience-garden authoritative script on :${this.address().port}`);
  });
}
