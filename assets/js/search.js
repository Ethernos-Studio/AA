export function normalizeSearch(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\p{Z}\s]+/gu, ' ')
    .trim();
}

const SEARCH_FIELDS = [
  ['title', 12],
  ['id', 10],
  ['archiveId', 10],
  ['aliases', 9],
  ['tags', 6],
  ['subtitle', 3],
];

// AND between query tokens, substring matching within each field (including
// short Chinese words). Equal scores retain the caller's registry order.
export function searchPages(pages, query, limit = 20) {
  const normalized = normalizeSearch(query);
  if (!normalized || !Array.isArray(pages)) return [];
  const count = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 20;
  if (!count) return [];
  const tokens = [...new Set(normalized.split(' '))];
  return pages
    .map((page, index) => {
      const fields = SEARCH_FIELDS.flatMap(([key, weight]) => {
        const values = Array.isArray(page[key]) ? page[key] : [page[key]];
        return values.map((value) => ({ value: normalizeSearch(value), weight }));
      });
      let score = 0;
      for (const token of tokens) {
        let best = 0;
        for (const field of fields) {
          if (!field.value.includes(token)) continue;
          const multiplier = field.value === token ? 4 : field.value.startsWith(token) ? 2 : 1;
          best = Math.max(best, field.weight * multiplier);
        }
        if (!best) return { page, index, score: 0 };
        score += best;
      }
      for (const field of fields) {
        if (field.value === normalized) score += field.weight * 8;
        else if (field.value.includes(normalized)) score += field.weight * 2;
      }
      return { page, index, score };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, count)
    .map((result) => result.page);
}
