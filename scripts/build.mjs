import { copyFile, lstat, mkdir, readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { exactFile, isInside, isMain, PROJECT_ROOT, safeRelative } from './paths.mjs';
import { printValidation, validate } from './validate.mjs';

const ASSET_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.txt',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
]);

async function exists(file) {
  try {
    return await lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function assetFiles(root, relative = 'assets') {
  const stat = await lstat(path.join(root, relative));
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error(`${relative} must be a real directory`);
  const files = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = `${relative}/${entry.name}`;
    if (!safeRelative(child) || entry.isSymbolicLink()) throw new Error(`Unsafe asset: ${child}`);
    if (
      entry.isDirectory() &&
      ['node_modules', 'tests', 'test', 'scripts', 'docs'].includes(entry.name)
    )
      continue;
    if (entry.isDirectory()) files.push(...(await assetFiles(root, child)));
    else if (
      entry.isFile() &&
      (ASSET_EXTENSIONS.has(path.extname(child)) ||
        /^(?:[a-z0-9-]+\.)?(?:LICENSE|NOTICE)(?:\.[a-z]+)?$/i.test(entry.name))
    )
      files.push(child);
  }
  return files;
}

/** Always builds to <root>/dist; an arbitrary output/deletion path is not accepted. */
export async function build({ root = PROJECT_ROOT } = {}) {
  const source = await realpath(path.resolve(root));
  const result = await validate({ root: source });
  printValidation(result);
  if (!result.ok) throw new Error('Validation failed; dist was not changed.');
  const files = [
    'index.html',
    'wiki-config.json',
    'wiki-sidebar.json',
    ...(await assetFiles(source)),
  ];
  for (const entry of await readdir(path.join(source, 'pages')))
    if (/\.(?:json|md)$/.test(entry)) files.push(`pages/${entry}`);
  if (await exists(path.join(source, 'CNAME'))) files.push('CNAME');
  // Validate every input before modifying output. Never follow a source symlink.
  for (const file of files) await exactFile(source, file);
  const output = path.join(source, 'dist');
  const stat = await exists(output);
  if (stat && (stat.isSymbolicLink() || !stat.isDirectory() || (await realpath(output)) !== output))
    throw new Error('dist must be a real directory immediately inside the project');
  if (!isInside(source, output) || path.dirname(output) !== source)
    throw new Error('Refusing unsafe build destination');
  // rm is deliberately confined to the fixed dist child, never a CLI-provided path.
  if (stat) await rm(output, { recursive: true });
  await mkdir(output);
  for (const file of files) {
    const destination = path.join(output, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(source, file), destination);
  }
  return { output, files };
}

if (isMain(import.meta.url)) {
  try {
    if (process.argv.length > 2)
      throw new Error('Usage: node scripts/build.mjs (output is always ./dist)');
    const result = await build();
    console.log(`Built ${result.files.length} files in ${result.output}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
