// Static checks on the deployable site in docs/, catching mistakes that would only
// show up after deploying to GitHub Pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeAssets, render } from '../../scripts/build-sw.mjs';
import { ICONS } from '../../docs/js/vendor/lucide-icons.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const site = path.join(root, 'docs');

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

const jsFiles = (await walk(path.join(site, 'js'))).filter((f) => f.endsWith('.js'));

test('service worker precache list and version are up to date (run `npm run build:sw`)', async () => {
  const sw = await readFile(path.join(site, 'sw.js'), 'utf8');
  assert.equal(render(sw, await computeAssets()), sw);
});

test('every precached asset exists', async () => {
  const { assets } = await computeAssets();
  for (const a of assets) if (a !== './') assert.ok(existsSync(path.join(site, a)), a);
});

test('every relative import resolves to a real file with exact casing', async () => {
  for (const file of jsFiles) {
    const src = await readFile(file, 'utf8');
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]/gm)) {
      const target = path.resolve(path.dirname(file), m[1]);
      const dir = path.dirname(target);
      assert.ok(existsSync(dir), `${path.relative(root, file)} → ${m[1]}`);
      const names = await readdir(dir);
      assert.ok(names.includes(path.basename(target)), `${path.relative(root, file)} imports missing/miscased ${m[1]}`);
    }
  }
});

test('every icon name used in the UI exists', async () => {
  const used = new Set();
  for (const file of jsFiles) {
    if (file.includes(`${path.sep}vendor${path.sep}`)) continue;
    const src = await readFile(file, 'utf8');
    for (const m of src.matchAll(/\bicon\(\s*'([a-z0-9-]+)'/g)) used.add(m[1]);
    for (const m of src.matchAll(/\biconName:\s*'([a-z0-9-]+)'/g)) used.add(m[1]);
    for (const m of src.matchAll(/\bicon:\s*'([a-z0-9-]+)'/g)) used.add(m[1]);
    for (const m of src.matchAll(/(?:iconButton|channel|channelLink)\([^,]+,\s*'([a-z0-9-]+)'/g)) used.add(m[1]);
  }
  // Icons chosen dynamically from small maps.
  for (const n of ['info', 'circle-check', 'circle-alert', 'triangle-alert', 'eye', 'eye-off', 'check', 'volume-2', 'volume-x', 'monitor', 'sun', 'moon']) used.add(n);
  const missing = [...used].filter((n) => !ICONS[n]);
  assert.deepEqual(missing, []);
});

test('index.html has a strict CSP and references existing files', async () => {
  const html = await readFile(path.join(site, 'index.html'), 'utf8');
  const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)[1];
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /style-src 'self'(;|$)/);
  assert.match(csp, /object-src 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  for (const m of html.matchAll(/(?:href|src)="([^"#:]+)"/g)) assert.ok(existsSync(path.join(site, m[1])), m[1]);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, 'no inline scripts');
  assert.doesNotMatch(html, /\sstyle="/, 'no inline style attributes');
});

test('404.html CSP hashes match its inline script and style', async () => {
  const html = await readFile(path.join(site, '404.html'), 'utf8');
  const hash = (s) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.ok(csp.includes(`style-src ${hash(style)}`), 'style hash');
  assert.ok(csp.includes(`script-src ${hash(script)}`), 'script hash');
});

test('manifest icons exist and .nojekyll is present', async () => {
  const manifest = JSON.parse(await readFile(path.join(site, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.start_url, './');
  for (const icon of manifest.icons) assert.ok(existsSync(path.join(site, icon.src)), icon.src);
  assert.ok(existsSync(path.join(site, '.nojekyll')));
});

test('no source file uses HTML-parsing sinks', async () => {
  for (const file of jsFiles) {
    if (file.includes(`${path.sep}vendor${path.sep}`)) continue;
    const src = await readFile(file, 'utf8');
    const stripped = src.replace(/key === 'innerHTML' \|\| key === 'outerHTML'/, '');
    assert.doesNotMatch(stripped, /\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/, path.relative(root, file));
  }
});
