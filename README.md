# Alpha Archive

游戏《Alpha Zone》的架空世界观 Wiki。静态 HTML + 原生 ESM + JSON/Markdown，无后端、无前端打包器。页面上的“保密等级”“封锁”“未经授权访问”都是剧情表现，**不构成认证或访问控制**；部署后的内容公开可读。

## 本地预览

需要 Node.js 22.13 或更新的 22.x（工具链要求）。查看站点本身不需要安装依赖：

```sh
node scripts/dev.mjs
```

打开 `http://127.0.0.1:4173/`。不能直接双击 `index.html`：ESM 和 JSON/Markdown 的 `fetch` 需要 HTTP。

```sh
node scripts/dev.mjs --port 4174 --base /preview/
node scripts/dev.mjs --dir dist --base /preview/
```

服务只监听 `127.0.0.1`；第二条命令需先构建。部署到仓库子路径时也使用相对资源路径。

## 开发与检查

```sh
npm ci
npm run validate
npm run graph
npm test
npm run lint
npm run format:check
npm run check
npm run build
```

`npm run validate` 检查单个文件与跨文件引用；`npm run graph` 读取全部页面记录，一次看清全站关系——编号序列、可删除的重复声明、单向声明、被多个父级声明的条目。

`package-lock.json` 是唯一依赖锁文件，CI 使用 `npm ci`。Bun 用户可以用 `bun run dev` / `bun run test` 等执行相同脚本；不提交第二份 Bun 锁文件。浏览器 ESM 和 Node 脚本不依赖 Bun 专属 API。

浏览器回归测试需要已安装的 Playwright Chromium：

```sh
npx --no-install playwright install chromium
npm run test:e2e
```

这一步下载浏览器；离线或权限受限时不要执行，不应将“尚未运行”写成测试通过。若下载被代理或网络策略阻断，但本机已装 Chrome 或 Edge，可以复用系统浏览器：

```sh
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e
```

测试使用专用端口 `4319` 并启动自己的服务器，以免复用到同端口的其他站点。检查命令的组成以 `package.json` 为准，测试结果以实际输出为准。

## 编辑内容

```sh
node scripts/new-page.mjs new-entry --title "新条目" --category organizations
```

脚手架创建不覆盖的 `pages/new-entry.json` 和 `.md`，追加 `wiki-config.json` 的 `pageRegistry`；侧栏导航可选。元数据 JSON 是标题、分类、关系、现实编辑日期的唯一真源；Markdown 编写正文。详见 [页面指南](PAGE-GUIDE.md) 和 [贡献说明](CONTRIBUTING.md)。

- `?page=epun`：条目旧链接保持兼容。
- `?view=all`、`?view=recent`：全部条目、按现实 `lastUpdated` 排序的最近更新。
- `?category=organizations`：分类视图。
- 正文支持普通 Markdown 及档案风格扩展；marked 解析后由 DOMPurify 净化，不将内容视作可执行脚本。
- 条目页的「被引用」由关系数据自动推导：同一层关系只写一次，反向链接由程序补齐，正文里看不到的手写副本不需要维护。

## 结构

```text
index.html
assets/
  styles.css
  js/{app,router,render,content-store,search,markdown,graph}.js
  vendor/                  # 锁定的 marked / DOMPurify 浏览器资源及许可证
pages/                     # 每个条目的 JSON + Markdown
wiki-config.json           # 注册表、分类树、plannedPages
wiki-sidebar.json          # 人工策划的可选导航
scripts/                   # Node 标准库预览、校验、构建、脚手架
schemas/                   # 本地 JSON Schema 与编辑器提示
tests/                     # 单元/浏览器回归测试
```

Markdown/DOMPurify 的浏览器 vendor 文件随仓库部署，无运行时 CDN 请求；版本与校验方式见包锁和 vendor 检查脚本。[设计说明](WIKI-DESIGN.md) 记录模块边界。

## 部署

`npm run build` 先校验内容，再只把 `index.html`、`assets/` 内站点资源、`pages/*.json`/`*.md`、两份 Wiki 配置拷贝到固定的 `dist/`；已有真实 `CNAME` 可保留，不生成域名文件。不发布文档、测试、工具和 `node_modules`。

GitHub Actions 对 PR、main push 和手工触发运行检查。只有 main 的非 PR 工作流检查成功后才发布 `dist/` 到 Pages；部署权限仅授予部署 job，PR 保持只读。仓库维护者需自行配置 GitHub Pages 的 Actions 发布来源。本次工具调整没有触发远程部署，也没有联网核验 Action 主版本。

## Known issues

- 档案号唯一性由校验器强制：`npm run validate` 对重复 `archiveId` 报错。`grassland-base` 已由 `AZ-LOC-002` 改为 `AZ-LOC-003`。
- `grassland-base` 被 `alpha-zone` 与 `efgh` 同时声明为下属，`sr-3` 被 `sr-lab` 与 `alpha-zone` 同时声明为下属。这是**内容问题，不是工具错误**：「位于该区域内」与「由该组织管辖」在本设定中是两种断言，采用哪一个需要编辑确认，所以 `npm run graph` 只报告，不擅自改数据。
- `npm run graph` 列出的"两侧重复声明"是历史遗留的手写冗余，可以删除，反向链接会自动补齐；本次没有代为删除，以免混入与任务无关的内容改动。
- 其他检查限制见 [CONTRIBUTING.md](CONTRIBUTING.md#known-issues)。
