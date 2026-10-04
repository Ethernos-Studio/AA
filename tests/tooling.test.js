import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { build } from '../scripts/build.mjs';
import { createServer, normalizeBase, parseArgs, requestFile } from '../scripts/dev.mjs';
import { newPage } from '../scripts/new-page.mjs';
import { exactFile, safeRelative } from '../scripts/paths.mjs';
import { validate, validDate, validateTags } from '../scripts/validate.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'alpha-tooling-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = {
    siteName: 'Test',
    defaultPage: 'home',
    categories: { entities: { id: 'entities', name: 'Entities', parent: null } },
    pageRegistry: [{ id: 'home', file: 'pages/home.json' }],
    plannedPages: {},
  };
  const page = {
    id: 'home',
    title: 'Home',
    contentFile: 'pages/home.md',
    lastUpdated: '2024-02-29',
    categories: ['entities'],
  };
  const json = async (file, data) => writeFile(path.join(root, file), `${JSON.stringify(data)}\n`);
  await mkdir(path.join(root, 'pages'));
  await mkdir(path.join(root, 'assets'));
  await json('wiki-config.json', config);
  await json('wiki-sidebar.json', {
    sections: [{ title: 'Nav', items: [{ type: 'link', id: 'home', title: 'Home' }] }],
  });
  await json('pages/home.json', page);
  await writeFile(path.join(root, 'pages/home.md'), '[section]\n## Home\n[/section]\n');
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  await writeFile(path.join(root, 'assets/app.js'), 'export const ready = true;');
  return { root, config, page, json };
}

function get(server, requestPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { hostname: '127.0.0.1', port: server.address().port, path: requestPath, method },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    request.on('error', reject);
    request.end();
  });
}

test('safe paths reject traversal, Windows aliases, hidden files and repeated decoding', () => {
  for (const value of [
    '../x',
    '/etc/passwd',
    'pages/../x',
    'pages\\x',
    'C:/x',
    'pages/a%2emd',
    '.git/config',
    'pages/.env',
    'pages/a.',
    'pages/a ',
    'pages/con.md',
    'pages/a\0.md',
  ])
    assert.equal(safeRelative(value), false, value);
  assert.equal(safeRelative('pages/ADR-MK4.md'), true);
  for (const url of [
    '/../index.html',
    '/pages/%2e%2e/index.html',
    '/pages%2fhome.md',
    '/pages/%252e%252e/a',
    '/%zz',
    '/.git/config',
    '//index.html',
    '/README.md',
    '/assets/payload.html',
  ])
    assert.equal(requestFile(url), null, url);
  assert.equal(normalizeBase('/preview'), '/preview/');
  assert.throws(() => normalizeBase('/a/../b'));
  assert.deepEqual(requestFile('/preview/?page=home', '/preview/'), { relative: 'index.html' });
  assert.equal(requestFile('/preview-other/index.html', '/preview/'), null);
  assert.throws(() => parseArgs(['--port', '0']));
  assert.throws(() => parseArgs(['--port', '4.5']));
  assert.equal(parseArgs(['--port', '4174']).port, 4174);
});

test('exactFile checks path spelling even on case-insensitive filesystems', async (t) => {
  const { root } = await fixture(t);
  await assert.rejects(exactFile(root, 'pages/Home.md'), /case mismatch/);
  await assert.rejects(exactFile(root, 'pages/../index.html'), /Unsafe/);
});

test('HTTP server serves a base prefix with MIME, HEAD and method protections', async (t) => {
  const { root } = await fixture(t);
  const server = await createServer({ dir: root, base: '/preview/' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  assert.equal((await get(server, '/preview')).status, 308);
  assert.equal((await get(server, '/preview/')).status, 200);
  const javascript = await get(server, '/preview/assets/app.js');
  assert.match(javascript.headers['content-type'], /javascript/);
  assert.equal(javascript.headers['x-content-type-options'], 'nosniff');
  assert.equal((await get(server, '/preview/pages/home.json', 'HEAD')).body, '');
  assert.equal((await get(server, '/preview/', 'POST')).status, 405);
  for (const url of [
    '/index.html',
    '/preview/../index.html',
    '/preview/pages/%2e%2e/index.html',
    '/preview/.git/config',
    '/preview/pages/Home.md',
  ])
    assert.equal((await get(server, url)).status, 404, url);
});

test('valid dates include leap years and reject normalized impossible dates', () => {
  assert.equal(validDate('2024-02-29'), true);
  for (const date of [
    '2023-02-29',
    '2024-02-30',
    '2024-04-31',
    '2024-13-01',
    '2024-1-01',
    'not-date',
    null,
  ])
    assert.equal(validDate(date), false);
});

test('tag validator checks nesting but ignores fenced and inline code', () => {
  assert.deepEqual(validateTags('[section][highlight]x[/highlight][/section]'), []);
  assert.ok(validateTags('[section][warning][/section][/warning]').length);
  assert.ok(validateTags('[collapsible title="x"]unfinished').length);
  assert.deepEqual(validateTags('```md\n[section]\n```\n`[warning]`\n\\[section]\n[key]'), []);
});

test('validator accepts a complete fixture and fails bad field types without throwing', async (t) => {
  const { root, page, json } = await fixture(t);
  assert.equal((await validate({ root })).ok, true);
  Object.assign(page, {
    title: 3,
    lastUpdated: '2025-02-30',
    tags: 'not-an-array',
    infobox: { fields: [null] },
    banner: [],
    metadata: false,
    autoGenerate: { breadcrumb: 'yes' },
    categories: ['unknown'],
    relations: { associates: [null] },
  });
  await json('pages/home.json', page);
  const result = await validate({ root });
  assert.equal(result.ok, false);
  assert.ok(result.errors.length >= 9);
});

test('validator checks IDs, default page, exact case, unregistered content and unsafe paths', async (t) => {
  const { root, config, page, json } = await fixture(t);
  config.defaultPage = 'missing';
  config.pageRegistry.push(
    { id: 'home', file: 'pages/Home.json' },
    { id: 'outside', file: '../outside.json' },
  );
  await json('wiki-config.json', config);
  page.contentFile = 'pages/Home.md';
  await json('pages/home.json', page);
  await json('pages/orphan.json', {});
  const { errors } = await validate({ root });
  assert.ok(errors.some((error) => error.includes('duplicate page ID')));
  assert.ok(errors.some((error) => error.includes('defaultPage')));
  assert.ok(errors.some((error) => error.includes('case mismatch')));
  assert.ok(errors.some((error) => error.includes('not registered')));
  assert.ok(errors.some((error) => error.includes('direct pages/')));
});

test('only explicitly declared planned relation objects are accepted', async (t) => {
  const { root, config, page, json } = await fixture(t);
  page.relations = { parent: 'later', subordinates: [], associates: [] };
  await json('pages/home.json', page);
  assert.equal((await validate({ root })).ok, false);
  config.plannedPages = ['later'];
  await json('wiki-config.json', config);
  assert.equal((await validate({ root })).ok, false);
  config.plannedPages = { later: { id: 'later', title: 'Later' } };
  await json('wiki-config.json', config);
  assert.equal((await validate({ root })).ok, true);
  config.plannedPages.later.id = 'wrong';
  await json('wiki-config.json', config);
  assert.equal((await validate({ root })).ok, false);
});

test('categories and sidebar references must be valid', async (t) => {
  const { root, config, json } = await fixture(t);
  config.categories.entities.parent = 'child';
  config.categories.entities.subcategories = ['child'];
  config.categories.child = {
    id: 'child',
    name: 'Child',
    parent: 'entities',
    subcategories: ['entities'],
  };
  await json('wiki-config.json', config);
  await json('wiki-sidebar.json', {
    sections: [
      {
        title: 'Nav',
        items: [
          { type: 'link', id: 'missing', title: 'Missing' },
          { type: 'action', title: 'Bad', action: 'execute' },
        ],
      },
    ],
  });
  const { errors } = await validate({ root });
  assert.ok(errors.some((error) => error.includes('category cycle')));
  assert.ok(errors.some((error) => error.includes('unknown action')));
  assert.ok(errors.some((error) => error.includes('unknown or invalid page ID')));
});

test('scaffold creates JSON and Markdown, registers the page and refuses duplicate writes', async (t) => {
  const { root } = await fixture(t);
  await newPage({
    root,
    id: 'new-entry',
    title: 'New Entry',
    category: 'entities',
    date: '2026-10-04',
  });
  assert.equal((await validate({ root })).ok, true);
  const before = await readFile(path.join(root, 'wiki-config.json'), 'utf8');
  await assert.rejects(
    newPage({ root, id: 'new-entry', title: 'Overwrite' }),
    /already registered/,
  );
  assert.equal(await readFile(path.join(root, 'wiki-config.json'), 'utf8'), before);
  await assert.rejects(newPage({ root, id: '../escape', title: 'Escape' }), /id must/);
});

test('scaffold never overwrites existing Markdown and cleans only newly created JSON', async (t) => {
  const { root } = await fixture(t);
  await writeFile(path.join(root, 'pages/existing.md'), 'Keep this text');
  await assert.rejects(newPage({ root, id: 'existing', title: 'Existing' }), { code: 'EEXIST' });
  assert.equal(await readFile(path.join(root, 'pages/existing.md'), 'utf8'), 'Keep this text');
  await assert.rejects(readFile(path.join(root, 'pages/existing.json')), { code: 'ENOENT' });
  assert.equal(
    JSON.parse(await readFile(path.join(root, 'wiki-config.json'), 'utf8')).pageRegistry.length,
    1,
  );
});

test('build includes only the site whitelist and real CNAME; validation failure preserves dist', async (t) => {
  const { root, page, json } = await fixture(t);
  await writeFile(path.join(root, 'README.md'), 'Do not publish');
  await writeFile(path.join(root, 'CNAME'), 'wiki.example.test\n');
  await mkdir(path.join(root, 'node_modules'));
  await writeFile(path.join(root, 'node_modules/secret.js'), 'secret');
  const result = await build({ root });
  assert.ok(result.files.includes('CNAME'));
  assert.ok(result.files.includes('pages/home.md'));
  await assert.rejects(readFile(path.join(root, 'dist/README.md')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(root, 'dist/node_modules/secret.js')), {
    code: 'ENOENT',
  });
  page.lastUpdated = '2025-02-30';
  await json('pages/home.json', page);
  await assert.rejects(build({ root }), /Validation failed/);
  assert.equal(
    await readFile(path.join(root, 'dist/index.html'), 'utf8'),
    '<!doctype html><title>Test</title>',
  );
});

test('symlink inputs and dist escape are refused where symlinks are available', async (t) => {
  const { root } = await fixture(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'alpha-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, 'keep.txt'), 'Keep');
  try {
    await symlink(
      outside,
      path.join(root, 'dist'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) {
      t.skip(`Symlink creation unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  await assert.rejects(build({ root }), /dist must be a real/);
  await assert.rejects(exactFile(root, 'dist/keep.txt'), /Symbolic links/);
  assert.equal(await readFile(path.join(outside, 'keep.txt'), 'utf8'), 'Keep');
});

test('duplicate archiveId is always an error, including the former AZ-LOC-002 pair', async (t) => {
  const { root, config, json } = await fixture(t);
  const body = '[section]\n## Body\n[/section]\n';
  // Drop the fixture's own page so the registry below has no unregistered leftovers.
  await rm(path.join(root, 'pages/home.json'));
  await rm(path.join(root, 'pages/home.md'));
  const pages = {
    'efgh-alpha': {
      id: 'efgh-alpha',
      title: 'EFGH-ALPHA',
      archiveId: 'AZ-LOC-002',
      contentFile: 'pages/efgh-alpha.md',
      lastUpdated: '2024-02-29',
      categories: ['entities'],
    },
    'grassland-base': {
      id: 'grassland-base',
      title: 'GRASSLAND BASE',
      archiveId: 'AZ-LOC-002',
      contentFile: 'pages/grassland-base.md',
      lastUpdated: '2024-02-29',
      categories: ['entities'],
    },
  };
  config.pageRegistry = Object.keys(pages).map((id) => ({ id, file: `pages/${id}.json` }));
  config.defaultPage = 'efgh-alpha';
  config.categories.entities = { id: 'entities', name: 'Entities', parent: null };
  await json('wiki-config.json', config);
  await json('wiki-sidebar.json', { sections: [{ title: 'Nav', items: [] }] });
  for (const [id, page] of Object.entries(pages)) {
    await json(`pages/${id}.json`, page);
    await writeFile(path.join(root, `pages/${id}.md`), body);
  }
  const duplicate = await validate({ root });
  assert.equal(duplicate.ok, false);
  assert.ok(
    duplicate.errors.some((error) => error.includes('duplicate archiveId AZ-LOC-002')),
    'the former exception must no longer be exempt',
  );
  pages['grassland-base'].archiveId = 'AZ-LOC-003';
  await json('pages/grassland-base.json', pages['grassland-base']);
  assert.equal((await validate({ root })).ok, true);
});
