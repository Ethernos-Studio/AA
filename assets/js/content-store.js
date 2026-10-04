function storeError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

// Keep requests relative to the document, not to this module or the domain root.
// Decode before checking so encoded traversal and URL schemes cannot bypass it.
function localPath(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw storeError('INVALID_PATH', '内容路径必须是非空的相对路径。');
  }
  let decoded = value;
  try {
    for (let i = 0; i < 5; i += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch (cause) {
    throw storeError('INVALID_PATH', `内容路径编码无效：${value}`, cause);
  }
  if (
    decoded !== decoded.trim() ||
    /[\\?#:%\s]/u.test(decoded) ||
    [...decoded].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    decoded.startsWith('/') ||
    decoded.split('/').includes('..')
  ) {
    throw storeError('INVALID_PATH', `禁止外部地址或目录穿越：${value}`);
  }
  return value;
}

export class ContentStore {
  constructor({ fetcher = globalThis.fetch, timeout = 10000 } = {}) {
    if (typeof fetcher !== 'function') throw new TypeError('ContentStore 需要 fetcher 函数。');
    if (!Number.isFinite(timeout) || timeout <= 0) throw new TypeError('timeout 必须是正数。');
    // Bind so the browser's window.fetch keeps its receiver when stored as a method.
    this.fetcher = (...args) => fetcher(...args);
    this.timeout = timeout;
    this.config = null;
    this.order = [];
    this.pages = new Map();
    this._registry = new Map();
    this._metadataRequests = new Map();
    this._metadataVersions = new Map();
    this._pageRequests = new Map();
    this._pageVersions = new Map();
    this._pageCache = new Map();
    this._initRequest = null;
    this._sidebarRequest = null;
    this._sidebar = null;
  }

  async _request(file, format = 'json') {
    const path = localPath(file);
    const controller = new AbortController();
    let timer;
    const expired = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(storeError('TIMEOUT', `加载超时（${this.timeout}ms）：${path}`));
        controller.abort();
      }, this.timeout);
    });
    try {
      const request = (async () => {
        const response = await this.fetcher(path, { signal: controller.signal, redirect: 'error' });
        if (response.status !== 200) {
          throw storeError('HTTP_ERROR', `加载失败：${path}（HTTP ${response.status}）`);
        }
        return response[format]();
      })();
      return await Promise.race([request, expired]);
    } catch (cause) {
      if (cause?.code === 'HTTP_ERROR' || cause?.code === 'TIMEOUT') throw cause;
      throw storeError(
        'FETCH_ERROR',
        `无法加载 ${path}：${cause?.message || String(cause)}`,
        cause,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async init() {
    if (this.config) return this.config;
    if (this._initRequest) return this._initRequest;
    const request = (async () => {
      const config = await this._request('wiki-config.json');
      if (!config || !Array.isArray(config.pageRegistry)) {
        throw storeError('INVALID_CONFIG', 'wiki-config.json 缺少 pageRegistry 数组。');
      }
      const registry = new Map();
      for (const entry of config.pageRegistry) {
        if (!entry || typeof entry.id !== 'string' || !entry.id || registry.has(entry.id)) {
          throw storeError('INVALID_CONFIG', 'pageRegistry 包含空白或重复的条目 ID。');
        }
        localPath(entry.file);
        registry.set(entry.id, entry.file);
      }
      config.plannedPages ??= {};
      this._registry = registry;
      this.order = [...registry.keys()];
      this.config = config;
      return config;
    })();
    this._initRequest = request;
    try {
      return await request;
    } finally {
      if (this._initRequest === request) this._initRequest = null;
    }
  }

  async loadSidebar() {
    if (this._sidebar) return this._sidebar;
    if (this._sidebarRequest) return this._sidebarRequest;
    const request = this._request('wiki-sidebar.json').then((sidebar) => {
      if (!sidebar || !Array.isArray(sidebar.sections)) {
        throw storeError('INVALID_SIDEBAR', 'wiki-sidebar.json 缺少 sections 数组。');
      }
      this._sidebar = sidebar;
      return sidebar;
    });
    this._sidebarRequest = request;
    try {
      return await request;
    } finally {
      if (this._sidebarRequest === request) this._sidebarRequest = null;
    }
  }

  _requirePage(id) {
    if (!this._registry.has(id)) {
      throw storeError('NOT_FOUND', `未找到条目：${id}`);
    }
  }

  async getMeta(id, { force = false } = {}) {
    await this.init();
    this._requirePage(id);
    return this._loadMeta(id, force, true);
  }

  async _loadMeta(id, force, invalidatePage) {
    if (!force) {
      if (this._metadataRequests.has(id)) return this._metadataRequests.get(id);
      if (this.pages.has(id)) return this.pages.get(id);
    }
    const version = (this._metadataVersions.get(id) || 0) + 1;
    this._metadataVersions.set(id, version);
    // A metadata refresh also invalidates any older full-page request/cache.
    if (force && invalidatePage) {
      this._pageVersions.set(id, (this._pageVersions.get(id) || 0) + 1);
      this._pageRequests.delete(id);
      this._pageCache.delete(id);
    }
    const request = (async () => {
      const metadata = await this._request(this._registry.get(id));
      if (!metadata || metadata.id !== id || typeof metadata.title !== 'string') {
        throw storeError('INVALID_METADATA', `条目元数据无效或 ID 不匹配：${id}`);
      }
      localPath(metadata.contentFile);
      if (this._metadataVersions.get(id) === version) this.pages.set(id, metadata);
      return metadata;
    })();
    this._metadataRequests.set(id, request);
    try {
      return await request;
    } finally {
      if (this._metadataRequests.get(id) === request) this._metadataRequests.delete(id);
    }
  }

  async getPage(id, { force = false } = {}) {
    await this.init();
    this._requirePage(id);
    if (!force) {
      if (this._pageRequests.has(id)) return this._pageRequests.get(id);
      if (this._pageCache.has(id)) return this._pageCache.get(id);
    }
    const version = (this._pageVersions.get(id) || 0) + 1;
    this._pageVersions.set(id, version);
    // A full-page refresh fetches both metadata and content. Version checks
    // keep older requests from overwriting the refreshed result.
    if (force) this._pageCache.delete(id);
    const request = (async () => {
      const metadata = await this._loadMeta(id, force, false);
      const metadataVersion = this._metadataVersions.get(id);
      const content = await this._request(metadata.contentFile, 'text');
      const page = { ...metadata, content };
      if (
        this._pageVersions.get(id) === version &&
        this._metadataVersions.get(id) === metadataVersion &&
        this.pages.get(id) === metadata
      ) {
        this._pageCache.set(id, page);
      }
      return page;
    })();
    this._pageRequests.set(id, request);
    try {
      return await request;
    } finally {
      if (this._pageRequests.get(id) === request) this._pageRequests.delete(id);
    }
  }

  async preloadMetadata() {
    await this.init();
    const results = await Promise.allSettled(this.order.map((id) => this.getMeta(id)));
    const pages = [];
    const errors = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') pages.push(result.value);
      else errors.push({ id: this.order[index], error: result.reason });
    });
    return { pages, errors };
  }

  getOrderedPages() {
    return this.order.filter((id) => this.pages.has(id)).map((id) => this.pages.get(id));
  }

  getCategoryPages(id) {
    const categories = this.config?.categories || {};
    if (!Object.hasOwn(categories, id)) return [];
    const included = new Set([id]);
    const pending = [id];
    while (pending.length) {
      const current = pending.pop();
      const children = new Set(categories[current]?.subcategories || []);
      for (const [key, category] of Object.entries(categories)) {
        if (category.parent === current) children.add(key);
      }
      for (const child of children) {
        if (!included.has(child) && Object.hasOwn(categories, child)) {
          included.add(child);
          pending.push(child);
        }
      }
    }
    return this.getOrderedPages().filter((page) =>
      (page.categories || []).some((category) => included.has(category)),
    );
  }
}
