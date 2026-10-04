import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isMain(url) {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(url);
}

export function isInside(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

// Reject aliases that are ambiguous across POSIX, Windows and URL decoders.
export function safeRelative(value) {
  if (typeof value !== 'string' || !value || /[\\:%?#]/.test(value)) return false;
  if (
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    return false;
  return value
    .split('/')
    .every(
      (part) =>
        part &&
        part !== '.' &&
        part !== '..' &&
        !part.startsWith('.') &&
        !/[. ]$/.test(part) &&
        !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part),
    );
}

export async function exactFile(root, relative) {
  if (!safeRelative(relative)) throw new Error(`Unsafe relative path: ${relative}`);
  const base = await realpath(root);
  let current = base;
  const parts = relative.split('/');
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const entries = await readdir(current);
    if (!entries.includes(part)) throw new Error(`File missing or case mismatch: ${relative}`);
    current = path.join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${relative}`);
    if (index < parts.length - 1 && !stat.isDirectory())
      throw new Error(`Not a directory: ${relative}`);
    if (index === parts.length - 1 && !stat.isFile())
      throw new Error(`Not a regular file: ${relative}`);
  }
  if (!isInside(base, await realpath(current))) throw new Error(`Path escapes root: ${relative}`);
  return current;
}
