import qrcode from '../vendor/qrcode.js';
import { h, s } from '../lib/dom.js';
import { copyText, downloadFile, safeFilename } from '../lib/clipboard.js';
import { openDialog } from './dialog.js';
import { toast } from './toast.js';

// Level L keeps modules as large as possible for long links (easier to scan from
// screens and small printouts); M/Q/H would only add density.
export function makeQr(text) {
  for (const level of ['L']) {
    try {
      const q = qrcode(0, level);
      q.addData(text);
      q.make();
      return q;
    } catch {
      /* too long for this level */
    }
  }
  return null;
}

/** Crisp SVG QR code (black on white regardless of theme, so scanners can read it). */
export function qrSvg(text, { margin = 4, label = 'QR code' } = {}) {
  const q = makeQr(text);
  if (!q) return null;
  const n = q.getModuleCount();
  const size = n + margin * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!q.isDark(r, c)) continue;
      let len = 1;
      while (c + len < n && q.isDark(r, c + len)) len++;
      d += `M${c + margin} ${r + margin}h${len}v1h-${len}z`;
      c += len - 1;
    }
  }
  return s(
    'svg',
    { class: 'qr', viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': label, 'shape-rendering': 'crispEdges' },
    s('rect', { width: size, height: size, fill: '#ffffff' }),
    s('path', { d, fill: '#000000' }),
  );
}

function qrPng(text, scale = 10, margin = 4) {
  const q = makeQr(text);
  if (!q) return Promise.resolve(null);
  const n = q.getModuleCount();
  const size = (n + margin * 2) * scale;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (q.isDark(r, c)) ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
  }
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export function showQrDialog({ title, url, caption = 'Scan with a phone camera to open the link.', filename = 'secret-santa-qr' }) {
  const svg = qrSvg(url, { label: `QR code: ${title}` });
  openDialog({
    title,
    size: 'sm',
    body: h(
      'div',
      { class: 'qr-dialog' },
      svg
        ? h('div', { class: 'qr-frame' }, svg)
        : h('p', { class: 'notice notice-warn' }, 'This link is too long to fit in a QR code. Try shortening the wishlist or message, or share the link directly.'),
      h('p', { class: 'muted small center' }, caption),
    ),
    actions: [
      {
        label: 'Copy link',
        icon: 'copy',
        onClick: async () => {
          toast((await copyText(url)) ? 'Link copied' : 'Couldn’t copy. Select and copy it manually.', { type: 'success' });
          return false;
        },
      },
      svg && {
        label: 'Download PNG',
        icon: 'download',
        variant: 'primary',
        onClick: async () => {
          const blob = await qrPng(url);
          if (blob) downloadFile(`${safeFilename(filename)}.png`, blob);
          return false;
        },
      },
    ].filter(Boolean),
  });
}
