// Tiny static server that mimics GitHub Pages for a project site:
// the site lives under /<base>/, unknown paths get 404.html, and "/base" redirects to "/base/".
// Usage: node scripts/serve.mjs [--port 8080] [--base /secret-santa/]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

export function startServer({ port = 8080, base = '/secret-santa/', host = '127.0.0.1' } = {}) {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === prefix.slice(0, -1)) {
      res.writeHead(301, { Location: prefix + url.search });
      res.end();
      return;
    }
    const send404 = async () => {
      const body = await readFile(path.join(root, '404.html'));
      res.writeHead(404, { 'Content-Type': MIME['.html'] });
      res.end(body);
    };
    if (!pathname.startsWith(prefix)) return send404();
    let rel = pathname.slice(prefix.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) return send404();
    try {
      const st = await stat(file);
      if (!st.isFile()) return send404();
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      return send404();
    }
    return undefined;
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : fallback;
  };
  const port = Number(arg('--port', process.env.PORT || 8080));
  const base = arg('--base', '/secret-santa/');
  await startServer({ port, base });
  console.log(`Serving docs/ at http://localhost:${port}${base}`);
}
