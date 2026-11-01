import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BROWSER, eventIdFromUrl, linkFor, newContext, noHorizontalOverflow, openReveal, readEvent, setup, watch } from './harness.mjs';

let env;
before(async () => {
  env = await setup();
});
after(async () => {
  await env.close();
});

async function createExchange(page, base, { name, sealed = false } = {}) {
  await page.goto(`${base}#/new`);
  await page.waitForURL(/#\/e\/[a-z0-9]+\/details/);
  await page.getByLabel('Exchange name', { exact: true }).fill(name);
  await page.getByLabel(/^Date/).fill('2026-12-18');
  await page.getByLabel(/^Budget/).fill('25');
  await page.getByLabel(/^Organizer/).fill('Org');
  if (sealed) await page.getByText('Sealed mode: even the organizer can’t peek').click();
  await page.getByRole('link', { name: 'Next: People' }).click();
  await page.waitForURL(/\/people$/);
  return eventIdFromUrl(page.url());
}

async function addPeople(page, names) {
  for (const n of names) {
    await page.getByLabel('Name', { exact: true }).fill(n);
    await page.keyboard.press('Enter');
    await page.locator('.person-name', { hasText: new RegExp(`^${n}$`) }).waitFor();
  }
}

test('home, ideas, about and wishlist pages render without errors', async () => {
  const context = await newContext(env.browser);
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(env.base);
  await page.getByRole('heading', { name: /Secret Santa,\s*sorted/ }).waitFor();
  await page.locator('.site-nav').getByRole('link', { name: 'Gift ideas' }).click();
  await page.waitForURL(/#\/ideas/);
  await page.getByRole('heading', { level: 1, name: /Gift idea generator/ }).waitFor();
  await page.locator('.idea').first().waitFor();
  const all = await page.locator('.idea').count();
  await page.getByRole('button', { name: /\$ · Under \$15/ }).click();
  await page.waitForFunction((n) => {
    const c = document.querySelectorAll('.idea').length;
    return c > 0 && c < n;
  }, all);
  await page.getByRole('button', { name: 'Surprise me' }).click();
  await page.locator('.spot-card.landed').waitFor();
  await page.goto(`${env.base}#/about`);
  await page.getByRole('heading', { name: 'How it works & security' }).waitFor();
  assert.deepEqual(problems, []);
  await context.close();
});

test('full exchange: add people, rules, draw, and every link reveals a valid match', async () => {
  const context = await newContext(env.browser);
  const page = await context.newPage();
  const problems = watch(page);
  const id = await createExchange(page, env.base, { name: 'Office Party 2026' });

  await addPeople(page, ['Ann', 'Bob', 'Cat', 'Dan']);
  await page.getByRole('button', { name: 'Paste a list' }).click();
  await page.getByLabel('Names', { exact: true }).fill('Eve <eve@example.com>\nFay, fay@example.com\nAnn');
  await page.getByText('2 people will be added · 1 already in the list.').waitFor();
  await page.getByRole('button', { name: 'Add everyone' }).click();
  await page.locator('.person-name', { hasText: /^Fay$/ }).waitFor();

  // Duplicate names are rejected.
  await page.getByLabel('Name', { exact: true }).fill('ann');
  await page.keyboard.press('Enter');
  await page.getByText('ann is already on the list.').waitFor();
  await page.getByLabel('Name', { exact: true }).fill('');

  // Put Cat and Dan in one household; give Eve a wishlist.
  for (const who of ['Cat', 'Dan']) {
    await page.getByRole('button', { name: `Edit ${who}` }).click();
    await page.getByLabel('Household / group').fill('Smiths');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.locator('dialog[open]').waitFor({ state: 'detached' });
  }
  await page.getByRole('button', { name: 'Edit Eve' }).click();
  await page.getByLabel(/^Wishlist/).fill('Wool socks\nhttps://example.com/mug');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.locator('dialog[open]').waitFor({ state: 'detached' });

  // Rules: no swaps + Ann ↔ Bob exclusion.
  await page.getByRole('link', { name: 'Next: Rules' }).click();
  await page.getByText('No two-way swaps', { exact: true }).click();
  await page.getByLabel('Giver').selectOption({ label: 'Ann' });
  await page.getByLabel('Recipient').selectOption({ label: 'Bob' });
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.locator('.rule-item').waitFor();
  await page.locator('.feas-ok').waitFor();
  await page.getByText('Show who can draw whom').click();
  await page.locator('table.matrix').waitFor();

  // Draw.
  await page.getByRole('link', { name: 'Next: Draw & send' }).click();
  await page.getByRole('button', { name: 'Draw names' }).click();
  await page.locator('.fingerprint-card').waitFor();
  const fpOnDashboard = (await page.locator('.fp-code').textContent()).trim();

  const ev = await readEvent(page, id);
  assert.equal(ev.participants.length, 6);
  const byId = Object.fromEntries(ev.participants.map((p) => [p.id, p.name]));
  const matches = {};
  for (const p of ev.participants) {
    const entry = ev.draw.entries[p.id];
    assert.equal(entry.sealed, false);
    const r = await openReveal(context, linkFor(env.base, entry));
    assert.deepEqual(r.problems, []);
    assert.equal(r.giver, p.name);
    assert.equal(r.name, byId[entry.recipientId]);
    assert.ok(r.verified, 'fingerprint verifies');
    assert.ok(r.fp.endsWith(fpOnDashboard), 'same fingerprint as dashboard');
    matches[p.name] = r.name;
  }
  const names = Object.keys(matches);
  assert.equal(new Set(Object.values(matches)).size, names.length, 'everyone is drawn exactly once');
  for (const n of names) {
    assert.notEqual(matches[n], n);
    assert.notEqual(matches[matches[n]], n, 'no two-way swaps');
  }
  assert.notEqual(matches.Ann, 'Bob');
  assert.notEqual(matches.Bob, 'Ann');
  assert.ok(!(matches.Cat === 'Dan' || matches.Dan === 'Cat'), 'household kept apart');

  // Send dialog marks as sent.
  await page.getByRole('button', { name: 'Send' }).first().click();
  await page.getByRole('button', { name: 'Copy link only' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByText('1 of 6 links sent').waitFor();

  // Editing details after the draw → outdated → update links keeps matches.
  await page.getByRole('link', { name: /Details/ }).first().click();
  await page.getByLabel(/^Location/).fill('Break room');
  await page.getByRole('link', { name: /Draw & send/ }).first().click();
  await page.getByText('Links are out of date').waitFor();
  await page.getByRole('button', { name: 'Update links (keep matches)' }).click();
  await page.getByText('Links are out of date').waitFor({ state: 'detached' });
  const ev2 = await readEvent(page, id);
  for (const p of ev.participants) assert.equal(ev2.draw.entries[p.id].recipientId, ev.draw.entries[p.id].recipientId);

  // Party mode.
  await page.getByRole('link', { name: 'Party mode' }).click();
  await page.getByRole('button', { name: 'Ann', exact: true }).click();
  await page.getByRole('button', { name: 'I’m Ann' }).click();
  await page.getByRole('button', { name: 'Skip the animation and show me' }).click();
  assert.equal((await page.locator('.match-name').textContent()).trim(), matches.Ann);
  await page.getByRole('button', { name: 'Done: hide it & pass the phone' }).click();
  await page.getByRole('button', { name: 'Ann (already looked)' }).waitFor();

  // Print view: one QR per person.
  await page.goto(`${env.base}#/print/${id}`);
  await page.locator('.print-card').first().waitFor();
  assert.equal(await page.locator('.print-card svg.qr').count(), 6);

  assert.deepEqual(problems, []);
  await context.close();
});

test('sealed mode: sign-ups, encrypted links, phrase unlock and remembered keys', async () => {
  const org = await newContext(env.browser);
  const page = await org.newPage();
  const problems = watch(page);
  const id = await createExchange(page, env.base, { name: 'Sealed Party', sealed: true });

  await page.getByRole('button', { name: 'Get a sign-up link' }).click();
  const invite = await page.getByLabel('Sign-up link').inputValue();
  assert.match(invite, /#\/join\//);
  await page.keyboard.press('Escape');

  const people = [];
  for (const name of ['Zoë', 'Yuki', 'Xavi']) {
    const ctx = await newContext(env.browser);
    const p = await ctx.newPage();
    const pp = watch(p);
    await p.goto(invite);
    await p.getByLabel('Your name').fill(name);
    await p.getByLabel('Gift ideas for your Santa').fill(`${name}’s wish`);
    const phrase = (await p.locator('.phrase').first().textContent()).trim();
    await p.getByText('I’ve saved my secret phrase somewhere safe').click();
    await p.getByRole('button', { name: 'Sign me up' }).click();
    const code = await p.getByLabel('Your sign-up link').inputValue({ timeout: 30000 });
    assert.match(code, /#\/add\//);
    assert.deepEqual(pp, []);
    people.push({ name, phrase, code, ctx });
  }

  // Two via "Import sign-ups", one by opening the #/add/ link on the organizer's device.
  await page.getByRole('button', { name: 'Import sign-ups' }).click();
  await page.getByLabel('Sign-up codes').fill(`Hi! ${people[0].code}\n\nand ${people[1].code}`);
  await page.locator('.import-list li').nth(1).waitFor();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.locator('.person-name', { hasText: 'Yuki' }).waitFor();
  await page.goto(people[2].code);
  await page.getByRole('button', { name: 'Add Xavi' }).click();
  await page.waitForURL(/\/people$/);
  await addPeople(page, ['Walt']);

  await page.goto(`${env.base}#/e/${id}/draw`);
  await page.getByText('3 of 4 have signed up with a secret phrase. 1 will get a regular link.').waitFor();
  await page.getByRole('button', { name: 'Draw names' }).click();
  await page.locator('.fingerprint-card').waitFor();
  const ev = await readEvent(page, id);
  const byName = Object.fromEntries(ev.participants.map((p) => [p.name, p]));
  for (const person of people) {
    const entry = ev.draw.entries[byName[person.name].id];
    assert.equal(entry.sealed, true);
    assert.equal(entry.recipientId, undefined, 'organizer never stores sealed matches');
    assert.equal(entry.salt, undefined);
    person.url = linkFor(env.base, entry);
  }
  const walt = ev.draw.entries[byName.Walt.id];
  assert.equal(walt.sealed, false);

  const results = {};
  // 1) Remembered key: opens without a phrase on the participant's own device.
  {
    const p = await people[0].ctx.newPage();
    const pp = watch(p);
    await p.goto(people[0].url);
    await p.getByRole('button', { name: 'Skip the animation and show me' }).click();
    results[people[0].name] = (await p.locator('.match-name').textContent()).trim();
    await p.locator('.verify-ok').waitFor();
    assert.deepEqual(pp, []);
  }
  // 2) Fresh device: wrong phrase fails, right phrase (different case/spacing) works.
  for (const person of people.slice(1)) {
    const ctx = await newContext(env.browser);
    const p = await ctx.newPage();
    const pp = watch(p);
    await p.goto(person.url);
    await p.getByLabel('Your secret phrase').fill('definitely-not-it-12');
    await p.getByRole('button', { name: 'Unlock my match' }).click();
    await p.getByText('That phrase doesn’t match.', { exact: false }).waitFor({ timeout: 30000 });
    await p.getByLabel('Your secret phrase').fill(person.phrase.toUpperCase().replace(/-/g, ' '));
    await p.getByRole('button', { name: 'Unlock my match' }).click();
    await p.getByRole('button', { name: 'Skip the animation and show me' }).click({ timeout: 30000 });
    results[person.name] = (await p.locator('.match-name').textContent()).trim();
    await p.locator('.verify-ok').waitFor();
    assert.deepEqual(pp, []);
    await ctx.close();
  }
  const w = await openReveal(org, linkFor(env.base, walt));
  results.Walt = w.name;

  const names = Object.keys(results);
  assert.equal(names.length, 4);
  assert.equal(new Set(Object.values(results)).size, 4);
  for (const n of names) assert.notEqual(results[n], n);

  // The organizer can't see sealed matches.
  await page.locator('summary', { hasText: 'More' }).last().click();
  await page.getByRole('button', { name: 'Show all matches (spoilers)' }).click();
  await page.getByRole('button', { name: 'Show matches' }).click();
  await page.locator('.results-table').waitFor();
  assert.equal(await page.locator('.results-table td', { hasText: 'sealed' }).count(), 3);

  assert.deepEqual(problems, []);
  for (const person of people) await person.ctx.close();
  await org.close();
});

test('reveal styles: gift box, envelope and scratch card all reveal the match', async () => {
  const context = await newContext(env.browser);
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(env.base);
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await page.waitForURL(/\/people$/);
  const id = eventIdFromUrl(page.url());

  for (const [label, action] of [
    // force: the idle "bob" animation means these targets are never perfectly still.
    ['Gift box', async () => page.getByRole('button', { name: 'Unwrap your gift' }).click({ force: true })],
    ['Envelope', async () => page.getByRole('button', { name: 'Open the envelope' }).click({ force: true })],
    [
      'Scratch card',
      async () => {
        const canvas = page.locator('.scratch-canvas');
        await canvas.waitFor();
        await page.waitForTimeout(100);
        const box = await canvas.boundingBox();
        for (let row = 0; row < 6; row++) {
          const y = box.y + (box.height * (row + 0.5)) / 6;
          await page.mouse.move(box.x + 2, y);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width - 2, y, { steps: 12 });
          await page.mouse.up();
        }
      },
    ],
  ]) {
    await page.goto(`${env.base}#/e/${id}/details`);
    await page.locator('.radio-card', { hasText: label }).click();
    await page.goto(`${env.base}#/preview/${id}`);
    await action();
    await page.locator('.match-name').waitFor({ timeout: 10000 });
    assert.equal((await page.locator('.match-name').textContent()).trim(), 'Rudolph (example)');
  }
  assert.deepEqual(problems, []);
  await context.close();
});

test('wishlist links, broken links, and the 404 page recovering lost # links', async () => {
  const context = await newContext(env.browser);
  const page = await context.newPage();
  const problems = watch(page, [/Failed to load resource/]);
  await page.goto(`${env.base}#/wishlist`);
  await page.getByLabel('Your name').fill('Bea');
  await page.getByLabel(/^Wishlist/).fill('Mittens\nhttps://example.com/book');
  await page.getByRole('button', { name: 'Create link' }).click();
  const url = await page.getByLabel('Wishlist link').inputValue();
  const p2 = await context.newPage();
  await p2.goto(url);
  await p2.getByRole('heading', { name: 'Bea’s wishlist' }).waitFor();
  assert.equal(await p2.locator('.wishlist li').count(), 2);
  assert.equal(await p2.locator('.wishlist a').getAttribute('href'), 'https://example.com/book');
  assert.equal(await p2.locator('.wishlist a').getAttribute('rel'), 'noopener noreferrer nofollow ugc');

  await page.goto(`${env.base}#/r/AQAAAAAA`);
  await page.getByRole('heading', { name: 'Hmm, this link didn’t work' }).waitFor();
  await page.goto(`${env.base}#/s/garbage`);
  await page.getByRole('heading', { name: 'Hmm, this link didn’t work' }).waitFor();

  // A link whose "#" was lost becomes a path; the 404 page rewrites it back.
  await page.goto(`${env.base}r/AQAAAAAA`);
  await page.waitForURL(/#\/r\/AQAAAAAA$/);
  await page.getByRole('heading', { name: 'Hmm, this link didn’t work' }).waitFor();
  assert.deepEqual(problems, []);
  await context.close();
});

test('backup export and import round-trip', async () => {
  const context = await newContext(env.browser, { acceptDownloads: true });
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(env.base);
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await page.waitForURL(/\/people$/);
  await page.getByLabel('More actions', { exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export backup' }).click()]);
  const file = await download.path();
  const json = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(json.format, 'secret-santa-exchange');
  assert.equal(json.event.participants.length, 8);

  const other = await newContext(env.browser);
  const p2 = await other.newPage();
  const pp = watch(p2);
  await p2.goto(env.base);
  await p2.locator('input[type=file]').setInputFiles(file);
  await p2.getByRole('heading', { name: /North Pole Office Party/ }).waitFor();
  assert.deepEqual(pp, []);
  assert.deepEqual(problems, []);
  await other.close();
  await context.close();
});

test('pages fit a 320px phone screen without horizontal scrolling', async () => {
  const context = await newContext(env.browser, { viewport: { width: 320, height: 640 }, isMobile: BROWSER !== 'firefox', hasTouch: true });
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(env.base);
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await page.waitForURL(/\/people$/);
  const id = eventIdFromUrl(page.url());
  const routes = ['', '#/ideas', '#/about', '#/wishlist', `#/e/${id}/details`, `#/e/${id}/people`, `#/e/${id}/rules`, `#/e/${id}/draw`];
  for (const r of routes) {
    await page.goto(env.base + r);
    await page.waitForTimeout(250);
    assert.ok(await noHorizontalOverflow(page), `no overflow on ${r || 'home'}`);
  }
  await page.goto(`${env.base}#/e/${id}/draw`);
  await page.getByRole('button', { name: 'Draw names' }).click();
  await page.locator('.fingerprint-card').waitFor();
  assert.ok(await noHorizontalOverflow(page), 'no overflow on share list');
  const ev = await readEvent(page, id);
  const first = ev.draw.entries[ev.participants[0].id];
  await page.goto(linkFor(env.base, first));
  await page.getByRole('button', { name: 'Skip the animation and show me' }).click();
  await page.locator('.match-name').waitFor();
  assert.ok(await noHorizontalOverflow(page), 'no overflow on reveal');
  await page.goto(`${env.base}#/party/${id}`);
  await page.locator('.party-grid').waitFor();
  assert.ok(await noHorizontalOverflow(page), 'no overflow on party mode');
  // Mobile menu opens and navigates.
  await page.goto(env.base);
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.locator('.site-nav').getByRole('link', { name: 'Gift ideas' }).click();
  await page.waitForURL(/#\/ideas/);
  await page.getByRole('heading', { level: 1, name: /Gift idea generator/ }).waitFor();
  assert.deepEqual(problems, []);
  await context.close();
});

test('dark mode applies and works offline after the first visit', async () => {
  const context = await newContext(env.browser, { colorScheme: 'dark' });
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(env.base);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(bg, 'rgb(12, 26, 29)');
  if (BROWSER === 'chromium') {
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await context.setOffline(true);
    await page.reload();
    await page.getByRole('heading', { name: /Secret Santa,\s*sorted/ }).waitFor();
    await page.goto(`${env.base}#/ideas`);
    await page.getByRole('heading', { level: 1, name: /Gift idea generator/ }).waitFor();
    await context.setOffline(false);
  }
  assert.deepEqual(problems, []);
  await context.close();
});
