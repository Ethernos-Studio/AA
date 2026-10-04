import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  archivePrefix,
  auditGraph,
  backlinks,
  buildGraph,
  categoryChain,
  mirroredPairs,
  nextArchiveId,
} from '../assets/js/graph.js';
import { newPage } from '../scripts/new-page.mjs';

const CONFIG = {
  siteName: 'Test',
  defaultPage: 'alpha',
  categories: {
    entities: {
      id: 'entities',
      name: '实体',
      parent: null,
      subcategories: ['organizations', 'locations'],
    },
    organizations: { id: 'organizations', name: '组织', parent: 'entities', archivePrefix: 'ORG' },
    locations: { id: 'locations', name: '地点', parent: 'entities', archivePrefix: 'LOC' },
  },
  plannedPages: {},
  pageRegistry: [],
};

test('archive prefix, category chain and next number are read from config', () => {
  assert.equal(archivePrefix(CONFIG, ['entities', 'organizations']), 'ORG');
  assert.equal(archivePrefix(CONFIG, ['entities']), null);
  assert.equal(archivePrefix(undefined, ['organizations']), null);
  assert.deepEqual(categoryChain(CONFIG, 'organizations'), ['entities', 'organizations']);
  assert.deepEqual(categoryChain(CONFIG, 'entities'), ['entities']);
  assert.deepEqual(categoryChain(CONFIG, 'missing'), []);

  const pages = [
    { id: 'a', archiveId: 'AZ-ORG-001' },
    { id: 'b', archiveId: 'AZ-ORG-007' },
    { id: 'c', archiveId: 'AZ-LOC-004' },
  ];
  assert.equal(nextArchiveId(CONFIG, pages, 'organizations'), 'AZ-ORG-008');
  assert.equal(nextArchiveId(CONFIG, pages, 'locations'), 'AZ-LOC-005');
  assert.equal(nextArchiveId(CONFIG, [], 'organizations'), 'AZ-ORG-001');
  assert.equal(nextArchiveId(CONFIG, pages, 'entities'), null);
});

test('backlinks surface declarations the page does not make itself', () => {
  const graph = buildGraph([
    { id: 'a', title: 'A', relations: { subordinates: ['b'] } },
    { id: 'b', title: 'B' },
  ]);
  assert.deepEqual(
    backlinks(graph, 'b').map((edge) => [edge.from, edge.kind]),
    [['a', 'subordinate']],
  );
  assert.deepEqual(backlinks(graph, 'a'), []);

  // A relation named by both pages must not be echoed back as a backlink.
  const mirrored = buildGraph([
    { id: 'a', relations: { associates: [{ id: 'b', type: '合作' }] } },
    { id: 'b', relations: { associates: [{ id: 'a', type: '合作' }] } },
  ]);
  assert.deepEqual(backlinks(mirrored, 'b'), []);
  assert.deepEqual(backlinks(mirrored, 'unknown'), []);
});

test('mirrored declarations are reported once per pair', () => {
  const pairs = mirroredPairs(
    buildGraph([
      { id: 'a', relations: { parent: 'p' } },
      { id: 'p', relations: { subordinates: ['a'] } },
      { id: 'x', relations: { associates: [{ id: 'y', type: '敌对' }] } },
      { id: 'y', relations: { associates: [{ id: 'x', type: '敌对' }] } },
    ]),
  );
  assert.deepEqual(
    pairs.find((pair) => pair.kind === 'parent'),
    {
      kind: 'parent',
      child: 'a',
      parent: 'p',
    },
  );
  assert.deepEqual(
    pairs.find((pair) => pair.kind === 'associate'),
    {
      kind: 'associate',
      a: 'x',
      b: 'y',
    },
  );
  assert.equal(pairs.length, 2);
});

test('audit flags self-relations and parent cycles as errors', () => {
  const self = auditGraph([{ id: 'a', relations: { parent: 'a' } }]);
  assert.ok(self.issues.some((issue) => issue.code === 'self-relation' && issue.level === 'error'));

  const cycle = auditGraph([
    { id: 'a', relations: { parent: 'b' } },
    { id: 'b', relations: { parent: 'a' } },
  ]);
  assert.ok(cycle.issues.some((issue) => issue.code === 'parent-cycle' && issue.level === 'error'));

  assert.equal(auditGraph([{ id: 'a' }, { id: 'b' }]).issues.length, 0);
});

test('a page claimed by two parents is a warning, not a build failure', () => {
  const { issues } = auditGraph(
    [
      { id: 'child', relations: { parent: 'p1' } },
      { id: 'p1' },
      { id: 'p2', relations: { subordinates: ['child'] } },
    ],
    { planned: {} },
  );
  const conflict = issues.find((issue) => issue.code === 'conflicting-parent');
  // "Inside this region" and "administered by" are different claims in the
  // archive's own model, so this must not block a build.
  assert.equal(conflict.level, 'warning');
  assert.deepEqual([...conflict.related].sort(), ['p1', 'p2']);
});

test('scaffold derives category ancestors and the next archive number', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'alpha-graph-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'pages'));
  await writeFile(
    path.join(root, 'wiki-config.json'),
    `${JSON.stringify({ ...CONFIG, pageRegistry: [{ id: 'alpha', file: 'pages/alpha.json' }] }, null, 2)}\n`,
  );
  const alpha = {
    id: 'alpha',
    title: 'A',
    archiveId: 'AZ-ORG-003',
    contentFile: 'pages/alpha.md',
    lastUpdated: '2026-01-01',
    categories: ['entities', 'organizations'],
  };
  await writeFile(path.join(root, 'pages/alpha.json'), `${JSON.stringify(alpha, null, 2)}\n`);
  await writeFile(path.join(root, 'pages/alpha.md'), '## 概述\n');

  const result = await newPage({
    root,
    id: 'beta',
    title: 'Beta',
    category: 'organizations',
    date: '2026-10-04',
  });
  // Both fields used to be typed by hand on every new page.
  assert.deepEqual(result.page.categories, ['entities', 'organizations']);
  assert.equal(result.page.archiveId, 'AZ-ORG-004');
  const onDisk = JSON.parse(await readFile(path.join(root, 'pages/beta.json'), 'utf8'));
  assert.equal(onDisk.archiveId, 'AZ-ORG-004');
  assert.deepEqual(
    JSON.parse(await readFile(path.join(root, 'wiki-config.json'), 'utf8')).pageRegistry.map(
      (entry) => entry.id,
    ),
    ['alpha', 'beta'],
  );
});
