// Avatar emoji for participants.
export const AVATARS = [
  '🦌', '⛄', '🐧', '🦊', '🐻', '🐼', '🐨', '🦉', '🐰', '🐱', '🐶', '🦁', '🐯', '🐸', '🐙', '🦄',
  '🐳', '🦋', '🐢', '🦔', '🐿️', '🦩', '🐝', '🐞', '🍪', '🧁', '🍩', '🍭', '🍄', '🌵', '🌻', '🌈',
  '⭐', '🌙', '❄️', '🔥', '🎸', '🎨', '🚀', '👑', '🎩', '🧸', '🎅', '🤶', '🧝', '👻', '🤖', '👽',
];

export function nextAvatar(used) {
  const taken = new Set(used);
  const free = AVATARS.filter((a) => !taken.has(a));
  const pool = free.length ? free : AVATARS;
  return pool[Math.floor(Math.random() * pool.length)];
}
