import { Marked } from '../vendor/marked.js';

const BLOCK_TAGS = new Set(['section', 'warning', 'timeline', 'collapsible', 'breadcrumb']);
const INLINE_CLASSES = {
  redacted: 'redacted',
  'redacted-text': 'redacted-text',
  censored: 'censored',
  highlight: 'highlight',
  code: 'code-term',
};
const BLOCK_START =
  /(?:^|\n) {0,3}\[(?:section|warning|timeline|breadcrumb)\]|(?:^|\n) {0,3}\[collapsible\s+title=(?:"[^"\n]*"|'[^'\n]*')\]/;
const INLINE_START = /\[(?:redacted|redacted-text|censored|highlight|code|key)\]/;

function normalize(source) {
  return String(source ?? '')
    .replace(/^\u{FEFF}/u, '')
    .replace(/\r\n?/g, '\n');
}

function trimBlock(source) {
  // Do not trim indentation: four leading spaces are meaningful Markdown code.
  return source.replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '');
}

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  );
}

function stripFrontmatter(source) {
  const match = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(source);
  // Only consume metadata, not two ordinary thematic breaks around prose.
  return match && /^[ \t]*[\w-]+[ \t]*:/m.test(match[1]) ? source.slice(match[0].length) : source;
}

function readTag(source, offset) {
  const match = /^\[(\/)?([a-z-]+)(?:\s+title=(?:"([^"\n]*)"|'([^'\n]*)'))?\]/.exec(
    source.slice(offset),
  );
  if (!match) return null;
  const [, closing, name, doubleTitle, singleTitle] = match;
  const title = doubleTitle ?? singleTitle;
  if (closing && title !== undefined) return null;
  if (!closing && (name === 'collapsible' ? title === undefined : title !== undefined)) return null;
  return { name, closing: Boolean(closing), title, end: offset + match[0].length };
}

// The pairing scan reads source, never generated HTML. Markdown code, escapes,
// HTML attributes/comments and link destinations cannot open/close directives.
function protectedEnd(source, offset, block) {
  if (block && (offset === 0 || source[offset - 1] === '\n')) {
    const lineEnd = source.indexOf('\n', offset);
    const end = lineEnd < 0 ? source.length : lineEnd + 1;
    const line = source.slice(offset, end);
    // Containers add quote/list prefixes before fences. Strip those prefixes
    // for fence detection only; Marked still owns their actual block parsing.
    const fenceLine = line
      .replace(/^(?: {0,3}>[ \t]?)+/, '')
      .replace(/^ {0,3}(?:[-+*]|\d+[.)])[ \t]+/, '');
    const fence = /^ {0,3}(`{3,}|~{3,})([^\n]*)/.exec(fenceLine);
    if (fence && !(fence[1][0] === '`' && fence[2].includes('`'))) {
      const close = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}[ \\t]*$`);
      let next = end;
      while (next < source.length) {
        const newline = source.indexOf('\n', next);
        const stop = newline < 0 ? source.length : newline;
        const closingLine = source.slice(next, stop).replace(/^(?: {0,3}>[ \t]?)+/, '');
        if (close.test(closingLine)) return newline < 0 ? stop : stop + 1;
        next = stop + 1;
      }
      return source.length;
    }
    if (/^(?: {4}|\t)/.test(fenceLine)) return end;
  }
  if (source[offset] === '\\') return Math.min(offset + 2, source.length);
  if (source[offset] === '`') {
    let length = 1;
    while (source[offset + length] === '`') length++;
    let cursor = offset + length;
    while ((cursor = source.indexOf('`', cursor)) !== -1) {
      let end = cursor + 1;
      while (source[end] === '`') end++;
      if (end - cursor === length) return end;
      cursor = end;
    }
    return offset + length;
  }
  if (source.startsWith('<!--', offset)) {
    const end = source.indexOf('-->', offset + 4);
    return end < 0 ? source.length : end + 3;
  }
  if (source[offset] === '<') {
    const tag = /^<\/?[a-zA-Z][\w:-]*(?:\s+(?:[^<>"']|"[^"]*"|'[^']*')*)?\s*\/?>/.exec(
      source.slice(offset),
    );
    if (tag) {
      const raw = /^<(pre|code|script|style|textarea)(?:\s|>)/i.exec(tag[0]);
      if (raw) {
        const close = new RegExp(`</${raw[1]}\\s*>`, 'ig');
        close.lastIndex = offset + tag[0].length;
        const end = close.exec(source);
        return end ? end.index + end[0].length : source.length;
      }
      return offset + tag[0].length;
    }
  }
  if (source.startsWith('](', offset)) {
    let depth = 1;
    for (let cursor = offset + 2; cursor < source.length; cursor++) {
      if (source[cursor] === '\\') cursor++;
      else if (source[cursor] === '(') depth++;
      else if (source[cursor] === ')' && --depth === 0) return cursor + 1;
    }
  }
  return offset;
}

function pairedTag(source, offset, block) {
  const opening = readTag(source, offset);
  if (
    !opening ||
    opening.closing ||
    (block ? !BLOCK_TAGS.has(opening.name) : !Object.hasOwn(INLINE_CLASSES, opening.name))
  )
    return null;
  // A normal Markdown link named [code], etc. is still a normal link.
  if (source[opening.end] === '(') return null;
  const stack = [opening.name];
  for (let cursor = opening.end; cursor < source.length;) {
    const protectedTo = protectedEnd(source, cursor, block);
    if (protectedTo > cursor) {
      cursor = protectedTo;
      continue;
    }
    const tag = source[cursor] === '[' ? readTag(source, cursor) : null;
    if (tag && (block ? BLOCK_TAGS.has(tag.name) : Object.hasOwn(INLINE_CLASSES, tag.name))) {
      if (!tag.closing && source[tag.end] === '(') {
        cursor = tag.end;
        continue;
      }
      if (tag.closing) {
        if (stack.at(-1) !== tag.name) return null;
        stack.pop();
        if (!stack.length)
          return { ...opening, body: source.slice(opening.end, cursor), end: tag.end };
      } else {
        stack.push(tag.name);
      }
      cursor = tag.end;
    } else cursor++;
  }
  return null;
}

function timelineParts(source) {
  const dates = [];
  for (let cursor = 0; cursor < source.length;) {
    const protectedTo = protectedEnd(source, cursor, true);
    if (protectedTo > cursor) {
      cursor = protectedTo;
      continue;
    }
    if (cursor === 0 || source[cursor - 1] === '\n') {
      const end = source.indexOf('\n', cursor);
      const stop = end < 0 ? source.length : end;
      const line = source.slice(cursor, stop);
      // A date is the existing archive convention: one standalone bold line.
      // Continuation paragraphs and lists stay with the preceding date.
      if (/^ {0,3}(?:\[key\][ \t]*)?\*\*.+\*\*(?:[ \t]*\[key\])?[ \t]*$/.test(line)) {
        dates.push({ start: cursor, end: stop, date: line.trim() });
        cursor = stop + 1;
        continue;
      }
    }
    if (source[cursor] === '[') {
      const nested = pairedTag(source, cursor, true);
      if (nested) {
        cursor = nested.end;
        continue;
      }
    }
    cursor++;
  }
  if (!dates.length) return { prefix: source, items: [] };
  return {
    prefix: source.slice(0, dates[0].start),
    items: dates.map((date, index) => ({
      date: date.date,
      body: trimBlock(source.slice(date.end, dates[index + 1]?.start ?? source.length)),
    })),
  };
}

function decodeEntities(text) {
  const names = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    mdash: '—',
    ndash: '–',
    hellip: '…',
    copy: '©',
    reg: '®',
    trade: '™',
  };
  return text.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (entity, name) => {
    if (name[0] !== '#') return names[name] ?? entity;
    const value =
      name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
      ? String.fromCodePoint(value)
      : '�';
  });
}

function tokenText(tokens) {
  return tokens
    .map((token) => {
      if (token.type === 'html') return token.text.replace(/<[^>]*>/g, '');
      if (token.type === 'br') return ' ';
      if (token.tokens) return tokenText(token.tokens);
      return token.text ?? token.raw ?? '';
    })
    .join('');
}

/** Stable base slug. parseMarkdown adds -2, -3, etc. to avoid document collisions. */
export function headingSlug(text) {
  const slug = String(text)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return `section-${slug || 'heading'}`;
}

function createParser() {
  const state = {
    toc: [],
    breadcrumb: '',
    hasBreadcrumb: false,
    usedIds: new Set(),
    keyTarget: null,
  };
  const marked = new Marked({ gfm: true, breaks: false, async: false });

  marked.use({
    extensions: [
      {
        // Legacy archive prose places full-width punctuation inside bold, with
        // no separating space before the next word. CommonMark intentionally
        // does not treat that closing delimiter as strong emphasis.
        name: 'archiveCjkStrong',
        level: 'inline',
        tokenizer(source) {
          if (!source.startsWith('**') || /\s/.test(source[2] ?? ' ')) return;
          const end = source.indexOf('**', 2);
          if (
            end < 3 ||
            !/[、。！，：；？）】」』》〉〕］｝]/.test(source[end - 1]) ||
            !/[\p{L}\p{N}]/u.test(source[end + 2] ?? '')
          )
            return;
          const text = source.slice(2, end);
          if (text.includes('\n')) return;
          return {
            type: 'strong',
            raw: source.slice(0, end + 2),
            text,
            tokens: this.lexer.inlineTokens(text),
          };
        },
      },
      {
        name: 'archiveBlock',
        level: 'block',
        start(source) {
          return source.match(BLOCK_START)?.index;
        },
        tokenizer(source) {
          const indent = /^ {0,3}(?=\[)/.exec(source);
          if (!indent) return;
          const pair = pairedTag(source, indent[0].length, true);
          if (!pair) return;
          const token = {
            type: 'archiveBlock',
            raw: source.slice(0, pair.end),
            name: pair.name,
            tokens: [],
          };
          const body = trimBlock(pair.body);
          if (pair.name === 'breadcrumb') token.tokens = this.lexer.inline(body.trim());
          else if (pair.name === 'warning') {
            const newline = body.indexOf('\n');
            token.label = this.lexer.inline(newline < 0 ? body : body.slice(0, newline));
            token.tokens = this.lexer.blockTokens(
              newline < 0 ? '' : trimBlock(body.slice(newline + 1)),
            );
          } else if (pair.name === 'timeline') {
            const parts = timelineParts(body);
            token.tokens = this.lexer.blockTokens(parts.prefix);
            token.items = parts.items.map((item) => ({
              date: this.lexer.inline(item.date),
              tokens: this.lexer.blockTokens(item.body),
            }));
          } else {
            if (pair.name === 'collapsible') token.title = this.lexer.inline(pair.title);
            token.tokens = this.lexer.blockTokens(body);
          }
          return token;
        },
        renderer(token) {
          if (token.name === 'breadcrumb') {
            if (state.hasBreadcrumb) return `<p>${escapeHtml(token.raw)}</p>\n`;
            state.hasBreadcrumb = true;
            state.breadcrumb = this.parser.parseInline(token.tokens);
            return '';
          }
          if (token.name === 'section')
            return `<section class="article-section">\n${this.parser.parse(token.tokens)}</section>\n`;
          if (token.name === 'warning')
            return `<div class="warning-box"><span class="label">${this.parser.parseInline(token.label)}</span>\n${this.parser.parse(token.tokens)}</div>\n`;
          if (token.name === 'collapsible')
            return `<details class="collapsible"><summary>${this.parser.parseInline(token.title)}</summary>\n<div class="collapsible-body">${this.parser.parse(token.tokens)}</div></details>\n`;
          if (token.name === 'timeline') {
            let html = this.parser.parse(token.tokens);
            for (const item of token.items) {
              const previous = state.keyTarget;
              const current = { key: false };
              state.keyTarget = current;
              const date = this.parser.parseInline(item.date);
              const body = this.parser.parse(item.tokens);
              state.keyTarget = previous;
              html += `<div class="timeline-item${current.key ? ' key' : ''}"><div class="timeline-date">${date}</div>\n${body}</div>\n`;
            }
            return `<div class="timeline">\n${html}</div>\n`;
          }
          return false;
        },
      },
      {
        name: 'archiveInline',
        level: 'inline',
        start(source) {
          return source.match(INLINE_START)?.index;
        },
        tokenizer(source) {
          if (source.startsWith('[key]') && source[5] !== '(' && source[5] !== '[')
            return { type: 'archiveKey', raw: '[key]' };
          const pair = pairedTag(source, 0, false);
          if (!pair) return;
          return {
            type: 'archiveInline',
            raw: source.slice(0, pair.end),
            name: pair.name,
            tokens: this.lexer.inlineTokens(pair.body),
          };
        },
        renderer(token) {
          return `<span class="${INLINE_CLASSES[token.name]}">${this.parser.parseInline(token.tokens)}</span>`;
        },
        childTokens: ['tokens'],
      },
      {
        name: 'archiveKey',
        renderer() {
          if (!state.keyTarget) return '[key]';
          state.keyTarget.key = true;
          return '';
        },
      },
    ],
    renderer: {
      heading({ tokens, depth }) {
        const text = decodeEntities(tokenText(tokens)).replace(/\s+/g, ' ').trim();
        const base = headingSlug(text);
        let id = base;
        let suffix = 2;
        while (state.usedIds.has(id)) id = `${base}-${suffix++}`;
        state.usedIds.add(id);
        state.toc.push({ id, text, level: depth });
        return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
      link(token) {
        const match = /^([\p{L}\p{N}_-]+)(#[^\s]*)?$/u.exec(token.href);
        if (!match) return false;
        const href = `?page=${encodeURIComponent(match[1])}${match[2] ?? ''}`;
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
        return `<a href="${escapeHtml(href)}"${title}>${this.parser.parseInline(token.tokens)}</a>`;
      },
      table(token) {
        const row = (cells, header) =>
          `<tr>${cells
            .map((cell, index) => {
              const tag = header ? 'th' : 'td';
              const align = token.align[index] ? ` class="table-align-${token.align[index]}"` : '';
              return `<${tag}${header ? ' scope="col"' : ''}${align}>${this.parser.parseInline(cell.tokens)}</${tag}>`;
            })
            .join('')}</tr>\n`;
        return `<div class="table-scroll" tabindex="0" role="region" aria-label="表格（可横向滚动）"><table class="wiki-table">\n<thead>\n${row(token.header, true)}</thead>\n<tbody>\n${token.rows.map((cells) => row(cells, false)).join('')}</tbody>\n</table></div>\n`;
      },
    },
  });
  return { marked, state };
}

/** Returns UNSANITIZED HTML. The rendering boundary must sanitize html AND breadcrumb. */
export function parseMarkdown(source) {
  const { marked, state } = createParser();
  const html = marked.parse(stripFrontmatter(normalize(source)));
  return { html, toc: state.toc, breadcrumb: state.breadcrumb };
}

/** Inline rich text for metadata fields; also UNSANITIZED (raw HTML is preserved). */
export function parseInline(source) {
  return createParser().marked.parseInline(normalize(source));
}
