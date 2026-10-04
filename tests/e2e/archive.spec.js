import { test, expect } from '@playwright/test';

const ready = async (page) =>
  expect(page.locator('#mainContent')).toHaveAttribute('aria-busy', 'false');

test('首页、浏览器历史和同页导航保持一致', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await expect(page.locator('#pageTitle')).toHaveText('Alpha Zone');
  await page.locator('#sidebarNav a[href="?page=epun"]').click();
  await ready(page);
  await expect(page.locator('#pageTitle')).toHaveText('EPUN');
  const history = await page.evaluate(() => window.history.length);
  await page.locator('#sidebarNav a[href="?page=epun"]').click();
  expect(await page.evaluate(() => window.history.length)).toBe(history);
  await page.locator('#sidebarNav a[href="?page=deworld"]').click();
  await ready(page);
  await page.goBack();
  await ready(page);
  await expect(page.locator('#pageTitle')).toHaveText('EPUN');
  await page.goForward();
  await ready(page);
  await expect(page.locator('#pageTitle')).toHaveText('DeWorld');
  await page.reload();
  await ready(page);
  await expect(page.locator('#pageTitle')).toHaveText('DeWorld');
});

test('搜索全称、编号与键盘选取', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await expect(page.getByRole('searchbox', { name: '搜索档案' })).toBeVisible();
  const input = page.locator('#searchInput');
  const firstResult = page.locator('#searchResults a').first();
  await input.fill('地球联合国');
  // Assert the result identity, not just the count: a stale list can satisfy a count check.
  await expect(firstResult).toHaveAttribute('href', /\?page=epun$/);
  await expect(page.locator('#searchResults a')).toHaveCount(1);
  await input.press('ArrowDown');
  await expect(firstResult).toBeFocused();
  await page.keyboard.press('Enter');
  await ready(page);
  await expect(page.locator('#pageTitle')).toHaveText('EPUN');
  await input.fill('ADR MK4');
  await expect(firstResult).toHaveAttribute('href', /\?page=adr-mk4$/);
  await input.press('Enter');
  await ready(page);
  await expect(page.locator('#pageTitle')).toContainText('ADR');
  await input.fill('不存在的关键词');
  await expect(page.locator('#searchStatus')).toContainText('没有匹配');
  await input.press('Escape');
  await expect(page.locator('#searchPanel')).toBeHidden();
});

test('慢旧请求不会覆盖新导航', async ({ page }) => {
  await page.route('**/pages/deworld.md', async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
  await page.goto('/?page=epun');
  await ready(page);
  await page.locator('#sidebarNav a[href="?page=deworld"]').click();
  await page.locator('#sidebarNav a[href="?page=sr-lab"]').click();
  await expect(page.locator('#pageTitle')).toHaveText('SR实验室');
  await page.waitForTimeout(1000);
  await expect(page.locator('#pageTitle')).toHaveText('SR实验室');
  await expect(page).toHaveURL(/page=sr-lab/);
});

test('正文首次失败后可以重试', async ({ page }) => {
  let count = 0;
  await page.route('**/pages/epun.md', (route) =>
    ++count === 1 ? route.fulfill({ status: 503, body: 'Unavailable' }) : route.continue(),
  );
  await page.goto('/?page=epun');
  await expect(page.getByRole('heading', { name: '档案暂时无法加载' })).toBeVisible();
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.locator('#pageTitle')).toHaveText('EPUN');
  expect(count).toBe(2);
});

test('稳定章节深链和折叠原生键盘行为', async ({ page }) => {
  await page.goto('/?page=epun');
  await ready(page);
  const anchor = page.locator('.toc a').last();
  const href = await anchor.getAttribute('href');
  await anchor.click();
  await expect(page).toHaveURL(new RegExp(href.split('#')[1]));
  await page.reload();
  await ready(page);
  const id = decodeURIComponent(href.split('#')[1]);
  expect(
    await page.evaluate((value) => document.getElementById(value).getBoundingClientRect().top, id),
  ).toBeGreaterThanOrEqual(80);
  await page.goto('/?page=grassland-base');
  await ready(page);
  const summary = page.locator('summary').first();
  if (await summary.count()) {
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(summary.locator('..')).toHaveAttribute('open', '');
  }
});

test('移动菜单焦点、关闭与待收录页面', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await ready(page);
  const menu = page.locator('#menuToggle');
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#closeMenu')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await menu.click();
  await page.locator('#sidebarNav a[href="?page=sr-3"]').click();
  await expect(page.locator('.state-label')).toHaveText('待收录档案');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  expect(await page.locator('#sidebar').evaluate((el) => el.inert)).toBe(true);
});

test('所有档案可读且无扩展标签泄漏', async ({ page, request }) => {
  const config = await (await request.get('/wiki-config.json')).json();
  for (const { id } of config.pageRegistry) {
    await page.goto(`/?page=${id}`);
    await ready(page);
    await expect(page.locator('.article-content')).toBeVisible();
    const text = await page.locator('.article-content').innerText();
    expect(text).not.toMatch(
      /\[\/?(?:section|redacted|redacted-text|timeline|key|collapsible|censored|warning)\b[^\]]*\]/,
    );
    expect(text.length).toBeGreaterThan(30);
  }
});

test('危险富文本和链接被清洗', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const html = await page.evaluate(async () => {
    const { sanitizeHtml } = await import('/assets/js/render.js');
    return sanitizeHtml(
      '<img src=x onerror="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)" onclick="alert(1)">危险链接</a><span class="highlight fixed" style="position:fixed">允许文本</span>',
    );
  });
  expect(html).not.toMatch(/onerror|onclick|javascript:|<script|<img|style=|fixed/);
  expect(html).toContain('class="highlight"');
});

test('反向链接与派生编号由页面数据生成', async ({ page }) => {
  // SR实验室 lists DeWorld as 被渗透, but DeWorld never declares SR实验室 back.
  await page.goto('/?page=deworld');
  await ready(page);
  const inbound = page.locator('.relation-inbound');
  await expect(inbound).toBeVisible();
  await expect(inbound.getByRole('link', { name: 'SR实验室' })).toBeVisible();

  // The infobox「编号」reads archiveId instead of repeating the string.
  await page.goto('/?page=grassland-base');
  await ready(page);
  await expect(page.locator('.infobox')).toContainText('AZ-LOC-003');
  const meta = await (await page.request.get('/pages/grassland-base.json')).json();
  expect(meta.archiveId).toBe('AZ-LOC-003');
  expect(meta.infobox.fields.find((field) => field.label === '编号')).toEqual({
    label: '编号',
    auto: 'archiveId',
  });
});

for (const width of [320, 375, 768, 769, 1024, 1440]) {
  test(`${width}px 无整体横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const id of ['index', 'epun', 'alpha-zone', 'adr-mk4']) {
      await page.goto(`/?page=${id}`);
      await ready(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const body = page.locator('.article-body');
      expect((await body.boundingBox()).width).toBeGreaterThan(Math.min(width - 40, 260));
    }
  });
}

test('分类、最近更新、404可继续浏览', async ({ page }) => {
  await page.goto('/?category=clues');
  await ready(page);
  await expect(page.locator('.archive-row')).toHaveCount(1);
  await page.goto('/?view=recent');
  await ready(page);
  await expect(page.locator('.archive-row')).toHaveCount(11);
  await page.goto('/?page=missing');
  await ready(page);
  await expect(page.locator('#pageTitle')).toHaveText('未找到这份档案');
  await page.getByRole('link', { name: '返回首页', exact: true }).click();
  await ready(page);
  await expect(page.locator('#pageTitle')).toHaveText('Alpha Zone');
});
