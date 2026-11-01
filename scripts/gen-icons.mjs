// Renders docs/icons/icon.svg into the PNG sizes browsers and home screens want.
// Usage: node scripts/gen-icons.mjs   (needs Playwright + Chromium)
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = await readFile(path.join(root, 'docs/icons/icon.svg'), 'utf8');
// Full-bleed variant (no rounded corners) for maskable/Apple icons; the OS applies its own mask.
const square = svg.replace('rx="112"', 'rx="0"');
// Maskable: shrink artwork into the 80% safe zone.
const maskable = square.replace(/(<rect width="512" height="512" rx="0" fill="url\(#bg\)"\/>)([\s\S]*)(<\/svg>)/, '$1<g transform="translate(51.2 51.2) scale(0.8)">$2</g>$3');

const targets = [
  ['favicon-32.png', 32, svg, true],
  ['icon-192.png', 192, svg, true],
  ['icon-512.png', 512, svg, true],
  ['apple-touch-icon.png', 180, square, false],
  ['icon-maskable-512.png', 512, maskable, false],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, markup, transparent] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${markup.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: path.join(root, 'docs/icons', name), omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', name);
}
await browser.close();
