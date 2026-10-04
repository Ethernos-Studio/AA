import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { categoryChain, nextArchiveId } from '../assets/js/graph.js';
import { exactFile, ID_PATTERN, isMain, PROJECT_ROOT } from './paths.mjs';
import { validDate } from './validate.mjs';

export async function newPage({
  root = PROJECT_ROOT,
  id,
  title,
  category,
  date = new Date().toISOString().slice(0, 10),
} = {}) {
  if (
    typeof id !== 'string' ||
    !ID_PATTERN.test(id) ||
    /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(id)
  )
    throw new Error(
      'id must use lower-case letters/numbers separated by hyphens and not be a reserved filename',
    );
  if (typeof title !== 'string' || !title.trim())
    throw new Error('A non-empty --title is required');
  if (!validDate(date)) throw new Error('date must be a real YYYY-MM-DD date');
  const base = await realpath(root);
  const configFile = await exactFile(base, 'wiki-config.json');
  await mkdir(path.join(base, 'pages'), { recursive: true });
  const directory = await lstat(path.join(base, 'pages'));
  if (directory.isSymbolicLink() || !directory.isDirectory())
    throw new Error('pages must be a real directory');
  const lockFile = path.join(base, '.new-page.lock');
  const lock = await open(lockFile, 'wx');
  const created = [];
  try {
    const original = await readFile(configFile, 'utf8');
    const config = JSON.parse(original);
    if (!Array.isArray(config.pageRegistry))
      throw new Error('config.pageRegistry must be an array');
    if (
      config.pageRegistry.some((page) => page.id === id) ||
      Object.hasOwn(config.plannedPages ?? {}, id)
    )
      throw new Error(`ID already registered or planned: ${id}`);
    if (category !== undefined && !Object.hasOwn(config.categories ?? {}, category))
      throw new Error(`Unknown category: ${category}`);
    // Read every page record so the two derived fields below come from data
    // rather than from what the author remembered to type.
    const names = await readdir(path.join(base, 'pages'));
    const existing = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        existing.push(JSON.parse(await readFile(path.join(base, 'pages', name), 'utf8')));
      } catch {
        // Unreadable metadata is a `validate` problem, not a reason to block scaffolding.
      }
    }
    const json = `pages/${id}.json`;
    const markdown = `pages/${id}.md`;
    const archiveId = category ? nextArchiveId(config, existing, category) : null;
    const page = {
      id,
      title: title.trim(),
      lastUpdated: date,
      tags: [],
      contentFile: markdown,
      // Ancestors are included automatically; pages under `organizations`
      // also belong to `entities`, and that was previously retyped by hand.
      categories: category ? categoryChain(config, category) : [],
      relations: { parent: null, subordinates: [], associates: [] },
      autoGenerate: { breadcrumb: true, categoryNav: true, relatedPages: true },
      ...(archiveId ? { archiveId } : {}),
    };
    // Exclusive creation ensures existing files are never overwritten, even on failure.
    await writeFile(path.join(base, json), `${JSON.stringify(page, null, 2)}\n`, { flag: 'wx' });
    created.push(json);
    await writeFile(path.join(base, markdown), '## 概述\n\n在这里编写条目正文。\n', { flag: 'wx' });
    created.push(markdown);
    if ((await readFile(configFile, 'utf8')) !== original)
      throw new Error('wiki-config.json changed during creation; retry after other edits finish');
    config.pageRegistry.push({ id, file: json });
    await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`);
    return { page, files: created };
  } catch (error) {
    for (const file of created) await unlink(path.join(base, file));
    throw error;
  } finally {
    await lock.close();
    await unlink(lockFile);
  }
}

export function parseArgs(args) {
  const [id, ...flags] = args;
  const options = { id };
  for (let index = 0; index < flags.length; index += 2) {
    const flag = flags[index];
    if (!['--title', '--category'].includes(flag) || !flags[index + 1])
      throw new Error(
        'Usage: node scripts/new-page.mjs page-id --title "标题" [--category organizations]',
      );
    options[flag.slice(2)] = flags[index + 1];
  }
  return options;
}

if (isMain(import.meta.url)) {
  try {
    const result = await newPage(parseArgs(process.argv.slice(2)));
    console.log(`Created ${result.files.join(' and ')}; appended pageRegistry.`);
    console.log(
      `Derived categories: ${result.page.categories.join(' → ') || '(none)'}; ` +
        `archiveId: ${result.page.archiveId || '未派生（该分类未声明 archivePrefix）'}.`,
    );
    console.log(
      'Sidebar navigation is optional: edit wiki-sidebar.json if desired. Run npm run validate.',
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
