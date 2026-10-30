import { mkdir, copyFile } from 'node:fs/promises';
await mkdir(new URL('../dist/', import.meta.url), {recursive:true});
for (const [from,to] of [['plugin.mjs','index.js'],['core.mjs','core.mjs'],['summary.mjs','summary.mjs'],
  ['summary-audit.mjs','summary-audit.mjs'],['summary-audit-host.mjs','summary-audit-host.mjs'],['client.js','client.js']]) {
  await copyFile(new URL('../src/'+from,import.meta.url),new URL('../dist/'+to,import.meta.url));
}
console.log('Built host plugin, core and native DSH client entry.');
