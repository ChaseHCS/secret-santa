// The draw engine.
//
// A draw is a permutation `perm` where perm[giver] = recipient. Constraints:
//   * nobody draws themselves
//   * explicit exclusions ("A can't draw B")
//   * optional: people in the same group/household can't draw each other
//   * optional: avoid pairs from a previous exchange
//   * optional global rules: no two-way swaps (A→B and B→A), or one single loop
//
// Strategy:
//   1. Feasibility check with bipartite matching (Kuhn). If no perfect matching
//      exists, explain why using Hall's theorem (a group of k people who can only
//      draw from fewer than k people).
//   2. Rejection sampling: build a uniformly random permutation (or cyclic order)
//      with crypto randomness and keep it only if every rule holds. Conditioning a
//      uniform distribution on validity gives a sample that is *exactly uniform*
//      over all valid draws.
//   3. If the rules are so tight that sampling keeps failing, fall back to a
//      randomized backtracking search (valid, random, but not provably uniform).
//   4. Every result is re-validated before it is returned.

import { cryptoRng, shuffle } from '../lib/random.js';

export const REASON = Object.freeze({
  SELF: 'self',
  GROUP: 'group',
  EXCLUDED: 'excluded',
  PREVIOUS: 'previous',
});

const now = () => (globalThis.performance ? performance.now() : Date.now());

export function normName(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * @param {{id:string,name:string,group?:string}[]} participants
 * @param {{exclusions?:{from:string,to:string}[], groupsExclusive?:boolean,
 *          noReciprocal?:boolean, singleCycle?:boolean, avoid?:{from:string,to:string}[]}} rules
 */
export function buildConstraints(participants, rules = {}) {
  const n = participants.length;
  const allowed = Array.from({ length: n }, () => new Array(n).fill(true));
  const reason = Array.from({ length: n }, () => new Array(n).fill(null));
  const forbid = (i, j, why) => {
    if (allowed[i][j]) {
      allowed[i][j] = false;
      reason[i][j] = why;
    }
  };
  for (let i = 0; i < n; i++) forbid(i, i, REASON.SELF);

  if (rules.groupsExclusive) {
    const groups = new Map();
    participants.forEach((p, i) => {
      const g = normName(p.group);
      if (!g) return;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(i);
    });
    for (const members of groups.values()) {
      for (const a of members) for (const b of members) if (a !== b) forbid(a, b, REASON.GROUP);
    }
  }

  const index = new Map(participants.map((p, i) => [p.id, i]));
  for (const ex of rules.exclusions || []) {
    const i = index.get(ex.from);
    const j = index.get(ex.to);
    if (i !== undefined && j !== undefined) forbid(i, j, REASON.EXCLUDED);
  }

  if (rules.avoid && rules.avoid.length) {
    const byName = new Map(participants.map((p, i) => [normName(p.name), i]));
    for (const pair of rules.avoid) {
      const i = byName.get(normName(pair.from));
      const j = byName.get(normName(pair.to));
      if (i !== undefined && j !== undefined) forbid(i, j, REASON.PREVIOUS);
    }
  }

  return {
    n,
    allowed,
    reason,
    noReciprocal: !!rules.noReciprocal,
    singleCycle: !!rules.singleCycle,
  };
}

function indicesWhere(row) {
  const out = [];
  for (let j = 0; j < row.length; j++) if (row[j]) out.push(j);
  return out;
}

/** Maximum bipartite matching (Kuhn's algorithm). Optional rng randomizes the result. */
export function maxMatching(allowed, rng = null) {
  const n = allowed.length;
  const adj = allowed.map((row) => indicesWhere(row));
  const order = Array.from({ length: n }, (_, i) => i);
  if (rng) {
    shuffle(order, rng);
    adj.forEach((a) => shuffle(a, rng));
  }
  const matchL = new Int32Array(n).fill(-1);
  const matchR = new Int32Array(n).fill(-1);
  let seen;
  const augment = (u) => {
    for (const v of adj[u]) {
      if (seen[v]) continue;
      seen[v] = 1;
      if (matchR[v] === -1 || augment(matchR[v])) {
        matchR[v] = u;
        matchL[u] = v;
        return true;
      }
    }
    return false;
  };
  let size = 0;
  for (const u of order) {
    seen = new Uint8Array(n);
    if (augment(u)) size++;
  }
  return { size, matchL, matchR };
}

/**
 * Returns null if a valid assignment exists ignoring global rules (two-way/loop),
 * otherwise a structured explanation.
 */
export function explainBaseInfeasibility(C) {
  const { n, allowed } = C;
  if (n < 2) return { kind: 'too-few' };
  for (let i = 0; i < n; i++) {
    if (!allowed[i].some(Boolean)) return { kind: 'no-options', giver: i };
  }
  for (let j = 0; j < n; j++) {
    let any = false;
    for (let i = 0; i < n; i++) if (allowed[i][j]) any = true;
    if (!any) return { kind: 'no-santa', recipient: j };
  }
  const m = maxMatching(allowed);
  if (m.size === n) return null;
  // Hall violator: alternating BFS from an unmatched giver.
  const start = m.matchL.indexOf(-1);
  const givers = new Set([start]);
  const recipients = new Set();
  const queue = [start];
  while (queue.length) {
    const g = queue.shift();
    for (let r = 0; r < n; r++) {
      if (!allowed[g][r] || recipients.has(r)) continue;
      recipients.add(r);
      const next = m.matchR[r];
      if (next !== -1 && !givers.has(next)) {
        givers.add(next);
        queue.push(next);
      }
    }
  }
  return { kind: 'hall', givers: [...givers].sort((a, b) => a - b), recipients: [...recipients].sort((a, b) => a - b) };
}

/** Validates a permutation against all constraints. */
export function isValidPerm(C, perm) {
  const { n, allowed } = C;
  if (!perm || perm.length !== n) return false;
  const seen = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = perm[i];
    if (!Number.isInteger(r) || r < 0 || r >= n || seen[r]) return false;
    seen[r] = 1;
    if (!allowed[i][r]) return false;
  }
  if (C.noReciprocal) {
    for (let i = 0; i < n; i++) if (perm[perm[i]] === i) return false;
  }
  if (C.singleCycle) {
    let steps = 0;
    let cur = 0;
    do {
      cur = perm[cur];
      steps++;
    } while (cur !== 0 && steps <= n);
    if (steps !== n) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Uniform samplers (return a valid perm or null). Early rejection keeps them fast
// and does not affect uniformity: each complete permutation has probability 1/n!.

function makeSampler(C, rng) {
  const n = C.n;
  const { allowed, noReciprocal } = C;
  const work = new Int32Array(n);
  const perm = new Int32Array(n);
  if (C.singleCycle) {
    return () => {
      if (noReciprocal && n === 2) return null;
      for (let i = 0; i < n; i++) work[i] = i;
      for (let i = 0; i < n; i++) {
        const k = i + rng.int(n - i);
        const t = work[k];
        work[k] = work[i];
        work[i] = t;
        if (i > 0 && !allowed[work[i - 1]][work[i]]) return null;
      }
      if (!allowed[work[n - 1]][work[0]]) return null;
      for (let i = 0; i < n; i++) perm[work[i]] = work[(i + 1) % n];
      return Int32Array.from(perm);
    };
  }
  return () => {
    for (let i = 0; i < n; i++) work[i] = i;
    for (let i = 0; i < n; i++) {
      const k = i + rng.int(n - i);
      const r = work[k];
      work[k] = work[i];
      work[i] = r;
      if (!allowed[i][r]) return null;
      if (noReciprocal && r < i && perm[r] === i) return null;
      perm[i] = r;
    }
    return Int32Array.from(perm);
  };
}

// ---------------------------------------------------------------------------
// Randomized backtracking fallbacks.

function searchPerm(C, rng, deadline, maxNodes) {
  const n = C.n;
  const { allowed, noReciprocal } = C;
  const cand = allowed.map((row) => shuffle(indicesWhere(row), rng));
  const pred = Array.from({ length: n }, (_, j) => {
    const out = [];
    for (let i = 0; i < n; i++) if (allowed[i][j]) out.push(i);
    return out;
  });
  const perm = new Int32Array(n).fill(-1);
  const used = new Uint8Array(n);
  let nodes = 0;
  let aborted = false;
  const ok = (i, j) => !used[j] && !(noReciprocal && perm[j] === i);

  const rec = (count) => {
    if (count === n) return true;
    nodes++;
    if (nodes > maxNodes || ((nodes & 63) === 0 && now() > deadline)) {
      aborted = true;
      return false;
    }
    let best = -1;
    let bestCount = Infinity;
    for (let i = 0; i < n; i++) {
      if (perm[i] !== -1) continue;
      let c = 0;
      for (const j of cand[i]) if (ok(i, j)) c++;
      if (c === 0) return false;
      if (c < bestCount) {
        bestCount = c;
        best = i;
      }
    }
    for (let j = 0; j < n; j++) {
      if (used[j]) continue;
      let reachable = false;
      for (const i of pred[j]) {
        if (perm[i] === -1 && ok(i, j)) {
          reachable = true;
          break;
        }
      }
      if (!reachable) return false;
    }
    for (const j of cand[best]) {
      if (!ok(best, j)) continue;
      perm[best] = j;
      used[j] = 1;
      if (rec(count + 1)) return true;
      perm[best] = -1;
      used[j] = 0;
      if (aborted) return false;
    }
    return false;
  };

  const found = rec(0);
  return { perm: found ? perm : null, exhausted: !found && !aborted };
}

function searchCycle(C, rng, deadline, maxNodes) {
  const n = C.n;
  const { allowed, noReciprocal } = C;
  if (noReciprocal && n === 2) return { perm: null, exhausted: true };
  const succ = allowed.map((row) => shuffle(indicesWhere(row), rng));
  const pred = Array.from({ length: n }, (_, j) => {
    const out = [];
    for (let i = 0; i < n; i++) if (allowed[i][j]) out.push(i);
    return out;
  });
  const start = rng.int(n);
  const visited = new Uint8Array(n);
  visited[start] = 1;
  const path = [start];
  let nodes = 0;
  let aborted = false;

  const viable = (cur) => {
    for (let v = 0; v < n; v++) {
      if (visited[v]) continue;
      let hasSucc = false;
      for (const w of succ[v]) {
        if (w === start || !visited[w]) {
          hasSucc = true;
          break;
        }
      }
      if (!hasSucc) return false;
      let hasPred = false;
      for (const u of pred[v]) {
        if (u === cur || !visited[u]) {
          hasPred = true;
          break;
        }
      }
      if (!hasPred) return false;
    }
    return true;
  };
  const onward = (w) => {
    let c = 0;
    for (const x of succ[w]) if (!visited[x]) c++;
    return c;
  };

  const rec = (cur, depth) => {
    if (depth === n) return allowed[cur][start];
    nodes++;
    if (nodes > maxNodes || ((nodes & 63) === 0 && now() > deadline)) {
      aborted = true;
      return false;
    }
    if (!viable(cur)) return false;
    const next = [];
    for (const w of succ[cur]) if (!visited[w]) next.push([onward(w), w]);
    next.sort((a, b) => a[0] - b[0]); // Warnsdorff heuristic; stable sort keeps random tie-breaks
    for (const [, w] of next) {
      visited[w] = 1;
      path.push(w);
      if (rec(w, depth + 1)) return true;
      path.pop();
      visited[w] = 0;
      if (aborted) return false;
    }
    return false;
  };

  const found = rec(start, 1);
  if (!found) return { perm: null, exhausted: !aborted };
  const perm = new Int32Array(n);
  for (let k = 0; k < n; k++) perm[path[k]] = path[(k + 1) % n];
  return { perm, exhausted: false };
}

// ---------------------------------------------------------------------------

/**
 * Draw a valid assignment.
 * @returns {{ok:true, perm:Int32Array, method:'uniform'|'search', attempts:number} |
 *           {ok:false, problem:object}}
 */
export function drawPerm(C, opts = {}) {
  const rng = opts.rng || cryptoRng;
  const n = C.n;
  const base = explainBaseInfeasibility(C);
  if (base) return { ok: false, problem: base };
  if (C.noReciprocal && n === 2) return { ok: false, problem: { kind: 'two-way-2' } };

  const maxAttempts = opts.maxAttempts ?? 500000;
  const sampleDeadline = now() + (opts.sampleTimeMs ?? 300);
  const sample = makeSampler(C, rng);
  for (let a = 1; a <= maxAttempts; a++) {
    const perm = sample();
    if (perm) {
      if (!isValidPerm(C, perm)) throw new Error('Internal error: sampler produced an invalid draw');
      return { ok: true, perm, method: 'uniform', attempts: a };
    }
    if ((a & 1023) === 0 && now() > sampleDeadline) break;
  }

  const searchDeadline = now() + (opts.searchTimeMs ?? 1500);
  const maxNodes = opts.maxNodes ?? 2_000_000;
  const res = C.singleCycle ? searchCycle(C, rng, searchDeadline, maxNodes) : searchPerm(C, rng, searchDeadline, maxNodes);
  if (res.perm) {
    if (!isValidPerm(C, res.perm)) throw new Error('Internal error: search produced an invalid draw');
    return { ok: true, perm: res.perm, method: 'search', attempts: 0 };
  }
  if (!C.singleCycle && !C.noReciprocal) {
    // A perfect matching exists (checked above) and is itself a valid draw.
    const m = maxMatching(C.allowed, rng);
    const perm = Int32Array.from(m.matchL);
    if (m.size === n && isValidPerm(C, perm)) return { ok: true, perm, method: 'search', attempts: 0 };
  }
  return { ok: false, problem: { kind: res.exhausted ? 'impossible' : 'too-hard' } };
}

/** Convenience: draw for participant objects. Returns {ok, assignments:{giverId: recipientId}, ...}. */
export function drawAssignments(participants, rules, opts = {}) {
  const C = buildConstraints(participants, rules);
  const res = drawPerm(C, opts);
  if (!res.ok) return res;
  const assignments = {};
  participants.forEach((p, i) => {
    assignments[p.id] = participants[res.perm[i]].id;
  });
  return { ...res, assignments };
}

/** Validate an {giverId: recipientId} mapping against current participants and rules. */
export function validateAssignments(participants, rules, assignments) {
  const C = buildConstraints(participants, rules);
  const index = new Map(participants.map((p, i) => [p.id, i]));
  const perm = new Int32Array(C.n);
  for (let i = 0; i < C.n; i++) {
    const r = index.get(assignments[participants[i].id]);
    if (r === undefined) return false;
    perm[i] = r;
  }
  return isValidPerm(C, perm);
}

// ---------------------------------------------------------------------------
// Counting possible draws (for the "how random is this?" stats).

function popcount(x) {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}

/** Exact count of valid permutations (matrix permanent) via subset DP. n ≤ 18. */
function countPermanent(C) {
  const n = C.n;
  const masks = C.allowed.map((row) => row.reduce((m, ok, j) => (ok ? m | (1 << j) : m), 0));
  const size = 1 << n;
  const dp = new Float64Array(size);
  dp[0] = 1;
  for (let mask = 0; mask < size; mask++) {
    const v = dp[mask];
    if (!v) continue;
    const i = popcount(mask);
    if (i >= n) continue;
    let avail = masks[i] & ~mask;
    while (avail) {
      const bit = avail & -avail;
      dp[mask | bit] += v;
      avail ^= bit;
    }
  }
  return dp[size - 1];
}

/** Exact count of directed Hamiltonian cycles (Held–Karp style DP). n ≤ 16. */
function countCycles(C) {
  const n = C.n;
  const { allowed } = C;
  if (n === 1) return 0;
  const size = 1 << n;
  const dp = new Float64Array(size * n);
  dp[1 * n + 0] = 1;
  for (let mask = 1; mask < size; mask += 2) {
    for (let v = 0; v < n; v++) {
      const c = dp[mask * n + v];
      if (!c) continue;
      for (let w = 1; w < n; w++) {
        if (mask & (1 << w) || !allowed[v][w]) continue;
        dp[(mask | (1 << w)) * n + w] += c;
      }
    }
  }
  let total = 0;
  for (let v = 1; v < n; v++) if (allowed[v][0]) total += dp[(size - 1) * n + v];
  return total;
}

/** Exact count with the no-two-way rule by DFS. n ≤ 9. */
function countNoReciprocal(C) {
  const n = C.n;
  const { allowed } = C;
  const perm = new Int32Array(n).fill(-1);
  const used = new Uint8Array(n);
  let count = 0;
  const rec = (i) => {
    if (i === n) {
      count++;
      return;
    }
    for (let r = 0; r < n; r++) {
      if (used[r] || !allowed[i][r]) continue;
      if (r < i && perm[r] === i) continue;
      used[r] = 1;
      perm[i] = r;
      rec(i + 1);
      used[r] = 0;
      perm[i] = -1;
    }
  };
  rec(0);
  return count;
}

export function log2Factorial(n) {
  let s = 0;
  for (let k = 2; k <= n; k++) s += Math.log2(k);
  return s;
}

/** Exact count when cheap to compute, else null. */
export function countExact(C) {
  const n = C.n;
  if (n < 2) return 0;
  if (C.singleCycle) {
    if (C.noReciprocal && n === 2) return 0;
    return n <= 16 ? countCycles(C) : null;
  }
  if (C.noReciprocal) {
    if (n === 2) return 0;
    return n <= 9 ? countNoReciprocal(C) : null;
  }
  return n <= 18 ? countPermanent(C) : null;
}

/** Monte-Carlo estimate (log2 of the number of valid draws). */
export function estimateLog2Count(C, opts = {}) {
  const rng = opts.rng || cryptoRng;
  const samples = opts.samples ?? 20000;
  const deadline = now() + (opts.timeMs ?? 40);
  const sample = makeSampler(C, rng);
  let accepted = 0;
  let done = 0;
  while (done < samples) {
    if (sample()) accepted++;
    done++;
    if ((done & 255) === 0 && now() > deadline) break;
  }
  const space = C.singleCycle ? log2Factorial(C.n - 1) : log2Factorial(C.n);
  if (accepted === 0) return { log2: null, upperLog2: space - Math.log2(done), samples: done };
  return { log2: Math.log2(accepted / done) + space, samples: done, accepted };
}

/**
 * Live analysis for the rules editor.
 * @returns {{status:'ok'|'impossible'|'unknown', problem?:object, count?:number|null,
 *            log2?:number|null, approx?:boolean, tightest?:{index:number, options:number}}}
 */
export function analyze(participants, rules, opts = {}) {
  const C = buildConstraints(participants, rules);
  const n = C.n;
  if (n < 2) return { status: 'impossible', problem: { kind: 'too-few' }, C };
  const base = explainBaseInfeasibility(C);
  if (base) return { status: 'impossible', problem: base, C };
  if (C.noReciprocal && n === 2) return { status: 'impossible', problem: { kind: 'two-way-2' }, C };

  let tightest = null;
  for (let i = 0; i < n; i++) {
    const options = C.allowed[i].filter(Boolean).length;
    if (!tightest || options < tightest.options) tightest = { index: i, options };
  }

  const exact = countExact(C);
  if (exact !== null) {
    if (exact === 0) return { status: 'impossible', problem: { kind: 'impossible' }, C, count: 0 };
    return { status: 'ok', count: exact, log2: Math.log2(exact), approx: false, tightest, C };
  }

  // Large or global-rule cases: make sure a draw can actually be found.
  if (C.noReciprocal || C.singleCycle) {
    const trial = drawPerm(C, {
      rng: opts.rng,
      sampleTimeMs: opts.sampleTimeMs ?? 60,
      searchTimeMs: opts.searchTimeMs ?? 300,
    });
    if (!trial.ok) {
      return { status: trial.problem.kind === 'too-hard' ? 'unknown' : 'impossible', problem: trial.problem, C };
    }
  }
  const est = estimateLog2Count(C, opts);
  return { status: 'ok', count: null, log2: est.log2, upperLog2: est.upperLog2, approx: true, tightest, C };
}

/** Human-readable explanation of a problem. `names[i]` is participant i's name. */
export function describeProblem(problem, names) {
  const list = (idx) => formatList(idx.map((i) => names[i]));
  switch (problem.kind) {
    case 'too-few':
      return 'Add at least 2 people to draw names.';
    case 'no-options':
      return `${names[problem.giver]} isn't allowed to draw anyone. Remove a rule that involves them.`;
    case 'no-santa':
      return `Nobody is allowed to draw ${names[problem.recipient]}. Remove a rule that involves them.`;
    case 'hall': {
      const g = problem.givers;
      const r = problem.recipients;
      return `${list(g)} can only draw from ${r.length === 1 ? names[r[0]] : list(r)}: that's ${g.length} people for ${r.length} ${r.length === 1 ? 'spot' : 'spots'}. Relax a rule involving them.`;
    }
    case 'two-way-2':
      return 'With only 2 people, the two must draw each other. Turn off "No two-way swaps" or add more people.';
    case 'impossible':
      return 'No valid draw exists with these rules. Try removing an exclusion or turning off a rule.';
    case 'too-hard':
      return "These rules are so tight that no valid draw turned up. Try relaxing a rule.";
    default:
      return 'These rules can’t be satisfied.';
  }
}

export function formatList(items) {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  if (items.length > 6) return `${items.slice(0, 5).join(', ')} and ${items.length - 5} others`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
