import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

// Use the installed host's Node and native dependencies, without starting its
// CLI, desktop profile, model adapters, or UI. All session data is temporary.
const desktop = process.env.DSH_DESKTOP_EXECUTABLE
  ?? [process.env.LOCALAPPDATA, join(homedir(), 'AppData', 'Local')].filter(Boolean)
    .map(local => join(local, 'Programs', 'DeepSeek Harness', 'DeepSeek Harness.exe')).find(existsSync);
if (!desktop || !existsSync(desktop)) throw new Error('Set DSH_DESKTOP_EXECUTABLE to the installed DeepSeek Harness executable.');
const script = fileURLToPath(new URL('../test/native-session-roundtrip.mjs', import.meta.url));
const result = spawnSync(desktop, ['--expose-internals', script, join(dirname(desktop), 'resources', 'app.asar', 'dsh', 'package.json')], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8', windowsHide: true, timeout: 120_000,
});
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
if (result.error) console.error(`Native session test runner failed: ${result.error.code ?? 'unknown'}`);
process.exitCode = result.status ?? 1;
