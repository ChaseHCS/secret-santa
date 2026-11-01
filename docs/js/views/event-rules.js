import { cx, debounce, h, mount } from '../lib/dom.js';
import { formatBigCount, plural } from '../lib/format.js';
import { REASON, analyze, buildConstraints, describeProblem, normName } from '../core/draw.js';
import { knownPairs, listEvents } from '../core/events.js';
import { LIMITS, cleanLine } from '../core/schema.js';
import { button, card, disclosure, input, notice, textarea, toggle } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';

const MATRIX_MAX = 40;

export function parsePairs(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(.+?)\s*(?:→|->|=>|>|,|;|\t|\s+draws\s+|\s+gave to\s+|\s+gives to\s+|\s+to\s+)\s*(.+)$/i.exec(line);
    if (!m) continue;
    const from = cleanLine(m[1], LIMITS.name);
    const to = cleanLine(m[2], LIMITS.name);
    if (from && to && normName(from) !== normName(to)) out.push({ from, to });
  }
  return out;
}

function feasibilityPanel(ev) {
  const ps = ev.participants;
  if (ps.length < 2) {
    return notice('Add at least 2 people (3 or more is more fun) to see whether your rules work.', 'info');
  }
  const a = analyze(ps, ev.rules);
  const names = ps.map((p) => p.name);
  if (a.status === 'impossible') {
    return h(
      'div',
      { class: 'feas feas-bad', role: 'status' },
      h('div', { class: 'feas-title' }, icon('circle-alert'), 'These rules can’t all be satisfied'),
      h('p', describeProblem(a.problem, names)),
    );
  }
  if (a.status === 'unknown') {
    return h(
      'div',
      { class: 'feas feas-warn', role: 'status' },
      h('div', { class: 'feas-title' }, icon('triangle-alert'), 'These rules are very tight'),
      h('p', describeProblem(a.problem, names)),
    );
  }
  const few = a.approx ? a.log2 !== null && a.log2 < Math.log2(50) : a.count < 50;
  const countText = a.log2 === null ? 'a handful of' : a.approx ? `≈ ${formatBigCount(null, a.log2)}` : formatBigCount(a.count);
  const bits = a.log2 === null ? null : a.log2;
  return h(
    'div',
    { class: cx(['feas', few ? 'feas-warn' : 'feas-ok']), role: 'status' },
    h('div', { class: 'feas-title' }, icon(few ? 'triangle-alert' : 'circle-check'), few ? 'Works, but there are very few possible draws' : 'Ready to draw'),
    h(
      'dl',
      { class: 'feas-stats' },
      h('div', h('dt', 'Possible draws'), h('dd', countText)),
      bits !== null && h('div', h('dt', 'Randomness'), h('dd', `${bits.toFixed(1)} bits`)),
      a.tightest && h('div', h('dt', 'Fewest options'), h('dd', `${names[a.tightest.index]}: ${plural(a.tightest.options, 'person', 'people')}`)),
    ),
    few && h('p', { class: 'small' }, 'With this few possibilities, people may be able to work out who has whom. Consider relaxing a rule.'),
  );
}

function matrix(ctx) {
  const ev = ctx.ev;
  const ps = ev.participants;
  if (ps.length < 2) return h('p', { class: 'muted' }, 'Add people first.');
  if (ps.length > MATRIX_MAX) return h('p', { class: 'muted' }, `The grid is available for up to ${MATRIX_MAX} people.`);
  const C = buildConstraints(ps, ev.rules);
  const direct = new Set(ev.rules.exclusions.map((x) => `${x.from}>${x.to}`));
  const LABEL = { [REASON.GROUP]: 'same household', [REASON.PREVIOUS]: 'last time’s pair', [REASON.EXCLUDED]: 'excluded' };
  const table = h(
    'table',
    { class: 'matrix' },
    h('caption', { class: 'visually-hidden' }, 'Who can draw whom. Rows are givers, columns are recipients.'),
    h(
      'thead',
      h(
        'tr',
        h('th', { scope: 'col', class: 'matrix-corner' }, h('span', { class: 'small muted' }, 'gives → ')),
        ps.map((p) => h('th', { scope: 'col', title: p.name }, h('span', { class: 'matrix-col' }, h('span', { 'aria-hidden': 'true' }, p.emoji), h('span', { class: 'matrix-col-name' }, p.name)))),
      ),
    ),
    h(
      'tbody',
      ps.map((g, i) =>
        h(
          'tr',
          h('th', { scope: 'row' }, h('span', { 'aria-hidden': 'true' }, `${g.emoji} `), g.name),
          ps.map((r, j) => {
            if (i === j) return h('td', { class: 'cell cell-self', 'aria-label': 'self' }, '·');
            const why = C.reason[i][j];
            const isDirect = direct.has(`${g.id}>${r.id}`);
            const allowed = C.allowed[i][j];
            const label = allowed ? `${g.name} can draw ${r.name}` : `${g.name} can’t draw ${r.name} (${LABEL[why] || why})`;
            const toggleable = allowed || isDirect;
            return h(
              'td',
              { class: cx(['cell', allowed ? 'cell-ok' : `cell-${why}`]) },
              h(
                'button',
                {
                  type: 'button',
                  class: 'cell-btn',
                  'aria-label': toggleable ? `${label}. Click to ${allowed ? 'block' : 'allow'}.` : label,
                  title: label,
                  disabled: !toggleable,
                  onClick: () =>
                    ctx.change(
                      (e) => {
                        if (isDirect) e.rules.exclusions = e.rules.exclusions.filter((x) => !(x.from === g.id && x.to === r.id));
                        else e.rules.exclusions.push({ from: g.id, to: r.id });
                      },
                      { rerender: true },
                    ),
                },
                allowed ? '✓' : why === REASON.GROUP ? '🏠' : why === REASON.PREVIOUS ? '↺' : '✕',
              ),
            );
          }),
        ),
      ),
    ),
  );
  return h(
    'div',
    { class: 'stack' },
    h('p', { class: 'muted small' }, 'Rows give to columns. Click a ✓ to block that pair, or a ✕ to allow it again. 🏠 = same household, ↺ = avoided from last time.'),
    h('div', { class: 'matrix-scroll', tabindex: '0', role: 'region', 'aria-label': 'Who can draw whom grid' }, table),
  );
}

export default function rulesStep(ctx) {
  const ev = ctx.ev;
  // UI state that should survive re-renders of this step.
  const ui = ctx.ui || (ctx.ui = {});
  const ps = ev.participants;
  const feasEl = h('div', { class: 'feas-wrap', 'aria-live': 'polite' });
  const matrixBody = h('div');
  const refreshAnalysis = debounce(() => {
    mount(feasEl, feasibilityPanel(ctx.ev));
    if (matrixBody.isConnected && matrixBody.closest('details')?.open) mount(matrixBody, matrix(ctx));
  }, 150);
  ctx.onCleanup(() => refreshAnalysis.cancel());
  mount(feasEl, feasibilityPanel(ev));

  // --- Households
  const groups = new Map();
  for (const p of ps) {
    if (!p.group) continue;
    const k = normName(p.group);
    if (!groups.has(k)) groups.set(k, { label: p.group, members: [] });
    groups.get(k).members.push(p.name);
  }
  const groupEditor = h(
    'div',
    { class: 'group-editor' },
    ps.map((p) => {
      const inp = input({ value: p.group, maxlength: LIMITS.group, list: 'group-names', placeholder: 'No household', 'aria-label': `Household for ${p.name}`, autocomplete: 'off' });
      inp.addEventListener('input', () => {
        ctx.change((e) => {
          const t = e.participants.find((x) => x.id === p.id);
          if (t) t.group = cleanLine(inp.value, LIMITS.group);
        });
        refreshAnalysis();
      });
      return h('label', { class: 'group-row' }, h('span', { class: 'group-name' }, `${p.emoji} ${p.name}`), inp);
    }),
    h('datalist', { id: 'group-names' }, [...groups.values()].map((g) => h('option', { value: g.label }))),
  );

  // --- Exclusions
  const opts = (sel) => ps.map((p) => h('option', { value: p.id, selected: p.id === sel }, p.name));
  const fromSel = h('select', { class: 'input select', 'aria-label': 'Giver' }, opts(ps[0] && ps[0].id));
  const toSel = h('select', { class: 'input select', 'aria-label': 'Recipient' }, opts(ps[1] && ps[1].id));
  const bothWays = h('input', { type: 'checkbox', checked: true, id: 'ex-both' });
  const addExclusion = () => {
    const from = fromSel.value;
    const to = toSel.value;
    if (!from || !to || from === to) {
      toast('Pick two different people.', { type: 'warn' });
      return;
    }
    ctx.change(
      (e) => {
        const has = (a, b) => e.rules.exclusions.some((x) => x.from === a && x.to === b);
        if (!has(from, to)) e.rules.exclusions.push({ from, to });
        if (bothWays.checked && !has(to, from)) e.rules.exclusions.push({ from: to, to: from });
      },
      { rerender: true },
    );
  };
  const byId = new Map(ps.map((p) => [p.id, p]));
  const pairs = [];
  const seen = new Set();
  for (const x of ev.rules.exclusions) {
    const key = `${x.from}>${x.to}`;
    if (seen.has(key)) continue;
    const mutual = ev.rules.exclusions.some((y) => y.from === x.to && y.to === x.from);
    seen.add(key);
    if (mutual) seen.add(`${x.to}>${x.from}`);
    pairs.push({ ...x, mutual });
  }
  const exclusionList = pairs.length
    ? h(
        'ul',
        { class: 'rule-list' },
        pairs.map((x) => {
          const a = byId.get(x.from);
          const b = byId.get(x.to);
          if (!a || !b) return null;
          return h(
            'li',
            { class: 'rule-item' },
            h('span', `${a.emoji} ${a.name}`),
            h('span', { class: 'rule-arrow', 'aria-label': x.mutual ? 'and' : 'can’t draw' }, x.mutual ? '↔' : '↛'),
            h('span', `${b.emoji} ${b.name}`),
            h('span', { class: 'muted small grow' }, x.mutual ? ' won’t draw each other' : ''),
            button('', {
              iconName: 'x',
              variant: 'ghost',
              size: 'sm',
              'aria-label': `Remove rule ${a.name} and ${b.name}`,
              onClick: () =>
                ctx.change(
                  (e) => {
                    e.rules.exclusions = e.rules.exclusions.filter((y) => !((y.from === x.from && y.to === x.to) || (x.mutual && y.from === x.to && y.to === x.from)));
                  },
                  { rerender: true },
                ),
            }),
          );
        }),
      )
    : h('p', { class: 'muted small' }, 'No exclusions yet.');

  // --- Avoid repeats
  const sources = listEvents()
    .filter((e) => e.id !== ev.id && e.draw)
    .map((e) => ({ e, pairs: knownPairs(e) }))
    .filter((x) => x.pairs.length);
  const names = new Set(ps.map((p) => normName(p.name)));
  const matched = ev.rules.avoid.filter((a) => names.has(normName(a.from)) && names.has(normName(a.to))).length;
  const srcSel = h('select', { class: 'input select', 'aria-label': 'Past exchange' }, sources.map((x, i) => h('option', { value: String(i) }, `${x.e.name || 'Untitled exchange'} (${plural(x.pairs.length, 'pair', 'pairs')})`)));
  const pasteTa = textarea({ rows: 4, placeholder: 'Ann → Bob\nBob → Cat\n…', class: 'input textarea mono' });

  return h(
    'div',
    { class: 'stack-lg' },
    ev.draw && notice('Names have already been drawn. If you change the rules, check the Draw step: you may need to draw again.', 'warn'),
    feasEl,
    card(
      h(
        'div',
        { class: 'stack' },
        toggle({
          label: 'Keep households apart',
          description: 'People in the same household or group never draw each other.',
          iconName: 'house',
          checked: ev.rules.groupsExclusive,
          onChange: (v) => ctx.change((e) => (e.rules.groupsExclusive = v), { rerender: true }),
        }),
        groups.size
          ? h('div', { class: 'chips' }, [...groups.values()].map((g) => h('span', { class: 'chip chip-static', title: g.members.join(', ') }, `🏠 ${g.label} · ${g.members.length}`)))
          : h('p', { class: 'muted small' }, 'No households yet. Type one next to each person below (e.g. “The Smiths”).'),
        ps.length
          ? (() => {
              const d = disclosure('Edit households', groupEditor, { open: ui.groupsOpen ?? (groups.size === 0 && ps.length <= 12) });
              d.addEventListener('toggle', () => {
                ui.groupsOpen = d.open;
              });
              return d;
            })()
          : null,
      ),
      { title: 'Households', titleIcon: 'house' },
    ),
    card(
      h(
        'div',
        { class: 'stack' },
        toggle({
          label: 'No two-way swaps',
          description: 'If Ann draws Bob, Bob won’t draw Ann.',
          iconName: 'repeat',
          checked: ev.rules.noReciprocal,
          onChange: (v) => ctx.change((e) => (e.rules.noReciprocal = v), { rerender: true }),
        }),
        toggle({
          label: 'One big loop',
          description: 'Everyone forms a single chain (Ann → Bob → Cat → … → Ann). Perfect for opening gifts one at a time.',
          iconName: 'refresh-cw',
          checked: ev.rules.singleCycle,
          onChange: (v) => ctx.change((e) => (e.rules.singleCycle = v), { rerender: true }),
        }),
      ),
      { title: 'Draw style', titleIcon: 'shuffle' },
    ),
    card(
      h(
        'div',
        { class: 'stack' },
        ps.length >= 2
          ? h(
              'form',
              {
                class: 'exclusion-form',
                onSubmit: (e) => {
                  e.preventDefault();
                  addExclusion();
                },
              },
              fromSel,
              h('span', { class: 'muted' }, 'can’t draw'),
              toSel,
              h('label', { class: 'check', htmlFor: 'ex-both' }, bothWays, ' both ways'),
              h('button', { type: 'submit', class: 'btn btn-secondary btn-sm' }, icon('plus', { size: 16 }), 'Add rule'),
            )
          : h('p', { class: 'muted small' }, 'Add at least 2 people first.'),
        exclusionList,
      ),
      { title: 'Exclusions', titleIcon: 'ban' },
    ),
    card(
      h(
        'div',
        { class: 'stack' },
        ev.rules.avoid.length
          ? h(
              'div',
              { class: 'row gap-sm wrap' },
              h('p', { class: 'grow' }, `Avoiding ${plural(ev.rules.avoid.length, 'pair', 'pairs')}${ev.rules.avoidLabel ? ` from “${ev.rules.avoidLabel}”` : ''}. `, h('span', { class: 'muted small' }, `${matched} match people in this exchange.`)),
              button('Clear', { size: 'sm', variant: 'ghost', iconName: 'x', onClick: () => ctx.change((e) => { e.rules.avoid = []; e.rules.avoidLabel = ''; }, { rerender: true }) }),
            )
          : h('p', { class: 'muted small' }, 'Stop people getting the same person as last time.'),
        sources.length
          ? h(
              'div',
              { class: 'row gap-sm wrap' },
              srcSel,
              button('Avoid these pairs', {
                size: 'sm',
                iconName: 'rotate-ccw',
                onClick: () => {
                  const src = sources[Number(srcSel.value)];
                  if (!src) return;
                  ctx.change(
                    (e) => {
                      e.rules.avoid = src.pairs;
                      e.rules.avoidLabel = src.e.name || 'a past exchange';
                    },
                    { rerender: true },
                  );
                },
              }),
            )
          : null,
        disclosure(
          'Paste last year’s pairs',
          h(
            'div',
            { class: 'stack' },
            pasteTa,
            button('Use these pairs', {
              size: 'sm',
              onClick: () => {
                const list = parsePairs(pasteTa.value);
                if (!list.length) {
                  toast('No pairs found. Use one “Giver → Recipient” per line.', { type: 'warn' });
                  return;
                }
                ctx.change(
                  (e) => {
                    e.rules.avoid = list;
                    e.rules.avoidLabel = 'pasted list';
                  },
                  { rerender: true },
                );
                toast(`Avoiding ${plural(list.length, 'pair', 'pairs')}`, { type: 'success' });
              },
            }),
          ),
        ),
      ),
      { title: 'Avoid repeats', titleIcon: 'rotate-ccw' },
    ),
    card(
      (() => {
        const d = disclosure('Show who can draw whom', matrixBody, { open: !!ui.matrixOpen });
        if (ui.matrixOpen) mount(matrixBody, matrix(ctx));
        d.addEventListener('toggle', () => {
          ui.matrixOpen = d.open;
          if (d.open) mount(matrixBody, matrix(ctx));
        });
        return d;
      })(),
      { title: 'The grid', titleIcon: 'list' },
    ),
  );
}
