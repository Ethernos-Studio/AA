# Alpha Archive Wiki 设计文档

## 1. 概述

### 1.1 项目目标
构建一个基于静态文件的Wiki系统，支持Markdown内容编写和JSON配置驱动，采用深色科幻档案风格UI。

### 1.2 核心特性
- 零后端依赖，纯前端渲染
- Markdown + JSON 双文件驱动
- 模块化组件设计
- 响应式布局支持

---

## 2. 架构设计

### 2.1 文件结构

```
E:\spj\EWD\
├── wiki-engine.html      # 核心引擎 (HTML+CSS+JS)
├── wiki-config.json      # 站点配置
├── wiki-sidebar.json     # 侧边栏配置
├── WIKI-DESIGN.md        # 设计文档
├── rollback-wiki.ps1     # 回滚脚本
└── pages\                # Markdown内容目录
    ├── epun.md
    ├── deworld.md
    ├── alpha-zone.md
    └── wun.md
```

### 2.2 数据流

```
用户请求
    ↓
wiki-engine.html 加载
    ↓
并行加载 wiki-config.json + wiki-sidebar.json
    ↓
根据配置预加载 pages/*.md
    ↓
解析Markdown → 渲染HTML
    ↓
注入DOM + 绑定事件
```

### 2.3 模块划分

| 模块 | 职责 | 复杂度 |
|------|------|--------|
| ConfigLoader | 加载/验证JSON配置 | O(1) |
| MarkdownParser | 解析自定义MD语法 | O(n) |
| ComponentRenderer | 渲染UI组件 | O(n) |
| NavigationManager | 处理页面导航 | O(1) |
| SearchEngine | 全文搜索 | O(n) |

---

## 3. 配置规范

### 3.1 wiki-config.json

```typescript
interface WikiConfig {
  siteName: string;           // 站点名称
  domain: string;             // 域名显示
  defaultPage: string;        // 默认页面ID
  footer: string;             // 页脚文本
  pages: PageConfig[];        // 页面列表
}

interface PageConfig {
  id: string;                 // 唯一标识
  title: string;              // 页面标题
  subtitle: string;           // 副标题
  archiveId: string;          // 归档编号
  clearance: string;          // 保密等级
  lastUpdated: string;        // 更新日期
  tags: string[];             // 标签列表
  banner: BannerConfig;       // 横幅配置
  infobox: InfoboxConfig;     // 信息框配置
}

interface BannerConfig {
  level: string;              // 等级标识
  text: string;               // 显示文本
  meta: string;               // 元信息
  color: "amber" | "red" | "blue" | "green";
}

interface InfoboxConfig {
  title: string;
  fields: Array<{
    label: string;
    value: string;            // 支持HTML
  }>;
}
```

### 3.2 wiki-sidebar.json

```typescript
interface SidebarConfig {
  sections: NavSection[];
}

interface NavSection {
  title: string;
  items: NavItem[];
}

type NavItem =
  | { type: "link"; id: string; title: string }
  | { type: "locked"; title: string }
  | { type: "subheader"; title: string }
  | { type: "meta"; title: string }
  | { type: "action"; title: string; action: string };
```

---

## 4. Markdown语法规范

### 4.1 标准语法支持

| 语法 | 输出 | 示例 |
|------|------|------|
| `## 标题` | `<h2>` | 章节标题 |
| `### 子标题` | `<h3>` | 小节标题 |
| `**粗体**` | `<strong>` | **粗体** |
| `\n\n` | `<p>` | 段落分隔 |

### 4.2 自定义标签

#### 4.2.1 面包屑导航
```markdown
[breadcrumb]
[单体](epun) > [组织](epun) > EPUN
[/breadcrumb]
```

#### 4.2.2 内容区块
```markdown
[section]
## 标题
内容...
[/section]
```

#### 4.2.3 特殊文本样式
```markdown
[redacted]隐藏文本[/redacted]          → 黑色块遮盖
[redacted-text]警告文本[/redacted-text] → 红色高亮
[censored]审查内容[/censored]          → 灰色斜体
[highlight]重点内容[/highlight]        → 琥珀色高亮
[code]代码术语[/code]                  → 等宽字体+背景
```

#### 4.2.4 警告框
```markdown
[warning]
警告标题
警告内容...
[/warning]
```

#### 4.2.5 可折叠区块
```markdown
[collapsible title="标题"]
折叠内容...
[/collapsible]
```

#### 4.2.6 时间线
```markdown
[timeline]
**日期** [key]
事件描述...

**日期**
另一事件...
[/timeline]
```
- `[key]` 标记重要事件（红色节点）

---

## 5. 组件设计

### 5.1 布局组件

#### 5.1.1 页面结构
```
┌─────────────────────────────────────┐
│ Header (固定48px)                    │
├──────────┬──────────────────────────┤
│          │                          │
│ Sidebar  │    Main Content          │
│ (220px)  │    (自适应)               │
│ 固定      │                          │
│          │                          │
├──────────┴──────────────────────────┤
│ Quick Nav (固定底部)                  │
└─────────────────────────────────────┘
```

#### 5.1.2 响应式断点
| 断点 | 行为 |
|------|------|
| < 768px | Sidebar隐藏，QuickNav简化 |
| ≥ 768px | 完整布局 |

### 5.2 UI组件

#### 5.2.1 分级横幅 (ClassBanner)
- 四种颜色主题: amber/red/blue/green
- 左侧等级图标
- 右侧元信息

#### 5.2.2 信息框 (Infobox)
- 浮动右侧 (280px)
- 键值对列表
- 支持内联HTML

#### 5.2.3 时间线 (Timeline)
- 左侧垂直线
- 节点标记普通/关键事件
- 日期 + 描述结构

#### 5.2.4 快速导航 (QuickNav)
- 上一页/下一页按钮
- 页面计数器
- 搜索框
- 随机条目按钮

---

## 6. 状态管理

### 6.1 全局状态
```javascript
const state = {
  config: null,           // 站点配置
  pages: Map<id, page>,   // 页面缓存
  currentPageId: null,    // 当前页面
  history: [],            // 浏览历史
  historyIndex: -1,       // 历史指针
  sidebarData: null       // 侧边栏数据
};
```

### 6.2 导航逻辑
- **loadPage**: 加载指定页面，更新历史
- **prevPage**: 历史后退
- **nextPage**: 历史前进或下一页
- **randomPage**: 随机跳转

### 6.3 缓存策略
- 启动时预加载所有Markdown文件
- 使用Map存储，O(1)查询
- 无缓存失效机制（静态文件假设不变）

---

## 7. 性能优化

### 7.1 加载优化
- 并行加载配置文件
- 异步预加载页面内容
- 加载动画提升感知性能

### 7.2 渲染优化
- 虚拟滚动（未实现，内容量小）
- 防抖搜索 (200ms)
- 事件委托

### 7.3 资源优化
- 内联CSS/JS（单文件部署）
- SVG噪声纹理（Data URI）
- 无外部依赖

---

## 8. 扩展指南

### 8.1 添加新页面

1. 创建 `pages/new-page.md`
2. 在 `wiki-config.json` 的 `pages` 数组添加配置
3. 在 `wiki-sidebar.json` 添加导航项

### 8.2 添加自定义标签

1. 在 `parseMarkdown` 函数添加正则匹配
2. 实现对应的HTML生成逻辑
3. 更新本文档第4节

### 8.3 修改主题色

编辑 `wiki-engine.html` 的 `:root` 变量：
```css
:root {
  --bg: #08080c;
  --accent-amber: #d4a017;
  --accent-red: #c0392b;
  /* ... */
}
```

---

## 9. 安全考虑

### 9.1 XSS防护
- `escapeHtml` 函数转义所有动态内容
- Markdown解析器过滤危险标签
- 配置文件中HTML需手动审核

### 9.2 数据完整性
- JSON解析失败时显示错误页面
- 页面不存在时优雅降级
- 回滚脚本提供快速清理

---

## 10. 浏览器兼容

| 浏览器 | 支持状态 |
|--------|----------|
| Chrome 90+ | 完全支持 |
| Firefox 88+ | 完全支持 |
| Edge 90+ | 完全支持 |
| Safari 14+ | 基本支持 |

---

## 附录A: 文件清单

| 文件 | 大小 | 用途 |
|------|------|------|
| wiki-engine.html | ~25KB | 核心引擎 |
| wiki-config.json | ~3KB | 站点配置 |
| wiki-sidebar.json | ~1KB | 导航配置 |
| pages/*.md | ~2KB each | 内容文件 |

---

## 附录B: 更新日志

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-16 | 1.0.0 | 初始版本 |
