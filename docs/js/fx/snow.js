// Gentle falling snow on a fixed, non-interactive canvas. Pauses when the tab is hidden.
let canvas = null;
let ctx = null;
let flakes = [];
let raf = 0;
let running = false;
let w = 0;
let hgt = 0;
let dpr = 1;
let last = 0;
let color = '#fff';
let frames = 0;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  w = window.innerWidth;
  hgt = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(hgt * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const target = Math.max(24, Math.min(110, Math.round((w * hgt) / 14000)));
  while (flakes.length < target) flakes.push(makeFlake(true));
  flakes.length = target;
}

function makeFlake(anywhere) {
  const r = 0.8 + Math.random() * 2.6;
  return {
    x: Math.random() * w,
    y: anywhere ? Math.random() * hgt : -10,
    r,
    vy: 12 + r * 9 + Math.random() * 10,
    phase: Math.random() * Math.PI * 2,
    sway: 8 + Math.random() * 18,
    a: 0.35 + Math.random() * 0.5,
  };
}

function frame(t) {
  if (!running) return;
  const dt = Math.min(0.05, (t - (last || t)) / 1000);
  last = t;
  ctx.clearRect(0, 0, w, hgt);
  if (frames++ % 60 === 0) color = getComputedStyle(document.documentElement).getPropertyValue('--snow').trim() || '#fff';
  ctx.fillStyle = color;
  for (const f of flakes) {
    f.y += f.vy * dt;
    f.phase += dt * 0.8;
    const x = f.x + Math.sin(f.phase) * f.sway;
    if (f.y > hgt + 10) Object.assign(f, makeFlake(false));
    ctx.globalAlpha = f.a;
    ctx.beginPath();
    ctx.arc(x, f.y, f.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  raf = requestAnimationFrame(frame);
}

function onVisibility() {
  if (!canvas) return;
  if (document.hidden) {
    cancelAnimationFrame(raf);
  } else if (running) {
    last = 0;
    raf = requestAnimationFrame(frame);
  }
}

export function setSnow(enabled) {
  if (enabled && !running) {
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'snow';
      canvas.setAttribute('aria-hidden', 'true');
      ctx = canvas.getContext('2d');
      window.addEventListener('resize', () => canvas && resize(), { passive: true });
      document.addEventListener('visibilitychange', onVisibility);
    }
    document.body.prepend(canvas);
    resize();
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  } else if (!enabled && running) {
    running = false;
    cancelAnimationFrame(raf);
    canvas.remove();
  }
}
