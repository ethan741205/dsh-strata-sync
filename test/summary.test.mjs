import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Context, Service } from '@deepseek-ai/cordis';
import { estimateSummarySource, installSummaryGuidance, MIN_SUMMARY_TARGET,
  nativeSummaryMessage, planSummaryTarget, summaryInstruction } from '../src/summary.mjs';

// Public native instruction from @deepseek-ai/dsh-compaction-basic 0.2.1-rc.3
// (DeepSeek Harness, MIT). Its complete license accompanies the fixture.
// This is a compatibility fixture, never a replacement prompt shipped to users.
const nativePrompt = await readFile(new URL('./fixtures/native-summary-instruction.txt', import.meta.url), 'utf8');
const text = value => ({ type: 'text', text: value });
const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const fixture = (changes = {}) => ({
  purpose: 'compaction', provider: 'strata-server', model: 'qwen', maxTokens: 4096,
  sessionId: 'test-session', signal: new AbortController().signal,
  tools: [{ name: 'read', description: 'test schema', parameters: { type: 'object' } }],
  toolHistory: { marker: 'native tool history' }, temperature: 0,
  messages: [
    { role: 'system', content: [text('Native system instructions')] },
    { role: 'user', content: [text('a'.repeat(24000))] },
    deepFreeze({ role: 'user', content: [text(nativePrompt)] }),
  ],
  ...changes,
});
async function installed(t, resolveContext = async () => 32768) {
  const ctx = new Context();
  const llm = new Service(ctx, 'llm');
  const fiber = ctx.plugin(child => installSummaryGuidance(child, resolveContext));
  await fiber.await();
  assert.equal(fiber.state, 2);
  t.after(() => fiber.dispose());
  return {
    ctx, fiber,
    stream(options, native) {
      // Real Cordis waterfall semantics: next() closes over the original
      // options, exactly as LlmRuntime.streamWithRegistration() does.
      return ctx.waterfall(llm, 'llm/stream', options, () => native(options));
    },
  };
}
async function collect(stream) {
  const result = [];
  for await (const value of stream) result.push(value);
  return result;
}

test('summary target follows context, real hard cap, and source bounds', () => {
  assert.equal(planSummaryTarget(32768, 4096, 12000), 2048);
  assert.equal(planSummaryTarget(65536, 4096, 12000), 2048);
  assert.equal(planSummaryTarget(131072, 4096, 12000), 2048);
  assert.equal(planSummaryTarget(65536, 1024, 12000), 512);
  assert.equal(planSummaryTarget(65536, 4096, 1501), 750);
  for (const context of [8192, 32768, 65536, 131072]) {
    for (const cap of [512, 1024, 4096, 8192]) {
      for (const source of [512, 1001, 2048, 10000]) {
        const target = planSummaryTarget(context, cap, source);
        if (target === null) continue;
        assert.ok(Number.isInteger(target));
        assert.ok(target <= context / 16 && target <= cap / 2 && target <= source / 2);
      }
    }
  }
});

test('tiny or unknown targets are not rounded up or invented', () => {
  assert.equal(MIN_SUMMARY_TARGET, 256);
  assert.equal(planSummaryTarget(32768, 4096, 512), 256);
  assert.equal(planSummaryTarget(32768, 4096, 511), null);
  assert.equal(planSummaryTarget(32768, 511, 9000), null);
  for (const invalid of [undefined, null, 0, -1, 1.5, NaN, Infinity, '32768', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(planSummaryTarget(invalid, 4096, 8000), null);
    assert.equal(planSummaryTarget(32768, invalid, 8000), null);
    assert.equal(planSummaryTarget(32768, 4096, invalid), null);
  }
  assert.throws(() => summaryInstruction(0), TypeError);
  assert.throws(() => summaryInstruction(1.5), TypeError);
});

test('source estimate excludes native instruction, system prompt and tool schemas', () => {
  const options = fixture({ messages: [
    { role: 'system', content: [text('s'.repeat(200000))] },
    { role: 'user', content: [text('x'.repeat(2000))] },
    { role: 'assistant', content: [{ type: 'reasoning', text: 'y'.repeat(800) },
      { type: 'tool-call', name: 'read', arguments: '{}xx' }] },
    { role: 'tool', content: [text('z'.repeat(400))] },
    { role: 'user', content: [text(nativePrompt)] },
  ], tools: [{ description: 'huge schema'.repeat(100000) }] });
  assert.equal(estimateSummarySource(options.messages), 830);
  const noSystem = options.messages.slice(1);
  assert.equal(estimateSummarySource(noSystem), 830);
  assert.equal(estimateSummarySource([]), null);
  assert.equal(estimateSummarySource([options.messages.at(-1)]), null);
});

test('recognizes the real native prompt and rejects foreign or already augmented instructions', () => {
  const options = fixture();
  assert.equal(nativeSummaryMessage(options), options.messages.at(-1));
  const foreign = structuredClone(options.messages);
  foreign.at(-1).content[0].text = 'Summarize this conversation in your own format.';
  assert.equal(nativeSummaryMessage({ ...options, messages: foreign }), null);
  const changed = structuredClone(options.messages);
  changed.at(-1).content[0].text = nativePrompt.replace('## Next Step', '## Plan');
  assert.equal(nativeSummaryMessage({ ...options, messages: changed }), null);
  const augmented = structuredClone(options.messages);
  augmented.at(-1).content[0].text += '\n- ' + summaryInstruction(2048);
  assert.equal(nativeSummaryMessage({ ...options, messages: augmented }), null);
  assert.equal(nativeSummaryMessage({ ...options, purpose: 'agent' }), null);
});

test('real Cordis stream appends exactly one sentence and restores all native options', async t => {
  let metadataCalls = 0, dispatches = 0;
  const harness = await installed(t, async options => {
    metadataCalls++;
    assert.equal(options.messages.at(-1).content[0].text, nativePrompt);
    return 32768;
  });
  const options = fixture();
  const originals = { ...options };
  deepFreeze(options.messages);
  const stream = harness.stream(options, async function* (request) {
    dispatches++;
    assert.strictEqual(request, options);
    for (const [key, value] of Object.entries(originals)) {
      if (key !== 'messages') assert.strictEqual(request[key], value, key);
    }
    assert.notStrictEqual(request.messages, originals.messages);
    assert.strictEqual(request.messages[0], originals.messages[0]);
    assert.strictEqual(request.messages[1], originals.messages[1]);
    assert.equal(request.messages.length, originals.messages.length);
    const supplemented = request.messages.at(-1).content[0].text;
    assert.equal(supplemented, nativePrompt + '\n- ' + summaryInstruction(2048));
    assert.equal(supplemented.slice(0, nativePrompt.length), nativePrompt);
    assert.equal(supplemented.slice(nativePrompt.length).match(/\./g)?.length, 1);
    assert.equal(request.messages.at(-1).content.length, 1);
    yield { type: 'text-delta', text: 'Native stream content' };
    yield { type: 'finish', reason: { kind: 'stop' } };
  });
  assert.equal(metadataCalls, 0, 'lazy stream should not discover until consumed');
  assert.deepEqual(await collect(stream), [
    { type: 'text-delta', text: 'Native stream content' },
    { type: 'finish', reason: { kind: 'stop' } },
  ]);
  assert.equal(metadataCalls, 1);
  assert.equal(dispatches, 1);
  assert.deepEqual(options, originals);
  assert.strictEqual(options.messages, originals.messages);
});

test('each summary recalculates from its actual hard cap and selected content', async t => {
  let calls = 0;
  const harness = await installed(t, async () => { calls++; return calls === 1 ? 32768 : 65536; });
  const observed = [];
  for (const options of [fixture(), fixture(), fixture({ maxTokens: 1024 })]) {
    await collect(harness.stream(options, async function* (request) {
      observed.push(request.messages.at(-1).content[0].text);
      yield { type: 'finish', reason: { kind: 'stop' } };
    }));
  }
  assert.equal(calls, 3);
  for (const [index, target] of [2048, 2048, 512].entries()) {
    assert.equal(observed[index], nativePrompt + '\n- ' + summaryInstruction(target));
  }
});

for (const [name, mutate] of [
  ['ordinary agent call', options => { options.purpose = 'agent'; }],
  ['foreign prompt', options => { options.messages = [...options.messages.slice(0, -1), { role: 'user', content: [text('A different summary prompt')] }]; }],
  ['image attachment', options => { options.messages[1].content.push({ type: 'image', url: 'test-image' }); }],
  ['file attachment', options => { options.messages[1].content.push({ type: 'file', path: '/test.txt' }); }],
  ['unrecognized role', options => { options.messages[1].role = 'developer'; }],
  ['invalid hard cap', options => { options.maxTokens = -1; }],
  ['frozen options object', options => { Object.freeze(options); }],
  ['already aborted signal', options => { options.signal = AbortSignal.abort(); }],
]) {
  test(`${name} preserves native behavior without discovery`, async t => {
    let metadataCalls = 0;
    const harness = await installed(t, async () => { metadataCalls++; return 32768; });
    const options = fixture();
    mutate(options);
    const original = options.messages;
    let dispatches = 0;
    await collect(harness.stream(options, async function* (request) {
      dispatches++;
      assert.strictEqual(request.messages, original);
      yield { type: 'finish', reason: { kind: 'stop' } };
    }));
    assert.equal(metadataCalls, 0);
    assert.equal(dispatches, 1);
  });
}

test('tiny selected content falls back to the original instruction', async t => {
  const harness = await installed(t);
  const options = fixture();
  options.messages[1].content = [text('A short conversation.')];
  const original = options.messages;
  await collect(harness.stream(options, async function* (request) {
    assert.strictEqual(request.messages, original);
    yield { type: 'finish', reason: { kind: 'stop' } };
  }));
});

test('metadata rejection and unknown context fail open without replacing native errors', async t => {
  const originalError = new Error('native inference error');
  let calls = 0;
  const harness = await installed(t, async () => { if (++calls === 1) throw Error('metadata unavailable'); return null; });
  for (let index = 0; index < 2; index++) {
    const options = fixture(), original = options.messages;
    await assert.rejects(collect(harness.stream(options, async function* (request) {
      assert.strictEqual(request.messages, original);
      throw originalError;
    })), error => error === originalError);
    assert.strictEqual(options.messages, original);
  }
});

test('aborting during discovery preserves the original signal and instruction', async t => {
  const gate = deferred(), entered = deferred();
  const harness = await installed(t, async () => { entered.resolve(); return gate.promise; });
  const controller = new AbortController(), options = fixture({ signal: controller.signal });
  const original = options.messages;
  const task = collect(harness.stream(options, async function* (request) {
    assert.strictEqual(request.messages, original);
    assert.strictEqual(request.signal, controller.signal);
    assert.equal(request.signal.aborted, true);
    yield { type: 'finish', reason: { kind: 'aborted' } };
  }));
  await entered.promise;
  controller.abort();
  gate.resolve(32768);
  assert.deepEqual(await task, [{ type: 'finish', reason: { kind: 'aborted' } }]);
});

test('unloading during discovery does not modify the pending call and removes the hook', async t => {
  const gate = deferred(), entered = deferred();
  let metadataCalls = 0;
  const harness = await installed(t, async () => { metadataCalls++; entered.resolve(); return gate.promise; });
  const options = fixture(), original = options.messages;
  const native = async function* (request) {
    assert.equal(request.messages.at(-1).content[0].text, nativePrompt);
    yield { type: 'finish', reason: { kind: 'stop' } };
  };
  const task = collect(harness.stream(options, native));
  await entered.promise;
  await harness.fiber.dispose();
  gate.resolve(32768);
  await task;
  assert.strictEqual(options.messages, original);
  await collect(harness.stream(fixture(), native));
  assert.equal(metadataCalls, 1);
});

test('native stream failures propagate unchanged and original messages are restored', async t => {
  const harness = await installed(t);
  const options = fixture(), original = options.messages;
  const failure = Error('native stream failed');
  await assert.rejects(collect(harness.stream(options, async function* (request) {
    assert.notStrictEqual(request.messages, original);
    yield { type: 'text-delta', text: 'already produced' };
    throw failure;
  })), error => error === failure);
  assert.strictEqual(options.messages, original);
});

test('stopping consumption closes the native iterator and restores messages', async t => {
  const harness = await installed(t);
  const options = fixture(), original = options.messages;
  let closed = false;
  const iterator = harness.stream(options, async function* () {
    try {
      yield { type: 'text-delta', text: 'first' };
      yield { type: 'text-delta', text: 'second' };
    } finally { closed = true; }
  })[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value.text, 'first');
  assert.notStrictEqual(options.messages, original);
  await iterator.return();
  assert.equal(closed, true);
  assert.strictEqual(options.messages, original);
});

test('concurrent summaries keep independent targets and restore their own messages', async t => {
  const aGate = deferred(), bGate = deferred(), bothEntered = deferred();
  let entered = 0;
  const harness = await installed(t, async options => {
    if (++entered === 2) bothEntered.resolve();
    return options.model === 'a' ? aGate.promise : bGate.promise;
  });
  const optionsA = fixture({ model: 'a' }), optionsB = fixture({ model: 'b' });
  const originalA = optionsA.messages, originalB = optionsB.messages;
  const observed = new Map();
  const native = async function* (request) {
    observed.set(request.model, request.messages.at(-1).content[0].text);
    yield { type: 'finish', reason: { kind: 'stop' } };
  };
  const a = collect(harness.stream(optionsA, native));
  const b = collect(harness.stream(optionsB, native));
  await bothEntered.promise;
  bGate.resolve(65536);
  await b;
  assert.strictEqual(optionsA.messages, originalA);
  assert.strictEqual(optionsB.messages, originalB);
  aGate.resolve(32768);
  await a;
  assert.equal(observed.get('a'), nativePrompt + '\n- ' + summaryInstruction(2048));
  assert.equal(observed.get('b'), nativePrompt + '\n- ' + summaryInstruction(2048));
  assert.strictEqual(optionsA.messages, originalA);
});

test('duplicate hooks never duplicate the sentence or model request', async t => {
  let metadataCalls = 0, dispatches = 0;
  const resolve = async () => { metadataCalls++; return 32768; };
  const harness = await installed(t, resolve);
  const second = harness.ctx.plugin(child => installSummaryGuidance(child, resolve));
  await second.await();
  t.after(() => second.dispose());
  const options = fixture(), original = options.messages;
  await collect(harness.stream(options, async function* (request) {
    dispatches++;
    assert.equal(request.messages.at(-1).content[0].text, nativePrompt + '\n- ' + summaryInstruction(2048));
    yield { type: 'finish', reason: { kind: 'stop' } };
  }));
  assert.equal(metadataCalls, 1);
  assert.equal(dispatches, 1);
  assert.strictEqual(options.messages, original);
});

test('another middleware replacement is not overwritten after metadata or stream completion', async t => {
  const gate = deferred(), entered = deferred();
  const harness = await installed(t, async () => { entered.resolve(); return gate.promise; });
  const options = fixture();
  const replacement = [options.messages[1], { role: 'user', content: [text('other middleware prompt')] }];
  const task = collect(harness.stream(options, async function* (request) {
    assert.strictEqual(request.messages, replacement);
    yield { type: 'finish', reason: { kind: 'stop' } };
  }));
  await entered.promise;
  options.messages = replacement;
  gate.resolve(32768);
  await task;
  assert.strictEqual(options.messages, replacement);
});
