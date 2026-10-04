export function readRoute(location, defaultPage = 'index') {
  const url = new URL(location.href || location);
  const category = url.searchParams.get('category');
  const view = url.searchParams.get('view');
  if (category) return { type: 'category', id: category, hash: url.hash };
  if (view) return { type: 'view', id: view, hash: url.hash };
  return { type: 'page', id: url.searchParams.get('page') || defaultPage, hash: url.hash };
}

export function routeKey(route) {
  return `${route.type}:${route.id}`;
}

export function createRouter({ onRoute, defaultPage = 'index', win = window }) {
  let currentKey = '';
  let timer;
  win.history.scrollRestoration = 'manual';
  const saveScroll = () => {
    win.history.replaceState({ ...win.history.state, scroll: win.scrollY }, '', win.location.href);
  };
  const emit = (source) => {
    const route = readRoute(win.location, defaultPage);
    const key = routeKey(route);
    const samePage = currentKey === key;
    currentKey = key;
    onRoute(route, {
      source,
      samePage,
      scroll: source === 'pop' ? win.history.state?.scroll : undefined,
    });
  };
  const navigate = (href, { replace = false } = {}) => {
    const url = new URL(href, win.location.href);
    if (url.origin !== win.location.origin || url.pathname !== win.location.pathname) return false;
    if (url.href === win.location.href) return true;
    saveScroll();
    win.history[replace ? 'replaceState' : 'pushState']({ scroll: 0 }, '', url);
    emit('navigate');
    return true;
  };
  const onPop = () => emit('pop');
  const onScroll = () => {
    clearTimeout(timer);
    timer = setTimeout(saveScroll, 100);
  };
  win.addEventListener('popstate', onPop);
  win.addEventListener('scroll', onScroll, { passive: true });
  return {
    navigate,
    start() {
      win.history.replaceState(
        { ...win.history.state, scroll: win.scrollY },
        '',
        win.location.href,
      );
      emit('initial');
    },
    destroy() {
      clearTimeout(timer);
      win.removeEventListener('popstate', onPop);
      win.removeEventListener('scroll', onScroll);
    },
  };
}
