// Message templates for sending links. {placeholders} that resolve to nothing
// remove their whole line, so optional details (date, budget…) disappear cleanly.

export const PLACEHOLDERS = ['name', 'event', 'link', 'date', 'budget', 'organizer', 'sealed'];

export const DEFAULT_TEMPLATE = [
  '🎅 Hi {name}!',
  'Your Secret Santa match for {event} is ready. Open your private link (and keep it to yourself!):',
  '{link}',
  '📅 {date}',
  '💰 Budget: {budget}',
  '{sealed}',
  '— {organizer}',
].join('\n');

export const SEALED_NOTE = '🔐 You’ll need the secret phrase you picked when you signed up.';

export function renderTemplate(template, vars) {
  const tpl = template && template.trim() ? template : DEFAULT_TEMPLATE;
  const lines = [];
  for (const line of tpl.replace(/\r\n?/g, '\n').split('\n')) {
    let hadVar = false;
    let anyValue = false;
    const out = line.replace(/\{(\w+)\}/g, (m, key) => {
      if (!PLACEHOLDERS.includes(key)) return m;
      hadVar = true;
      const v = vars[key] === undefined || vars[key] === null ? '' : String(vars[key]);
      if (v) anyValue = true;
      return v;
    });
    if (hadVar && !anyValue) continue;
    lines.push(out);
  }
  let text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // Never send a message without the link, even if someone deleted {link} from the template.
  if (vars.link && !text.includes(vars.link)) text = `${text}\n${vars.link}`;
  return text;
}
