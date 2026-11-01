import { h } from '../lib/dom.js';
import { countdownParts, eventDate } from '../lib/format.js';

/** Live countdown to an event date. Returns {el, stop}. */
export function countdown(date, time) {
  const target = eventDate(date, time || '');
  const el = h('div', { class: 'countdown' });
  if (!target) return { el, stop() {} };
  const unit = (n, label) => h('div', { class: 'cd-unit' }, h('span', { class: 'cd-num' }, String(n).padStart(2, '0')), h('span', { class: 'cd-label' }, label));
  let timer = null;
  const tick = () => {
    const p = countdownParts(target);
    const sameDay = (() => {
      const now = new Date();
      return now.getFullYear() === target.getFullYear() && now.getMonth() === target.getMonth() && now.getDate() === target.getDate();
    })();
    if (p.past || (!time && sameDay)) {
      el.replaceChildren(h('p', { class: 'cd-done' }, sameDay ? '🎉 It’s today! Have fun!' : p.days >= 1 ? `🎁 That was ${p.days} ${p.days === 1 ? 'day' : 'days'} ago.` : '🎉 It’s happening now!'));
      return;
    }
    const units = [unit(p.days, p.days === 1 ? 'day' : 'days'), unit(p.hours, 'hrs'), unit(p.minutes, 'min')];
    if (time) units.push(unit(p.seconds, 'sec'));
    el.replaceChildren(h('div', { class: 'cd-units', role: 'timer', 'aria-label': `${p.days} days, ${p.hours} hours, ${p.minutes} minutes to go` }, units));
  };
  tick();
  timer = setInterval(tick, 1000);
  return {
    el,
    stop() {
      clearInterval(timer);
    },
  };
}
