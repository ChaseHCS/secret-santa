// One-shot confetti burst on a temporary overlay canvas.
import { reducedMotion } from '../lib/settings.js';

const DEFAULT_COLORS = ['#e23d52', '#2f9e6b', '#f2c14e', '#ffffff', '#4fa3e0', '#ff8fb1'];

export function confetti({ x = 0.5, y = 0.4, count = 140, colors = DEFAULT_COLORS, spread = 1 } = {}) {
  if (reducedMotion()) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const ox = x * W;
  const oy = y * H;
  const parts = Array.from({ length: count }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1 * spread;
    const speed = 380 + Math.random() * 520;
    return {
      x: ox,
      y: oy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 14,
      color: colors[Math.floor(Math.random() * colors.length)],
      round: Math.random() < 0.3,
      life: 0,
      max: 1.8 + Math.random() * 1.4,
    };
  });

  let last = 0;
  const step = (t) => {
    const dt = Math.min(0.033, (t - (last || t)) / 1000);
    last = t;
    ctx.clearRect(0, 0, W, H);
    let alive = 0;
    for (const p of parts) {
      p.life += dt;
      if (p.life > p.max) continue;
      alive++;
      p.vy += 900 * dt;
      p.vx *= 1 - 1.6 * dt;
      p.vy *= 1 - 0.9 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - (p.life / p.max) ** 3);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 1.3)) + 1);
      }
      ctx.restore();
    }
    if (alive) requestAnimationFrame(step);
    else canvas.remove();
  };
  requestAnimationFrame(step);
}
