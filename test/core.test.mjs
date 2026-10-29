import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBaseURL, planBudget, discoverStrata, planModelCapabilities } from '../src/core.mjs';

const loaded = (id = 'qwen', n_ctx = 32768) => ({ id, status: 'loaded', meta: { n_ctx } });
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const stub = (models, slots = [{ n_ctx: 32768 }]) => async url => url.endsWith('/models') ? json({ data: models }) : json(slots);
const errorCode = code => error => error.code === code;

test('server roots and /v1 normalize without query or embedded credentials', () => {
  assert.equal(normalizeBaseURL('http://localhost:8080/'), 'http://localhost:8080/v1');
  assert.equal(normalizeBaseURL('https://example.test/prefix/v1/'), 'https://example.test/prefix/v1');
  for (const value of ['file:///test', 'https://u:p@example.test', 'https://example.test/?key=secret', 'https://example.test/#x', 'invalid']) {
    assert.throws(() => normalizeBaseURL(value), errorCode('INVALID_URL'));
  }
});

test('32K corrects the native invalid 65536 headroom with a valid policy', () => {
  const p = planBudget(32768);
  assert.deepEqual([p.outputTokens, p.headroomTokens, p.summaryMaxTokens, p.thresholdTokens, p.retainTokens], [9830, 4096, 4096, 18842, 3670]);
  assert.equal(p.source, 'client-derived');
  assert.equal(p.clientSafetyTokens, 4096);
});

test('64K, 8K, and custom output budgets remain internally consistent', () => {
  assert.equal(planBudget(65536).outputTokens, 16384);
  assert.equal(planBudget(65536).thresholdTokens, 45056);
  for (const p of [planBudget(8192), planBudget(65536), planBudget(32768, { outputTokens: 4096 })]) {
    assert.ok(p.thresholdTokens > p.retainTokens);
    assert.ok(p.thresholdTokens + p.outputTokens + p.headroomTokens <= p.contextWindow);
  }
  for (const value of [4096, -1, 0, NaN, Infinity, 32768.1]) assert.throws(() => planBudget(value), errorCode('UNSUPPORTED_CONTEXT'));
  for (const value of [0, -1, 30000, 32768, 1.5]) assert.throws(() => planBudget(32768, { outputTokens: value }), errorCode('INVALID_OUTPUT_BUDGET'));
});

test('discovery only reads metadata and sends credentials without returning them', async () => {
  const calls = [];
  const result = await discoverStrata('https://strata.test/', 'private-api-key', { fetch: async (url, options) => {
    calls.push({ url, options });
    return stub([loaded()])(url);
  } });
  assert.deepEqual(calls.map(call => call.url), ['https://strata.test/v1/models', 'https://strata.test/slots', 'https://strata.test/props?model=qwen']);
  for (const { options } of calls) {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer private-api-key');
  }
  assert.equal(result.model.contextWindow, 32768);
  assert.equal(result.model.contextSource, 'slots.n_ctx');
  assert.ok(!JSON.stringify(result).includes('private-api-key'));
});

test('actual slot capacity takes precedence over declared model metadata', async () => {
  const result = await discoverStrata('http://localhost:8080', '', { fetch: stub([loaded('qwen', 65536)]) });
  assert.equal(result.model.contextWindow, 32768);
  assert.ok(result.warnings.includes('SLOTS_OVERRIDE_MODEL_CONTEXT'));
});

test('Strata object status and null slot model are supported', async () => {
  const result = await discoverStrata('https://strata.test/v1', '', {
    fetch: stub([{ ...loaded(), status: { value: 'loaded' } }], [{ id: 0, n_ctx: 32768, model: null, is_processing: false }]),
  });
  assert.equal(result.model.id, 'qwen');
  assert.equal(result.model.contextSource, 'slots.n_ctx');
});

test('optional slots failures fall back to explicit model metadata', async () => {
  const result = await discoverStrata('https://strata.test', '', { fetch: async url => url.endsWith('/models') ? json({ data: [loaded()] }) : new Response('private error', { status: 404 }) });
  assert.equal(result.model.contextSource, 'models.meta.n_ctx');
  assert.ok(result.warnings.includes('SLOTS_HTTP_ERROR'));
});

test('missing, unloaded, ambiguous, and duplicate models cannot silently sync', async () => {
  for (const data of [[], [{ id: 'qwen', meta: { n_ctx: 32768 } }], [{ ...loaded(), status: 'unloaded' }]]) {
    await assert.rejects(discoverStrata('https://strata.test', '', { fetch: stub(data) }), errorCode('NO_LOADED_MODEL'));
  }
  await assert.rejects(discoverStrata('https://strata.test', '', { fetch: stub([loaded(), loaded('deepseek')]) }), errorCode('AMBIGUOUS_MODEL'));
  await assert.rejects(discoverStrata('https://strata.test', '', { fetch: stub([loaded(), loaded()]) }), errorCode('INVALID_MODELS'));
  await assert.rejects(discoverStrata('https://strata.test', '', { modelId: 'absent', fetch: stub([loaded()]) }), errorCode('MODEL_NOT_LOADED'));
});

test('multiple models require explicit selection and matching slots', async () => {
  const result = await discoverStrata('https://strata.test', '', { modelId: 'deepseek', fetch: stub([loaded(), loaded('deepseek', 65536)], [{ model: 'deepseek', n_ctx: 32768 }, { model: 'qwen', n_ctx: 16384 }]) });
  assert.equal(result.model.id, 'deepseek');
  assert.equal(result.model.contextWindow, 32768);
});

test('unknown capacity is rejected rather than guessed', async () => {
  await assert.rejects(discoverStrata('https://strata.test', '', { fetch: stub([{ id: 'qwen', status: 'loaded' }], []) }), errorCode('CONTEXT_UNAVAILABLE'));
});

test('conflicting live slot capacities cannot silently select a context', async () => {
  await assert.rejects(discoverStrata('https://strata.test', '', { fetch: stub([loaded()], [{ n_ctx: 32768 }, { n_ctx: 16384 }]) }), errorCode('AMBIGUOUS_CONTEXT'));
});

test('malformed JSON, oversized payloads, and redirects fail without leaking bodies', async () => {
  for (const [response, code] of [
    [new Response('private invalid payload'), 'INVALID_JSON'],
    [json({ models: [loaded()] }), 'INVALID_MODELS'],
    [new Response('secret', { status: 302, headers: { location: 'https://attacker.test/' } }), 'REDIRECT_REJECTED'],
    [new Response('x'.repeat(256 * 1024 + 1)), 'RESPONSE_TOO_LARGE'],
    [new Response('private server message', { status: 401 }), 'HTTP_ERROR'],
  ]) {
    await assert.rejects(discoverStrata('https://strata.test', 'private-api-key', { fetch: async () => response }), error => {
      assert.equal(error.code, code);
      assert.ok(!error.message.includes('private'));
      assert.ok(!error.message.includes('attacker'));
      return true;
    });
  }
});

test('network errors and credential validation do not expose credentials', async () => {
  await assert.rejects(discoverStrata('https://strata.test', 'private-api-key', { fetch: async () => { throw new Error('private-api-key'); } }), error => error.code === 'CONNECTION_FAILED' && !error.message.includes('private-api-key'));
  await assert.rejects(discoverStrata('https://strata.test', 'bad\r\nkey'), errorCode('INVALID_CREDENTIAL'));
});

test('timeout aborts the metadata fetch', async () => {
  await assert.rejects(discoverStrata('https://strata.test', '', { timeout: 10, fetch: async (_url, options) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(json({ data: [loaded()] })), 1000);
    options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
  }) }), errorCode('TIMEOUT'));
});
