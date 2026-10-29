import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import PackageJson from '@npmcli/package-json';

const root = fileURLToPath(new URL('../', import.meta.url));
const repository = 'https://github.com/ethan741205/dsh-strata-sync';
const required = ['LICENSE', 'README.md', 'package.json', 'cordis.patch.yml',
  'dist/index.js', 'dist/client.js', 'dist/core.mjs', 'dist/summary.mjs',
  'docs/README.zh-CN.md', 'docs/README.zh-TW.md', 'docs/CAPABILITIES.md', 'docs/VALIDATION.md'];

export async function verifyPackage() {
  const entries = await readdir(root);
  assert.deepEqual(entries.filter(name => /^readme(?:\.|$)/i.test(name)), ['README.md'],
    'Keep only README.md at the package root so npm cannot select a translated README.');
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const prepared = (await PackageJson.prepare(root)).content;
  assert.equal(prepared.readmeFilename, 'README.md', 'npm must select the English root README.');
  assert.equal(prepared.readme, await readFile(join(root, 'README.md'), 'utf8'));
  assert.equal(manifest.publishConfig?.registry, 'https://registry.npmjs.org/');
  assert.equal(manifest.publishConfig?.access, 'public');
  assert.equal(manifest.homepage, `${repository}#readme`);
  assert.equal(manifest.bugs?.url, `${repository}/issues`);
  assert.ok(manifest.keywords?.length, 'Publish search keywords.');

  const npmCli = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  await access(npmCli).catch(() => { throw new Error('Run this verifier with npm run verify:package or npm test.'); });
  const [packed] = JSON.parse(execFileSync(process.execPath,
    [npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' }));
  const files = new Set(packed.files.map(file => file.path));
  assert.equal(packed.version, manifest.version);
  assert.deepEqual([...files].sort(), [...required].sort(), 'Package contents must match the reviewed public file list.');
  for (const target of [manifest.main, ...Object.values(manifest.exports)]) {
    assert.ok(files.has(target.replace(/^\.\//, '')), `Missing runtime entry: ${target}`);
  }
  assert.match(await readFile(join(root, 'cordis.patch.yml'), 'utf8'), /name: ['"]?dsh-strata-sync/);
  for (const [source, built] of [['src/plugin.mjs', 'dist/index.js'], ['src/client.js', 'dist/client.js'], ['src/core.mjs', 'dist/core.mjs'], ['src/summary.mjs', 'dist/summary.mjs']]) {
    assert.equal((await readFile(join(root, source), 'utf8')).replace(/\r\n/g, '\n'),
      (await readFile(join(root, built), 'utf8')).replace(/\r\n/g, '\n'), `Run npm run build: ${built} is stale.`);
  }
  for (const name of ['README.md', 'docs/README.zh-CN.md', 'docs/README.zh-TW.md']) {
    const text = await readFile(join(root, name), 'utf8');
    assert.ok(text.includes('dsh plugin --profile desktop add dsh-strata-sync'), `${name} needs registry install instructions.`);
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      const link = match[1];
      assert.match(link, /^https:\/\//, `${name} has a relative link that may break on npm: ${link}`);
      if (link.startsWith(`${repository}/blob/main/`)) {
        const target = decodeURIComponent(link.slice(`${repository}/blob/main/`.length).split('#')[0]);
        assert.ok(files.has(target), `${name} links to documentation omitted from the package: ${target}`);
      }
    }
  }
  return { name: manifest.name, version: manifest.version, readmeFilename: prepared.readmeFilename,
    readmeLength: prepared.readme.length, fileCount: files.size, packedBytes: packed.size };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(JSON.stringify(await verifyPackage(), null, 2));
}
