// Test helpers: a seeded PRNG (for reproducible randomized tests) and brute force.

export function seededRng(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { int: (n) => Math.floor(next() * n), next };
}

export function* permutations(n) {
  const a = Array.from({ length: n }, (_, i) => i);
  const c = new Array(n).fill(0);
  yield a.slice();
  let i = 0;
  while (i < n) {
    if (c[i] < i) {
      const j = i % 2 === 0 ? 0 : c[i];
      [a[j], a[i]] = [a[i], a[j]];
      yield a.slice();
      c[i]++;
      i = 0;
    } else {
      c[i] = 0;
      i++;
    }
  }
}

export function people(n, groups = []) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${String(i).padStart(4, '0')}x`,
    name: `Person ${i}`,
    group: groups[i] || '',
  }));
}

/** Chi-square statistic for observed counts vs a uniform expectation. */
export function chiSquare(counts) {
  const values = [...counts.values()];
  const total = values.reduce((a, b) => a + b, 0);
  const expected = total / values.length;
  return values.reduce((s, o) => s + (o - expected) ** 2 / expected, 0);
}
