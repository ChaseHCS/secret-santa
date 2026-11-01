// Shared Playwright harness: serves docs/ under /secret-santa/ (like GitHub Pages) and
// collects console errors, page errors and CSP violations so tests can assert none happened.
import { createRequire } from 'node:module';
import { startServer } from '../../scripts/serve.mjs';

const require = createRequire(import.meta.url);
const playwright = require('playwright');

export const BROWSER = process.env.BROWSER || 'chromium';

export async function setup() {
  const server = await startServer({ port: 0 });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/secret-santa/`;
  const browser = await playwright[BROWSER].launch();
  return {
    base,
    browser,
    async close() {
      await browser.close();
      await new Promise((r) => server.close(r));
    },
  };
}

/** Collects problems on a page. `allow` is a list of regexes for expected messages. */
export function watch(page, allow = []) {
  const problems = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (allow.some((re) => re.test(text))) return;
    problems.push(`console.error: ${text}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

export async function newContext(browser, opts = {}) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, ...opts });
  return context;
}

/** Read an exchange (or the only one) straight from localStorage. */
export async function readEvent(page, id = null) {
  return page.evaluate((wanted) => {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('secret-santa:event:'));
    const key = wanted ? `secret-santa:event:${wanted}` : keys[0];
    return JSON.parse(localStorage.getItem(key));
  }, id);
}

export function eventIdFromUrl(url) {
  const m = /#\/e\/([a-z0-9]+)/.exec(url);
  return m ? m[1] : null;
}

export function linkFor(base, entry) {
  return `${base}#/${entry.sealed ? 's' : 'r'}/${entry.link}`;
}

/** Open a reveal link in a fresh page, skip the animation, and return the match name. */
export async function openReveal(context, url) {
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(url);
  await page.getByRole('button', { name: 'Skip the animation and show me' }).click();
  const name = (await page.locator('.match-name').textContent()).trim();
  const giver = (await page.locator('.reveal-hello').textContent()).replace(/^Hi\s+/, '').replace(/!.*$/, '').trim();
  await page.locator('.verify-ok, .verify-bad, .verify-none').first().waitFor();
  const verified = await page.locator('.verify-ok').count();
  const fp = verified ? (await page.locator('.fp-inline').textContent()).trim() : null;
  await page.close();
  return { name, giver, verified: verified === 1, fp, problems };
}

export async function noHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}
