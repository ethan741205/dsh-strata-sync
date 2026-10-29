import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPackage } from '../scripts/verify-package.mjs';

test('npm selects the main README and packages all public documentation and runtime entries', async () => {
  const result = await verifyPackage();
  assert.equal(result.readmeFilename, 'README.md');
  assert.equal(result.fileCount, 12);
  assert.ok(result.readmeLength > 1000);
});
