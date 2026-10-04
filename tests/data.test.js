import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ContentStore } from '../assets/js/content-store.js';
import { normalizeSearch, searchPages } from '../assets/js/search.js';

function config(ids = ['a', 'b', 'c']) {
  return {
    defaultPage: ids[0],
    pageRegistry: ids.map((id) => ({ id, file: `pages/${id}.json` })),
    plannedPages: { planned: { id: 'planned', title: '待编写' } },
    categories: {
      root: { id: 'root', parent: null, subcategories: ['child'] },
      child: { id: 'child', parent: 'root' },
      grandchild: { id: 'grandchild', parent: 'child' },
    },
  };
}

function meta(id, extra = {}) {
  return { id, title: id.toUpperCase(), contentFile: `pages/${id}.md`, categories: [], ...extra };
}

function response(value, status = 200) {
  return { status, json: async () => structuredClone(value), text: async () => value };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fixture(routes = {}, ids = ['a', 'b', 'c']) {
  const calls = [];
  const store = new ContentStore({
    fetcher: async (path, options) => {
      calls.push({ path, options });
      if (Object.hasOwn(routes, path)) {
        const route = routes[path];
        return typeof route === 'function' ? route(path, options) : route;
      }
      if (path === 'wiki-config.json') return response(config(ids));
      if (path === 'wiki-sidebar.json') return response({ sections: [] });
      const id = path.match(/^pages\/(.+)\.(json|md)$/)?.[1];
      if (id && path.endsWith('.json')) return response(meta(id));
      if (id) return response(`# ${id}`);
      return response(null, 404);
    },
  });
  return { store, calls, count: (path) => calls.filter((call) => call.path === path).length };
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test('init loads config only, exposes planned pages, and deduplicates calls', async () => {
  const { store, calls } = fixture();
  const [first, second] = await Promise.all([store.init(), store.init()]);
  assert.equal(first, second);
  assert.equal(store.config, first);
  assert.deepEqual(store.order, ['a', 'b', 'c']);
  assert.equal(store.config.plannedPages.planned.title, '待编写');
  assert.equal(store.pages.size, 0);
  await store.init();
  assert.deepEqual(
    calls.map((call) => call.path),
    ['wiki-config.json'],
  );
});

test('configuration failures are retryable', async () => {
  let attempt = 0;
  const { store } = fixture({
    'wiki-config.json': () => (++attempt === 1 ? response(null, 503) : response(config())),
  });
  await assert.rejects(store.init(), { code: 'HTTP_ERROR' });
  assert.equal(store.config, null);
  await store.init();
  assert.equal(attempt, 2);
});

test('metadata loads independently, deduplicates, caches, and keeps registry order', async () => {
  const slow = deferred();
  const { store, count } = fixture({ 'pages/a.json': slow.promise });
  const first = store.getMeta('a');
  const second = store.getMeta('a');
  const b = await store.getMeta('b');
  assert.equal(b.id, 'b');
  assert.deepEqual(
    store.getOrderedPages().map((page) => page.id),
    ['b'],
  );
  slow.resolve(response(meta('a')));
  assert.equal(await first, await second);
  assert.equal(await store.getMeta('a'), await first);
  assert.equal(count('pages/a.json'), 1);
  assert.deepEqual(
    store.getOrderedPages().map((page) => page.id),
    ['a', 'b'],
  );
});

test('preloadMetadata reports partial failures in registry order and retries failures', async () => {
  const pendingA = deferred();
  const pendingB = deferred();
  let cAttempts = 0;
  const { store, count } = fixture({
    'pages/a.json': pendingA.promise,
    'pages/b.json': pendingB.promise,
    'pages/c.json': () => (++cAttempts === 1 ? response(null, 404) : response(meta('c'))),
  });
  const preload = store.preloadMetadata();
  await nextTurn();
  pendingB.resolve(response(meta('b')));
  pendingA.resolve(response(meta('a')));
  const result = await preload;
  assert.deepEqual(
    result.pages.map((page) => page.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    result.errors.map((entry) => entry.id),
    ['c'],
  );
  assert.equal(result.errors[0].error.code, 'HTTP_ERROR');
  assert.equal(store.pages.has('c'), false);
  assert.deepEqual(
    (await store.preloadMetadata()).pages.map((page) => page.id),
    ['a', 'b', 'c'],
  );
  assert.equal(count('pages/a.json'), 1);
  assert.equal(cAttempts, 2);
});

test('multiple preload errors remain ordered despite reversed completion', async () => {
  const a = deferred();
  const b = deferred();
  const { store } = fixture({ 'pages/a.json': a.promise, 'pages/b.json': b.promise });
  const load = store.preloadMetadata();
  await nextTurn();
  b.resolve(response(null, 500));
  a.resolve(response(null, 404));
  assert.deepEqual(
    (await load).errors.map((entry) => entry.id),
    ['a', 'b'],
  );
});

test('getPage combines metadata and content, deduplicates and caches only successes', async () => {
  let attempts = 0;
  const { store, count } = fixture({
    'pages/a.md': () => (++attempts === 1 ? response(null, 503) : response('正文')),
  });
  await assert.rejects(store.getPage('a'), { code: 'HTTP_ERROR' });
  const [first, second] = await Promise.all([store.getPage('a'), store.getPage('a')]);
  assert.equal(first, second);
  assert.equal(first.content, '正文');
  assert.equal(first.title, 'A');
  assert.equal(await store.getPage('a'), first);
  assert.equal(count('pages/a.json'), 1);
  assert.equal(count('pages/a.md'), 2);
  assert.equal(Object.hasOwn(store.pages.get('a'), 'content'), false);
});

test('unknown and planned IDs reject with NOT_FOUND without requesting a page', async () => {
  const { store, calls } = fixture();
  await assert.rejects(store.getMeta('missing'), { code: 'NOT_FOUND' });
  await assert.rejects(store.getPage('planned'), { code: 'NOT_FOUND' });
  assert.equal(calls.length, 1);
});

test('a forced metadata refresh cannot be overwritten by an older response', async () => {
  const older = deferred();
  const newer = deferred();
  let attempts = 0;
  const { store } = fixture({
    'pages/a.json': () => (++attempts === 1 ? older.promise : newer.promise),
  });
  const oldRequest = store.getMeta('a');
  await nextTurn();
  const newRequest = store.getMeta('a', { force: true });
  await nextTurn();
  newer.resolve(response(meta('a', { title: 'New' })));
  await newRequest;
  older.resolve(response(meta('a', { title: 'Old' })));
  assert.equal((await oldRequest).title, 'Old');
  assert.equal((await store.getMeta('a')).title, 'New');
  assert.equal(attempts, 2);
});

test('readers during force refresh join newest metadata request', async () => {
  const newer = deferred();
  let attempts = 0;
  const { store } = fixture({
    'pages/a.json': () => (++attempts === 1 ? response(meta('a')) : newer.promise),
  });
  await store.getMeta('a');
  const forced = store.getMeta('a', { force: true });
  const reader = store.getMeta('a');
  await nextTurn();
  newer.resolve(response(meta('a', { title: 'Newest' })));
  assert.equal(await forced, await reader);
  assert.equal(attempts, 2);
});

test('a forced page refresh fetches metadata and content, preserving newest cache', async () => {
  const older = deferred();
  const newer = deferred();
  let contentAttempts = 0;
  let metadataAttempts = 0;
  const { store } = fixture({
    'pages/a.json': () => response(meta('a', { title: `Version ${++metadataAttempts}` })),
    'pages/a.md': () => (++contentAttempts === 1 ? older.promise : newer.promise),
  });
  const oldRequest = store.getPage('a');
  await nextTurn();
  const forced = store.getPage('a', { force: true });
  const follower = store.getPage('a');
  await nextTurn();
  newer.resolve(response('New content'));
  const refreshed = await forced;
  assert.equal(await follower, refreshed);
  older.resolve(response('Old content'));
  assert.equal((await oldRequest).content, 'Old content');
  assert.equal(await store.getPage('a'), refreshed);
  assert.equal(refreshed.title, 'Version 2');
  assert.equal(contentAttempts, 2);
  assert.equal(metadataAttempts, 2);
});

test('a metadata refresh invalidates cached content and older in-flight page requests', async () => {
  const older = deferred();
  let contentAttempts = 0;
  let metadataAttempts = 0;
  const { store } = fixture({
    'pages/a.json': () => response(meta('a', { title: `Version ${++metadataAttempts}` })),
    'pages/a.md': () => (++contentAttempts === 1 ? older.promise : response('New content')),
  });
  const oldRequest = store.getPage('a');
  await nextTurn();
  await store.getMeta('a', { force: true });
  const latest = await store.getPage('a');
  older.resolve(response('Old content'));
  await oldRequest;
  assert.equal(await store.getPage('a'), latest);
  assert.equal(latest.title, 'Version 2');
  assert.equal(latest.content, 'New content');
});

test('a failed forced request does not allow an earlier response to populate the cache', async () => {
  const older = deferred();
  let attempts = 0;
  const { store } = fixture({
    'pages/a.json': () => {
      attempts += 1;
      if (attempts === 1) return older.promise;
      if (attempts === 2) return response(null, 500);
      return response(meta('a', { title: 'Retry' }));
    },
  });
  const first = store.getMeta('a');
  await nextTurn();
  await assert.rejects(store.getMeta('a', { force: true }), { code: 'HTTP_ERROR' });
  older.resolve(response(meta('a', { title: 'Stale' })));
  await first;
  assert.equal(store.pages.has('a'), false);
  assert.equal((await store.getMeta('a')).title, 'Retry');
});

test('invalid metadata and parsing failures are not cached', async () => {
  let attempts = 0;
  const { store } = fixture({
    'pages/a.json': () => {
      attempts += 1;
      if (attempts === 1) return response(meta('wrong'));
      if (attempts === 2)
        return {
          status: 200,
          json: async () => {
            throw new SyntaxError('Invalid JSON');
          },
        };
      return response(meta('a'));
    },
  });
  await assert.rejects(store.getMeta('a'), { code: 'INVALID_METADATA' });
  await assert.rejects(store.getMeta('a'), { code: 'FETCH_ERROR' });
  assert.equal(store.pages.has('a'), false);
  assert.equal((await store.getMeta('a')).id, 'a');
  assert.equal(attempts, 3);
});

test('all non-200 statuses are errors, even other successful HTTP statuses', async () => {
  const { store } = fixture({ 'pages/a.json': response(meta('a'), 204) });
  await assert.rejects(
    store.getMeta('a'),
    (error) => error.code === 'HTTP_ERROR' && /204/.test(error.message),
  );
});

test('timeouts cover both fetch and body reading, even if fetcher ignores abort', async () => {
  for (const fetcher of [
    async () => new Promise(() => {}),
    async () => ({ status: 200, json: () => new Promise(() => {}) }),
  ]) {
    const store = new ContentStore({ fetcher, timeout: 15 });
    await assert.rejects(
      store.init(),
      (error) => error.code === 'TIMEOUT' && /wiki-config.json/.test(error.message),
    );
    assert.equal(store.config, null);
  }
});

test('timed-out metadata retries without allowing late responses to enter the cache', async () => {
  const late = deferred();
  let attempts = 0;
  const store = new ContentStore({
    timeout: 15,
    fetcher: async (path) => {
      if (path === 'wiki-config.json') return response(config(['a']));
      attempts += 1;
      return attempts === 1 ? late.promise : response(meta('a', { title: 'Retry' }));
    },
  });
  await assert.rejects(store.getMeta('a'), { code: 'TIMEOUT' });
  assert.equal(store.pages.has('a'), false);
  const latest = await store.getMeta('a');
  late.resolve(response(meta('a', { title: 'Late' })));
  await nextTurn();
  assert.equal(await store.getMeta('a'), latest);
  assert.equal(latest.title, 'Retry');
  assert.equal(attempts, 2);
});

test('sidebar loads independently, retries failures, and deduplicates successful requests', async () => {
  let attempts = 0;
  const sidebar = {
    sections: [{ title: 'Test', items: [{ type: 'locked', id: 'planned', title: '待编写' }] }],
  };
  const { store, count } = fixture({
    'wiki-sidebar.json': () => (++attempts === 1 ? response(null, 500) : response(sidebar)),
  });
  await assert.rejects(store.loadSidebar(), { code: 'HTTP_ERROR' });
  const [first, second] = await Promise.all([store.loadSidebar(), store.loadSidebar()]);
  assert.equal(first, second);
  assert.deepEqual(first, sidebar);
  await store.loadSidebar();
  assert.equal(attempts, 2);
  assert.equal(count('wiki-config.json'), 0);
});

test('requests remain deployment-relative and prevent external redirects', async () => {
  const { store, calls } = fixture();
  await store.getPage('a');
  for (const call of calls) {
    assert.equal(
      new URL(call.path, 'https://example.com/project/index.html').pathname.startsWith('/project/'),
      true,
    );
    assert.equal(call.options.redirect, 'error');
    assert.ok(call.options.signal instanceof AbortSignal);
  }
});

test('registry rejects unsafe external, absolute, and encoded traversal paths', async () => {
  const paths = [
    'https://evil.test/a.json',
    '//evil.test/a.json',
    '/pages/a.json',
    '../a.json',
    'pages/../a.json',
    'pages/%2e%2e/a.json',
    'pages/%252e%252e/a.json',
    'pages\\a.json',
    'pages/%5c../a.json',
    'data:text/plain,a',
    'pages/a.json?x=1',
    ' pages/a.json',
    'pages/%00a.json',
    'pages/%25252525252e%25252525252e/a.json',
  ];
  for (const file of paths) {
    const data = config(['a']);
    data.pageRegistry[0].file = file;
    const { store, calls } = fixture({ 'wiki-config.json': response(data) });
    await assert.rejects(store.init(), { code: 'INVALID_PATH' }, file);
    assert.equal(calls.length, 1);
  }
});

test('metadata rejects unsafe content paths before any content fetch', async () => {
  const { store, calls } = fixture({
    'pages/a.json': response(meta('a', { contentFile: '../secret.md' })),
  });
  await assert.rejects(store.getPage('a'), { code: 'INVALID_PATH' });
  assert.equal(store.pages.has('a'), false);
  assert.equal(calls.length, 2);
});

test('category members derive from page categories and include descendants once', async () => {
  const { store } = fixture({
    'pages/a.json': response(meta('a', { categories: ['root', 'child', 'grandchild'] })),
    'pages/b.json': response(meta('b', { categories: ['grandchild'] })),
    'pages/c.json': response(meta('c', { categories: ['root'] })),
  });
  assert.deepEqual(store.getCategoryPages('root'), []);
  await store.preloadMetadata();
  assert.deepEqual(
    store.getCategoryPages('root').map((page) => page.id),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    store.getCategoryPages('child').map((page) => page.id),
    ['a', 'b'],
  );
  assert.deepEqual(store.getCategoryPages('missing'), []);
  store.config.categories.grandchild.subcategories = ['root'];
  assert.deepEqual(
    store.getCategoryPages('root').map((page) => page.id),
    ['a', 'b', 'c'],
  );
});

test('normalizeSearch handles case, full-width text, punctuation and spacing', () => {
  assert.equal(normalizeSearch('  ＡＤＲ－MK4 / AZ-CLU-001  '), 'adr mk4 az clu 001');
  assert.equal(normalizeSearch('时晶体（异常）'), '时晶体 异常');
  assert.equal(normalizeSearch(null), '');
});

test('search covers all metadata fields, Chinese substrings, and multiple tokens', () => {
  const page = {
    id: 'adr-mk4',
    title: 'ADR-MK4',
    subtitle: '失落的通讯装置',
    archiveId: 'AZ-CLU-001',
    tags: ['线索', '战区广播'],
    aliases: ['回声信标', 'Emergency Beacon'],
  };
  for (const query of [
    'adr mk4',
    'AZ-CLU-001',
    '通讯',
    '线索',
    '广播',
    '回声',
    'EMERGENCY beacon',
    'adr 线索',
  ]) {
    assert.deepEqual(searchPages([page], query), [page], query);
  }
  assert.deepEqual(searchPages([page], 'adr 时晶'), []);
  assert.deepEqual(searchPages([page], '!!'), []);
  assert.deepEqual(searchPages([page], ''), []);
});

test('search ranks title above weak fields, preserves ties, limits and returns original objects', () => {
  const pages = [
    { id: 'weak', title: '无关', subtitle: 'alpha' },
    { id: 'title1', title: 'Alpha' },
    { id: 'title2', title: 'Alpha' },
    { id: 'prefix', title: 'Alpha Zone' },
  ];
  assert.deepEqual(
    searchPages(pages, 'alpha').map((page) => page.id),
    ['title1', 'title2', 'prefix', 'weak'],
  );
  assert.equal(searchPages(pages, 'alpha', 1)[0], pages[1]);
  assert.deepEqual(searchPages(pages, 'alpha', 0), []);
  assert.deepEqual(searchPages(pages, 'alpha', -2), []);
  assert.deepEqual(
    pages.map((page) => page.id),
    ['weak', 'title1', 'title2', 'prefix'],
  );
});

test('repository config declares all relations and locked links without fictional page files', async () => {
  const root = new URL('../', import.meta.url);
  const data = JSON.parse(await readFile(new URL('wiki-config.json', root), 'utf8'));
  const sidebar = JSON.parse(await readFile(new URL('wiki-sidebar.json', root), 'utf8'));
  const ids = new Set(data.pageRegistry.map((entry) => entry.id));
  assert.equal(data.defaultPage, 'index');
  assert.equal(ids.has('recent'), false);
  assert.equal(ids.size, data.pageRegistry.length);
  for (const [id, planned] of Object.entries(data.plannedPages)) {
    assert.equal(planned.id, id);
    assert.equal(typeof planned.title, 'string');
    assert.equal(ids.has(id), false);
  }
  for (const category of Object.values(data.categories)) {
    assert.equal(Object.hasOwn(category, 'pages'), false);
    if (category.parent)
      assert.ok(data.categories[category.parent].subcategories.includes(category.id));
    for (const child of category.subcategories || [])
      assert.equal(data.categories[child].parent, category.id);
  }
  for (const entry of data.pageRegistry) {
    const page = JSON.parse(await readFile(new URL(entry.file, root), 'utf8'));
    assert.equal(page.id, entry.id);
    await readFile(new URL(page.contentFile, root), 'utf8');
    for (const category of page.categories) assert.ok(Object.hasOwn(data.categories, category));
    const relations = page.relations;
    const targets = [
      relations.parent,
      ...relations.subordinates,
      ...relations.associates.map((link) => link.id),
    ].filter((id) => id !== null);
    for (const id of targets)
      assert.ok(ids.has(id) || Object.hasOwn(data.plannedPages, id), `${entry.id} → ${id}`);
  }
  for (const section of sidebar.sections) {
    for (const item of section.items) {
      if (item.type === 'locked') assert.ok(Object.hasOwn(data.plannedPages, item.id));
      if (item.type === 'link' || item.type === 'page') assert.ok(ids.has(item.id));
    }
  }
});

// Regression: the browser's window.fetch is a brand-checked method. Storing it and
// calling it as `store.fetcher(...)` throws "Illegal invocation" and the request is
// never sent, so the store must invoke the fetcher without a receiver.
test('the fetcher is invoked without a receiver so window.fetch keeps its binding', async () => {
  const receivers = [];
  const fetcher = function plainFetch() {
    receivers.push(this);
    return Promise.resolve(response(config(['a'])));
  };
  const store = new ContentStore({ fetcher });
  await store.init();
  assert.equal(receivers.length, 1);
  assert.equal(receivers[0], undefined);
});
