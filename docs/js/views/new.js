import { createEvent } from '../core/events.js';
import { navigate, setPendingEvent } from '../router.js';

/** #/new → a fresh exchange that is saved on its first edit. */
export default function newEvent() {
  const ev = createEvent();
  setPendingEvent(ev);
  navigate(`/e/${ev.id}/details`, { replace: true });
}
