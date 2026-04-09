import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const host = '127.0.0.1';
const port = Number(process.env.PORT || 5173);
const root = process.cwd();

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function resolvePath(urlPath) {
  const safePath = normalize(decodeURIComponent(urlPath)).replace(/^\.\.[/\\]/, '');
  if (safePath === '/' || safePath === '.') return join(root, 'site', 'index.html');
  // /assets/ — короткий алиас на site/assets/
  if (safePath.startsWith('/assets/')) return join(root, 'site', safePath.slice(1));
  // /site/... (как используется в index.html) — относительно root
  if (safePath.startsWith('/site/')) return join(root, safePath.slice(1));
  // Любой другой статический файл на верхнем уровне (например /dapp-demo.html)
  // ищем сначала в site/, иначе в root.
  const inSite = join(root, 'site', safePath.startsWith('/') ? safePath.slice(1) : safePath);
  if (existsSync(inSite)) return inSite;
  return join(root, safePath.startsWith('/') ? safePath.slice(1) : safePath);
}

createServer(async (req, res) => {
  try {
    const urlPath = new URL(req.url, `http://${host}:${port}`).pathname;
    const absolute = resolvePath(urlPath);

    if (!existsSync(absolute)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const type = mime[extname(absolute).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });

    if (type.startsWith('text/') || type.includes('javascript') || type.includes('json')) {
      const content = await readFile(absolute);
      res.end(content);
      return;
    }

    createReadStream(absolute).pipe(res);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal server error');
  }
}).listen(port, host, () => {
  console.log(`Site running at http://${host}:${port}`);
});
