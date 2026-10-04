import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const check = process.argv.includes('--check');
const packages = [
  { name: 'marked', source: 'lib/marked.esm.js', output: 'marked.js', license: 'LICENSE' },
  { name: 'dompurify', source: 'dist/purify.es.mjs', output: 'purify.js', license: 'LICENSE' },
];
const manifest = [];
await mkdir(path.join(root, 'assets/vendor'), { recursive: true });
for (const pkg of packages) {
  const directory = path.join(root, 'node_modules', pkg.name);
  const meta = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  for (const [source, output] of [
    [pkg.source, pkg.output],
    [pkg.license, `${pkg.name}.LICENSE`],
  ]) {
    const data = await readFile(path.join(directory, source));
    const target = path.join(root, 'assets/vendor', output);
    if (check) {
      const actual = await readFile(target);
      if (!actual.equals(data))
        throw new Error(`${output} 与已锁定依赖不一致；运行 npm run vendor`);
    } else await writeFile(target, data);
    manifest.push({
      package: pkg.name,
      version: meta.version,
      source,
      file: output,
      sha256: createHash('sha256').update(data).digest('hex'),
    });
  }
}
const expected = `${JSON.stringify(manifest, null, 2)}\n`;
const manifestPath = path.join(root, 'assets/vendor/manifest.json');
if (check) {
  if ((await readFile(manifestPath, 'utf8')) !== expected) throw new Error('vendor manifest不一致');
} else await writeFile(manifestPath, expected);
console.log(check ? '自托管依赖与锁定安装一致。' : '已同步自托管依赖及许可证。');
