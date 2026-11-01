import { cx, h, mount, prefersReducedMotion, wait } from '../lib/dom.js';
import { pick } from '../lib/random.js';
import { IDEAS, TAGS, TIERS } from '../data/ideas.js';
import { button } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { playJingle, playTick } from '../fx/sound.js';

export default function ideasView({ root, query }) {
  document.title = 'Gift ideas · Secret Santa';
  const state = {
    tier: [1, 2, 3, 4].includes(Number(query.get('tier'))) ? Number(query.get('tier')) : 0,
    tags: new Set((query.get('tags') || '').split(',').filter((t) => TAGS.some(([k]) => k === t))),
    q: '',
  };
  const results = h('div');
  const count = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const spotlight = h('div', { class: 'spotlight', 'aria-live': 'polite' });

  const syncUrl = () => {
    const params = new URLSearchParams();
    if (state.tier) params.set('tier', String(state.tier));
    if (state.tags.size) params.set('tags', [...state.tags].join(','));
    const qs = params.toString();
    history.replaceState(null, '', `#/ideas${qs ? `?${qs}` : ''}`);
  };

  const filtered = () =>
    IDEAS.filter(([, title, tier, tags]) => {
      if (state.tier && tier > state.tier) return false;
      if (state.tags.size && !tags.some((t) => state.tags.has(t))) return false;
      if (state.q && !title.toLowerCase().includes(state.q)) return false;
      return true;
    });

  const tierLabel = (t) => TIERS.find(([n]) => n === t)[1];

  const render = () => {
    const list = filtered();
    count.textContent = `${list.length} ${list.length === 1 ? 'idea' : 'ideas'}`;
    mount(
      results,
      list.length
        ? h(
            'ul',
            { class: 'idea-grid' },
            list.map(([emoji, title, tier, tags]) =>
              h(
                'li',
                { class: 'idea' },
                h('span', { class: 'idea-emoji', 'aria-hidden': 'true' }, emoji),
                h('span', { class: 'idea-title' }, title),
                h('span', { class: 'idea-meta' }, h('span', { class: 'idea-tier', title: TIERS.find(([n]) => n === tier)[2] }, tierLabel(tier)), tags.slice(0, 2).map((t) => h('span', { class: 'idea-tag' }, TAGS.find(([k]) => k === t)[1]))),
              ),
            ),
          )
        : h('p', { class: 'empty muted' }, 'No ideas match. Try fewer filters.'),
    );
  };

  const tierChips = h(
    'div',
    { class: 'chips', role: 'group', 'aria-label': 'Price' },
    [[0, 'Any price', '']].concat(TIERS).map(([n, label, desc]) => {
      const b = h('button', { type: 'button', class: cx(['chip', state.tier === n && 'chip-on']), 'aria-pressed': String(state.tier === n), title: desc || 'Any price' }, n ? `${label} · ${desc}` : label);
      b.addEventListener('click', () => {
        state.tier = n;
        for (const c of tierChips.children) {
          const on = c === b;
          c.classList.toggle('chip-on', on);
          c.setAttribute('aria-pressed', String(on));
        }
        syncUrl();
        render();
      });
      return b;
    }),
  );

  const tagChips = h(
    'div',
    { class: 'chips', role: 'group', 'aria-label': 'Interests' },
    TAGS.map(([key, label]) => {
      const b = h('button', { type: 'button', class: cx(['chip', state.tags.has(key) && 'chip-on']), 'aria-pressed': String(state.tags.has(key)) }, label);
      b.addEventListener('click', () => {
        if (state.tags.has(key)) state.tags.delete(key);
        else state.tags.add(key);
        b.classList.toggle('chip-on', state.tags.has(key));
        b.setAttribute('aria-pressed', String(state.tags.has(key)));
        syncUrl();
        render();
      });
      return b;
    }),
  );

  const search = h('input', { type: 'search', class: 'input', placeholder: 'Search ideas…', 'aria-label': 'Search ideas' });
  search.addEventListener('input', () => {
    state.q = search.value.trim().toLowerCase();
    render();
  });

  let spinning = false;
  const surprise = async () => {
    if (spinning) return;
    const list = filtered();
    if (!list.length) return;
    spinning = true;
    const card = h('div', { class: 'spot-card' });
    mount(spotlight, card);
    const showIdea = ([emoji, title, tier]) => mount(card, h('span', { class: 'spot-emoji', 'aria-hidden': 'true' }, emoji), h('span', { class: 'spot-title' }, title), h('span', { class: 'idea-tier' }, tierLabel(tier)));
    if (!prefersReducedMotion()) {
      for (let i = 0; i < 14; i++) {
        showIdea(pick(list));
        playTick(1 + i / 14);
        await wait(50 + i * 12);
      }
    }
    const final = pick(list);
    showIdea(final);
    card.classList.add('landed');
    playJingle();
    spinning = false;
  };

  mount(
    root,
    h(
      'div',
      { class: 'container page-pad stack-lg' },
      h('div', { class: 'page-head' }, h('h1', 'Gift idea generator 💡'), h('p', { class: 'lead' }, `${IDEAS.length} ideas you can filter by budget and interest. Stuck? Hit “Surprise me”.`)),
      h(
        'section',
        { class: 'card stack' },
        h('div', { class: 'row gap-md wrap' }, h('div', { class: 'grow' }, search), button('Surprise me', { variant: 'primary', iconName: 'dice-5', onClick: surprise })),
        spotlight,
        h('div', { class: 'stack-sm' }, h('p', { class: 'field-label' }, icon('wallet', { size: 16 }), ' Budget (approx. USD)'), tierChips),
        h('div', { class: 'stack-sm' }, h('p', { class: 'field-label' }, icon('heart', { size: 16 }), ' Interests'), tagChips),
      ),
      count,
      results,
    ),
  );
  render();
}
