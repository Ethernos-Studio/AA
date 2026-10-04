// Read every page record at once and report the relationship graph.
//
// This is the view `validate` cannot give: it needs the whole archive in hand
// to answer "who points at this page", "which declarations are written twice",
// and "which pages claim the same subordinate". The same derivation feeds the
// browser, so what this prints is exactly what the site renders.

import { readFile } from 'node:fs/promises';
import { summarize } from '../assets/js/graph.js';
import { exactFile, isMain, PROJECT_ROOT } from './paths.mjs';

export async function loadContent(root = PROJECT_ROOT) {
  const config = JSON.parse(await readFile(await exactFile(root, 'wiki-config.json'), 'utf8'));
  const pages = [];
  for (const entry of config.pageRegistry || []) {
    try {
      pages.push(JSON.parse(await readFile(await exactFile(root, entry.file), 'utf8')));
    } catch {
      // Broken metadata is reported by `validate`; the graph still renders the rest.
    }
  }
  return { config, pages };
}

export function formatGraph(config, pages) {
  const planned = config.plannedPages || {};
  const report = summarize(pages, { planned });
  const { graph } = report;
  const title = (id) => graph.byId.get(id)?.title || planned[id]?.title || id;
  const lines = ['Alpha Archive 内容图', ''];

  lines.push(`节点  ${report.nodes} 已收录 + ${report.planned} 计划`);
  lines.push(
    `关系  ${graph.edges.length} 条声明边；其中 ${report.oneWay.length} 条只有单侧手写，反向链接由页面自动推导`,
  );
  lines.push('');

  lines.push('档案号序列（按注册顺序）');
  const byPrefix = new Map();
  for (const page of pages) {
    const match = /^AZ-([A-Z]+)-(\d{3})$/.exec(String(page.archiveId || ''));
    if (!match) continue;
    if (!byPrefix.has(match[1])) byPrefix.set(match[1], []);
    byPrefix.get(match[1]).push({ id: page.id, number: Number(match[2]) });
  }
  if (!byPrefix.size) lines.push('  （没有匹配 AZ-<前缀>-### 的编号）');
  for (const [prefix, items] of byPrefix) {
    const ascending = items.every(
      (item, index) => index === 0 || items[index - 1].number < item.number,
    );
    lines.push(
      `  AZ-${prefix}  ${items.map((item) => `${String(item.number).padStart(3, '0')} ${item.id}`).join(', ')}` +
        (ascending ? '' : '   ← 序号与注册顺序不一致'),
    );
  }
  lines.push('');

  lines.push(
    `父级冲突（${report.issues.filter((issue) => issue.code === 'conflicting-parent').length}）`,
  );
  const conflicts = report.issues.filter((issue) => issue.code === 'conflicting-parent');
  if (!conflicts.length) lines.push('  无');
  for (const issue of conflicts)
    lines.push(`  ${issue.page}：${issue.related.map((id) => `${title(id)}(${id})`).join('、')}`);
  lines.push('');

  const structural = report.issues.filter((issue) => issue.code !== 'conflicting-parent');
  if (structural.length) {
    lines.push('结构错误');
    for (const issue of structural)
      lines.push(`  [${issue.level}] ${issue.page}：${issue.message}`);
    lines.push('');
  }

  lines.push(`两侧重复声明（可删其一，反向由推导补齐）${report.mirrored.length ? '' : '  无'}`);
  for (const pair of report.mirrored)
    lines.push(
      pair.kind === 'parent'
        ? `  ${pair.child}.parent = ${pair.parent}  ↔  ${pair.parent}.subordinates ∋ ${pair.child}`
        : `  ${pair.a}.associates ∋ ${pair.b}  ↔  ${pair.b}.associates ∋ ${pair.a}`,
    );
  lines.push('');

  lines.push(`单向声明（这些页面的反向链接过去是缺失的）${report.oneWay.length ? '' : '  无'}`);
  for (const edge of report.oneWay)
    lines.push(`  ${edge.from} → ${edge.to}（${edge.kind}${edge.type ? `: ${edge.type}` : ''}）`);
  lines.push('');

  lines.push(`孤立页面（无任何关系）${report.orphans.length ? '' : '  无'}`);
  for (const id of report.orphans) lines.push(`  ${id}`);
  return lines.join('\n');
}

if (isMain(import.meta.url)) {
  const { config, pages } = await loadContent();
  console.log(formatGraph(config, pages));
}
