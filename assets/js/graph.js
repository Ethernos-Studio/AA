// Derived content graph for the archive.
//
// The browser renderer and the Node validators both import this module, so it
// must stay free of DOM, fetch and Node-only APIs.
//
// The point of this file is that a relation is authored exactly once. Today
// `wun.parent = epun` and `epun.subordinates ∋ wun` say the same thing in two
// places, and 15 of the archive's edges are only written on one side, so the
// other page silently hides who points at it. Everything here is computed from
// the declarations instead of being typed twice.

/** Push into a Map of arrays without repeating the has/else dance. */
function push(map, key, value) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Archive prefix declared by the page's most specific category.
 * Returns null when no category declares one, so callers skip the format check
 * rather than inventing a convention the author never opted into.
 */
export function archivePrefix(config, categories) {
  let prefix = null;
  for (const id of categories || []) {
    const candidate = config?.categories?.[id]?.archivePrefix;
    if (typeof candidate === 'string' && candidate) prefix = candidate;
  }
  return prefix;
}

export const archiveIdPattern = (prefix) => new RegExp(`^AZ-${prefix}-\\d{3}$`);

/** Highest existing number for the prefix, plus one. Null when the prefix is unknown. */
export function nextArchiveId(config, pages, category) {
  const prefix = archivePrefix(config, [category]);
  if (!prefix) return null;
  const pattern = archiveIdPattern(prefix);
  let highest = 0;
  for (const page of pages || []) {
    const match = pattern.exec(String(page?.archiveId || ''));
    if (match) highest = Math.max(highest, Number(match[0].slice(-3)));
  }
  return `AZ-${prefix}-${String(highest + 1).padStart(3, '0')}`;
}

/**
 * Root-first category chain. A page belongs to `entities` *and* `organizations`;
 * both are derived so the ancestor list never has to be retyped per page.
 */
export function categoryChain(config, id) {
  const chain = [];
  const seen = new Set();
  let cursor = id;
  while (typeof cursor === 'string' && !seen.has(cursor) && config?.categories?.[cursor]) {
    seen.add(cursor);
    chain.unshift(cursor);
    cursor = config.categories[cursor].parent;
  }
  return chain;
}

/** Ids this page names itself, in either direction. */
export function declaredIds(page) {
  const relations = page?.relations || {};
  return new Set([
    ...(typeof relations.parent === 'string' && relations.parent ? [relations.parent] : []),
    ...(relations.subordinates || []).filter((id) => typeof id === 'string' && id),
    ...(relations.associates || [])
      .map((item) => item?.id)
      .filter((id) => typeof id === 'string' && id),
  ]);
}

/**
 * Flatten every declaration into directed edges.
 * An edge always means "`from` declares `to` as its <kind>".
 */
export function buildGraph(pages) {
  const list = (pages || []).filter((page) => page && typeof page.id === 'string' && page.id);
  const byId = new Map(list.map((page) => [page.id, page]));
  const edges = [];
  for (const page of list) {
    const relations = page.relations || {};
    if (typeof relations.parent === 'string' && relations.parent)
      edges.push({ from: page.id, to: relations.parent, kind: 'parent' });
    for (const id of relations.subordinates || [])
      if (typeof id === 'string' && id) edges.push({ from: page.id, to: id, kind: 'subordinate' });
    for (const associate of relations.associates || []) {
      if (!associate || typeof associate.id !== 'string' || !associate.id) continue;
      edges.push({
        from: page.id,
        to: associate.id,
        kind: 'associate',
        type: associate.type,
        description: associate.description,
      });
    }
  }
  const outgoing = new Map();
  const incoming = new Map();
  for (const id of byId.keys()) {
    outgoing.set(id, []);
    incoming.set(id, []);
  }
  for (const edge of edges) {
    push(outgoing, edge.from, edge);
    push(incoming, edge.to, edge);
  }
  return { byId, edges, outgoing, incoming };
}

/**
 * Relations other pages declare about `id` that `id` does not declare back.
 * These are exactly the edges that used to be invisible: the page showed what
 * it pointed at, never who pointed at it.
 */
export function backlinks(graph, id) {
  const page = graph.byId.get(id);
  if (!page) return [];
  const declared = declaredIds(page);
  const seen = new Set();
  const result = [];
  for (const edge of graph.incoming.get(id) || []) {
    if (edge.from === id || declared.has(edge.from) || seen.has(edge.from)) continue;
    seen.add(edge.from);
    result.push(edge);
  }
  return result;
}

/** Edges that are written on both sides, so one of the two can be deleted. */
export function mirroredPairs(graph) {
  const pairs = new Map();
  for (const edge of graph.edges) {
    if (edge.kind === 'parent') {
      const parent = graph.byId.get(edge.to);
      if ((parent?.relations?.subordinates || []).includes(edge.from))
        pairs.set(`${edge.to}\u0000${edge.from}`, {
          kind: 'parent',
          child: edge.from,
          parent: edge.to,
        });
    } else if (edge.kind === 'associate') {
      const other = graph.byId.get(edge.to);
      if ((other?.relations?.associates || []).some((item) => item?.id === edge.from)) {
        // Associates are symmetric, so both directions must collapse onto one
        // key rather than reporting the same pair twice.
        const [a, b] = [edge.from, edge.to].sort();
        pairs.set(`a\u0000${a}\u0000${b}`, { kind: 'associate', a, b });
      }
    }
  }
  return [...pairs.values()];
}

/**
 * Structural problems in the declared graph.
 *
 * Only mistakes the author fully controls are errors. A page claimed as a
 * subordinate by two different parents is reported as a warning: the archive
 * genuinely models "inside this region" and "administered by" as different
 * things, and which claim wins is an editorial decision, not a bug to fail on.
 */
export function auditGraph(pages, { planned = {} } = {}) {
  const graph = buildGraph(pages);
  const issues = [];
  const add = (level, code, page, message, related = []) =>
    issues.push({ level, code, page, message, related });

  for (const page of graph.byId.values())
    if (declaredIds(page).has(page.id))
      add('error', 'self-relation', page.id, `把自身 ${page.id} 写成了关系目标`);

  // `parent` is single-valued, so any repeated link in the chain is a mistake.
  for (const page of graph.byId.values()) {
    const seen = [page.id];
    let cursor = page.relations?.parent;
    while (typeof cursor === 'string' && graph.byId.has(cursor)) {
      if (seen.includes(cursor)) {
        add('error', 'parent-cycle', page.id, `上级链形成循环：${[...seen, cursor].join(' → ')}`, [
          cursor,
        ]);
        break;
      }
      seen.push(cursor);
      cursor = graph.byId.get(cursor).relations?.parent;
    }
  }

  const parents = new Map();
  for (const page of graph.byId.values()) {
    const parent = page.relations?.parent;
    if (typeof parent === 'string' && parent) push(parents, page.id, parent);
    for (const id of page.relations?.subordinates || []) push(parents, id, page.id);
  }
  for (const [child, claimants] of parents) {
    const unique = [...new Set(claimants)];
    if (unique.length < 2) continue;
    const label = unique
      .map((id) => graph.byId.get(id)?.title || planned[id]?.title || id)
      .join('、');
    add('warning', 'conflicting-parent', child, `被多个页面声明为下属：${label}`, unique);
  }

  return { graph, issues };
}

/** Human-readable summary used by `npm run graph` and the validator output. */
export function summarize(pages, { planned = {} } = {}) {
  const { graph, issues } = auditGraph(pages, { planned });
  const orphans = [...graph.byId.keys()].filter(
    (id) =>
      !(graph.outgoing.get(id) || []).length &&
      !(graph.incoming.get(id) || []).length &&
      id !== 'index',
  );
  const oneWay = graph.edges.filter((edge) => {
    const other = graph.byId.get(edge.to);
    if (!other) return true;
    return !declaredIds(other).has(edge.from);
  });
  return {
    graph,
    issues,
    orphans,
    oneWay,
    mirrored: mirroredPairs(graph),
    nodes: graph.byId.size,
    planned: Object.keys(planned).length,
  };
}
