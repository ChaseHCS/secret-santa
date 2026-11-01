import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyze,
  buildConstraints,
  countExact,
  describeProblem,
  drawAssignments,
  drawPerm,
  explainBaseInfeasibility,
  isValidPerm,
  validateAssignments,
} from '../../docs/js/core/draw.js';
import { chiSquare, people, permutations, seededRng } from './helpers.mjs';

function bruteCount(C) {
  let c = 0;
  for (const p of permutations(C.n)) if (isValidPerm(C, Int32Array.from(p))) c++;
  return c;
}

test('every draw is a valid derangement (n = 2..40)', () => {
  for (let n = 2; n <= 40; n++) {
    const ps = people(n);
    for (let k = 0; k < 30; k++) {
      const res = drawAssignments(ps, {});
      assert.equal(res.ok, true);
      const recipients = new Set(Object.values(res.assignments));
      assert.equal(recipients.size, n, 'each person is drawn exactly once');
      for (const p of ps) assert.notEqual(res.assignments[p.id], p.id, 'nobody draws themselves');
      assert.equal(validateAssignments(ps, {}, res.assignments), true);
    }
  }
});

test('exclusions, groups, previous pairs and global rules are always respected', () => {
  const rng = seededRng(42);
  for (let trial = 0; trial < 400; trial++) {
    const n = 3 + rng.int(12);
    const groups = Array.from({ length: n }, () => (rng.int(3) === 0 ? `g${rng.int(3)}` : ''));
    const ps = people(n, groups);
    const exclusions = [];
    for (let k = 0; k < rng.int(n); k++) {
      const a = rng.int(n);
      const b = rng.int(n);
      if (a !== b) exclusions.push({ from: ps[a].id, to: ps[b].id });
    }
    const avoid = rng.int(2) ? [{ from: ps[0].name.toUpperCase(), to: `  ${ps[1].name} ` }] : [];
    const rules = {
      exclusions,
      avoid,
      groupsExclusive: rng.int(2) === 1,
      noReciprocal: rng.int(3) === 0,
      singleCycle: rng.int(4) === 0,
    };
    const C = buildConstraints(ps, rules);
    const res = drawPerm(C);
    const exact = countExact(C);
    if (exact === 0) {
      assert.equal(res.ok, false, 'impossible configurations must be reported');
      continue;
    }
    assert.equal(res.ok, true, `draw should succeed (count ${exact})`);
    assert.equal(isValidPerm(C, res.perm), true);
    for (const ex of exclusions) {
      const i = ps.findIndex((p) => p.id === ex.from);
      const j = ps.findIndex((p) => p.id === ex.to);
      assert.notEqual(res.perm[i], j);
    }
    if (avoid.length) assert.notEqual(res.perm[0], 1, 'avoid pairs match names case-insensitively');
    if (rules.groupsExclusive) {
      for (let i = 0; i < n; i++) {
        if (groups[i]) assert.notEqual(groups[i], groups[res.perm[i]]);
      }
    }
    if (rules.noReciprocal) for (let i = 0; i < n; i++) assert.notEqual(res.perm[res.perm[i]], i);
    if (rules.singleCycle) {
      let cur = 0;
      let steps = 0;
      do {
        cur = res.perm[cur];
        steps++;
      } while (cur !== 0);
      assert.equal(steps, n);
    }
  }
});

test('draws are uniformly distributed over all valid derangements (chi-square)', () => {
  const ps = people(4);
  const counts = new Map();
  const N = 18000;
  for (let k = 0; k < N; k++) {
    const res = drawAssignments(ps, {});
    const key = ps.map((p) => res.assignments[p.id]).join(',');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  assert.equal(counts.size, 9, 'there are exactly 9 derangements of 4');
  // 8 degrees of freedom; p = 0.0001 critical value ≈ 31.83
  assert.ok(chiSquare(counts) < 31.83, `chi-square too high: ${chiSquare(counts)}`);
});

test('single-loop draws are uniform over Hamiltonian cycles (chi-square)', () => {
  const ps = people(5);
  const counts = new Map();
  for (let k = 0; k < 24000; k++) {
    const res = drawAssignments(ps, { singleCycle: true });
    const key = ps.map((p) => res.assignments[p.id]).join(',');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  assert.equal(counts.size, 24, '(5-1)! = 24 cycles');
  // 23 dof; p = 0.0001 critical value ≈ 52.6 (generous)
  assert.ok(chiSquare(counts) < 55, `chi-square too high: ${chiSquare(counts)}`);
});

test('uniformity holds with constraints too', () => {
  const ps = people(5, ['a', 'a', '', '', '']);
  const rules = { groupsExclusive: true, exclusions: [{ from: ps[2].id, to: ps[3].id }] };
  const C = buildConstraints(ps, rules);
  const total = bruteCount(C);
  const counts = new Map();
  const N = total * 1000;
  for (let k = 0; k < N; k++) {
    const res = drawPerm(C);
    const key = Array.from(res.perm).join(',');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  assert.equal(counts.size, total);
  // dof = total - 1; generous bound: mean + 6 sd of chi-square distribution
  const dof = total - 1;
  assert.ok(chiSquare(counts) < dof + 6 * Math.sqrt(2 * dof), `chi-square ${chiSquare(counts)} dof ${dof}`);
});

test('fallback search produces valid draws when sampling is skipped', () => {
  const rng = seededRng(7);
  for (let trial = 0; trial < 300; trial++) {
    const n = 2 + rng.int(14);
    const ps = people(n);
    const exclusions = [];
    for (let k = 0; k < rng.int(2 * n); k++) {
      const a = rng.int(n);
      const b = rng.int(n);
      if (a !== b) exclusions.push({ from: ps[a].id, to: ps[b].id });
    }
    const rules = { exclusions, noReciprocal: rng.int(2) === 1, singleCycle: rng.int(3) === 0 };
    const C = buildConstraints(ps, rules);
    const res = drawPerm(C, { maxAttempts: 0 });
    const exact = countExact(C);
    if (exact === 0) {
      assert.equal(res.ok, false);
      assert.ok(['impossible', 'no-options', 'no-santa', 'hall', 'two-way-2'].includes(res.problem.kind));
    } else {
      assert.equal(res.ok, true, `search should find one of ${exact} draws`);
      assert.equal(res.method, 'search');
      assert.equal(isValidPerm(C, res.perm), true);
    }
  }
});

test('a fully forced draw (exactly one solution) is found', () => {
  const n = 8;
  const ps = people(n);
  const exclusions = [];
  // Only allow i -> i+1 (mod n).
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) if (i !== j && j !== (i + 1) % n) exclusions.push({ from: ps[i].id, to: ps[j].id });
  }
  const C = buildConstraints(ps, { exclusions });
  assert.equal(countExact(C), 1);
  for (const opts of [{}, { maxAttempts: 0 }]) {
    const res = drawPerm(C, opts);
    assert.equal(res.ok, true);
    for (let i = 0; i < n; i++) assert.equal(res.perm[i], (i + 1) % n);
  }
});

test('exact counts match brute force', () => {
  const rng = seededRng(99);
  for (let trial = 0; trial < 150; trial++) {
    const n = 2 + rng.int(6);
    const ps = people(n);
    const exclusions = [];
    for (let k = 0; k < rng.int(n * 2); k++) {
      const a = rng.int(n);
      const b = rng.int(n);
      if (a !== b) exclusions.push({ from: ps[a].id, to: ps[b].id });
    }
    for (const mode of [{}, { noReciprocal: true }, { singleCycle: true }, { singleCycle: true, noReciprocal: true }]) {
      const C = buildConstraints(ps, { exclusions, ...mode });
      assert.equal(countExact(C), bruteCount(C), `n=${n} ${JSON.stringify(mode)}`);
    }
  }
  // Known sequences: derangements and (n-1)!
  const D = [0, 0, 1, 2, 9, 44, 265, 1854, 14833, 133496, 1334961];
  for (let n = 2; n <= 10; n++) assert.equal(countExact(buildConstraints(people(n), {})), D[n]);
  assert.equal(countExact(buildConstraints(people(16), {})), 7697064251745);
  assert.equal(countExact(buildConstraints(people(10), { singleCycle: true })), 362880);
});

test('infeasible setups are explained', () => {
  const names = (ps) => ps.map((p) => p.name);
  assert.equal(drawAssignments(people(1), {}).problem.kind, 'too-few');

  let ps = people(4);
  let rules = { exclusions: ps.slice(1).map((p) => ({ from: ps[0].id, to: p.id })) };
  let res = drawAssignments(ps, rules);
  assert.equal(res.ok, false);
  assert.equal(res.problem.kind, 'no-options');
  assert.equal(res.problem.giver, 0);
  assert.match(describeProblem(res.problem, names(ps)), /Person 0 isn't allowed to draw anyone/);

  ps = people(4);
  rules = { exclusions: ps.slice(1).map((p) => ({ from: p.id, to: ps[0].id })) };
  res = drawAssignments(ps, rules);
  assert.equal(res.problem.kind, 'no-santa');
  assert.match(describeProblem(res.problem, names(ps)), /Nobody is allowed to draw Person 0/);

  // Three people (0,1,2) may only draw 3 or 4 → Hall violation.
  ps = people(5);
  rules = { exclusions: [] };
  for (const a of [0, 1, 2]) for (const b of [0, 1, 2]) if (a !== b) rules.exclusions.push({ from: ps[a].id, to: ps[b].id });
  res = drawAssignments(ps, rules);
  assert.equal(res.problem.kind, 'hall');
  assert.deepEqual(res.problem.givers.filter((g) => g <= 2).length >= 3, true);
  assert.ok(res.problem.recipients.length < res.problem.givers.length);
  assert.match(describeProblem(res.problem, names(ps)), /people for 2 spots/);

  // Same-group family of 3 in a group of 5 with no-two-way.
  assert.equal(drawAssignments(people(2), { noReciprocal: true }).problem.kind, 'two-way-2');

  // Single loop impossible: 4 people split into two forced pairs.
  ps = people(4);
  rules = { singleCycle: true, exclusions: [] };
  const allowedPairs = new Set(['0>1', '1>0', '2>3', '3>2']);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (i !== j && !allowedPairs.has(`${i}>${j}`)) rules.exclusions.push({ from: ps[i].id, to: ps[j].id });
  res = drawAssignments(ps, rules);
  assert.equal(res.ok, false);
  assert.equal(res.problem.kind, 'impossible');
  assert.equal(analyze(ps, rules).status, 'impossible');
});

test('explainBaseInfeasibility returns null for feasible setups', () => {
  assert.equal(explainBaseInfeasibility(buildConstraints(people(5), {})), null);
});

test('analyze reports counts, entropy and the tightest person', () => {
  const ps = people(6, ['a', 'a', 'b', 'b', '', '']);
  const a = analyze(ps, { groupsExclusive: true });
  assert.equal(a.status, 'ok');
  assert.equal(a.approx, false);
  assert.ok(a.count > 0);
  assert.ok(Math.abs(a.log2 - Math.log2(a.count)) < 1e-9);
  assert.equal(a.tightest.options, 4); // group of 2 in 6 people: 6 - 1 (self) - 1 (partner)

  const big = analyze(people(40), { noReciprocal: true });
  assert.equal(big.status, 'ok');
  assert.equal(big.approx, true);
  assert.ok(big.log2 > 100 && big.log2 < 160, `estimate ${big.log2}`);
});

test('large exchanges draw quickly', () => {
  const ps = people(300, Array.from({ length: 300 }, (_, i) => `house${i % 60}`));
  const t0 = performance.now();
  const res = drawAssignments(ps, { groupsExclusive: true, noReciprocal: true });
  const ms = performance.now() - t0;
  assert.equal(res.ok, true);
  assert.equal(validateAssignments(ps, { groupsExclusive: true, noReciprocal: true }, res.assignments), true);
  assert.ok(ms < 2000, `took ${ms}ms`);
});

test('validateAssignments rejects broken mappings', () => {
  const ps = people(3);
  assert.equal(validateAssignments(ps, {}, { [ps[0].id]: ps[1].id, [ps[1].id]: ps[2].id, [ps[2].id]: ps[0].id }), true);
  assert.equal(validateAssignments(ps, {}, { [ps[0].id]: ps[1].id, [ps[1].id]: ps[1].id, [ps[2].id]: ps[0].id }), false);
  assert.equal(validateAssignments(ps, {}, { [ps[0].id]: ps[1].id, [ps[1].id]: ps[0].id, [ps[2].id]: ps[0].id }), false);
  assert.equal(validateAssignments(ps, {}, { [ps[0].id]: ps[1].id, [ps[1].id]: ps[2].id }), false);
});
