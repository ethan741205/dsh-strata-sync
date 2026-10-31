import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Context, Service } from '@deepseek-ai/cordis';
import { clampMaxTokensToContext } from '@earendil-works/pi-ai/api/simple-options';
import { DEFAULT_SUMMARY_TEMPLATE, estimateEffectiveSummaryBudget, estimateSummarySource,
  installSummaryGuidance, planSummaryTarget, summaryInstruction } from '../src/summary.mjs';

const nativePrompt = await readFile(new URL('./fixtures/native-summary-instruction.txt', import.meta.url), 'utf8');
const text = value => ({ type: 'text', text: value });
const image = (changes = {}) => ({ type: 'image', attachment: {
  attachmentId: `sha256:${'a'.repeat(64)}`, mediaType: 'image/png', bytes: 1234,
  width: 1200, height: 800, name: 'PRIVATE-IMAGE-NAME.png', ...changes,
} });
const fixture = (role = 'user', blocks = [image()], chars = 24000) => ({
  purpose: 'compaction', provider: 'strata-server', model: 'fixture-model', maxTokens: 4096,
  sessionId: 'image-fixture-session', signal: new AbortController().signal,
  messages: [{ role, content: [text('x'.repeat(chars)), ...blocks] },
    { role: 'user', content: [text(nativePrompt)] }],
});
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
async function installed(t, settings = {}, context = async () => 32768) {
  const ctx = new Context(), llm = new Service(ctx, 'llm'), attempts = [];
  const audit = { begin() {
    const attempt = {}; attempts.push(attempt);
    return { decision: data => { attempt.decision = structuredClone(data); },
      finish: data => { attempt.result = structuredClone(data); } };
  } };
  const fiber = ctx.plugin(child => installSummaryGuidance(child, context, () => ({
    summaryGuidance: true, summaryGuidanceMode: 'always', ...settings,
  }), audit));
  await fiber.await(); assert.equal(fiber.state, 2); t.after(() => fiber.dispose());
  return { ctx, attempts, stream: (options, native) => ctx.waterfall(llm, 'llm/stream', options, () => native(options)) };
}
async function collect(stream) { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return chunks; }
const finished = kind => ({ type: 'finish', reason: { kind } });

test('native user and tool image references have a nonzero source cost and ignore offloaded state', () => {
  for (const role of ['user', 'tool']) {
    const block = image(), options = fixture(role, [block], 8), details = {};
    const expectedImage = 4 + Math.ceil(JSON.stringify(block).length / 4);
    assert.equal(estimateSummarySource(options.messages, details), 4 + 4 + 2 + expectedImage);
    assert.deepEqual(details, { imageCount: 1, imageTokens: expectedImage, inputIssue: null });
    const offloaded = structuredClone(options.messages); offloaded[0].content[1].offloaded = true;
    assert.equal(estimateSummarySource(offloaded), estimateSummarySource(options.messages));
  }
});

test('images consume remaining output room rather than counting as zero tokens', () => {
  for (const role of ['user', 'tool']) {
    const noImage = fixture(role, [], 12000), one = fixture(role, [image()], 12000);
    const three = fixture(role, [image(), image(), image()], 12000), oneDetails = {}, threeDetails = {};
    const before = estimateEffectiveSummaryBudget(noImage, 16000);
    const afterOne = estimateEffectiveSummaryBudget(one, 16000, DEFAULT_SUMMARY_TEMPLATE, oneDetails);
    const afterThree = estimateEffectiveSummaryBudget(three, 16000, DEFAULT_SUMMARY_TEMPLATE, threeDetails);
    assert.ok(afterThree < afterOne && afterOne <= before);
    assert.equal(oneDetails.imageCount, 1); assert.equal(threeDetails.imageCount, 3);
    assert.ok(oneDetails.imageTokens > 1371);
    assert.equal(threeDetails.imageTokens, 3 * oneDetails.imageTokens);
  }
});

// Installed dsh-llm/pi-ai projection, represented without image data. These
// handles and projected user/toolResult roles are fed into pi-ai's real clamp;
// the plugin must remain conservative even when names and access paths are long.
function projectedHandle(ref, access) {
  const label = ref.name === undefined ? ref.attachmentId : `${JSON.stringify(ref.name)} (${ref.attachmentId})`;
  const opening = `Image ${label}; request preview ${ref.width}x${ref.height}px.`;
  if (!access) return `${opening} It may be resized or re-encoded; source dimensions, format, and byte size may differ.`;
  return `${opening} Normalized copy (read-only; may be resized or re-encoded): ${JSON.stringify(access.readonlyPath)} (${ref.width}x${ref.height}px, ${ref.mediaType}). Source dimensions, format, and byte size may differ. Copy to a writable path ending in .png before editing.`;
}
function projectedContext(options, target, access) {
  const source = options.messages[0], plain = source.content.filter(block => block.type === 'text');
  const pictures = source.content.filter(block => block.type === 'image').flatMap(block => [
    text(projectedHandle(block.attachment, access)), { type: 'image', data: 'synthetic', mimeType: block.attachment.mediaType },
  ]);
  const messages = source.role === 'tool'
    ? [{ role: 'toolResult', toolCallId: 'fixture-tool', toolName: 'fixture-tool', isError: false,
      timestamp: 0, content: [...plain, ...pictures] }]
    : [{ role: 'user', timestamp: 0, content: [...plain, ...pictures] }];
  messages.push({ role: 'user', timestamp: 0, content: nativePrompt + (target === null ? '' : '\n- ' + summaryInstruction(target)) });
  return { messages };
}

test('native image guidance budget remains below the pi-ai clamp for multiple images and long metadata', () => {
  for (const role of ['user', 'tool']) for (const count of [1, 3]) for (const contextWindow of [16384, 32768]) {
    for (const long of [false, true]) {
      const access = long ? { readonlyPath: 'C:/PRIVATE-PATH/' + 'nested/'.repeat(800) + 'image.png' } : undefined;
      const options = fixture(role, Array.from({ length: count }, () => image({
        name: long ? 'PRIVATE-IMAGE-NAME-'.repeat(300) + '"\n.png' : 'fixture.png',
      })), long ? 8000 : 36000);
      const details = {}, budget = estimateEffectiveSummaryBudget(options, contextWindow,
        DEFAULT_SUMMARY_TEMPLATE, details, () => access);
      const target = planSummaryTarget(budget, estimateSummarySource(options.messages));
      const nativeCap = clampMaxTokensToContext({ contextWindow }, projectedContext(options, target, access), options.maxTokens);
      assert.ok(budget >= 0 && budget <= nativeCap, `${role}/${count}/${contextWindow}/${long}: ${budget} > ${nativeCap}`);
      assert.equal(details.imageCount, count);
      assert.doesNotMatch(JSON.stringify(details), /PRIVATE-|nested|sha256/);
    }
  }
});

test('unsupported and malformed inputs report bounded categories without private values', () => {
  const cases = [
    [{ type: 'image', url: 'PRIVATE-URL' }, 'unsupported-image', 'attachment'],
    [{ type: 'image', attachment: 'PRIVATE-ATTACHMENT' }, 'invalid-field-type', 'attachment'],
    [image({ width: 'PRIVATE-WIDTH' }), 'invalid-field-type', 'width'],
    [image({ attachmentId: 'PRIVATE-HANDLE' }), 'unsupported-image', 'attachmentId'],
    [image({ mediaType: 'PRIVATE-MEDIA' }), 'unsupported-image', 'mediaType'],
    [{ type: 'file', path: 'PRIVATE-FILE' }, 'unsupported-file', null],
    [{ type: 'text', text: { secret: 'PRIVATE-TEXT' } }, 'invalid-field-type', 'text'],
    [{ type: 'PRIVATE-BLOCK' }, 'unsupported-block', null],
  ];
  for (const [block, code, field] of cases) {
    const options = fixture('tool', [block]), source = {}, budget = {};
    assert.equal(estimateSummarySource(options.messages, source), null);
    assert.equal(estimateEffectiveSummaryBudget(options, 32768, DEFAULT_SUMMARY_TEMPLATE, budget), null);
    for (const [stage, details] of [['source', source], ['budget', budget]]) {
      assert.equal(details.inputIssue.stage, stage); assert.equal(details.inputIssue.code, code);
      assert.equal(details.inputIssue.field, field); assert.equal(details.inputIssue.role, 'tool');
      assert.doesNotMatch(JSON.stringify(details), /PRIVATE-/);
    }
  }
  const details = {};
  assert.equal(estimateSummarySource([{ role: 'PRIVATE-ROLE', content: [] }, { role: 'user', content: [] }], details), null);
  assert.equal(details.inputIssue.code, 'unsupported-role'); assert.equal(details.inputIssue.role, 'unknown');
  assert.doesNotMatch(JSON.stringify(details), /PRIVATE-/);
});

test('failed or malformed image access resolution safely rejects the estimate without exposing paths', () => {
  for (const resolve of [() => { throw Error('PRIVATE-ERROR'); }, () => ({ readonlyPath: 123 }), () => Promise.resolve({ readonlyPath: 'PRIVATE-PATH' })]) {
    const details = {}, options = fixture();
    assert.equal(estimateEffectiveSummaryBudget(options, 32768, DEFAULT_SUMMARY_TEMPLATE, details, resolve), null);
    assert.deepEqual(details.inputIssue, { stage: 'budget', code: 'image-access-unavailable', role: 'user', blockType: 'image', field: 'attachment' });
    assert.doesNotMatch(JSON.stringify(details), /PRIVATE-/);
  }
});

test('guidance preserves frozen image messages and keeps private access metadata out of audit decisions', async t => {
  const harness = await installed(t), options = fixture('tool'), original = freeze(options.messages);
  let pathResolutions = 0;
  const mappedPath = '/PRIVATE-ACCESS/' + 'nested/'.repeat(2000) + 'image.png';
  harness.ctx.provide('attachments', { imageHostPath(ref) {
    assert.equal(ref, original[0].content[1].attachment);
    pathResolutions++; return 'C:/PRIVATE-HOST/image.png';
  } });
  harness.ctx.provide('fs', { processPathFromHostPath(hostPath) {
    assert.equal(hostPath, 'C:/PRIVATE-HOST/image.png'); return mappedPath;
  } });
  const chunks = [finished('stop')];
  assert.deepEqual(await collect(harness.stream(options, async function* (request) {
    assert.notEqual(request.messages, original);
    assert.equal(request.messages[0], original[0]);
    assert.equal(request.messages[0].content[1], original[0].content[1]);
    assert.equal(request.maxTokens, 4096);
    assert.match(request.messages.at(-1).content[0].text, /target of 2048 tokens/);
    yield* chunks;
  })), chunks);
  assert.equal(options.messages, original); assert.equal(pathResolutions, 1);
  const decision = harness.attempts[0].decision;
  assert.equal(decision.applied, true); assert.equal(decision.sourceImageCount, 1);
  assert.ok(decision.sourceImageTokensEstimated > 0 && decision.budgetImageTokensEstimated > 0);
  const noAccessDetails = {};
  estimateEffectiveSummaryBudget(options, 32768, DEFAULT_SUMMARY_TEMPLATE, noAccessDetails);
  assert.ok(decision.budgetImageTokensEstimated > noAccessDetails.imageTokens + 3000,
    'The hook must reserve the mapped access path, not silently use the shorter unavailable-path handle.');
  assert.doesNotMatch(JSON.stringify(harness.attempts), /PRIVATE-|sha256|fixture source/);
});

test('unsupported input still arms recovery on truncation and image guidance resets only after native commit', async t => {
  let discoveries = 0;
  const harness = await installed(t, { summaryGuidanceMode: 'after-truncation' }, async () => { discoveries++; return 32768; });
  const requests = [fixture('tool', [{ type: 'image', url: 'PRIVATE-URL' }]), fixture('tool'), fixture('tool'), fixture('tool')];
  for (let index = 0; index < requests.length; index++) {
    const options = requests[index], original = options.messages;
    await collect(harness.stream(options, async function* (request) {
      assert.equal(request.messages !== original, index === 1 || index === 2);
      assert.deepEqual(request.messages[0], original[0]);
      yield finished(index === 0 ? 'max-tokens' : 'stop');
    }));
    assert.equal(options.messages, original);
    if (index === 0) assert.equal(discoveries, 0);
    if (index === 2) {
      harness.ctx.emit('session/event', { id: options.sessionId }, { type: 'compaction/summary',
        data: { compactionId: 'committed-image', provider: options.provider, model: options.model } });
      harness.ctx.emit('session/event', { id: options.sessionId }, { type: 'compaction/end', data: { compactionId: 'committed-image' } });
    }
  }
  assert.equal(discoveries, 2);
  assert.deepEqual(harness.attempts.map(attempt => attempt.decision.reason), ['unsupported-input', 'applied', 'applied', 'awaiting-truncation']);
  assert.equal(harness.attempts[0].decision.inputIssue.code, 'unsupported-image');
  assert.equal(harness.attempts[0].result.outcome, 'truncated');
});

test('unsupported image inputs do not discover model context or attachment metadata', async t => {
  let discoveries = 0, attachmentCalls = 0;
  const harness = await installed(t, {}, async () => { discoveries++; return 32768; });
  harness.ctx.provide('attachments', { imageHostPath() { attachmentCalls++; throw Error('must not resolve'); } });
  const options = fixture('tool', [image({ bytes: 'PRIVATE-BYTES' })]), original = options.messages;
  await collect(harness.stream(options, async function* (request) {
    assert.equal(request.messages, original); yield finished('stop');
  }));
  assert.equal(discoveries, 0); assert.equal(attachmentCalls, 0);
  assert.equal(harness.attempts[0].decision.reason, 'unsupported-input');
  assert.equal(harness.attempts[0].decision.inputIssue.field, 'bytes');
});
