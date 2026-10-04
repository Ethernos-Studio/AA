# Alpha Archive 设计说明

## 目标与边界

这是公开的静态 Wiki，不是访问控制系统。档案等级、涂黑和锁定条目属于架空剧情及 UI 状态，不能保护原文。运行站点只需要 HTTP 静态托管；Node.js 22.13+ 的 22.x 用于本地工具与测试，不是服务端业务依赖。

没有 SPA 框架或生产 JS 打包步骤；HTML、CSS、原生 ESM、JSON、Markdown 与锁定的浏览器 vendor 资源直接部署。新功能优先保持轻量模块边界，不在单个 `index.html` 中重新聚合所有逻辑。

## 文件与职责

| 文件/模块 | 职责 |
| --- | --- |
| `index.html` | 语义结构、静态 UI 容器、ESM 入口 |
| `assets/styles.css` | 档案主题、布局、窄屏、状态样式 |
| `assets/js/app.js` | 启动协调、事件绑定与页面状态 |
| `assets/js/router.js` | URL 解析、页面/视图/分类导航和浏览器历史 |
| `assets/js/render.js` | 页面/聚合视图 DOM、净化边界和组件渲染 |
| `assets/js/content-store.js` | 配置、元数据、正文懒加载与缓存 |
| `assets/js/search.js` | 搜索匹配与结果模型 |
| `assets/js/markdown.js` | marked 上的档案扩展、标题锚点和目录数据 |
| `assets/js/graph.js` | 关系图推导：反向链接、编号前缀、无 DOM 依赖的冲突检测，浏览器与 Node 共用 |
| `assets/vendor/` | 本地锁定 marked/DOMPurify 及许可证 |
| `wiki-config.json` | 注册表、默认页、分类树、显式计划条目 |
| `wiki-sidebar.json` | 人工策划的导航与剧情锁定项 |
| `pages/*.json` | 真实元数据源 |
| `pages/*.md` | 正文 |
| `scripts/` | Node 标准库预览、校验、构建、脚手架；vendor 同步/检查 |
| `schemas/` | 编辑器 JSON Schema；不替代跨文件校验 |
| `tests/` | 导入实际模块的单元测试和浏览器回归 |

## 数据与路由

启动读取配置、侧栏与注册页 JSON，正文只在访问或需要搜索时按需加载。内容存储复用缓存与正在进行的请求，路由负责当前意图，不能让较慢的旧请求覆盖后来导航。

- `?page=epun` 延续旧页面 URL。
- `?view=all` 汇总正式注册条目；`?view=recent` 按现实编辑字段 `lastUpdated` 组织。
- `?category=organizations` 根据页面 JSON `categories` 计算成员，不重复维护另一份分类成员列表。
- 没有匹配的路由/资源应给出明确状态，不无限显示加载画面或静默转为错误页面内容。
- 查询路由与相对资源 URL 支持根路径和 `/preview/` 等仓库子路径部署。

`plannedPages` 严格为 `{ "id": { "id": "id", "title": "显示名" } }` 对象。它只解释已知但未编写的关系目标，不伪造正式页面。默认页和正常侧栏 link 必须指向注册页面。页面唯一 ID 与剧情 `archiveId` 是不同概念。

## 派生数据，不重复录入

同一个事实只应写一次。以下内容由页面 JSON 推导，而不是人工维护；手写副本正是缺陷来源——历史上的重复 `archiveId`、大量只有单侧的关联、信息框「编号」与 `archiveId` 各写一遍，都属于这一类。

- **反向链接**：`graph.js` 反转关系图，页面底部的「被引用」列出所有指向本页的声明，包括对方单方面写下的那些。渲染与校验共用同一份推导，两侧不会出现分歧。
- **编号前缀**：`AZ-<前缀>-###` 的前缀由分类在 `wiki-config.json` 的 `archivePrefix` 声明；脚手架按分类派生下一个空号，校验器检查格式与唯一性。
- **分类祖先链**：`--category organizations` 自动写入 `entities → organizations`。
- **信息框派生字段**：`{ "label": "编号", "auto": "archiveId" }` 渲染时读取页面编号，不再复制字符串。

`plannedPages` 是唯一仍需手写的"未来关系"声明，因为计划条目没有 JSON 文件来承载自己的父级。父级冲突（同一页面被两个页面声明为下属）报告为警告而非错误：本设定中"位于该区域内"与"由该组织管辖"是不同断言，取舍属于编辑决定，不应阻断构建。`npm run graph` 输出全站关系图与上述矛盾清单。

## Markdown 与安全边界

JSON 元数据独立于 Markdown 正文。新正文用普通 Markdown，按需使用 `section`、`warning`、`collapsible`、`timeline`、`breadcrumb` 及少量行内扩展。扩展识别尊重代码块、行内代码和转义，支持正确嵌套，不用全局正则轮番重写已生成 HTML。旧 front matter 仅兼容跳过，不覆盖 JSON。

marked 解析 Markdown；解析器返回的 HTML **不是可信输出**。DOMPurify 在渲染注入边界净化正文、手写面包屑和允许富文本的信息框；普通元数据使用文本/安全属性赋值。链接协议、事件属性、危险标签不能借助自定义扩展绕过净化。DOM 净化防 XSS，不提供内容保密。

标题锚点来自文本并处理重复标题；目录与内容由同一次解析生成。时间线基于独立粗体日期行，保留条目中的多段与列表。warning 首行为标签，后续正文继续走 Markdown。详细语法见 [PAGE-GUIDE.md](PAGE-GUIDE.md)。

## 本地工具与产物

- `dev.mjs`：HTTP 仅监听 `127.0.0.1:4173`，支持 `--port`、`--dir`、`--base`。固定站点路由白名单、显式 MIME、`nosniff`；拒绝点段、编码分隔符、符号链接、Windows 路径别名和大小写错误；不提供目录浏览。
- `validate.mjs`：校验类型、真实日期、唯一 ID、存在且精确匹配的路径、注册表/默认页、分类树、关系、侧栏和扩展配对。重复 `archiveId` 一律报错，没有例外名单；`archiveId` 还须匹配其分类声明的 `archivePrefix`。跨页结构（自指、上级环、父级冲突）由 `graph.js` 的审计补充，单看一个文件看不出这些。
- `graph.mjs`：读取全部页面记录并打印关系图——编号序列、父级冲突、可删除的重复声明、单向声明、孤立页面。这就是"能读取所有关系"的那个全局视图。
- `new-page.mjs`：独占创建 JSON/Markdown、登记 registry、防覆盖与创建锁；按分类派生 `archiveId` 与祖先分类链。不会自动创造剧情内容。
- `build.mjs`：先校验，再复制受限站点白名单到固定 `dist/`，可保留真实 `CNAME`。不发布源文档、测试、工具、依赖目录，不接受任意输出路径作递归删除目标。

vendor 资源随站点发布，运行时不请求 CDN；版本由 npm 包锁及 vendor 一致性检查约束。依赖安装统一 `npm ci`，仓库只维护 `package-lock.json`，Bun 可作为命令运行器但不是第二套锁文件来源。

## 验证与发布

Node 单元测试覆盖 parser/数据/工具逻辑，临时目录测试覆盖危险路径、无覆盖写入、坏元数据及部署白名单。浏览器测试负责实际导航、交互、净化与子路径行为。自动化成功与否以运行输出为准，设计文档不宣称某浏览器或 CI 已通过。

GitHub Actions 在 PR、main push、手工触发上运行 `npm ci`、仓库检查、浏览器回归与构建；只有 main 非 PR 且检查通过才上传 `dist/` 并进入部署 job。PR 只读；`pages: write`/`id-token: write` 限制在部署 job。工作流采用已知官方 Action 主版本，未联网核验和未实际远程部署的限制见 [Known issues](CONTRIBUTING.md#known-issues)。
