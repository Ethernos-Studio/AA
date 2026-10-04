import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { archiveIdPattern, archivePrefix, auditGraph } from '../assets/js/graph.js';
import { exactFile, ID_PATTERN, isMain, PROJECT_ROOT } from './paths.mjs';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const tags = new Set([
  'section',
  'warning',
  'collapsible',
  'timeline',
  'breadcrumb',
  'redacted',
  'redacted-text',
  'censored',
  'highlight',
  'code',
]);

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateTags(markdown) {
  const errors = [];
  const stack = [];
  let fence = null;
  const source = markdown
    .split(/\r?\n/)
    .map((line) => {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (
          marker[1][0] === fence[0] &&
          marker[1].length >= fence.length &&
          /^\s*$/.test(line.slice(marker[0].length))
        )
          fence = null;
        return '';
      }
      return fence ? '' : line;
    })
    .join('\n')
    .replace(/(`+)([\s\S]*?)\1/g, (match) => match.replace(/[^\n]/g, ' '));
  for (const match of source.matchAll(/(?<!\\)\[(\/?)([a-z][a-z-]*)([^\]\n]*)\]/g)) {
    const [, closing, name, attributes] = match;
    if (!tags.has(name)) continue;
    const line = source.slice(0, match.index).split('\n').length;
    if (closing) {
      if (attributes.trim() || stack.at(-1)?.name !== name)
        errors.push(`line ${line}: mismatched [/${name}]`);
      else stack.pop();
    } else {
      if (attributes && !attributes.startsWith(' ')) continue;
      stack.push({ name, line });
    }
  }
  for (const tag of stack) errors.push(`line ${tag.line}: unclosed [${tag.name}]`);
  return errors;
}

/** Validate on-disk source content without loading browser dependencies. */
export async function validate({ root = PROJECT_ROOT } = {}) {
  const errors = [];
  const warnings = [];
  const fail = (where, message) => errors.push(`${where}: ${message}`);
  const stringField = (value, key, where, required = false) => {
    if ((required || value[key] !== undefined) && !text(value[key]))
      fail(where, `${key} must be a non-empty string`);
  };
  const strings = (value, where) => {
    if (!Array.isArray(value) || value.some((item) => !text(item))) {
      fail(where, 'must be an array of non-empty strings');
      return [];
    }
    if (new Set(value).size !== value.length) fail(where, 'contains duplicates');
    return value;
  };
  const readJSON = async (relative) => {
    try {
      return JSON.parse(await readFile(await exactFile(root, relative), 'utf8'));
    } catch (error) {
      fail(relative, error.message);
      return null;
    }
  };
  const config = await readJSON('wiki-config.json');
  const sidebar = await readJSON('wiki-sidebar.json');
  if (!object(config)) {
    fail('wiki-config.json', 'must be an object');
    return { ok: false, errors, warnings, pages: [] };
  }
  for (const key of ['siteName', 'defaultPage']) stringField(config, key, 'config', true);
  for (const key of ['domain', 'footer']) stringField(config, key, 'config');
  const registry = Array.isArray(config.pageRegistry) ? config.pageRegistry : [];
  if (!Array.isArray(config.pageRegistry) || !registry.length)
    fail('config.pageRegistry', 'must be a non-empty array');
  const ids = new Set();
  const files = new Set();
  const contentFiles = new Set();
  const pages = [];
  const archives = new Map();
  const categories = object(config.categories) ? config.categories : {};
  if (!object(config.categories)) fail('config.categories', 'must be an object');
  const planned = object(config.plannedPages) ? config.plannedPages : {};
  if (config.plannedPages !== undefined && !object(config.plannedPages))
    fail('config.plannedPages', 'must be an object keyed by ID, not an array');
  for (const [id, entry] of Object.entries(planned)) {
    if (
      !ID_PATTERN.test(id) ||
      !object(entry) ||
      entry.id !== id ||
      !text(entry.title) ||
      Object.keys(entry).some((key) => !['id', 'title'].includes(key))
    )
      fail(`plannedPages.${id}`, 'must be { id, title }, with a matching valid ID');
  }
  for (const [id, category] of Object.entries(categories)) {
    const where = `categories.${id}`;
    if (!object(category)) {
      fail(where, 'must be an object');
      continue;
    }
    if (!ID_PATTERN.test(id) || category.id !== id)
      fail(where, 'id must match its valid category key');
    stringField(category, 'name', where, true);
    stringField(category, 'description', where);
    if (
      category.parent !== null &&
      (typeof category.parent !== 'string' || !Object.hasOwn(categories, category.parent))
    )
      fail(where, 'parent must be null or an existing category ID');
    if (category.parent === id) fail(where, 'cannot be its own parent');
    if (category.subcategories !== undefined)
      for (const child of strings(category.subcategories, `${where}.subcategories`)) {
        if (!object(categories[child]) || categories[child].parent !== id)
          fail(where, `subcategory ${child} must exist and point back to this parent`);
      }
    if (
      typeof category.parent === 'string' &&
      object(categories[category.parent]) &&
      !(
        Array.isArray(categories[category.parent].subcategories) &&
        categories[category.parent].subcategories.includes(id)
      )
    )
      fail(where, 'parent must list this category in subcategories');
    const ancestors = new Set([id]);
    let cursor = category.parent;
    while (typeof cursor === 'string' && object(categories[cursor])) {
      if (ancestors.has(cursor)) {
        fail(where, 'category cycle');
        break;
      }
      ancestors.add(cursor);
      cursor = categories[cursor].parent;
    }
  }
  for (const [index, entry] of registry.entries()) {
    const where = `pageRegistry[${index}]`;
    if (!object(entry) || !text(entry.id) || !ID_PATTERN.test(entry.id)) {
      fail(where, 'must have a valid lower-case page id');
      continue;
    }
    if (ids.has(entry.id)) fail(where, `duplicate page ID ${entry.id}`);
    ids.add(entry.id);
    if (Object.hasOwn(planned, entry.id)) fail(where, 'registered pages cannot also be planned');
    if (
      typeof entry.file !== 'string' ||
      !/^pages\/[A-Za-z0-9][A-Za-z0-9-]*\.json$/.test(entry.file)
    ) {
      fail(where, 'file must be a direct pages/*.json path');
      continue;
    }
    if (files.has(entry.file.toLowerCase())) fail(where, `duplicate metadata path ${entry.file}`);
    files.add(entry.file.toLowerCase());
    const page = await readJSON(entry.file);
    if (!object(page)) {
      fail(entry.file, 'must be a metadata object');
      continue;
    }
    pages.push(page);
    if (page.id !== entry.id) fail(entry.file, 'id must match pageRegistry');
    for (const key of ['title', 'contentFile']) stringField(page, key, entry.file, true);
    for (const key of ['subtitle', 'archiveId', 'clearance']) stringField(page, key, entry.file);
    if (page.lastUpdated !== undefined && !validDate(page.lastUpdated))
      fail(entry.file, 'lastUpdated must be a real YYYY-MM-DD date');
    if (page.tags !== undefined) strings(page.tags, `${entry.file}.tags`);
    if (page.categories !== undefined)
      for (const category of strings(page.categories, `${entry.file}.categories`)) {
        if (!Object.hasOwn(categories, category)) fail(entry.file, `unknown category ${category}`);
      }
    if (page.banner !== undefined) {
      if (!object(page.banner)) fail(entry.file, 'banner must be an object');
      else {
        for (const key of ['level', 'text', 'meta'])
          stringField(page.banner, key, `${entry.file}.banner`);
        if (
          page.banner.color !== undefined &&
          !['amber', 'red', 'blue', 'green'].includes(page.banner.color)
        )
          fail(entry.file, 'invalid banner.color');
      }
    }
    if (page.infobox !== undefined) {
      if (!object(page.infobox)) fail(entry.file, 'infobox must be an object');
      else {
        stringField(page.infobox, 'title', `${entry.file}.infobox`, true);
        if (!Array.isArray(page.infobox.fields))
          fail(entry.file, 'infobox.fields must be an array');
        else
          for (const field of page.infobox.fields) {
            if (!object(field) || !text(field.label)) {
              fail(entry.file, 'infobox fields must have a string label');
            } else if (field.auto !== undefined) {
              if (field.auto !== 'archiveId' || field.value !== undefined)
                fail(entry.file, 'infobox auto must be "archiveId" and must omit value');
            } else if (typeof field.value !== 'string') {
              fail(entry.file, 'infobox fields must have a string value or auto: "archiveId"');
            }
          }
      }
    }
    if (page.autoGenerate !== undefined) {
      if (!object(page.autoGenerate)) fail(entry.file, 'autoGenerate must be an object');
      else
        for (const [key, value] of Object.entries(page.autoGenerate))
          if (
            !['breadcrumb', 'categoryNav', 'relatedPages'].includes(key) ||
            typeof value !== 'boolean'
          )
            fail(entry.file, `invalid autoGenerate.${key}`);
    }
    if (page.metadata !== undefined) {
      if (!object(page.metadata)) fail(entry.file, 'metadata must be an object');
      else
        for (const key of ['author', 'reviewer', 'version'])
          stringField(page.metadata, key, `${entry.file}.metadata`);
    }
    if (text(page.archiveId)) {
      const existing = archives.get(page.archiveId) ?? [];
      archives.set(page.archiveId, [...existing, page.id]);
      // The prefix comes from the page's most specific category, so the format
      // is derived from config instead of being a convention held in the head.
      const prefix = archivePrefix(config, page.categories);
      if (prefix && !archiveIdPattern(prefix).test(page.archiveId))
        fail(entry.file, `archiveId must match AZ-${prefix}-###, the format for its category`);
    }
    if (
      typeof page.contentFile !== 'string' ||
      !/^pages\/[A-Za-z0-9][A-Za-z0-9-]*\.md$/.test(page.contentFile)
    )
      fail(entry.file, 'contentFile must be a direct pages/*.md path');
    else {
      if (contentFiles.has(page.contentFile.toLowerCase()))
        fail(entry.file, 'Markdown files must not be shared by pages');
      contentFiles.add(page.contentFile.toLowerCase());
      if (path.basename(entry.file, '.json') !== path.basename(page.contentFile, '.md'))
        fail(entry.file, 'JSON and Markdown basenames must match exactly');
      try {
        const markdown = await readFile(await exactFile(root, page.contentFile), 'utf8');
        for (const issue of validateTags(markdown)) fail(page.contentFile, issue);
      } catch (error) {
        fail(page.contentFile, error.message);
      }
    }
  }
  if (!ids.has(config.defaultPage)) fail('config.defaultPage', 'must reference a registered page');
  const known = (id, where, allowPlanned = true) => {
    if (
      typeof id !== 'string' ||
      !ID_PATTERN.test(id) ||
      (!ids.has(id) && !(allowPlanned && Object.hasOwn(planned, id)))
    )
      fail(
        where,
        `unknown or invalid page ID ${String(id)}; planned relations require config.plannedPages[id] = { id, title }`,
      );
  };
  for (const page of pages) {
    const where = `page ${page.id}.relations`;
    if (page.relations === undefined) continue;
    if (!object(page.relations)) {
      fail(where, 'must be an object');
      continue;
    }
    const relations = page.relations;
    if (relations.parent !== undefined && relations.parent !== null)
      known(relations.parent, `${where}.parent`);
    if (relations.subordinates !== undefined)
      for (const id of strings(relations.subordinates, `${where}.subordinates`))
        known(id, `${where}.subordinates`);
    if (relations.associates !== undefined) {
      if (!Array.isArray(relations.associates)) fail(where, 'associates must be an array');
      else
        for (const associate of relations.associates) {
          if (!object(associate)) {
            fail(where, 'associate must be an object');
            continue;
          }
          known(associate.id, `${where}.associates`);
          stringField(associate, 'type', where, true);
          if (associate.description !== undefined && typeof associate.description !== 'string')
            fail(where, 'description must be a string');
        }
    }
  }
  // Cross-page structure: self-relations, parent cycles and pages claimed as a
  // subordinate by more than one parent. Individual fields cannot see these.
  for (const issue of auditGraph(pages, { planned }).issues) {
    const message = `${issue.code} (${issue.page}): ${issue.message}`;
    if (issue.level === 'error') errors.push(message);
    else warnings.push(message);
  }
  for (const [id, category] of Object.entries(categories))
    if (object(category) && category.pages !== undefined) {
      for (const page of strings(category.pages, `categories.${id}.pages`))
        known(page, `categories.${id}.pages`, false);
    }
  for (const [archive, owners] of archives)
    if (owners.length > 1) fail('archives', `duplicate archiveId ${archive}: ${owners.join(', ')}`);
  if (!object(sidebar) || !Array.isArray(sidebar.sections))
    fail('wiki-sidebar.json', 'must have a sections array');
  else
    for (const [index, section] of sidebar.sections.entries()) {
      const where = `sidebar.sections[${index}]`;
      if (!object(section) || !text(section.title) || !Array.isArray(section.items)) {
        fail(where, 'must have a title and items array');
        continue;
      }
      for (const item of section.items) {
        if (!object(item) || !text(item.title)) {
          fail(where, 'item must have a title');
          continue;
        }
        if (item.type === 'link') known(item.id, where, false);
        else if (item.type === 'action') {
          if (!['random', 'all', 'recent'].includes(item.action)) fail(where, 'unknown action');
          if (item.url !== undefined && item.url !== `?view=${item.action}`)
            fail(where, 'action URL must match its view');
        } else if (item.type === 'category') {
          if (!Object.hasOwn(categories, item.id)) fail(where, 'unknown category');
        } else if (!['locked', 'subheader', 'meta'].includes(item.type))
          fail(where, `unknown item type ${String(item.type)}`);
      }
    }
  try {
    for (const item of await readdir(path.join(root, 'pages'), { withFileTypes: true })) {
      if (item.isSymbolicLink() || item.isDirectory())
        fail(
          `pages/${item.name}`,
          'page directory must contain regular files, no subdirectories or symbolic links',
        );
      if (item.name.endsWith('.json') && !files.has(`pages/${item.name}`.toLowerCase()))
        fail(`pages/${item.name}`, 'metadata file is not registered');
      if (item.name.endsWith('.md') && !contentFiles.has(`pages/${item.name}`.toLowerCase()))
        fail(`pages/${item.name}`, 'Markdown file has no registered metadata');
    }
  } catch (error) {
    fail('pages', error.message);
  }
  return { ok: errors.length === 0, errors, warnings, pages };
}

export function printValidation(result) {
  for (const warning of result.warnings) console.warn(`WARNING ${warning}`);
  for (const error of result.errors) console.error(`ERROR ${error}`);
  console.log(
    `Validated ${result.pages.length} pages: ${result.errors.length} error(s), ${result.warnings.length} warning(s).`,
  );
}

if (isMain(import.meta.url)) {
  const result = await validate();
  printValidation(result);
  if (!result.ok) process.exitCode = 1;
}
