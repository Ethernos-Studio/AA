# Page Markdown 文件设计指南

## 1. 文件基础

### 1.1 文件位置
页面内容由两个文件组成：
- **Markdown文件**: `pages/*.md` - 页面正文内容
- **JSON配置文件**: `pages/*.json` - 页面元数据、分类、关联关系

```
pages/
├── epun.md
├── epun.json
├── deworld.md
├── deworld.json
├── alpha-zone.md
├── alpha-zone.json
├── wun.md
└── wun.json
```

### 1.2 文件命名规范
- 使用小写字母
- 单词间用连字符 `-` 连接
- 避免特殊字符和空格
- Markdown与JSON文件名必须一致

| 正确 | 错误 |
|------|------|
| `alpha-zone.md` | `Alpha Zone.md` |
| `sr-lab.md` | `SR_Lab.md` |
| `deworld.md` | `DeWorld!!.md` |

### 1.3 编码要求
- 文件编码: UTF-8
- 换行符: LF 或 CRLF
- 缩进: 2个空格（用于嵌套内容）

---

## 2. JSON配置文件结构

### 2.1 完整模板
```json
{
  "id": "page-id",
  "title": "页面标题",
  "subtitle": "副标题描述",
  "archiveId": "档案编号",
  "clearance": "L3",
  "lastUpdated": "2031-09-24",
  "tags": ["标签1", "标签2"],
  "contentFile": "pages/page-id.md",
  "banner": {
    "level": "L3",
    "text": "保密提示文本",
    "meta": "系列编号",
    "color": "amber"
  },
  "infobox": {
    "title": "信息框标题",
    "fields": [
      { "label": "字段名", "value": "字段值" }
    ]
  },
  "categories": ["父分类", "子分类"],
  "relations": {
    "parent": "上级页面id",
    "subordinates": ["下属页面id1", "下属页面id2"],
    "associates": [
      { "id": "关联页面id", "type": "关系类型", "description": "描述" }
    ]
  },
  "autoGenerate": {
    "breadcrumb": true,
    "categoryNav": true,
    "relatedPages": true
  },
  "metadata": {
    "author": "作者",
    "reviewer": "审核员",
    "version": "1.0.0"
  }
}
```

### 2.2 字段详解

#### 基础信息
| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识，与文件名一致 |
| `title` | string | 是 | 页面主标题 |
| `subtitle` | string | 否 | 副标题描述 |
| `archiveId` | string | 否 | 档案编号如 AZ-ORG-001 |
| `clearance` | string | 否 | 保密等级 L1/L2/L3/L4 |
| `lastUpdated` | string | 否 | 最后更新日期 YYYY-MM-DD |
| `tags` | array | 否 | 标签数组 |
| `contentFile` | string | 是 | 对应Markdown文件路径 |

#### Banner配置
| 字段 | 类型 | 说明 |
|------|------|------|
| `level` | string | 显示等级如 L3 |
| `text` | string | 提示文本，支持换行符 `\n` |
| `meta` | string | 元信息如系列编号 |
| `color` | string | 颜色: amber/red/blue/green |

#### Infobox配置
| 字段 | 类型 | 说明 |
|------|------|------|
| `title` | string | 信息框标题如 Entity Profile |
| `fields` | array | 字段数组，每个含 `label` 和 `value` |

**value支持HTML标签：**
- `<span class='highlight'>高亮</span>`
- `<span class='redacted'>████</span>`
- `<span class='censored'>[审查]</span>`
- `<span class='redacted-text'>警告</span>`

#### 分类系统 (categories)
定义页面在分类树中的位置，从根到叶排列：
```json
"categories": ["entities", "organizations"]
```
表示: 单体 > 组织

#### 关联关系 (relations)
| 字段 | 类型 | 说明 |
|------|------|------|
| `parent` | string/null | 上级页面id |
| `subordinates` | array | 下属页面id数组 |
| `associates` | array | 关联对象数组 |

**associates对象结构：**
```json
{
  "id": "关联页面id",
  "type": "关系类型如敌对/隶属/管辖",
  "description": "关系描述"
}
```

#### 自动生成开关 (autoGenerate)
| 字段 | 类型 | 说明 |
|------|------|------|
| `breadcrumb` | boolean | 自动生成面包屑导航 |
| `categoryNav` | boolean | 自动生成分类导航盒 |
| `relatedPages` | boolean | 自动生成相关条目盒 |

---

## 3. JSON配置示例

### EPUN完整示例
```json
{
  "id": "epun",
  "title": "EPUN",
  "subtitle": "Earth United Nations / 地球联合国 — 超国家封锁联合体",
  "archiveId": "AZ-ORG-001",
  "clearance": "L3",
  "lastUpdated": "2031-09-24",
  "tags": ["组织", "军事", "封锁", "L3"],
  "contentFile": "pages/epun.md",
  "banner": {
    "level": "L3",
    "text": "该文档需 L3 及以上保密权限访问。\n未经授权的扩散将触发[追踪协议]。",
    "meta": "EPUN-WAR-ARCH\nSERIES AZ-ORG",
    "color": "amber"
  },
  "infobox": {
    "title": "Entity Profile",
    "fields": [
      { "label": "编号", "value": "AZ-ORG-001" },
      { "label": "分类", "value": "超国家军事-政治联合体" },
      { "label": "状态", "value": "<span class='highlight'>活跃（封锁阶段）</span>" },
      { "label": "成立", "value": "2028年9月" },
      { "label": "成员国", "value": "20 <span class='censored'>[完整列表需L4权限]</span>" },
      { "label": "总部", "value": "<span class='redacted'>███████</span>" },
      { "label": "关联机构", "value": "WUN, EPUN医疗纵队, 战档司" },
      { "label": "敌对", "value": "DeWorld（净化者/毁灭派）" }
    ]
  },
  "categories": ["entities", "organizations"],
  "relations": {
    "parent": null,
    "subordinates": ["wun"],
    "associates": [
      { "id": "deworld", "type": "敌对", "description": "主要敌对组织" },
      { "id": "alpha-zone", "type": "管辖", "description": "封锁区域" }
    ]
  },
  "autoGenerate": {
    "breadcrumb": true,
    "categoryNav": true,
    "relatedPages": true
  },
  "metadata": {
    "author": "EPUN战档司",
    "reviewer": "L3审核员",
    "version": "2.1.0"
  }
}
```

---

## 4. Markdown文件结构

### 4.1 基础模板
```markdown
[section]
## 概述

页面简介段落...
[/section]

[section]
## 主要章节

### 子章节

内容...
[/section]
```

**注意**: Markdown文件不再包含YAML头，所有元数据移至JSON文件。

### 4.2 与JSON的关联
Wiki引擎通过 `contentFile` 字段关联Markdown：
1. 从 `wiki-config.json` 的 `pageRegistry` 找到页面JSON
2. 从JSON的 `contentFile` 加载Markdown内容
3. 合并渲染：JSON提供元数据，Markdown提供正文

---

## 5. Markdown标签语法

### 5.1 文本样式标签

| 标签 | 效果 | 使用场景 |
|------|------|----------|
| `[redacted]文本[/redacted]` | 黑色遮盖块 | 机密信息 |
| `[redacted-text]文本[/redacted-text]` | 红色警告 | 危险警告 |
| `[censored]文本[/censored]` | 灰色斜体 | 审查内容 |
| `[highlight]文本[/highlight]` | 琥珀色高亮 | 重点强调 |
| `[code]文本[/code]` | 代码样式 | 术语/代码 |

**示例：**
```markdown
EPUN总部位于[redacted]███████[/redacted]。
警告：[redacted-text]开火优先于说话[/redacted-text]
涉及[censored]伪史档案[/censored]的编纂。
决策逻辑：[highlight]收复成本高于土地价值[/highlight]
使用[code]超国家军事指挥权[/code]直接调动。
```

### 5.2 警告框
```markdown
[warning]
警告标题
警告内容，支持多行...
[/warning]
```

### 5.3 可折叠区块
```markdown
[collapsible title="区块标题"]
折叠内容...

支持多行和**粗体**等格式
[/collapsible]
```

### 5.4 时间线
```markdown
[timeline]
**日期或时间段**
事件描述...

**日期** [key]
重要事件描述...
[/timeline]
```

- `[key]` - 标记为关键事件（红色节点）
- 日期用 `**` 包裹
- 事件间用空行分隔

---

## 6. 内容区块

### 6.1 区块语法
```markdown
[section]
## 区块标题

区块内容...
[/section]
```

### 6.2 标题层级

| Markdown | HTML | 用途 |
|----------|------|------|
| `##` | `<h2>` | 主要章节 |
| `###` | `<h3>` | 子章节 |
| `####` | `<h4>` | 小节（不建议使用） |

---

## 7. 完整示例

### epun.json
```json
{
  "id": "epun",
  "title": "EPUN",
  "subtitle": "Earth United Nations / 地球联合国",
  "archiveId": "AZ-ORG-001",
  "clearance": "L3",
  "lastUpdated": "2031-09-24",
  "tags": ["组织", "军事", "L3"],
  "contentFile": "pages/epun.md",
  "banner": {
    "level": "L3",
    "text": "该文档需 L3 及以上保密权限访问。",
    "meta": "EPUN-WAR-ARCH",
    "color": "amber"
  },
  "infobox": {
    "title": "Entity Profile",
    "fields": [
      { "label": "编号", "value": "AZ-ORG-001" },
      { "label": "状态", "value": "<span class='highlight'>活跃</span>" }
    ]
  },
  "categories": ["entities", "organizations"],
  "relations": {
    "parent": null,
    "subordinates": ["wun"],
    "associates": [
      { "id": "deworld", "type": "敌对", "description": "主要敌对组织" }
    ]
  },
  "autoGenerate": {
    "breadcrumb": true,
    "categoryNav": true,
    "relatedPages": true
  },
  "metadata": {
    "author": "EPUN战档司",
    "version": "2.1.0"
  }
}
```

### epun.md
```markdown
[section]
## 概述

**EPUN（地球联合国）**是2028年迪纳科山氢弹事件后，由20个主权国家组成的临时联合决策机构。

与常规国际组织的协商性质不同，EPUN在成立之初即被赋予[code]超国家军事指挥权[/code]。
[/section]

[section]
## 历史时间线

[timeline]
**2028-09-30** [key]
**雪杉行动**。EPUN联合20国发动首次大规模地面反攻...

**2028-12-01** [key]
**冻结与转向**。EPUN正式冻结地面进攻...
[/timeline]
[/section]

[section]
## 组织结构

### 战档司

EPUN的情报与档案中枢...

### WUN 联合部队

联合国常备军/快速反应部队...
[/section]

[section]
## 关键协议

[warning]
警告
以下内容涉及敏感军事协议。
[/warning]

[collapsible title="无救援协议"]
**生效日期**: 2029年6月

1. 任何未经批准的进入视为自动放弃保护
2. 医疗纵队仅在封锁线外执行检疫
[/collapsible]
[/section]
```

---

## 8. 快速参考卡

### JSON配置
```json
{
  "id": "page-id",
  "title": "标题",
  "subtitle": "副标题",
  "archiveId": "编号",
  "clearance": "L3",
  "lastUpdated": "2031-09-24",
  "tags": ["标签1", "标签2"],
  "contentFile": "pages/page-id.md",
  "banner": { "level": "L3", "text": "提示", "meta": "系列", "color": "amber" },
  "infobox": {
    "title": "Profile",
    "fields": [{ "label": "字段", "value": "值" }]
  },
  "categories": ["父分类", "子分类"],
  "relations": {
    "parent": null,
    "subordinates": [],
    "associates": [{ "id": "关联id", "type": "关系", "description": "描述" }]
  },
  "autoGenerate": {
    "breadcrumb": true,
    "categoryNav": true,
    "relatedPages": true
  },
  "metadata": { "author": "作者", "version": "1.0.0" }
}
```

### Markdown内容
```markdown
[section]
## 章节标题

[redacted]隐藏[/redacted]
[redacted-text]警告[/redacted-text]
[censored]审查[/censored]
[highlight]重点[/highlight]
[code]术语[/code]

[warning]
标题
内容
[/warning]

[collapsible title="标题"]
内容
[/collapsible]

[timeline]
**日期** [key]
事件
[/timeline]
[/section]
```
