import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEvent,
  createParticipant,
  deleteEvent,
  demoEvent,
  drawStatus,
  duplicateForNextYear,
  exportEvent,
  knownPairs,
  listEvents,
  loadEvent,
  makeDraw,
  normalizeEvent,
  parseBackup,
  refreshDraw,
  saveEvent,
} from '../../docs/js/core/events.js';
import { decodeReveal, decodeSealed, decodeRevealBytes, headerAad, verifyReveal } from '../../docs/js/core/payload.js';
import { createParticipantKey, open, unwrapParticipantKey } from '../../docs/js/core/seal.js';
import { fromB64url, toB64url } from '../../docs/js/lib/bytes.js';

function makeEvent(names = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay']) {
  const ev = createEvent({ name: 'Office 2026', date: '2026-12-18', budget: 20, currency: 'USD', organizer: 'Org' });
  for (const n of names) ev.participants.push(createParticipant({ name: n, wishlist: `${n}'s list` }, ev.participants));
  return ev;
}

async function openAll(ev) {
  const out = {};
  for (const p of ev.participants) {
    const e = ev.draw.entries[p.id];
    assert.equal(e.sealed, false);
    out[p.name] = await decodeReveal(e.link);
  }
  return out;
}

test('a normal draw produces one verifiable link per person', async () => {
  const ev = makeEvent();
  const res = await makeDraw(ev);
  assert.equal(res.ok, true);
  ev.draw = res.draw;
  const reveals = await openAll(ev);
  const recipients = new Set();
  const fps = new Set();
  for (const p of ev.participants) {
    const r = reveals[p.name];
    assert.equal(r.g, p.name);
    assert.notEqual(r.r, p.name);
    const recipient = ev.participants.find((x) => x.name === r.r);
    assert.equal(ev.draw.entries[p.id].recipientId, recipient.id);
    assert.equal(r.w, recipient.wishlist, 'recipient wishlist is embedded');
    assert.equal(r.ev.n, 'Office 2026');
    const v = await verifyReveal(r);
    assert.equal(v.status, 'verified');
    fps.add(v.fingerprint.code);
    recipients.add(r.r);
  }
  assert.equal(recipients.size, 6);
  assert.equal(fps.size, 1, 'everyone sees the same fingerprint');
  assert.equal(drawStatus(ev).state, 'ok');
});

test('draw status tracks edits; refresh keeps the same matches', async () => {
  const ev = makeEvent();
  ev.draw = (await makeDraw(ev)).draw;
  const before = Object.fromEntries(Object.entries(ev.draw.entries).map(([k, e]) => [k, e.recipientId]));
  const rootBefore = ev.draw.root;

  ev.date = '2026-12-19';
  let st = drawStatus(ev);
  assert.equal(st.state, 'outdated');
  assert.deepEqual(st.reasons, ['details']);
  assert.equal(st.canRefresh, true);
  ev.draw = await refreshDraw(ev);
  assert.equal(drawStatus(ev).state, 'ok');
  assert.equal(ev.draw.root, rootBefore, 'names unchanged → same fingerprint');
  for (const [k, e] of Object.entries(ev.draw.entries)) assert.equal(e.recipientId, before[k]);
  const r = await decodeReveal(ev.draw.entries[ev.participants[0].id].link);
  assert.equal(r.ev.d, '2026-12-19');

  ev.participants[2].wishlist = 'New list';
  assert.deepEqual(drawStatus(ev).reasons, ['people']);

  // A rule that the current draw happens to satisfy keeps it valid; one it violates invalidates it.
  const [g, rid] = Object.entries(before)[0];
  ev.rules.exclusions.push({ from: g, to: rid });
  assert.equal(drawStatus(ev).state, 'invalid');
  assert.deepEqual(drawStatus(ev).reasons, ['rules']);
  await assert.rejects(() => refreshDraw(ev), /no longer satisfy/);
  ev.rules.exclusions.pop();

  ev.participants.push(createParticipant({ name: 'Gus' }, ev.participants));
  assert.equal(drawStatus(ev).state, 'invalid');
  assert.deepEqual(drawStatus(ev).reasons, ['participants']);
});

test('sealed draw: organizer stores no recipients, participants decrypt with their phrase', async () => {
  const ev = makeEvent(['Ann', 'Bob', 'Cat', 'Dan']);
  ev.sealedMode = true;
  const phrases = {};
  for (const p of ev.participants.slice(0, 3)) {
    phrases[p.name] = `${p.name} secret phrase words`;
    const k = await createParticipantKey(phrases[p.name], ev.id, 1000);
    p.key = { pub: toB64url(k.pub), wrap: toB64url(k.wrap) };
  }
  ev.draw = (await makeDraw(ev)).draw;
  const found = new Set();
  const fps = new Set();
  for (const p of ev.participants) {
    const e = ev.draw.entries[p.id];
    let reveal;
    if (p.key) {
      assert.equal(e.sealed, true);
      assert.equal('recipientId' in e, false, 'no recipient stored for sealed entries');
      assert.equal('salt' in e, false, 'no salt stored for sealed entries');
      const s = decodeSealed(e.link);
      assert.equal(s.header.g, p.name);
      const priv = await unwrapParticipantKey(s.wrap, phrases[p.name], s.header.e);
      reveal = await decodeRevealBytes(await open(s.sealedBox, priv, s.header.pub, headerAad(s.headerBytes)));
    } else {
      assert.equal(e.sealed, false);
      reveal = await decodeReveal(e.link);
    }
    assert.equal(reveal.g, p.name);
    found.add(reveal.r);
    const v = await verifyReveal(reveal);
    assert.equal(v.status, 'verified');
    fps.add(v.fingerprint.code);
  }
  assert.equal(found.size, 4);
  assert.equal(fps.size, 1);
  assert.equal(drawStatus(ev).state, 'ok');
  assert.equal(knownPairs(ev).length, 1, 'only the unsealed pair is known');

  ev.name = 'Renamed';
  const st = drawStatus(ev);
  assert.equal(st.state, 'outdated');
  assert.equal(st.canRefresh, false, 'sealed draws cannot be refreshed');

  ev.participants[0].key = null;
  assert.equal(drawStatus(ev).state, 'invalid');
});

test('persistence, backup round-trip and normalization', async () => {
  const ev = makeEvent();
  ev.draw = (await makeDraw(ev)).draw;
  assert.equal(saveEvent(ev), true);
  assert.equal(loadEvent(ev.id).participants.length, 6);
  assert.ok(listEvents().some((e) => e.id === ev.id));

  const [restored] = parseBackup(exportEvent(ev));
  assert.equal(restored.id, ev.id);
  assert.deepEqual(restored.draw.entries, ev.draw.entries);
  assert.equal(drawStatus(restored).state, 'ok');

  deleteEvent(ev.id);
  assert.equal(loadEvent(ev.id), null);
  assert.throws(() => parseBackup('{"nope":1}'), /isn’t a Secret Santa backup/);
  assert.throws(() => parseBackup('not json'), /not JSON/);

  const messy = normalizeEvent({
    name: 'x'.repeat(500),
    participants: [{ name: 'Ann' }, { name: 'ann' }, { name: '' }, { name: 'Bob', email: 'bad', emoji: 'abc' }],
    rules: { exclusions: [{ from: 'nobody', to: 'nobody2' }] },
    theme: 'evil',
    draw: { entries: { x: { link: '<script>' } } },
  });
  assert.equal(messy.name.length, 80);
  assert.deepEqual(messy.participants.map((p) => p.name), ['Ann', 'ann (2)', 'Bob']);
  assert.equal(messy.participants[2].email, '');
  assert.equal(messy.rules.exclusions.length, 0);
  assert.equal(messy.theme, 'classic');
  assert.equal(messy.draw, null);
});

test('duplicate for next year avoids last year’s pairs', async () => {
  const ev = makeEvent();
  ev.draw = (await makeDraw(ev)).draw;
  const next = duplicateForNextYear(ev);
  assert.equal(next.name, 'Office 2027');
  assert.equal(next.date, '2027-12-18');
  assert.equal(next.participants.length, 6);
  assert.equal(next.rules.avoid.length, 6);
  assert.equal(next.draw, null);
  const res = await makeDraw(next);
  assert.equal(res.ok, true);
  const lastYear = new Set(knownPairs(ev).map((p) => `${p.from}>${p.to}`));
  next.draw = res.draw;
  for (const pair of knownPairs(next)) assert.equal(lastYear.has(`${pair.from}>${pair.to}`), false);
});

test('demo event is drawable', async () => {
  const ev = demoEvent();
  assert.equal(ev.participants.length, 8);
  const res = await makeDraw(ev);
  assert.equal(res.ok, true);
  assert.ok(fromB64url(res.draw.root).length === 32);
});
