// Scratch-off card on a canvas. The prize element sits underneath (hidden from
// assistive tech until revealed; there is always a "reveal without scratching" option).
import { h } from '../lib/dom.js';
import { playTick } from '../fx/sound.js';

export function scratchCard(prize, { onComplete, threshold = 0.5 } = {}) {
  const canvas = h('canvas', { class: 'scratch-canvas', 'aria-hidden': 'true' });
  const wrap = h('div', { class: 'scratch' }, h('div', { class: 'scratch-prize', 'aria-hidden': 'true' }, prize), canvas);
  const ctx = canvas.getContext('2d');
  let W = 0;
  let H = 0;
  let drawing = false;
  let last = null;
  let moves = 0;
  let done = false;
  let ro = null;

  function paint() {
    const rect = wrap.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#c9ced6');
    g.addColorStop(0.45, '#eef1f5');
    g.addColorStop(0.55, '#d7dce3');
    g.addColorStop(1, '#aeb5bf');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // Sparkle pattern.
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < 70; i++) {
      const x = ((i * 97) % 1000) / 1000 * W;
      const y = ((i * 61) % 1000) / 1000 * H;
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.fillStyle = '#5b6370';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.max(18, Math.min(28, W / 12))}px system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.fillText('✨ Scratch here ✨', W / 2, H / 2 - 10);
    ctx.font = `500 ${Math.max(12, Math.min(15, W / 24))}px system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.fillText('Use your finger or mouse', W / 2, H / 2 + 20);
  }

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function scratch(a, b) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(30, W / 10);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x + 0.01, b.y + 0.01);
    ctx.stroke();
  }

  function cleared() {
    const { width, height } = canvas;
    if (!width || !height) return 0;
    const data = ctx.getImageData(0, 0, width, height).data;
    const step = Math.max(4, Math.floor(Math.min(width, height) / 40));
    let total = 0;
    let clear = 0;
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        total++;
        if (data[(y * width + x) * 4 + 3] < 128) clear++;
      }
    }
    return total ? clear / total : 0;
  }

  function finish() {
    if (done) return;
    done = true;
    canvas.classList.add('cleared');
    wrap.querySelector('.scratch-prize').removeAttribute('aria-hidden');
    setTimeout(() => canvas.remove(), 450);
    if (onComplete) onComplete();
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (done) return;
    drawing = true;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    last = pos(e);
    scratch(last, last);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing || done) return;
    const p = pos(e);
    scratch(last, p);
    last = p;
    moves++;
    if (moves % 6 === 0) playTick(0.6 + Math.random() * 0.3);
    if (moves % 10 === 0 && cleared() > threshold) finish();
  });
  const end = () => {
    if (!drawing) return;
    drawing = false;
    if (!done && cleared() > threshold) finish();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  requestAnimationFrame(() => {
    paint();
    if (typeof ResizeObserver === 'function') {
      let lastW = 0;
      ro = new ResizeObserver((entries) => {
        const w = entries[0].contentRect.width;
        // Repaint only on real size changes before any scratching started.
        if (!done && moves === 0 && Math.abs(w - lastW) > 1) {
          lastW = w;
          paint();
        }
      });
      ro.observe(wrap);
    }
  });

  return {
    el: wrap,
    reveal: finish,
    destroy() {
      if (ro) ro.disconnect();
    },
  };
}
