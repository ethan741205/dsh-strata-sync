import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Context, Service } from '@deepseek-ai/cordis';
import { clampMaxTokensToContext } from '@earendil-works/pi-ai/api/simple-options';
import { estimateEffectiveSummaryBudget, estimateSummarySource, installSummaryGuidance, MIN_SUMMARY_TARGET, MAX_RECOVERY_SESSIONS,
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
async function installed(t, resolveContext = async () => 32768, getSettings = () => ({summaryGuidance:true}), audit) {
  const ctx = new Context();
  const llm = new Service(ctx, 'llm');
  const fiber = ctx.plugin(child => installSummaryGuidance(child, resolveContext, () => { const value = getSettings(); return value == null ? value : { summaryGuidanceMode: 'always', ...value }; }, audit));
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

function auditCapture() {
  const attempts = [];
  return { attempts, begin(options) {
    const entry = {};
    attempts.push(entry);
    return {
      decision(data) {
        entry.decision = structuredClone(data);
        // Observe the actual request at the logging boundary, not afterwards.
        entry.promptAtDecision = options.messages.at(-1)?.content?.[0]?.text;
      },
      finish(data) { entry.result = structuredClone(data); },
    };
  } };
}

test('audit records the exact applied target after mutation and preserves native chunks and options', async t => {
  const audit = auditCapture();
  const harness = await installed(t, undefined, () => ({ summaryOutputDivisor: 1.5 }), audit);
  const options = fixture(), original = options.messages;
  const chunks = [{ type: 'text-delta', text: 'private summary' },
    { type: 'usage', usage: { inputTokens: 7000, outputTokens: 2300, totalTokens: 9300 } },
    { type: 'finish', reason: { kind: 'stop' } }];
  let calls = 0, prompt;
  const result = await collect(harness.stream(options, async function* (request) {
    calls++; prompt = request.messages.at(-1).content[0].text; yield* chunks;
  }));
  assert.equal(calls, 1);
  assert.equal(audit.attempts.length, 1);
  const record = audit.attempts[0];
  assert.equal(record.decision.targetTokens, 2730);
  assert.equal(record.decision.applied, true);
  assert.equal(record.decision.reason, 'applied');
  assert.equal(record.decision.effectiveOutputTokensEstimated, 4096);
  assert.equal(record.promptAtDecision, prompt);
  assert.equal(prompt, nativePrompt + '\n- ' + summaryInstruction(2730));
  assert.equal(record.result.outcome, 'completed');
  assert.equal(record.result.streamCompleted, true);
  assert.deepEqual(record.result.usage, chunks[1].usage);
  assert.ok(Number.isSafeInteger(record.result.elapsedMs) && record.result.elapsedMs >= 0);
  result.forEach((chunk, i) => assert.equal(chunk, chunks[i]));
  assert.equal(options.messages, original);
  assert.equal(options.maxTokens, 4096);
});

test('audit keeps rejected candidate targets and distinguishes uncalculated skip reasons', async t => {
  for (const row of [
    { settings: { summaryOutputDivisor: 32 }, reason: 'target-too-small', target: 128, discoveries: 1 },
    { settings: { summaryGuidance: false }, reason: 'disabled', discoveries: 0 },
    { settings: { summaryGuidanceMode: 'after-truncation' }, reason: 'awaiting-truncation', discoveries: 0 },
    { settings: { summaryOutputDivisor: 0 }, reason: 'invalid-settings', discoveries: 0 },
    { context: null, reason: 'context-unavailable', discoveries: 1 },
    { changes: { maxTokens: 0 }, reason: 'invalid-max-tokens', discoveries: 0 },
    { changes: { signal: AbortSignal.abort() }, reason: 'cancelled', discoveries: 0 },
    { freeze: true, reason: 'non-writable', discoveries: 0 },
  ]) {
    const audit = auditCapture(); let discoveries = 0;
    const harness = await installed(t, async () => { discoveries++; return row.context === null ? null : 32768; }, () => row.settings ?? {}, audit);
    const options = fixture(row.changes), original = options.messages;
    if (row.freeze) Object.freeze(options);
    await collect(harness.stream(options, async function* (request) {
      assert.equal(request.messages, original);
      yield { type: 'finish', reason: { kind: 'stop' } };
    }));
    assert.equal(discoveries, row.discoveries, row.reason);
    assert.equal(audit.attempts.length, 1, row.reason);
    assert.equal(audit.attempts[0].decision.applied, false, row.reason);
    assert.equal(audit.attempts[0].decision.reason, row.reason);
    assert.equal(audit.attempts[0].decision.targetTokens, row.target ?? null, row.reason);
  }
});

test('audit retains a calculated target when settings change before application', async t => {
  const audit = auditCapture(); let settings = { summaryGuidance: true };
  const harness = await installed(t, async () => { settings = { summaryGuidance: false }; return 32768; }, () => settings, audit);
  await collect(harness.stream(fixture(), async function* (request) {
    assert.equal(request.messages.at(-1).content[0].text, nativePrompt);
    yield { type: 'finish', reason: { kind: 'stop' } };
  }));
  assert.equal(audit.attempts[0].decision.targetTokens, 2048);
  assert.equal(audit.attempts[0].decision.applied, false);
  assert.equal(audit.attempts[0].decision.reason, 'settings-changed');
});

test('audit distinguishes native truncation, errors, cancellation and incomplete consumption', async t => {
  for (const [finish, outcome] of [['max-tokens', 'truncated'], ['error', 'error'], ['aborted', 'cancelled'], ['tool-calls', 'completed']]) {
    const audit = auditCapture(), harness = await installed(t, undefined, undefined, audit);
    await collect(harness.stream(fixture(), async function* () { yield { type: 'finish', reason: { kind: finish } }; }));
    assert.equal(audit.attempts[0].result.outcome, outcome);
    assert.equal(audit.attempts[0].result.finishReason, finish);
  }
  const audit = auditCapture(), harness = await installed(t, undefined, undefined, audit);
  const options = fixture(), original = options.messages;
  const stream = harness.stream(options, async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; });
  await stream.next(); await stream.return();
  assert.equal(audit.attempts[0].result.outcome, 'incomplete');
  assert.equal(audit.attempts[0].result.streamCompleted, false);
  assert.equal(options.messages, original);
});

test('audit failures never replace native errors or affect the disabled dispatch boundary', async t => {
  const failure = new Error('native transport failure');
  for (const audit of [
    { begin() { throw Error('audit unavailable'); } },
    { begin() { return { decision() { throw Error('audit write failed'); }, finish() { throw Error('audit write failed'); } }; } },
  ]) {
    for (const enabled of [true, false]) {
      const harness = await installed(t, undefined, () => ({ summaryGuidance: enabled }), audit);
      const options = fixture(), original = options.messages;
      await assert.rejects(collect(harness.stream(options, async function* () { throw failure; })), error => error === failure);
      assert.equal(options.messages, original);
    }
  }
  const audit = auditCapture(), harness = await installed(t, undefined, () => ({ summaryGuidance: false }), audit);
  assert.throws(() => harness.stream(fixture(), () => { throw failure; }), error => error === failure);
  assert.equal(audit.attempts[0].result.outcome, 'error');
});

test('duplicate audit hooks record once even when guidance is disabled', async t => {
  const audit = auditCapture(), settings = () => ({ summaryGuidance: false });
  const harness = await installed(t, undefined, settings, audit);
  const second = harness.ctx.plugin(child => installSummaryGuidance(child, async () => 32768, settings, audit));
  await second.await(); t.after(() => second.dispose());
  let calls = 0;
  await collect(harness.stream(fixture(), async function* () { calls++; yield { type: 'finish', reason: { kind: 'stop' } }; }));
  assert.equal(calls, 1);
  assert.equal(audit.attempts.length, 1);
});

test('a disabled audit hook does not suppress later enabled guidance or claim its decision', async t => {
  const audit = auditCapture();
  const harness = await installed(t, undefined, () => ({ summaryGuidance: false }), audit);
  const second = harness.ctx.plugin(child => installSummaryGuidance(child, async () => 32768,
    () => ({ summaryGuidance: true, summaryGuidanceMode: 'always' }), audit));
  await second.await(); t.after(() => second.dispose());
  await collect(harness.stream(fixture(), async function* (options) {
    assert.equal(options.messages.at(-1).content[0].text, nativePrompt + '\n- ' + summaryInstruction(2048));
    yield { type: 'finish', reason: { kind: 'stop' } };
  }));
  assert.equal(audit.attempts.length, 1);
  assert.equal(audit.attempts[0].decision.applied, true);
  assert.equal(audit.attempts[0].decision.targetTokens, 2048);
});

test('audit ignores throwing usage getters and preserves native chunk identity', async t => {
  const chunk = { type: 'usage', get usage() { throw Error('private malformed usage'); } };
  for (const enabled of [true, false]) {
    const audit = auditCapture();
    const harness = await installed(t, undefined, () => ({ summaryGuidance: enabled }), audit);
    const results = await collect(harness.stream(fixture(), async function* () {
      yield chunk; yield { type: 'finish', reason: { kind: 'stop' } };
    }));
    assert.equal(results[0], chunk);
    assert.equal(audit.attempts[0].result.outcome, 'completed');
  }
});

test('audited passthrough forwards native return and throw before iteration', async t => {
  for (const method of ['return', 'throw']) {
    const audit = auditCapture();
    const harness = await installed(t, undefined, () => ({ summaryGuidance: false }), audit);
    let called = 0;
    const argument = method === 'throw' ? new Error('native caller error') : 'return value';
    const stream = harness.stream(fixture(), () => ({
      [Symbol.asyncIterator]() { return this; },
      async next() { assert.fail('No next() was requested'); },
      async [method](value) { called++; assert.equal(value, argument); return { value: 'native cleanup result', done: true }; },
    }));
    assert.deepEqual(await stream[method](argument), { value: 'native cleanup result', done: true });
    assert.equal(called, 1);
    assert.equal(audit.attempts[0].result.outcome, 'incomplete');
    assert.equal(audit.attempts[0].result.streamCompleted, false);
  }
});

test('closing an unstarted guided iterator releases audit ownership for a reused request', async t => {
  for (const method of ['return', 'throw']) {
    const audit = auditCapture(); let enabled = true;
    const harness = await installed(t, undefined, () => ({ summaryGuidance: enabled }), audit);
    const options = fixture();
    const first = harness.stream(options, () => { assert.fail('Unstarted guidance must not dispatch'); });
    const error = new Error('caller closed before starting');
    if (method === 'throw') await assert.rejects(first.throw(error), value => value === error);
    else await first.return();
    assert.equal(audit.attempts.length, 0);
    enabled = false;
    await collect(harness.stream(options, async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; }));
    assert.equal(audit.attempts.length, 1);
    assert.equal(audit.attempts[0].decision.reason, 'disabled');
  }
});

test('target uses only the effective output budget and source length, both at 50% by default', () => {
  assert.equal(planSummaryTarget(4096, 12000), 2048);
  assert.equal(planSummaryTarget(8192, 12000), 4096);
  assert.equal(planSummaryTarget(1024, 12000), 512);
  assert.equal(planSummaryTarget(4096, 1501), 750);
  for (const cap of [512, 1024, 4096, 8192]) {
    for (const source of [512, 1001, 2048, 10000]) {
      const target = planSummaryTarget(cap, source);
      if (target !== null) assert.ok(Number.isInteger(target) && target <= cap / 2 && target <= source / 2);
    }
  }
});

test('tiny or unknown targets are not rounded up or invented', () => {
  assert.equal(MIN_SUMMARY_TARGET, 256);
  assert.equal(planSummaryTarget(4096, 512), 256);
  assert.equal(planSummaryTarget(4096, 511), null);
  assert.equal(planSummaryTarget(511, 9000), null);
  for (const invalid of [undefined, null, 0, -1, 1.5, NaN, Infinity, '4096', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(planSummaryTarget(invalid, 8000), null);
    assert.equal(planSummaryTarget(4096, invalid), null);
  }
  assert.throws(() => summaryInstruction(0), TypeError);
  assert.throws(() => summaryInstruction(1.5), TypeError);
});

test('fractional divisors are independently applied and floored', () => {
  assert.equal(planSummaryTarget(4096, 12000, 1.5, 2.5), 2730);
  assert.equal(planSummaryTarget(4096, 1000, 1.5, 2.5), 400);
  assert.equal(planSummaryTarget(4096, 12000, 1, 1), 4096);
  for (const bad of [0.5, NaN, Infinity, null, '2', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(planSummaryTarget(4096, 12000, bad, 2), null);
    assert.equal(planSummaryTarget(4096, 12000, 2, bad), null);
  }
});

test('effective budget stays below the downstream pi-ai clamp, including the supplemental prompt', () => {
  for (const contextWindow of [16384, 32768, 65536]) {
    for (const chars of [2000, 24000, 86000, 110000]) {
      const options = fixture();
      options.messages[1].content[0].text = 'x'.repeat(chars);
      // The real adapter removes leading system history into systemPrompt,
      // flattens user text, and zeroes replayed usage. Test against pi-ai itself.
      const budget = estimateEffectiveSummaryBudget(options, contextWindow);
      assert.ok(budget >= 0 && budget <= options.maxTokens);
      const target = planSummaryTarget(budget, estimateSummarySource(options.messages));
      const piContext = { messages: options.messages.slice(1).map((message, index) => ({
        role: 'user', timestamp: 0, content: message.content[0].text +
          (index === 1 && target !== null ? '\n- ' + summaryInstruction(target) : ''),
      })) };
      const nativeCap = clampMaxTokensToContext({ contextWindow }, piContext, options.maxTokens);
      assert.ok(budget <= nativeCap, `${contextWindow}/${chars}: budget ${budget} > native cap ${nativeCap}`);
      if (target !== null) assert.ok(target <= nativeCap / 2);
    }
  }
});

test('full prompt costs and tool schemas reduce remaining output room, but not the source length', () => {
  const options = fixture();
  options.messages[1].content[0].text = 'x'.repeat(86000);
  const source = estimateSummarySource(options.messages);
  const before = estimateEffectiveSummaryBudget(options, 32768);
  assert.ok(before > 512 && before < 4096);
  const withSystem = { ...options, system: 's'.repeat(2000) };
  const withTools = { ...options, tools: [{ name: 'read', description: 't'.repeat(2000) }] };
  for (const request of [withSystem, withTools]) {
    assert.ok(estimateEffectiveSummaryBudget(request, 32768) < before);
    assert.equal(estimateSummarySource(request.messages), source);
  }
  assert.ok(estimateEffectiveSummaryBudget(options, 32768, '{target}'.repeat(200)) < before);
  assert.equal(estimateEffectiveSummaryBudget(options, 65536), 4096);
  for (const malformed of [{ ...options, system: {} }, { ...options, tools: {} },
    { ...options, messages: [{ role: 'user', content: [{ type: 'image' }] }] }]) {
    assert.equal(estimateEffectiveSummaryBudget(malformed, 32768), null);
  }
});

test('legacy context divisor is ignored; explicitly disabled guidance still does no discovery', async t => {
  for (const legacy of [1, 16, 32, 1000, null]) {
    const harness = await installed(t, async () => 32768, () => ({ summaryGuidance: true, summaryContextDivisor: legacy }));
    const options = fixture();
    await collect(harness.stream(options, async function* (request) {
      assert.match(request.messages.at(-1).content[0].text, /target of 2048 tokens/); yield {};
    }));
  }
  let calls = 0;
  const disabled = await installed(t, async () => { calls++; return 32768; }, () => ({ summaryGuidance: false, summaryContextDivisor: 16 }));
  const options = fixture(), original = options.messages;
  await collect(disabled.stream(options, async function* (request) {
    assert.strictEqual(request.messages, original); yield {};
  }));
  assert.equal(calls, 0);
});

test('near-full context reduces the live writing target; exhausted room preserves native behavior', async t => {
  const harness = await installed(t);
  for (const length of [86000, 110000]) {
    const options = fixture();
    options.messages[1].content[0].text = 'x'.repeat(length);
    const original = options.messages;
    await collect(harness.stream(options, async function* (request) {
      if (length === 86000) {
        const target = Number(request.messages.at(-1).content[0].text.match(/target of (\d+) tokens/)[1]);
        assert.ok(target >= 256 && target < 2048);
      } else assert.strictEqual(request.messages, original);
      assert.equal(request.maxTokens, 4096); yield {};
    }));
    assert.strictEqual(options.messages, original);
  }
});

test('custom template is literal text and missing placeholders or excessive length are rejected', () => {
  assert.equal(summaryInstruction(1024, '{target} tokens; ${literal}; <tag>; {target}.'), '1024 tokens; ${literal}; <tag>; 1024.');
  for (const bad of [null, '', 'No target', '{target}' + 'x'.repeat(2048)]) assert.throws(() => summaryInstruction(1024, bad));
});

test('custom guidance is appended only once across duplicate hooks and restored afterwards', async t => {
  let metadataCalls = 0;
  const resolve = async () => { metadataCalls++; return 32768; };
  const settings = () => ({ summaryGuidance: true, summaryPromptTemplate: 'Use at most {target} tokens.\nKeep the next step.', summaryOutputDivisor: 1.5 });
  const harness = await installed(t, resolve, settings);
  const second = harness.ctx.plugin(child => installSummaryGuidance(child, resolve, settings));
  await second.await(); t.after(() => second.dispose());
  const options = fixture(), original = options.messages;
  await collect(harness.stream(options, async function* (request) {
    assert.equal(request.messages.at(-1).content[0].text, nativePrompt + '\n- Use at most 2730 tokens.\nKeep the next step.');
    yield {};
  }));
  assert.equal(metadataCalls, 1); assert.strictEqual(options.messages, original);
});

test('disabled, invalid or unavailable preferences preserve native compaction without metadata', async t => {
  for (const setting of [{ summaryGuidance: false }, { summaryGuidance: 'true' },
    { summaryGuidance: true, summaryOutputDivisor: 0 }, { summaryGuidance: true, summarySourceDivisor: null },
    { summaryOutputDivisor: 0.5 }, { summarySourceDivisor: Infinity }, { summaryPromptTemplate: 'Missing placeholder' }, null]) {
    let discovery = 0, calls = 0;
    const harness = await installed(t, async () => { discovery++; return 32768; }, () => setting);
    const options = fixture(), original = structuredClone(options.messages);
    await collect(harness.stream(options, async function* (request) {
      calls++; assert.deepEqual(request.messages, original);
      yield { type: 'finish', reason: { kind: 'stop' } };
    }));
    assert.equal(calls, 1); assert.equal(discovery, 0);
  }
});

test('preferences are read per summary and the original prompt is restored between calls', async t => {
  let settings = { summaryGuidance: true, summaryOutputDivisor: 4 };
  const harness = await installed(t, async () => 32768, () => settings);
  for (const [enabled, divisor, target] of [[true, 4, 1024], [false, 4, null], [true, 2, 2048]]) {
    settings = { summaryGuidance: enabled, summaryOutputDivisor: divisor };
    const options = fixture(), original = options.messages;
    await collect(harness.stream(options, async function* (request) {
      assert.equal(request.messages.at(-1).content[0].text, target === null ? nativePrompt : `${nativePrompt}\n- ${summaryInstruction(target)}`);
      yield {};
    }));
    assert.strictEqual(options.messages, original);
  }
});

test('disabling guidance or changing its divisor during discovery skips stale supplementation', async t => {
  for (const change of [{ summaryGuidance: false, summaryOutputDivisor: 2 }, { summaryGuidance: true, summaryOutputDivisor: 4 }]) {
    let settings = { summaryGuidance: true, summaryOutputDivisor: 2 };
    const harness = await installed(t, async () => { settings = change; return 32768; }, () => settings);
    const options = fixture(), original = options.messages;
    await collect(harness.stream(options, async function* (request) {
      assert.strictEqual(request.messages, original); yield {};
    }));
  }
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

test('each summary recalculates from its requested cap, available context and selected content', async t => {
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

const recoverySettings = () => ({ summaryGuidance: true, summaryGuidanceMode: 'after-truncation' });

test('omitted mode starts with native summary and enables guidance only after truncation', async t => {
  let discoveries = 0;
  const h = await installed(t, async () => { discoveries++; return 32768; }, () => ({ summaryGuidance: undefined, summaryGuidanceMode: undefined }));
  const first = fixture(), original = first.messages.at(-1).content[0].text;
  await collect(h.stream(first, async function* (options) {
    assert.equal(options.messages.at(-1).content[0].text, original);
    yield { type: 'finish', reason: { kind: 'max-tokens' } };
  }));
  assert.equal(discoveries, 0);
  const next = fixture();
  await collect(h.stream(next, async function* (options) {
    assert.match(options.messages.at(-1).content[0].text, /target of 2048 tokens/);
    yield { type: 'finish', reason: { kind: 'stop' } };
  }));
  assert.equal(discoveries, 1);
});
const finished = kind => ({ type: 'finish', reason: { kind } });
const compactionEvent = (harness, type, data = {}, sessionId = 'test-session') => harness.ctx.emit('session/event',
  { id: sessionId }, { type, data: { compactionId: 'native-compaction', ...data } });
function committed(harness, changes = {}) {
  const { sessionId = 'test-session', provider = 'strata-server', model = 'qwen', compactionId = 'native-compaction' } = changes;
  compactionEvent(harness, 'compaction/summary', { compactionId, provider, model }, sessionId);
  compactionEvent(harness, 'compaction/end', { compactionId }, sessionId);
}

test('after-truncation leaves the first summary native, guides subsequent attempts, and resets on success', async t => {
  let discoveries = 0, dispatches = 0, downstreamVisits = 0;
  const harness = await installed(t, async () => { discoveries++; return 32768; }, recoverySettings);
  const downstream = harness.ctx.plugin(child => child.on('llm/stream', (_options, next) => {
    downstreamVisits++; return next();
  }));
  await downstream.await(); t.after(() => downstream.dispose());
  for (const [kind, guided] of [['stop', false], ['max-tokens', false], ['max-tokens', true], ['stop', true], ['stop', false]]) {
    const options = fixture(), originals = { ...options };
    const events = [ { type: 'text-delta', text: kind === 'stop' ? 'Completed native summary' : 'Partial native summary' }, finished(kind) ];
    assert.deepEqual(await collect(harness.stream(options, async function* (request) {
      dispatches++;
      assert.equal(request.messages.at(-1).content[0].text, guided ? nativePrompt + '\n- ' + summaryInstruction(2048) : nativePrompt);
      for (const [key, value] of Object.entries(originals)) if (key !== 'messages') assert.strictEqual(request[key], value, key);
      yield* events;
    })), events);
    assert.strictEqual(options.messages, originals.messages);
    if (kind === 'stop') committed(harness);
  }
  assert.equal(dispatches, 5, 'each native attempt dispatches once, including truncated attempts');
  assert.equal(downstreamVisits, 5, 'the downstream waterfall is preserved on every attempt');
  assert.equal(discoveries, 2, 'only the two armed attempts need metadata');
});

test('recovery is isolated by session, provider and model, and ordinary calls never consume it', async t => {
  const harness = await installed(t, async () => 32768, recoverySettings);
  await collect(harness.stream(fixture(), async function* () { yield finished('max-tokens'); }));
  for (const changes of [{ sessionId: 'different-session' }, { provider: 'different-provider' }, { model: 'different-model' }, { purpose: 'agent' }]) {
    await collect(harness.stream(fixture(changes), async function* (request) {
      assert.equal(request.messages.at(-1).content[0].text, nativePrompt); yield finished('stop');
    }));
  }
  await collect(harness.stream(fixture(), async function* (request) {
    assert.match(request.messages.at(-1).content[0].text, /target of 2048 tokens/); yield finished('stop');
  }));
});

test('only the native structured max-tokens finish arms recovery', async t => {
  for (const result of [finished('error'), finished('aborted'), finished('context-window-exceeded'),
    { type: 'finish', reason: { kind: 'error', failure: { message: 'output token limit' } } },
    { type: 'done', reason: { kind: 'max-tokens' } }, { type: 'finish', finishReason: 'length' },
    { type: 'text-delta', text: 'max-tokens' }, null, Error('max-tokens from a transport failure')]) {
    let discoveries = 0;
    const harness = await installed(t, async () => { discoveries++; return 32768; }, recoverySettings);
    const request = collect(harness.stream(fixture(), async function* () {
      if (result instanceof Error) throw result;
      if (result) yield result;
    }));
    if (result instanceof Error) await assert.rejects(request, e => e === result);
    else await request;
    await collect(harness.stream(fixture(), async function* (options) {
      assert.equal(options.messages.at(-1).content[0].text, nativePrompt); yield finished('stop');
    }));
    assert.equal(discoveries, 0);
  }
});

test('missing routing identity and invalid mode leave all attempts native', async t => {
  for (const changes of [{ sessionId: undefined }, { sessionId: '' }, { sessionId: 'x'.repeat(513) }, { provider: '' }, { model: undefined }]) {
    let discoveries = 0;
    const harness = await installed(t, async () => { discoveries++; return 32768; }, recoverySettings);
    for (let i = 0; i < 2; i++) await collect(harness.stream(fixture(changes), async function* (options) {
      assert.equal(options.messages.at(-1).content[0].text, nativePrompt); yield finished('max-tokens');
    }));
    assert.equal(discoveries, 0);
  }
  const harness = await installed(t, async () => { throw Error('must not discover'); }, () => ({ summaryGuidance: true, summaryGuidanceMode: 'unknown' }));
  await collect(harness.stream(fixture(), async function* (options) {
    assert.equal(options.messages.at(-1).content[0].text, nativePrompt); yield finished('max-tokens');
  }));
});

test('disabling guidance or selecting always clears pending recovery', async t => {
  for (const change of [{ summaryGuidance: false, summaryGuidanceMode: 'after-truncation' }, { summaryGuidance: true, summaryGuidanceMode: 'always' }]) {
    let settings = recoverySettings();
    const harness = await installed(t, async () => 32768, () => settings);
    await collect(harness.stream(fixture(), async function* () { yield finished('max-tokens'); }));
    settings = change;
    await collect(harness.stream(fixture({ purpose: 'agent' }), async function* () { yield finished('stop'); }));
    settings = recoverySettings();
    await collect(harness.stream(fixture(), async function* (options) {
      assert.equal(options.messages.at(-1).content[0].text, nativePrompt); yield finished('stop');
    }));
  }
});

test('aborted and incompletely consumed streams cannot arm recovery', async t => {
  for (const abort of [false, true]) {
    let discoveries = 0;
    const harness = await installed(t, async () => { discoveries++; return 32768; }, recoverySettings);
    const controller = new AbortController();
    const iterator = harness.stream(fixture({ signal: controller.signal }), async function* () {
      yield finished('max-tokens');
    })[Symbol.asyncIterator]();
    assert.deepEqual((await iterator.next()).value, finished('max-tokens'));
    if (abort) { controller.abort(); await iterator.next(); }
    else await iterator.return();
    await collect(harness.stream(fixture(), async function* (options) {
      assert.equal(options.messages.at(-1).content[0].text, nativePrompt); yield finished('stop');
    }));
    assert.equal(discoveries, 0);
  }
});

test('a failed guided attempt retains recovery and unknown metadata falls back safely', async t => {
  let metadataAvailable = true;
  const harness = await installed(t, async () => metadataAvailable ? 32768 : null, recoverySettings);
  await collect(harness.stream(fixture(), async function* () { yield finished('max-tokens'); }));
  const failure = Error('connection lost');
  await assert.rejects(collect(harness.stream(fixture(), async function* (options) {
    assert.match(options.messages.at(-1).content[0].text, /target of 2048 tokens/); throw failure;
  })), e => e === failure);
  metadataAvailable = false;
  await collect(harness.stream(fixture(), async function* (options) {
    assert.equal(options.messages.at(-1).content[0].text, nativePrompt); yield finished('max-tokens');
  }));
  metadataAvailable = true;
  await collect(harness.stream(fixture(), async function* (options) {
    assert.match(options.messages.at(-1).content[0].text, /target of 2048 tokens/); yield finished('stop');
  }));
});

test('late older failures cannot overwrite a newer successful summary', async t => {
  const gate = deferred(), entered = deferred();
  let discoveries = 0;
  const harness = await installed(t, async () => { discoveries++; return 32768; }, recoverySettings);
  const earlier = collect(harness.stream(fixture(), async function* () {
    entered.resolve(); await gate.promise; yield finished('max-tokens');
  }));
  await entered.promise;
  await collect(harness.stream(fixture(), async function* () { yield finished('stop'); }));
  gate.resolve(); await earlier;
  await collect(harness.stream(fixture(), async function* (options) {
    assert.equal(options.messages.at(-1).content[0].text, nativePrompt); yield finished('stop');
  }));
  assert.equal(discoveries, 0);
});

test('recovery memory is bounded and an evicted session safely returns to native behavior', async t => {
  const harness = await installed(t, async () => 32768, recoverySettings);
  for (let i = 0; i <= MAX_RECOVERY_SESSIONS; i++) {
    await collect(harness.stream(fixture({ sessionId: `session-${i}` }), async function* () { yield finished('max-tokens'); }));
  }
  await collect(harness.stream(fixture({ sessionId: 'session-0' }), async function* (options) {
    assert.equal(options.messages.at(-1).content[0].text, nativePrompt); yield finished('stop');
  }));
  await collect(harness.stream(fixture({ sessionId: `session-${MAX_RECOVERY_SESSIONS}` }), async function* (options) {
    assert.match(options.messages.at(-1).content[0].text, /target of 2048 tokens/); yield finished('stop');
  }));
});

test('duplicate recovery hooks observe once, preserve downstream middleware, and do not dispatch retries', async t => {
  let discoveries = 0, dispatches = 0, visits = 0;
  const resolve = async () => { discoveries++; return 32768; };
  const harness = await installed(t, resolve, recoverySettings);
  const second = harness.ctx.plugin(child => installSummaryGuidance(child, resolve, recoverySettings));
  const downstream = harness.ctx.plugin(child => child.on('llm/stream', (_options, next) => { visits++; return next(); }));
  await Promise.all([second.await(), downstream.await()]);
  t.after(() => second.dispose()); t.after(() => downstream.dispose());
  for (const [kind, guided] of [['max-tokens', false], ['stop', true], ['stop', false]]) {
    await collect(harness.stream(fixture(), async function* (options) {
      dispatches++;
      assert.equal(options.messages.at(-1).content[0].text, guided ? nativePrompt + '\n- ' + summaryInstruction(2048) : nativePrompt);
      yield finished(kind);
    }));
    if (kind === 'stop') committed(harness);
  }
  assert.equal(discoveries, 1); assert.equal(dispatches, 3); assert.equal(visits, 3);
});

test('unloading removes pending recovery before a fresh plugin instance observes the session', async t => {
  const harness = await installed(t, async () => 32768, recoverySettings);
  await collect(harness.stream(fixture(), async function* () { yield finished('max-tokens'); }));
  await harness.fiber.dispose();
  const replacement = harness.ctx.plugin(child => installSummaryGuidance(child, async () => { throw Error('must not discover'); }, recoverySettings));
  await replacement.await(); t.after(() => replacement.dispose());
  await collect(harness.stream(fixture(), async function* (options) {
    assert.equal(options.messages.at(-1).content[0].text, nativePrompt); yield finished('stop');
  }));
});

test('stop does not clear recovery when native checkpoint validation or commit fails', async t => {
  const harness = await installed(t, async () => 32768, recoverySettings);
  await collect(harness.stream(fixture(), async function* () { yield finished('max-tokens'); }));
  const guided = async () => collect(harness.stream(fixture(), async function* (options) {
    assert.match(options.messages.at(-1).content[0].text, /target of 2048 tokens/); yield finished('stop');
  }));
  await guided();
  compactionEvent(harness, 'compaction/end', { error: 'summary is not smaller than the shadowed content' });
  await guided();
  // An unmatched successful end is not proof of a committed summary.
  compactionEvent(harness, 'compaction/end');
  await guided();
  committed(harness, { provider: 'different-provider' });
  committed(harness, { model: 'different-model' });
  committed(harness, { sessionId: 'different-session' });
  await guided();
  compactionEvent(harness, 'compaction/summary', { provider: 'strata-server', model: 'qwen' });
  compactionEvent(harness, 'compaction/end', { error: 'checkpoint commit failed' });
  await guided();
  committed(harness);
  await collect(harness.stream(fixture(), async function* (options) {
    assert.equal(options.messages.at(-1).content[0].text, nativePrompt); yield finished('stop');
  }));
});

test('a matching native summary must precede its own successful compaction end', async t => {
  const harness = await installed(t, async () => 32768, recoverySettings);
  await collect(harness.stream(fixture(), async function* () { yield finished('max-tokens'); }));
  await collect(harness.stream(fixture(), async function* () { yield finished('stop'); }));
  compactionEvent(harness, 'compaction/summary', { compactionId: 'one', provider: 'strata-server', model: 'qwen' });
  compactionEvent(harness, 'compaction/end', { compactionId: 'two' });
  await collect(harness.stream(fixture(), async function* (options) {
    assert.match(options.messages.at(-1).content[0].text, /target of 2048 tokens/); yield finished('stop');
  }));
  committed(harness, { compactionId: 'three' });
  await collect(harness.stream(fixture(), async function* (options) {
    assert.equal(options.messages.at(-1).content[0].text, nativePrompt); yield finished('stop');
  }));
});

test('a native tool-calls finish with valid summary text resets only after checkpoint commit', async t => {
  const harness = await installed(t, async () => 32768, recoverySettings);
  await collect(harness.stream(fixture(), async function* () { yield finished('max-tokens'); }));
  const nativeSummary = async function* (options) {
    assert.match(options.messages.at(-1).content[0].text, /target of 2048 tokens/);
    yield { type: 'text-delta', text: 'A complete checkpoint accepted by native validation.' };
    yield finished('tool-calls');
  };
  await collect(harness.stream(fixture(), nativeSummary));
  // The finish itself is insufficient: a following native attempt is still guided.
  await collect(harness.stream(fixture(), nativeSummary));
  committed(harness);
  await collect(harness.stream(fixture(), async function* (options) {
    assert.equal(options.messages.at(-1).content[0].text, nativePrompt); yield finished('stop');
  }));
});

test('an old commit cannot clear a newer truncation, even when its summary event arrives late', async t => {
  for (const lateSummary of [false, true]) {
    const harness = await installed(t, async () => 32768, recoverySettings);
    await collect(harness.stream(fixture(), async function* () { yield finished('max-tokens'); }));
    await collect(harness.stream(fixture(), async function* () { yield finished('stop'); }));
    const summary = () => compactionEvent(harness, 'compaction/summary', { provider: 'strata-server', model: 'qwen' });
    if (!lateSummary) summary();
    await collect(harness.stream(fixture(), async function* () { yield finished('max-tokens'); }));
    if (lateSummary) summary();
    compactionEvent(harness, 'compaction/end');
    await collect(harness.stream(fixture(), async function* (options) {
      assert.match(options.messages.at(-1).content[0].text, /target of 2048 tokens/); yield finished('stop');
    }));
  }
});
