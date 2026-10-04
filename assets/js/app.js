import { ContentStore } from './content-store.js';
import { searchPages } from './search.js';
import { createRouter, readRoute, routeKey } from './router.js';
import {
  escapeHtml,
  pageUrl,
  renderSidebar,
  renderPage,
  renderIndex,
  renderState,
  refreshRelations,
} from './render.js';

const $ = (id) => document.getElementById(id);
const store = new ContentStore();
const main = $('mainContent');
const search = $('searchInput');
const mobile = matchMedia('(max-width: 760px)');
let router;
let sidebarData;
let currentRoute;
let currentPage;
let navigation = 0;
let metadataPromise;
let metadataErrors = [];
let searchTimer;
let drawerOpen = false;
let drawerReturn;
let renderedKey = '';
const announce = (text) => {
  $('announcer').textContent = text;
};

function paintSidebar() {
  $('sidebarNav').innerHTML = renderSidebar(sidebarData, store, currentRoute);
}

async function ensureMetadata(force = false) {
  if (!metadataPromise || force) {
    metadataPromise = store
      .preloadMetadata()
      .then((result) => {
        metadataErrors = result.errors;
        paintSidebar();
        if (currentPage) {
          const relations = $('relatedContent');
          if (relations) relations.innerHTML = refreshRelations(currentPage, store);
          for (const anchor of main.querySelectorAll('.page-navigation a')) {
            const id = new URL(anchor.href).searchParams.get('page');
            anchor.textContent = store.pages.get(id)?.title || id;
          }
        }
        return result;
      })
      .catch((error) => {
        metadataPromise = null;
        throw error;
      });
  }
  return metadataPromise;
}

function positionContent(route, context) {
  let target;
  if (route.hash) {
    try {
      target = document.getElementById(decodeURIComponent(route.hash.slice(1)));
    } catch {
      /* Invalid encoded anchors are ignored. */
    }
  }
  if (target) {
    let parent = target.parentElement;
    while (parent) {
      if (parent.tagName === 'DETAILS') parent.open = true;
      parent = parent.parentElement;
    }
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start', behavior: 'instant' });
  } else if (context.source === 'pop' && Number.isFinite(context.scroll)) {
    window.scrollTo({ top: context.scroll, behavior: 'instant' });
  } else {
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (context.source !== 'initial') $('pageTitle')?.focus({ preventScroll: true });
  }
}

async function showRoute(route, context = {}, force = false) {
  currentRoute = route;
  const token = ++navigation;
  setDrawer(false, false);
  closeSearch();
  paintSidebar();
  if (!force && context.samePage && renderedKey === routeKey(route)) {
    positionContent(route, context);
    return;
  }
  currentPage = null;
  main.setAttribute('aria-busy', 'true');
  main.innerHTML =
    '<div class="state-panel" role="status"><span class="loading-mark" aria-hidden="true"></span><h1>正在读取档案</h1><p>正文按需加载，请稍候。</p></div>';
  let title;
  try {
    if (route.type === 'page') {
      const planned = store.config.plannedPages?.[route.id];
      if (planned) {
        title = planned.title || route.id;
        main.innerHTML = renderState(
          title,
          '这份资料尚未收录。其他档案中的引用仍被保留，后续编写完成后将可在此阅读。',
          { planned: true },
        );
      } else {
        const page = await store.getPage(route.id, { force });
        if (token !== navigation) return;
        currentPage = page;
        title = page.title;
        main.innerHTML = renderPage(page, store);
      }
    } else {
      await ensureMetadata(force);
      if (token !== navigation) return;
      if (route.type === 'category') {
        const category = store.config.categories[route.id];
        if (!category) throw Object.assign(new Error('分类不存在'), { code: 'NOT_FOUND' });
        title = category.name;
        main.innerHTML = renderIndex(store.getCategoryPages(route.id), store, {
          title,
          description: category.description,
        });
      } else if (['all', 'recent'].includes(route.id)) {
        title = route.id === 'recent' ? '最近更新' : '全部档案';
        main.innerHTML = renderIndex(store.getOrderedPages(), store, {
          title,
          recent: route.id === 'recent',
          description:
            route.id === 'recent' ? '按实际修订日期排列，不是世界观事件发生时间。' : undefined,
        });
      } else throw Object.assign(new Error('页面不存在'), { code: 'NOT_FOUND' });
      if (metadataErrors.length)
        main.insertAdjacentHTML(
          'beforeend',
          '<div class="inline-notice" role="status">部分目录未能加载，当前列表可能不完整。<button type="button" data-action="retry-index">重试目录</button></div>',
        );
    }
    if (token !== navigation) return;
    renderedKey = routeKey(route);
    document.title = `${title} · ${store.config.siteName}`;
    main.setAttribute('aria-busy', 'false');
    announce(`已打开${title}`);
    paintSidebar();
    positionContent(route, context);
    void ensureMetadata().catch(() => {});
  } catch (error) {
    if (token !== navigation) return;
    renderedKey = '';
    title = error.code === 'NOT_FOUND' ? '未找到这份档案' : '档案暂时无法加载';
    main.innerHTML = renderState(
      title,
      error.code === 'NOT_FOUND'
        ? `“${route.id}”不在当前目录中。检查链接，或从完整目录重新查找。`
        : '请求未完成。请检查网络后重试，已加载的其他档案仍可阅读。',
      { retry: error.code !== 'NOT_FOUND' },
    );
    main.setAttribute('aria-busy', 'false');
    document.title = `${title} · Alpha Archive`;
    announce(title);
    positionContent(route, context);
  }
}

function setDrawer(open, restore = true) {
  open = Boolean(open && mobile.matches);
  if (open && !drawerOpen) drawerReturn = document.activeElement;
  const wasOpen = drawerOpen;
  drawerOpen = open;
  document.body.classList.toggle('drawer-open', open);
  $('sidebar').classList.toggle('open', open);
  $('sidebar').inert = mobile.matches && !open;
  $('sidebarBackdrop').hidden = !open;
  $('menuToggle').setAttribute('aria-expanded', String(open));
  $('menuToggle').setAttribute('aria-label', open ? '关闭导航' : '打开导航');
  $('workspace').inert = open;
  $('siteHeader').inert = open;
  if (open) $('closeMenu').focus();
  else if (wasOpen && restore) drawerReturn?.focus();
}

function closeSearch() {
  $('searchPanel').hidden = true;
  search.setAttribute('aria-expanded', 'false');
}

async function updateSearch() {
  const query = search.value.trim();
  $('clearSearch').hidden = !query;
  if (!query) {
    closeSearch();
    return;
  }
  $('searchPanel').hidden = false;
  search.setAttribute('aria-expanded', 'true');
  $('searchStatus').textContent = '正在检索目录…';
  try {
    await ensureMetadata();
  } catch {
    $('searchStatus').textContent = '目录暂时无法读取，请重新搜索。';
    return;
  }
  if (query !== search.value.trim() || $('searchPanel').hidden) return;
  const results = searchPages(store.getOrderedPages(), query);
  $('searchStatus').textContent =
    `${results.length ? `找到 ${results.length} 份档案` : '没有匹配档案，可尝试名称、编号或其他关键词。'}${metadataErrors.length ? ' 部分目录加载失败，结果可能不完整。' : ''}`;
  $('searchResults').innerHTML = results
    .map(
      (page) =>
        `<li><a href="${pageUrl(page.id)}"><strong>${escapeHtml(page.title)}</strong><span>${escapeHtml(page.subtitle || page.archiveId)}</span></a></li>`,
    )
    .join('');
}

function bindEvents() {
  document.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-action]');
    if (action) {
      switch (action.dataset.action) {
        case 'retry':
          await showRoute(currentRoute, { source: 'navigate' }, true);
          break;
        case 'retry-index':
          metadataPromise = null;
          await showRoute(currentRoute, { source: 'navigate' }, true);
          break;
        case 'random': {
          const ids = store.order.filter((id) => id !== 'index' && id !== currentRoute?.id);
          if (ids.length) router.navigate(pageUrl(ids[Math.floor(Math.random() * ids.length)]));
          break;
        }
        case 'print': {
          const closed = [...main.querySelectorAll('details:not([open])')];
          closed.forEach((detail) => {
            detail.open = true;
          });
          window.addEventListener(
            'afterprint',
            () =>
              closed.forEach((detail) => {
                detail.open = false;
              }),
            { once: true },
          );
          window.print();
          break;
        }
        case 'copy-link': {
          try {
            await navigator.clipboard.writeText(location.href);
            announce('链接已复制');
            action.textContent = '已复制链接';
          } catch {
            announce('无法访问剪贴板，请复制浏览器地址栏中的链接。');
            action.textContent = '请复制地址栏链接';
          }
          break;
        }
      }
    }
    const tag = event.target.closest('[data-search]');
    if (tag) {
      search.value = tag.dataset.search;
      search.focus();
      void updateSearch();
    }
    const anchor = event.target.closest('a[href]');
    if (
      anchor &&
      router &&
      event.button === 0 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey &&
      !anchor.hasAttribute('download') &&
      (!anchor.target || anchor.target === '_self')
    ) {
      const url = new URL(anchor.href);
      if (url.origin === location.origin && url.pathname === location.pathname) {
        event.preventDefault();
        if (url.href === location.href) {
          setDrawer(false);
          closeSearch();
        } else router.navigate(url.href);
      }
    }
    if (!event.target.closest('#searchBox')) closeSearch();
  });
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(updateSearch, 120);
  });
  search.addEventListener('focus', () => {
    if (search.value.trim()) void updateSearch();
  });
  $('clearSearch').addEventListener('click', () => {
    search.value = '';
    $('clearSearch').hidden = true;
    closeSearch();
    search.focus();
  });
  $('searchBox').addEventListener('focusout', (event) => {
    if (!$('searchBox').contains(event.relatedTarget)) closeSearch();
  });
  $('searchBox').addEventListener('keydown', (event) => {
    const results = [...$('searchResults').querySelectorAll('a')];
    const index = results.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' && results.length && !$('searchPanel').hidden) {
      event.preventDefault();
      results[(index + 1) % results.length].focus();
    }
    if (event.key === 'ArrowUp' && results.length && !$('searchPanel').hidden) {
      event.preventDefault();
      if (index <= 0) search.focus();
      else results[index - 1].focus();
    }
    if (
      event.key === 'Enter' &&
      document.activeElement === search &&
      results.length &&
      !$('searchPanel').hidden
    ) {
      event.preventDefault();
      router.navigate(results[0].href);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSearch();
      search.focus();
      closeSearch();
    }
  });
  $('menuToggle').addEventListener('click', () => setDrawer(!drawerOpen));
  $('closeMenu').addEventListener('click', () => setDrawer(false));
  $('sidebarBackdrop').addEventListener('click', () => setDrawer(false));
  mobile.addEventListener('change', () => setDrawer(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (drawerOpen) setDrawer(false);
      else closeSearch();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !drawerOpen) {
      event.preventDefault();
      search.focus();
      search.select();
    }
    if (drawerOpen && event.key === 'Tab') {
      const items = [...$('sidebar').querySelectorAll('a[href],button:not([disabled])')];
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  $('readingToggle').addEventListener('click', () => {
    const active = document.body.classList.toggle('reading-mode');
    $('readingToggle').setAttribute('aria-pressed', String(active));
    try {
      localStorage.setItem('alpha-reading-mode', String(active));
    } catch {
      /* Reading still works without storage. */
    }
  });
  try {
    if (localStorage.getItem('alpha-reading-mode') === 'true') {
      document.body.classList.add('reading-mode');
      $('readingToggle').setAttribute('aria-pressed', 'true');
    }
  } catch {
    /* Storage is optional. */
  }
  setDrawer(false);
}

async function boot() {
  try {
    await store.init();
    router = createRouter({
      defaultPage: store.config.defaultPage,
      onRoute: (route, context) => {
        void showRoute(route, context);
      },
    });
    sidebarData = null;
    void store
      .loadSidebar()
      .then((data) => {
        sidebarData = data;
        paintSidebar();
      })
      .catch(() => {
        paintSidebar();
        $('sidebarNav').insertAdjacentHTML(
          'beforeend',
          '<p class="sidebar-warning">导航目录暂时不可用，可通过搜索或全部档案继续阅读。</p>',
        );
      });
    router.start();
  } catch {
    main.setAttribute('aria-busy', 'false');
    main.innerHTML = renderState(
      '站点配置未能加载',
      '请通过 HTTP 服务打开网站，检查网络后重新加载。',
      { retry: true },
    );
    currentRoute = readRoute(location);
    const retry = main.querySelector('[data-action="retry"]');
    retry.removeAttribute('data-action');
    retry.addEventListener(
      'click',
      () => {
        main.setAttribute('aria-busy', 'true');
        void boot();
      },
      { once: true },
    );
  }
}
bindEvents();
void boot();
