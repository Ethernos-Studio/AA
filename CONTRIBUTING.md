# 贡献说明

## 环境与本地流程

使用 Node.js 22.13+ 的 22.x，依赖以 `package-lock.json` 为准：

```sh
npm ci
npm run dev
```

不需要安装依赖也能用 `node scripts/dev.mjs` 查看站点。Bun 可以运行包脚本，但不维护另一份依赖锁。不要将构建产物、测试报告或 `node_modules` 提交到仓库。

提交变更前运行：

```sh
npm run check
npm run graph
npm run build
npm run test:e2e
```

浏览器测试需先准备 Playwright Chromium，首次下载命令见 README。离线限制下逐项记录“已运行 / 未运行 / 失败原因”，不能仅凭静态检查声称测试通过。`build` 的内容校验不能替代 parser、安全净化和浏览器回归测试。

## 内容贡献

1. 先检查 `wiki-config.json` 中是否存在相同 ID，包括 `plannedPages`。
2. 用 `node scripts/new-page.mjs page-id --title "标题" [--category category-id]` 创建新条目。脚手架拒绝覆盖文件、复用 ID、未知分类或危险路径。
3. 编辑 JSON 元数据与 Markdown 正文。JSON 是元数据真源，新的 Markdown 不写 front matter、不重复标题/面包屑。
4. `lastUpdated` 是**现实编辑日期**，如 `2026-10-04`；故事中的 2028/2031 年等日期留在正文/信息框，不以剧情日期冒充编辑时间。
5. 关系只能指向注册页面或显式 `plannedPages` 对象。计划条目不需要伪造 JSON 文件，不进入随机/上一篇/下一篇可用页面列表。
6. 侧栏是人工选编，可选添加；完整目录自动读取注册表。分类成员从页面 JSON 的 `categories` 派生，勿重复维护 `categories.*.pages`。
7. **只写一次**：关系不需要在两侧各写一遍，反向链接由程序推导；`archiveId` 不要填进信息框，用 `{ "label": "编号", "auto": "archiveId" }` 派生；分类祖先链与编号在脚手架里自动生成。手写副本是历史缺陷的来源。
8. `npm run validate` 检查真实日期、字段类型、ID、大小写敏感路径、注册/分类/关系/导航、自定义扩展配对、`archiveId` 前缀与唯一性。跨页结构（自指、上级环、父级冲突）由 `npm run graph` 报告。JSON Schema 为编辑提示，跨文件和实际文件系统约束由 Node 校验器检查。

详细语法和元数据模板见 [PAGE-GUIDE.md](PAGE-GUIDE.md)。脚手架保留 `.new-page.lock` 以防并发创建；只有确认没有创建进程运行时才手工移除崩溃遗留锁。

## 代码与安全

- 使用原生 ESM；模块职责见 [WIKI-DESIGN.md](WIKI-DESIGN.md)。不要复制一份生产 parser 到演示或测试 HTML。
- marked 负责 Markdown；自定义扩展只处理其约定语法，必须尊重代码块、行内代码和转义。
- 解析结果不是可信 HTML。DOMPurify 在 DOM 注入边界净化，文本字段使用 `textContent` 或等效转义；不要增加 inline handler、`javascript:` 链接或任意 HTML 拼接绕过净化。
- “保密等级”和涂黑样式是虚构叙事，无法保护部署到浏览器的秘密。不要向内容、JSON、静态资源或测试夹具写入凭据与真实敏感信息。
- vendor 资源应来自锁定依赖并保留许可证；升级时同时审查包锁、vendor 一致性与安全回归，不添加运行时 CDN 依赖。
- 本地服务器只对环回地址开放；不是生产服务器。构建仅写固定的 `dist/`，不接受任意清理输出目录。
- 新增功能同时补单元/浏览器测试；临时夹具使用系统临时目录，不修改真实内容来测试失败路径。

## PR 与部署

PR 应描述变更、截图（若涉及 UI）、实际检查结果，以及是否改变剧情。CI 使用 `npm ci` 后执行静态/单元检查、浏览器回归和构建；main 上检查成功的 push/手工运行才部署。PR job 仅 `contents: read`，发布权限只在部署 job 开启。工作流只上传 `dist/`，不上传整个仓库。

## Known issues

- **已解决：重复剧情档案号 `AZ-LOC-002`**：根因是同一个编号被写了两遍（`archiveId` 与资料框「编号」）。现已改为：信息框用 `{ "label": "编号", "auto": "archiveId" }` 派生，编号前缀由分类的 `archivePrefix` 声明，脚手架自动取下一个空号，校验器强制格式与唯一性。`grassland-base` 使用 `AZ-LOC-003`，`efgh-alpha` 保持 `AZ-LOC-002`。
- **待编辑确认：父级冲突**：`grassland-base`（`alpha-zone` 与 `efgh`）和计划条目 `sr-3`（`sr-lab` 与 `alpha-zone`）被两个页面同时声明为下属。工具只警告，不改数据——取舍取决于这两条关系在设定中各代表什么。
- **待编辑清理：两侧重复声明**：`npm run graph` 会列出十几处「A 写了一侧、B 又写回另一侧」的冗余。反向链接已能推导，这些可安全删除，但本次未代为删除。
- **外部验证限制**：本次实现只进行了本地工作，未联网核验 GitHub Action 版本或远程 Pages 配置，也未触发部署。工作流采用明确已知的官方主版本；后续维护者可在有网络、得到授权后核验并锁定完整提交摘要。不要把该限制写成“CI/线上部署已通过”。
- 旧 `test-blockquote.html` 曾复制一份解析器手测，已删除；其 blockquote 用例由 `tests/markdown.test.js` 导入实际生产模块覆盖。
