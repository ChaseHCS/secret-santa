// Regenerates the precache list and content-hash version in docs/sw.js.
// `--check` exits non-zero if sw.js is out of date (used by tests/CI).
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'docs');
const SKIP = new Set(['sw.js', '404.html', '.nojekyll']);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

export async function computeAssets() {
  const files = (await walk(site))
    .map((f) => path.relative(site, f).split(path.sep).join('/'))
    .filter((f) => !SKIP.has(f) && !f.endsWith('.md'))
    .sort();
  const hash = createHash('sha256');
  for (const f of files) {
    hash.update(f);
    hash.update(await readFile(path.join(site, f)));
  }
  return { assets: ['./', ...files], version: hash.digest('hex').slice(0, 12) };
}

export function render(source, { assets, version }) {
  const block = `// <generated-assets> (run \`npm run build:sw\` after changing files; a unit test checks this)
const VERSION = '${version}';
const ASSETS = [
${assets.map((a) => `  '${a}',`).join('\n')}
];
// </generated-assets>`;
  return source.replace(/\/\/ <generated-assets>[\s\S]*?\/\/ <\/generated-assets>/, block);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const swPath = path.join(site, 'sw.js');
  const source = await readFile(swPath, 'utf8');
  const next = render(source, await computeAssets());
  if (process.argv.includes('--check')) {
    if (next !== source) {
      console.error('docs/sw.js is out of date. Run: npm run build:sw');
      process.exit(1);
    }
    console.log('docs/sw.js is up to date');
  } else {
    await writeFile(swPath, next);
    console.log('Updated docs/sw.js');
  }
}
