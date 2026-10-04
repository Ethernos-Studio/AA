import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseMarkdown, parseInline, headingSlug } from '../assets/js/markdown.js';

const count = (html, pattern) => [...html.matchAll(pattern)].length;
const page = (name) => readFileSync(new URL(`../pages/${name}.md`, import.meta.url), 'utf8');

test('standard Markdown: six headings, emphasis, links, images, breaks and thematic rules', () => {
  const { html, toc } = parseMarkdown(
    [
      '# One',
      '## Two',
      '### Three',
      '#### Four',
      '##### Five',
      '###### Six',
      '',
      '**bold** *italic* ~~deleted~~ `literal` [archive](alpha-zone) [web](https://example.org/a)',
      '',
      '![image](./cover.png "title")',
      '',
      'line  \nbreak',
      '',
      '---',
    ].join('\n'),
  );
  assert.deepEqual(
    toc.map((item) => item.level),
    [1, 2, 3, 4, 5, 6],
  );
  assert.match(
    html,
    /<strong>bold<\/strong> <em>italic<\/em> <del>deleted<\/del> <code>literal<\/code>/,
  );
  assert.match(html, /href="\?page=alpha-zone"/);
  assert.match(html, /href="https:\/\/example.org\/a"/);
  assert.match(html, /<img src="\.\/cover.png" alt="image" title="title">/);
  assert.match(html, /line<br>\s*break/);
  assert.match(html, /<hr>/);
});

test('standard Markdown: nested lists, ordered start, blockquotes and task lists', () => {
  const { html } = parseMarkdown(
    '3. third\n   - inner\n     - deeper\n4. fourth\n\n> quote\n>\n> - quoted\n\n- [x] done\n- [ ] pending',
  );
  assert.match(html, /<ol start="3">/);
  assert.match(html, /<li>third\s*<ul>\s*<li>inner\s*<ul>/);
  assert.match(html, /<blockquote>\s*<p>quote<\/p>\s*<ul>/);
  assert.match(html, /<input[^>]+checked[^>]+disabled/);
  assert.equal(count(html, /type="checkbox"/g), 2);
});

test('tables are accessible scroll regions, keep escaped pipes and inline formatting', () => {
  const { html } = parseMarkdown(
    '| Left | Center | Right |\n| :--- | :---: | ---: |\n| a\\|b | **bold** | [highlight]value[/highlight] |',
  );
  assert.match(
    html,
    /<div class="table-scroll" tabindex="0" role="region" aria-label="[^"\n]+"><table class="wiki-table">/,
  );
  assert.match(html, /<th scope="col" class="table-align-left">Left<\/th>/);
  assert.match(html, /<td class="table-align-center"><strong>bold<\/strong><\/td>/);
  assert.match(html, /<td class="table-align-left">a\|b<\/td>/);
  assert.match(html, /<td class="table-align-right"><span class="highlight">value<\/span><\/td>/);
  assert.doesNotMatch(html, /\sstyle=|\son\w+=/i);
});

test('BOM, CRLF and CR normalize; only actual opening legacy frontmatter is stripped', () => {
  const source = '---\ntitle: Example\nid: example\n---\n[section]\n## 标题\n\n内容\n[/section]';
  const expected = parseMarkdown(source);
  assert.deepEqual(parseMarkdown('﻿' + source.replaceAll('\n', '\r\n')), expected);
  assert.deepEqual(parseMarkdown(source.replaceAll('\n', '\r')), expected);
  assert.doesNotMatch(expected.html, /title:|id:|<hr>/);
  assert.match(parseMarkdown('---\nordinary prose\n\n---').html, /ordinary prose/);
  assert.match(parseMarkdown('---\ntitle: unclosed').html, /title: unclosed/);
  assert.equal(parseMarkdown('---\nid: empty\n---').html, '');
});

test('heading IDs are deterministic, Chinese, unique across nested sections and collision suffixes', () => {
  const source =
    '# **概述**\n\n[section]\n## 概述\n\n### 概述-2\n\n## 概述\n\n## [highlight]资料[/highlight] &amp; `代码`\n\n#### <em>原文</em> &#x4E2D;\n\n##### !!!\n[/section]';
  const first = parseMarkdown(source);
  assert.deepEqual(first, parseMarkdown(source));
  assert.deepEqual(
    first.toc.map((item) => item.id),
    [
      'section-概述',
      'section-概述-2',
      'section-概述-2-2',
      'section-概述-3',
      'section-资料-代码',
      'section-原文-中',
      'section-heading',
    ],
  );
  assert.equal(first.toc[4].text, '资料 & 代码');
  for (const item of first.toc) assert.ok(first.html.includes(`id="${item.id}"`));
  assert.equal(headingSlug('Ａlpha：中文 / 测试'), 'section-alpha-中文-测试');
  assert.equal(parseMarkdown('## 概述').toc[0].id, 'section-概述');
});

test('section, warning and native collapsibles support paired nesting and full block Markdown', () => {
  const { html, toc } = parseMarkdown(
    '[section]\n## 外层\n[warning]\n**警告**\n\n- 保留列表\n\n[collapsible title="细节 &quot;引号&quot;"]\n[section]\n### 内层\n\n正文\n[/section]\n[collapsible title=\'嵌套\']\n另一个正文\n[/collapsible]\n[/collapsible]\n[/warning]\n[/section]',
  );
  assert.equal(count(html, /<section class="article-section">/g), 2);
  assert.equal(count(html, /<details class="collapsible">/g), 2);
  assert.match(html, /<span class="label"><strong>警告<\/strong><\/span>/);
  assert.match(html, /<summary>细节 &quot;引号&quot;<\/summary>/);
  assert.match(html, /<ul>\s*<li>保留列表<\/li>/);
  assert.deepEqual(
    toc.map((item) => item.text),
    ['外层', '内层'],
  );
  assert.doesNotMatch(html, /<p>\s*<(?:section|div|details|ul|h\d)|\son\w+=|\sstyle=/);
});

test('all inline directives support nested brackets, formatting and same-tag nesting', () => {
  const html = parseInline(
    '[redacted]A[/redacted] [redacted-text]B[/redacted-text] [censored][待定][/censored] [highlight]**外**[highlight]*内*[/highlight][/highlight] [code]术语 [链接](efgh)[/code]',
  );
  assert.match(html, /<span class="redacted">A<\/span>/);
  assert.match(html, /<span class="redacted-text">B<\/span>/);
  assert.match(html, /<span class="censored">\[待定\]<\/span>/);
  assert.match(
    html,
    /<span class="highlight"><strong>外<\/strong><span class="highlight"><em>内<\/em><\/span><\/span>/,
  );
  assert.match(html, /<span class="code-term">术语 <a href="\?page=efgh">链接<\/a><\/span>/);
  assert.equal(
    parseInline("<span class='highlight'>原HTML</span>"),
    "<span class='highlight'>原HTML</span>",
  );
});

test('legacy CJK punctuation-adjacent strong remains strong without changing ordinary emphasis', () => {
  const { html } = parseMarkdown(
    '**EPUN（地球联合国）**是机构。**阶段1：开始。**DeWorld行动。\n\n**标准** 普通 *斜体*',
  );
  assert.match(html, /<strong>EPUN（地球联合国）<\/strong>是机构/);
  assert.match(html, /<strong>阶段1：开始。<\/strong>DeWorld行动/);
  assert.match(html, /<strong>标准<\/strong> 普通 <em>斜体<\/em>/);
});

test('timeline keeps continuation paragraphs, lists and nested directives; key never leaks', () => {
  const { html } = parseMarkdown(
    '[timeline]\n前言不丢失\n\n**2030** [key]\n事件 **正文**\n\n- 项目一\n- 项目二\n\n续段必须留在第一项。\n\n[warning]\n提醒\n\n内容\n[/warning]\n\n**2031**\n第二项 [key]\n[/timeline]',
  );
  assert.equal(count(html, /class="timeline-item key"/g), 2);
  assert.equal(count(html, /class="timeline-date"/g), 2);
  assert.match(html, /<p>前言不丢失<\/p>/);
  assert.match(html, /<strong>正文<\/strong>/);
  assert.match(
    html,
    /<ul>[\s\S]*项目一[\s\S]*续段必须留在第一项。[\s\S]*warning-box[\s\S]*timeline-date"><strong>2031/,
  );
  assert.doesNotMatch(html, /\[key\]/);
  assert.equal(parseInline('[key] 普通文本'), '[key] 普通文本');
});

test('timeline code and nested timelines do not create phantom dates or leak key state', () => {
  const { html } = parseMarkdown(
    '[timeline]\n**2030**\n正文\n\n```md\n**2040** [key]\n[/timeline]\n```\n\n[timeline]\n**2000** [key]\n内层\n[/timeline]\n\n**2031**\n续项\n[/timeline]',
  );
  assert.equal(count(html, /class="timeline-date"/g), 3);
  assert.equal(count(html, /class="timeline-item key"/g), 1);
  assert.match(html, /<code class="language-md">\*\*2040\*\* \[key\]\n\[\/timeline\]/);
});

test('breadcrumb is separate inline HTML, bare IDs become page queries, extra breadcrumbs stay visible', () => {
  const { html, breadcrumb } = parseMarkdown(
    '[breadcrumb]\n[单体](epun) > [组织](deworld#section-概述) > 当前\n[/breadcrumb]\n\n## 内容\n\n[breadcrumb]额外内容[/breadcrumb]',
  );
  assert.equal(
    breadcrumb,
    '<a href="?page=epun">单体</a> &gt; <a href="?page=deworld#section-概述">组织</a> &gt; 当前',
  );
  assert.doesNotMatch(html, /href="\?page=epun"/);
  assert.match(html, /\[breadcrumb\]额外内容\[\/breadcrumb\]/);
  const inline = parseInline(
    '[file](./guide.md) [hash](#anchor) [query](?page=efgh) [email](mailto:a@example.org) [reference][ref]\n\n[ref]: alpha-zone',
  );
  assert.match(inline, /href="\.\/guide.md"/);
  assert.match(inline, /href="#anchor"/);
  assert.match(inline, /href="\?page=efgh"/);
  assert.match(inline, /href="mailto:a@example.org"/);
  assert.match(
    parseMarkdown('[reference][ref]\n\n[ref]: alpha-zone').html,
    /href="\?page=alpha-zone"/,
  );
});

test('fenced, indented, inline and escaped code stay literal, including fake closers', () => {
  const { html, toc, breadcrumb } = parseMarkdown(
    '[section]\n## 实际标题\n\n```md\n[/section]\n[breadcrumb]假的[/breadcrumb]\n## 假标题\n[highlight]示例[/highlight]\n```\n\n    [/section]\n    [warning]示例[/warning]\n\n`[redacted]literal[/redacted]` \\[highlight]escaped\\[/highlight]\n\n[highlight]``[/highlight]`` 正文[/highlight]\n[/section]',
  );
  assert.equal(count(html, /<section class="article-section">/g), 1);
  assert.equal(count(html, /<span class="highlight">/g), 1);
  assert.match(html, /<code>\[redacted\]literal\[\/redacted\]<\/code>/);
  assert.match(html, /<span class="highlight"><code>\[\/highlight\]<\/code> 正文<\/span>/);
  assert.match(html, /<pre><code>\[\/section\]\n\[warning\]示例\[\/warning\]/);
  assert.deepEqual(
    toc.map((item) => item.text),
    ['实际标题'],
  );
  assert.equal(breadcrumb, '');
});

test('fences in quotes/lists, tilde fences and initially indented code cannot terminate a section', () => {
  const source =
    '[section]\n    [highlight]indented[/highlight]\n\n> ~~~md\n> [/section]\n> [highlight]quoted[/highlight]\n> ~~~\n\n- ~~~md\n  [/section]\n  [highlight]listed[/highlight]\n  ~~~\n\n真正正文\n[/section]';
  const { html } = parseMarkdown(source);
  assert.equal(count(html, /<section class="article-section">/g), 1);
  assert.equal(count(html, /<pre><code/g), 3);
  assert.doesNotMatch(html, /<span class="highlight">/);
  assert.match(html, /真正正文<\/p>\n<\/section>/);
});

test('references defined outside extension blocks resolve inside their children', () => {
  const { html } = parseMarkdown(
    '[section]\n[archive][ref]\n\n[collapsible title="[more][ref]"]\n[highlight][archive][ref][/highlight]\n[/collapsible]\n[/section]\n\n[ref]: epun',
  );
  assert.equal(count(html, /href="\?page=epun"/g), 3);
  assert.doesNotMatch(html, /\[archive\]|\[more\]|\[ref\]/);
});

test('unknown, unmatched and crossed directives preserve their text instead of guessing repairs', () => {
  for (const source of [
    '[unknown]value[/unknown]',
    '[redacted]not closed',
    '[redacted-text]text[/redacted]',
    '[section]missing',
    '[collapsible]missing title[/collapsible]',
  ]) {
    assert.ok(parseMarkdown(source).html.includes(source), source);
  }
  const crossed = parseInline('[highlight]A[redacted]B[/highlight]C[/redacted]');
  assert.match(crossed, /\[highlight\]/);
  assert.match(crossed, /\[\/redacted\]/);
  const { html } = parseMarkdown('[timeline]\n没有可判断的日期\n\n另一个段落\n[/timeline]');
  assert.match(html, /没有可判断的日期/);
  assert.match(html, /另一个段落/);
  assert.equal(count(html, /class="timeline-item/g), 0);
  const legacy = parseMarkdown('[timeline]\n**[redacted]████** [key]\n成立。\n[/timeline]').html;
  assert.match(legacy, /class="timeline-item key"/);
  assert.match(legacy, /<strong>\[redacted\]████<\/strong>/);
  assert.doesNotMatch(legacy, /\[key\]/);
});

test('Markdown links named after directives remain links and attributes cannot close directives', () => {
  assert.match(
    parseInline('[code](https://example.org) [highlight](alpha-zone)'),
    /<a href="https:\/\/example.org">code<\/a> <a href="\?page=alpha-zone">highlight<\/a>/,
  );
  const { html } = parseMarkdown(
    '[section]\n文本 <span title="[/section]">原文</span>\n\n<!-- [/section] -->\n\n[链接](https://example.org/[/section])\n[/section]',
  );
  assert.equal(count(html, /<section class="article-section">/g), 1);
  assert.match(html, /<span title="\[\/section\]">原文<\/span>/);
  assert.match(html, /href="https:\/\/example.org\/%5B\/section%5D"/);
  assert.ok(html.endsWith('</section>\n'));
});

test('parser contract is explicitly unsanitized; sanitizing belongs to the DOM rendering boundary', () => {
  const source =
    '<img src=x onerror="alert(1)">\n\n<script>alert(2)</script>\n\n[unsafe](javascript:alert(3))';
  const { html } = parseMarkdown(source);
  assert.match(html, /onerror=/);
  assert.match(html, /<script>/);
  assert.match(html, /javascript:/);
  assert.deepEqual(Object.keys(parseMarkdown('')), ['html', 'toc', 'breadcrumb']);
  assert.deepEqual(parseMarkdown(null), { html: '', toc: [], breadcrumb: '' });
});

const regression = {
  'ADR-MK4': { headings: 0, sections: 0, items: 0 },
  'alpha-zone': { headings: 21, sections: 9, items: 10 },
  chronocrystalline: { headings: 24, sections: 7, items: 0 },
  deworld: { headings: 11, sections: 6, items: 10 },
  'efgh-alpha': { headings: 19, sections: 9, items: 6 },
  efgh: { headings: 16, sections: 7, items: 9 },
  epun: { headings: 7, sections: 4, items: 8 },
  'grassland-base': { headings: 12, sections: 6, items: 9 },
  index: { headings: 6, sections: 0, items: 0 },
  'sr-lab': { headings: 15, sections: 8, items: 8 },
  wun: { headings: 11, sections: 6, items: 8 },
};

test('all eleven production Markdown files are represented in the regression corpus', () => {
  const files = readdirSync(new URL('../pages/', import.meta.url))
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.slice(0, -3))
    .sort();
  assert.deepEqual(files, Object.keys(regression).sort());
});

for (const [name, expected] of Object.entries(regression)) {
  test(`production regression: ${name}`, () => {
    const source = page(name);
    const result = parseMarkdown(source);
    assert.equal(result.toc.length, expected.headings);
    assert.equal(new Set(result.toc.map((item) => item.id)).size, expected.headings);
    assert.equal(count(result.html, /class="article-section"/g), expected.sections);
    assert.equal(count(result.html, /class="timeline-item(?: key)?"/g), expected.items);
    const remainingTags =
      result.html.match(
        /\[\/?(?:section|timeline|warning|collapsible|breadcrumb|key|redacted(?:-text)?|censored|highlight|code)\b[^\]]*\]/g,
      ) ?? [];
    assert.deepEqual(remainingTags, []);
    assert.doesNotMatch(
      result.html,
      /<p>\s*<(?:section|div|details|table|ul|ol|h\d)|\son\w+=|\sstyle=/,
    );
    assert.deepEqual(
      parseMarkdown('﻿' + source.replace(/\r\n?/g, '\n').replaceAll('\n', '\r\n')),
      result,
    );
    assert.deepEqual(parseMarkdown(source), result);
    if (name === 'ADR-MK4') {
      assert.match(result.html, /<blockquote>/);
      assert.match(result.html, /<code>EPUN-ADR-MK4/);
      assert.match(result.html, /我忘了是多少/);
    }
    if (name === 'efgh-alpha') {
      const keyItem = /<div class="timeline-item key">([\s\S]*?)<div class="timeline-item">/.exec(
        result.html,
      )?.[1];
      assert.ok(keyItem?.includes('强制上线后，Guardian-7于21:17解密Mr.Li后门'));
      assert.equal(count(result.html, /<details class="collapsible">/g), 3);
    }
    if (name === 'alpha-zone') assert.match(result.html, /<span class="censored">\[待定\]<\/span>/);
  });
}
