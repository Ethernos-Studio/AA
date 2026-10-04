import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { exactFile, isMain, PROJECT_ROOT, safeRelative } from './paths.mjs';

export const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
});

export function normalizeBase(base = '/') {
  if (base === '/') return base;
  if (
    typeof base !== 'string' ||
    !base.startsWith('/') ||
    !safeRelative(base.slice(1).replace(/\/$/, ''))
  ) {
    throw new Error('--base must be an absolute URL prefix, e.g. /preview/');
  }
  return `${base.replace(/\/$/, '')}/`;
}

export function requestFile(rawUrl, base = '/') {
  // Do not use URL.pathname: URL parsing silently normalizes dot segments.
  const rawPath = rawUrl.split('?')[0];
  if (!rawPath.startsWith('/') || rawPath.startsWith('//') || /%(?:2f|5c)/i.test(rawPath))
    return null;
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (decoded === base.slice(0, -1) && base !== '/') return { redirect: base };
  if (!decoded.startsWith(base)) return null;
  const relative = decoded.slice(base.length) || 'index.html';
  if (!safeRelative(relative)) return null;
  // This is a site preview, not a repository/file-system browsing server.
  if (
    !['index.html', 'wiki-config.json', 'wiki-sidebar.json', 'CNAME'].includes(relative) &&
    !relative.startsWith('assets/') &&
    !relative.startsWith('pages/')
  )
    return null;
  const extension = path.extname(relative);
  if (relative.startsWith('pages/') && !['.json', '.md'].includes(extension)) return null;
  if (relative.startsWith('assets/') && extension === '.html') return null;
  if (!MIME_TYPES[extension] && relative !== 'CNAME') return null;
  return { relative };
}

export async function createServer({ dir = PROJECT_ROOT, base = '/' } = {}) {
  const root = await realpath(path.resolve(dir));
  const prefix = normalizeBase(base);
  return http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const target = requestFile(request.url ?? '/', prefix);
    if (!target) {
      response.writeHead(404).end();
      return;
    }
    if (target.redirect) {
      response.writeHead(308, { Location: target.redirect }).end();
      return;
    }
    try {
      const file = await exactFile(root, target.relative);
      const body = await readFile(file);
      response.writeHead(200, {
        'Content-Type': MIME_TYPES[path.extname(file)] ?? 'text/plain; charset=utf-8',
        'Content-Length': body.length,
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      response.writeHead(404).end();
    }
  });
}

export function parseArgs(args) {
  const options = { port: 4173, dir: PROJECT_ROOT, base: '/' };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!['--port', '--dir', '--base'].includes(flag) || !value)
      throw new Error('Usage: node scripts/dev.mjs [--port 4173] [--dir dist] [--base /preview/]');
    if (flag === '--port') {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)
        throw new Error('--port must be an integer from 1 to 65535');
      options.port = Number(value);
    } else options[flag.slice(2)] = value;
  }
  options.base = normalizeBase(options.base);
  return options;
}

if (isMain(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const server = await createServer(options);
    server.on('error', (error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
    server.listen(options.port, '127.0.0.1', () =>
      console.log(`Alpha Archive: http://127.0.0.1:${options.port}${options.base}`),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
