import DOMPurify from '../vendor/purify.js';
import { backlinks, buildGraph } from './graph.js';
import { parseMarkdown, parseInline } from './markdown.js';

export const escapeHtml = (value = '') =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
export const pageUrl = (id) => `?page=${encodeURIComponent(id)}`;
export const categoryUrl = (id) => `?category=${encodeURIComponent(id)}`;
const allowedClasses = new Set([
  'article-section',
  'section',
  'warning-box',
  'label',
  'timeline',
  'timeline-item',
  'key',
  'timeline-date',
  'timeline-content',
  'redacted',
  'redacted-text',
  'censored',
  'highlight',
  'code-term',
  'collapsible',
  'collapsible-body',
  'table-scroll',
  'table-align-left',
  'table-align-center',
  'table-align-right',
]);
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.hasAttribute?.('class')) {
    const classes = node.className.split(/\s+/).filter((name) => allowedClasses.has(name));
    if (classes.length) node.setAttribute('class', classes.join(' '));
    else node.removeAttribute('class');
  }
  if (node.hasAttribute?.('href')) {
    const href = node.getAttribute('href');
    if (/^(?:https?:)?\/\//i.test(href)) node.setAttribute('rel', 'noopener noreferrer');
  }
});
export function sanitizeHtml(html, inline = false) {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: inline
      ? ['span', 'br', 'strong', 'em', 'b', 'i', 'code', 'a']
      : [
          'p',
          'br',
          'hr',
          'h1',
          'h2',
          'h3',
          'h4',
          'h5',
          'h6',
          'ul',
          'ol',
          'li',
          'blockquote',
          'pre',
          'code',
          'strong',
          'em',
          'b',
          'i',
          'del',
          's',
          'a',
          'span',
          'div',
          'section',
          'table',
          'thead',
          'tbody',
          'tr',
          'th',
          'td',
          'details',
          'summary',
          'time',
        ],
    ALLOWED_ATTR: [
      'id',
      'class',
      'href',
      'title',
      'start',
      'colspan',
      'rowspan',
      'scope',
      'open',
      'tabindex',
      'role',
      'aria-label',
      'datetime',
    ],
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ['style', 'name'],
  });
}
const rich = (text) => sanitizeHtml(parseInline(String(text ?? '')), true);
const link = (id, label, extra = '') =>
  `<a href="${pageUrl(id)}" ${extra}>${escapeHtml(label)}</a>`;

export function renderSidebar(data, store, route) {
  const sections = data?.sections || [
    {
      title: '档案',
      items: [
        { id: 'index', title: '世界观首页' },
        { action: 'all', title: '全部档案', type: 'action' },
      ],
    },
  ];
  return sections
    .map(
      (section) =>
        `<section class="nav-section"><h2>${escapeHtml(section.title)}</h2><ul>${section.items
          .map((item) => {
            if (item.type === 'subheader')
              return `<li class="nav-subheader">${escapeHtml(item.title)}</li>`;
            if (item.type === 'action' && item.action === 'random')
              return `<li><button type="button" class="nav-link" data-action="random">${escapeHtml(item.title)}</button></li>`;
            const href =
              item.url ||
              (item.type === 'action'
                ? `?view=${encodeURIComponent(item.action)}`
                : pageUrl(item.id));
            const current =
              route &&
              ((route.type === 'page' && route.id === item.id) ||
                (route.type === 'view' && route.id === item.action));
            const title = item.title || store.pages.get(item.id)?.title || item.id;
            return `<li><a class="nav-link${current ? ' current' : ''}" href="${escapeHtml(href)}"${current ? ' aria-current="page"' : ''}>${escapeHtml(title)}${item.type === 'locked' ? '<span class="draft-mark">待收录</span>' : ''}</a></li>`;
          })
          .join('')}</ul></section>`,
    )
    .join('');
}

function renderBanner(banner) {
  if (!banner) return '';
  return `<div class="archive-notice"><span class="clearance">${escapeHtml(banner.level || '档案')}</span><p>${escapeHtml(banner.text).replace(/\n/g, '<br>')}<small>世界观设定 · 本条目可公开阅读</small></p></div>`;
}

// `auto` marks a field whose value comes from the page record itself. The
// archive number used to be typed twice — once as `archiveId`, once as an
// infobox「编号」row — and the second copy is what drifts.
function infoboxValue(page, field) {
  if (field.auto === 'archiveId') return escapeHtml(page.archiveId || '');
  return rich(field.value ?? '');
}

function renderInfobox(page) {
  if (!page.infobox) return '';
  return `<section class="infobox" aria-labelledby="profileTitle"><div class="infobox-heading"><h2 id="profileTitle">档案摘要</h2><span class="mono">${escapeHtml(page.clearance || '')}</span></div><dl>${page.infobox.fields.map((field) => `<div><dt>${escapeHtml(field.label)}</dt><dd>${infoboxValue(page, field)}</dd></div>`).join('')}</dl></section>`;
}

// Incoming edges are labelled from this page's point of view: if another page
// declares this one as its parent, that page is a subordinate of this one.
const inboundLabel = { parent: '下属档案', subordinate: '上级档案', associate: '关联档案' };

function renderRelations(page, store) {
  const relations = page.relations || {};
  const groups = [
    ['上级档案', relations.parent ? [{ id: relations.parent }] : []],
    ['下属档案', (relations.subordinates || []).map((id) => ({ id }))],
    ['关联档案', relations.associates || []],
  ];
  const blocks = groups
    .map(([title, entries]) => {
      const valid = entries.filter(
        ({ id }) => store.pages.has(id) || store.config.plannedPages?.[id],
      );
      if (!valid.length) return '';
      return `<div class="relation-group"><h3>${title}</h3><ul>${valid
        .map((item) => {
          const target = store.pages.get(item.id) || store.config.plannedPages[item.id];
          return `<li>${link(item.id, target.title || item.id)}<span>${escapeHtml(item.type || '')}${!store.pages.has(item.id) ? ' · 待收录' : ''}</span>${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}</li>`;
        })
        .join('')}</ul></div>`;
    })
    .filter(Boolean);
  // Relations other pages declare about this one. Many edges are only written
  // on one side, so without this the page hides who points at it.
  const inbound = backlinks(buildGraph(store.getOrderedPages()), page.id);
  if (inbound.length)
    blocks.push(
      `<div class="relation-group relation-inbound"><h3>被引用</h3><p class="relation-hint">其他档案指向本页的关系，由页面数据自动推导</p><ul>${inbound
        .map((edge) => {
          const target = store.pages.get(edge.from) || store.config.plannedPages?.[edge.from];
          const note = [inboundLabel[edge.kind], edge.type].filter(Boolean).join(' · ');
          return `<li>${link(edge.from, target?.title || edge.from)}<span>${escapeHtml(note)}</span></li>`;
        })
        .join('')}</ul></div>`,
    );
  return blocks.length
    ? `<section class="related-section"><h2>继续探索</h2><div class="relations">${blocks.join('')}</div></section>`
    : '';
}

export function renderCategoryLinks(store) {
  return `<div class="category-directory">${Object.values(store.config.categories)
    .filter((cat) => cat.id !== 'entities')
    .map(
      (cat) =>
        `<a href="${categoryUrl(cat.id)}"><span>${escapeHtml(cat.name)}</span><small>${escapeHtml(cat.description)}</small><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></a>`,
    )
    .join('')}</div>`;
}

export function renderPage(page, store) {
  const parsed = parseMarkdown(page.content);
  const home = page.id === 'index';
  const categories = (page.categories || [])
    .map((id) => store.config.categories[id])
    .filter(Boolean);
  const breadcrumb = `<nav class="breadcrumb" aria-label="面包屑">${link('index', '档案首页')}${categories
    .filter((c) => c.id !== 'entities')
    .map(
      (c) =>
        `<span aria-hidden="true">/</span><a href="${categoryUrl(c.id)}">${escapeHtml(c.name)}</a>`,
    )
    .join(
      '',
    )}<span aria-hidden="true">/</span><span aria-current="page">${escapeHtml(page.title)}</span></nav>`;
  const toc = parsed.toc.filter((heading) => heading.level <= 3);
  const index = store.order.indexOf(page.id);
  const previous = store.order[index - 1];
  const next = store.order[index + 1];
  return `<article class="archive-page${home ? ' home-page' : ''}">
    <header class="article-header">${breadcrumb}<div class="article-meta"><span class="mono">${escapeHtml(page.archiveId || 'Alpha Archive')}</span><span>修订于 ${escapeHtml(page.lastUpdated || '未记录')}</span></div><h1 tabindex="-1" id="pageTitle">${escapeHtml(page.title)}</h1><p class="page-subtitle">${escapeHtml(page.subtitle || '')}</p>${home ? '<p class="home-lead">从一份档案，进入阿尔法战区。<br>组织、封锁区与遗留线索，构成这个世界的不同切面。</p><div class="home-actions"><a class="button button-primary" href="?view=all">浏览全部档案</a><a class="button" href="?page=alpha-zone">了解阿尔法地带</a></div>' : renderBanner(page.banner)}</header>
    <aside class="article-aside">${renderInfobox(page)}${toc.length ? `<nav class="toc" aria-label="本页目录"><h2>本页目录</h2><ol>${toc.map((h) => `<li class="toc-level-${h.level}"><a href="${pageUrl(page.id)}#${encodeURIComponent(h.id)}">${escapeHtml(h.text)}</a></li>`).join('')}</ol></nav>` : ''}</aside>
    <div class="article-body">${home ? renderCategoryLinks(store) : ''}<div class="article-content">${sanitizeHtml(parsed.html)}</div><div id="relatedContent">${renderRelations(page, store)}</div>
    ${(page.tags || []).length ? `<div class="tag-list" aria-label="标签">${page.tags.map((tag) => `<button type="button" class="tag" data-search="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join('')}</div>` : ''}
    <div class="article-tools"><button type="button" class="text-button" data-action="copy-link">复制本页链接</button><button type="button" class="text-button" data-action="print">打印档案</button><a href="${escapeHtml(page.contentFile)}" class="text-button">Markdown 原文</a></div>
    <nav class="page-navigation" aria-label="相邻档案">${previous ? link(previous, store.pages.get(previous)?.title || previous, 'class="previous"') : '<span></span>'}${next ? link(next, store.pages.get(next)?.title || next, 'class="next"') : '<span></span>'}</nav>
    </div></article>`;
}

export function refreshRelations(page, store) {
  return renderRelations(page, store);
}

export function renderIndex(
  pages,
  store,
  { title = '全部档案', description = '按分类浏览已收录的世界观资料。', recent = false } = {},
) {
  const sorted = recent
    ? [...pages].sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated))
    : pages;
  return `<section class="index-page"><nav class="breadcrumb" aria-label="面包屑">${link('index', '档案首页')}<span>/</span><span>${escapeHtml(title)}</span></nav><header class="index-header"><h1 id="pageTitle" tabindex="-1">${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><span class="result-count">${sorted.length} 份已收录档案</span></header>${renderCategoryLinks(store)}<div class="archive-list">${sorted.map((page) => `<a class="archive-row" href="${pageUrl(page.id)}"><span class="archive-row-id mono">${escapeHtml(page.archiveId)}</span><span class="archive-row-main"><strong>${escapeHtml(page.title)}</strong><span>${escapeHtml(page.subtitle)}</span></span><span class="archive-row-date">${escapeHtml(page.lastUpdated)}</span></a>`).join('') || '<p class="empty-state">此分类还没有已收录档案。可先浏览其他分类。</p>'}</div></section>`;
}

export function renderState(title, message, { retry = false, planned = false } = {}) {
  return `<section class="state-panel"><span class="state-label">${planned ? '待收录档案' : '档案读取状态'}</span><h1 id="pageTitle" tabindex="-1">${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><div class="state-actions">${retry ? '<button class="button button-primary" data-action="retry" type="button">重新加载</button>' : ''}<a class="button" href="?page=index">返回首页</a><a class="button" href="?view=all">浏览全部档案</a></div></section>`;
}
