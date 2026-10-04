# 页面编写指南

## 一页 = JSON 元数据 + Markdown 正文

`wiki-config.json.pageRegistry` 注册 JSON，JSON 的 `contentFile` 指向 Markdown。**JSON 是元数据唯一真源**，新正文不写 YAML front matter，不重复页标题或自动生成的面包屑。

推荐 ID/新文件名使用小写英文、数字和连字符，如 `new-entry`；ID 全站唯一。JSON 与 Markdown 文件 basename 必须一致，路径使用 `/` 且必须与磁盘大小写完全匹配。历史 `ADR-MK4.json/.md` 保持原名，ID 为 `adr-mk4`。不使用 URL、绝对路径、`..`、反斜杠、符号链接或嵌套目录。

```sh
node scripts/new-page.mjs new-entry --title "新条目" --category organizations
```

脚手架使用现实当天日期，创建两个文件并追加注册表，不覆盖已有内容。`archiveId` 与分类祖先链由脚本派生：`--category organizations` 会同时写入 `entities` 与 `organizations`（后者是前者的子分类），编号取该分类 `archivePrefix` 下的下一个空号，因此不需要也不应手填编号。不自动加入侧栏；按需要在 `wiki-sidebar.json` 手工添加 link。将已声明的 planned 条目转为正式页面时，先从 `plannedPages` 移出该 ID，再运行脚手架。

## 元数据模板

```json
{
  "id": "new-entry",
  "title": "新条目",
  "subtitle": "简短副标题",
  "archiveId": "AZ-ORG-NEW",
  "clearance": "L3",
  "lastUpdated": "2026-10-04",
  "tags": ["组织"],
  "contentFile": "pages/new-entry.md",
  "categories": ["entities", "organizations"],
  "banner": {
    "level": "L3",
    "text": "虚构档案提示，不构成访问控制。",
    "meta": "ARCHIVE",
    "color": "amber"
  },
  "infobox": {
    "title": "Entity Profile",
    "fields": [
      { "label": "编号", "auto": "archiveId" },
      { "label": "状态", "value": "活动" }
    ]
  },
  "relations": {
    "parent": null,
    "subordinates": [],
    "associates": [{ "id": "epun", "type": "关联", "description": "关系说明" }]
  },
  "autoGenerate": {
    "breadcrumb": true,
    "categoryNav": true,
    "relatedPages": true
  },
  "metadata": { "author": "作者", "version": "1.0.0" }
}
```

必需字段：`id`、`title`、`contentFile`。其余字段可按需提供；不要用错误类型或 `null` 替代省略。`lastUpdated` 若提供须为真实有效的 `YYYY-MM-DD` **现实编辑日期**，不是世界观时间；故事日期写在正文或信息框中。最近更新按此字段排序。`archiveId` 是故事档案编号，不等于路由 ID；格式为 `AZ-<前缀>-###`，前缀由页面最具体的分类在 `wiki-config.json` 的 `archivePrefix` 声明，校验器据此检查格式并拒绝重复编号。

`banner.color` 仅 `amber`、`red`、`blue`、`green`。信息框每个字段给 `value`（字符串，可用有限内联 HTML，例如 `<span class="highlight">活动</span>`）**或** `auto`（当前支持 `"archiveId"`，渲染时读取页面自身的编号）。二者只能取其一；同一个编号不要在 `archiveId` 和「编号」行各写一遍。仍需 DOMPurify 净化，不能放脚本/事件属性。正文中的涂黑与分级仅为剧情效果，部署后原文公开可读。

编辑器提示来自 `schemas/*.schema.json` 和 `.vscode/settings.json`。跨文件关系、大小写、真实日期、自定义配对等以 `npm run validate` 为准。

## 注册、分类与关系

在 `wiki-config.json` 注册：

```json
{ "id": "new-entry", "file": "pages/new-entry.json" }
```

`defaultPage` 必须存在于注册表。`all` 和 `recent` 是视图而非伪页面，不创建 `pages/recent.json`。

页面 `categories` 是成员集合，所有值必须已在配置分类树中定义；不要在分类对象重复维护成员 `pages`。分类 `parent`/`subcategories` 应双向一致且无环。

`relations.parent`、`subordinates`、`associates[].id` 指向已有页面，或在配置显式声明的计划条目：

```json
"plannedPages": {
  "future-entry": { "id": "future-entry", "title": "待编写条目" }
}
```

必须是对象而非字符串数组；key 与内部 id 相同。计划条目不能同时在注册表中，不能当作正式条目的可点击导航目标。不要为了消除未知关系错误偷偷生成空白页面，也不要删除剧情关系。

关系只需声明一次，反向链接由页面数据自动推导：`deworld` 的「被引用」会列出所有指向它的档案，即使那些页面才写了这层关系。因此**两侧各写一遍是多余的**——`wun.parent = epun` 与 `epun.subordinates ∋ wun` 是同一件事，保留一处即可。

`parent` 是父级的权威写法：已注册页面把父级写在**子页**的 `relations.parent`，父页不必再在 `subordinates` 里重复。`subordinates` 保留给**计划条目**——它们没有 JSON 文件，无法自行声明父级。`npm run graph` 会列出可以删除的重复声明，以及被多个页面同时声明为下属的条目（这类冲突只警告，不阻断构建，因为"位于该区域内"与"由该组织管辖"在本设定中是两回事）。

侧栏常用项：

```json
{ "type": "link", "id": "new-entry", "title": "新条目" }
{ "type": "action", "action": "all", "url": "?view=all", "title": "全部条目" }
{ "type": "action", "action": "recent", "url": "?view=recent", "title": "最近更新" }
{ "type": "locked", "title": "未开放档案" }
```

上面每行为独立对象示例，应放入相应 section 的 `items` 数组。

## 普通 Markdown 优先

不需要把每段都包进自定义标签。标准标题、粗体、斜体、引用、列表、链接、表格、围栏代码均由 marked 处理：

````markdown
## 概述

普通段落与 **重点**。

> 档案引用

- 第一项
- 第二项

[EPUN](?page=epun)
[全部条目](?view=all)
[组织分类](?category=organizations)

```text
这里的 [section] 只是代码，不会变成区块。
```
````

旧 `?page=…` 链接继续支持；`?view=all/recent` 和 `?category=…` 用于聚合视图。页内可用 `#标题锚点`；重复标题会生成不同 ID。文件资源链接应使用部署相对路径，避免写死根路径 `/assets/...`，否则仓库子路径部署可能失效。

## 档案扩展

| 语法 | 用途 |
| --- | --- |
| `[redacted]文本[/redacted]` | 涂黑 |
| `[redacted-text]文本[/redacted-text]` | 警告样式 |
| `[censored]文本[/censored]` | 审查标记 |
| `[highlight]文本[/highlight]` | 高亮 |
| `[code]术语[/code]` | 行内代码样式 |

块级标签独占一行，可嵌套并须正确配对：

```markdown
[section]
## 行动记录

[warning]
警告标题
警告内容。
[/warning]

[collapsible title="补充记录"]
支持 **Markdown** 的折叠正文。
[/collapsible]

[timeline]
**2028-09-30** [key]
故事事件，不是 lastUpdated。

**2031-09-24**
后续事件。
[/timeline]
[/section]
```

`[key]` 是时间线关键事件单标记，没有 `[/key]`。`[breadcrumb]…[/breadcrumb]` 仅用于兼容旧内容；新页优先使用 `autoGenerate.breadcrumb`。解析器兼容旧 front matter，但不把它覆盖到 JSON 元数据上。不支持的标签保留为内容，`navbox/categorybox` 不属于扩展契约。

围栏代码、行内反引号代码中的标签不处理；`\[section]` 等转义用于原样显示。不要交叉嵌套，不要遗漏闭合标签。渲染先解析 Markdown/扩展，再在 DOM 注入时净化 HTML，内容不能作为脚本执行。

## 检查清单

- `npm run validate` 没有错误；明确阅读 warnings。
- `npm run graph` 查看全站关系图：单向声明、可删的重复声明、父级冲突与编号序列。
- 使用 `npm run dev` 通过 HTTP 预览条目、分类/关系、窄屏导航。
- 更改正文时同步调整现实 `lastUpdated`。
- 不更改故事事实来通过工具检查；已解决的编号冲突见 [Known issues](CONTRIBUTING.md#known-issues)。
