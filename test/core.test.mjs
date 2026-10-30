import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBaseURL, planBudget, discoverStrata, planModelCapabilities } from '../src/core.mjs';

const loaded = (id = 'qwen', n_ctx = 32768) => ({ id, status: 'loaded', meta: { n_ctx } });
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const stub = (models, slots = [{ n_ctx: 32768 }]) => async url => url.endsWith('/models') ? json({ data: models }) : json(slots);
const errorCode = code => error => error.code === code;

test('cancelled summary discovery makes no request and never exposes abort details', async () => {
  const controller = new AbortController();
  controller.abort(new Error('private cancellation detail'));
  let calls = 0;
  await assert.rejects(discoverStrata('http://localhost:8080', '', {
    signal: controller.signal, fetch: async () => { calls++; return json({}); },
  }), error => error.code === 'ABORTED' && !error.message.includes('private'));
  assert.equal(calls,0);
});

test('an in-flight metadata read follows the original summary cancellation signal', async () => {
  const controller = new AbortController();
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const task = discoverStrata('http://localhost:8080', '', {
    signal:controller.signal,
    fetch:async (_url,options) => new Promise((_resolve,reject) => {
      options.signal.addEventListener('abort',()=>reject(new Error('private transport detail')),{once:true});
      started();
    }),
  });
  await ready;
  controller.abort();
  await assert.rejects(task, error => error.code === 'ABORTED' && !error.message.includes('private'));
});

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
  assert.equal(planBudget(65536).outputTokens, 19660);
  assert.equal(planBudget(65536).thresholdTokens, 41780);
  for (const p of [planBudget(8192), planBudget(65536), planBudget(32768, { outputTokens: 4096 })]) {
    assert.ok(p.thresholdTokens > p.retainTokens);
    assert.ok(p.thresholdTokens + p.outputTokens + p.headroomTokens <= p.contextWindow);
  }
  for (const value of [4096, -1, 0, NaN, Infinity, 32768.1]) assert.throws(() => planBudget(value), errorCode('UNSUPPORTED_CONTEXT'));
  for (const value of [0, -1, 30000, 32768, 1.5]) assert.throws(() => planBudget(32768, { outputTokens: value }), errorCode('INVALID_OUTPUT_BUDGET'));
});

test('automatic output budget matches Strata floor, ratio and ceiling without overriding server or manual limits', () => {
  for (const [context, output] of [[8192,4096],[12288,4096],[16384,4915],[32768,9830],[65536,19660],[109226,32767],[109227,32768],[131072,32768],[1048576,32768]]) {
    const p=planBudget(context);
    assert.equal(p.outputTokens,output);
    assert.equal(p.outputSource,'calculated');
    assert.ok(p.thresholdTokens>p.retainTokens);
    assert.ok(p.thresholdTokens+p.outputTokens+p.headroomTokens<=context);
    if(context>=12288)assert.equal(p.headroomTokens,4096);
  }
  assert.equal(planBudget(8192).headroomTokens,2048);
  assert.equal(planBudget(32768,{serverOutputTokens:2048}).outputTokens,2048);
  assert.equal(planBudget(131072,{serverOutputTokens:40000}).outputTokens,40000);
  assert.equal(planBudget(131072,{serverOutputTokens:40000,outputTokens:50000}).outputTokens,50000);
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

test('loaded aliases collapse to the canonical text model and its metadata', async () => {
  const canonical = { ...loaded(), architecture: { input_modalities: ['text'], output_modalities: ['text'] } };
  const aliases = [
    { ...loaded('coding', 65536), alias_of: 'qwen', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
    { ...loaded('default'), alias_of: 'coding' },
  ];
  const calls = [];
  const result = await discoverStrata('https://strata.test', '', { fetch: async url => {
    calls.push(url);
    return stub([...aliases, canonical], [])(url);
  } });
  assert.equal(result.model.id, 'qwen');
  assert.equal(result.model.contextWindow, 32768);
  assert.deepEqual(result.model.capabilities.input, ['text']);
  assert.equal(result.model.contextSource, 'models.meta.n_ctx');
  assert.equal(calls.at(-1), 'https://strata.test/props?model=qwen');
  const explicit = await discoverStrata('https://strata.test', '', { modelId: 'default', fetch: stub([...aliases, canonical]) });
  assert.equal(explicit.model.id, 'qwen');
  assert.equal(explicit.model.contextSource, 'slots.n_ctx');
});

test('image generation entries and their aliases do not cause text model ambiguity', async () => {
  const image = { ...loaded('image-generator'), architecture: { input_modalities: ['text'], output_modalities: ['image'] } };
  const alias = { ...loaded('image-alias'), alias_of: 'image-generator' };
  // Text model deliberately omits output_modalities for older Strata versions.
  const result = await discoverStrata('https://strata.test', '', { fetch: stub([image, loaded(), alias]) });
  assert.equal(result.model.id, 'qwen');
  assert.equal(result.model.contextSource, 'slots.n_ctx');
  await assert.rejects(discoverStrata('https://strata.test', '', { fetch: stub([image, alias]) }), errorCode('NO_LOADED_MODEL'));
  await assert.rejects(discoverStrata('https://strata.test', '', { modelId: 'image-generator', fetch: stub([loaded(), image]) }), errorCode('MODEL_NOT_LOADED'));
});

test('aliases do not hide genuine multiple text models or trust unassociated slots', async () => {
  const rows = [loaded(), { ...loaded('coding'), alias_of: 'qwen' }, loaded('deepseek')];
  await assert.rejects(discoverStrata('https://strata.test', '', { fetch: stub(rows) }), errorCode('AMBIGUOUS_MODEL'));
  const selected = await discoverStrata('https://strata.test', '', {
    modelId: 'coding', fetch: stub(rows, [{ model: 'coding', n_ctx: 16384 }, { model: 'deepseek', n_ctx: 65536 }]),
  });
  assert.equal(selected.model.id, 'qwen');
  assert.equal(selected.model.contextWindow, 16384);
  const unlabelled = await discoverStrata('https://strata.test', '', { modelId: 'coding', fetch: stub(rows, [{ n_ctx: 16384 }]) });
  assert.equal(unlabelled.model.contextWindow, 32768);
  assert.equal(unlabelled.model.contextSource, 'models.meta.n_ctx');
});

test('canonical and alias slot capacities must agree', async () => {
  const rows = [loaded(), { ...loaded('coding'), alias_of: 'qwen' }];
  await assert.rejects(discoverStrata('https://strata.test', '', {
    fetch: stub(rows, [{ model: 'qwen', n_ctx: 32768 }, { model: 'coding', n_ctx: 16384 }]),
  }), errorCode('AMBIGUOUS_CONTEXT'));
});

test('loaded aliases must resolve to an existing loaded canonical model', async () => {
  const malformed = [
    [{ ...loaded('coding'), alias_of: 'absent' }],
    [loaded(), { ...loaded('coding'), alias_of: '' }],
    [loaded(), { ...loaded('coding'), alias_of: null }],
    [loaded(), { ...loaded('coding'), alias_of: 'coding' }],
    [{ ...loaded('a'), alias_of: 'b' }, { ...loaded('b'), alias_of: 'a' }],
    [{ ...loaded(), status: 'unloaded' }, { ...loaded('coding'), alias_of: 'qwen' }],
    [loaded(), { ...loaded('coding'), alias_of: 'qwen', architecture: { output_modalities: ['image'] } }],
  ];
  for (const rows of malformed) {
    await assert.rejects(discoverStrata('https://strata.test', '', { fetch: stub(rows) }), errorCode('INVALID_MODELS'));
  }
  // Alias metadata cannot stand in for missing canonical context evidence.
  await assert.rejects(discoverStrata('https://strata.test', '', {
    fetch: stub([{ id: 'qwen', status: 'loaded' }, { ...loaded('coding'), alias_of: 'qwen' }], []),
  }), errorCode('CONTEXT_UNAVAILABLE'));
});

test('malformed output modalities cannot be mistaken for a legacy text model', async () => {
  for (const output_modalities of [null, [], 'text', ['text', 'text'], [''], [123]]) {
    await assert.rejects(discoverStrata('https://strata.test', '', {
      fetch: stub([{ ...loaded(), architecture: { output_modalities } }]),
    }), errorCode('INVALID_MODELS'));
  }
});

test('output props accept only identities belonging to the selected canonical model', async () => {
  const rows = [loaded(), { ...loaded('coding'), alias_of: 'qwen' }, loaded('deepseek'), { ...loaded('other-alias'), alias_of: 'deepseek' }];
  for (const [model_alias, expected] of [['qwen', 8192], ['coding', 8192], ['other-alias', null], ['unlisted-alias', null]]) {
    const result = await discoverStrata('https://strata.test', '', {
      modelId: 'coding', fetch: async url => url.includes('/props?')
        ? json({ build_info: 'Strata 0.2.7', model_alias, default_generation_settings: { params: { n_predict: 8192 } } })
        : stub(rows, [{ model: 'qwen', n_ctx: 32768 }])(url),
    });
    assert.equal(result.model.id, 'qwen');
    assert.equal(result.model.serverOutputTokens, expected);
    assert.equal(result.model.outputLimitStatus, expected ? 'server' : 'unverified');
  }
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
  await assert.rejects(discoverStrata('https://strata.test', 'bad\nkey'), errorCode('INVALID_CREDENTIAL'));
});

test('timeout aborts the metadata fetch', async () => {
  await assert.rejects(discoverStrata('https://strata.test', '', { timeout: 10, fetch: async (_url, options) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(json({ data: [loaded()] })), 1000);
    options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
  }) }), errorCode('TIMEOUT'));
});

test('output budget prefers explicit override, then server default, then calculation', () => {
  assert.equal(planBudget(32768,{serverOutputTokens:8192}).outputTokens,8192);
  assert.equal(planBudget(32768,{serverOutputTokens:8192}).outputSource,'server');
  const manual=planBudget(32768,{serverOutputTokens:8192,outputTokens:4096});
  assert.equal(manual.outputTokens,4096); assert.equal(manual.outputSource,'manual');
  assert.equal(planBudget(32768,{serverOutputTokens:null}).outputTokens,9830);
  assert.equal(planBudget(32768).outputSource,'calculated');
  // Never silently replace a real server cap that makes DSH compaction invalid.
  for(const serverOutputTokens of [30000,32768,999999]) assert.throws(()=>planBudget(32768,{serverOutputTokens}),errorCode('INVALID_OUTPUT_BUDGET'));
});
const outputProps = value => ({build_info:'Strata 0.1.52',model_alias:'qwen',default_generation_settings:{params:{n_predict:value}}});
const discoverOutput = props => discoverStrata('https://strata.test','',{fetch:async url=>url.includes('/props?')?json(props):stub([loaded()])(url)});
test('verified model props supply output default independently of reasoning-template support', async () => {
  const r=await discoverOutput(outputProps(8192));
  assert.equal(r.model.serverOutputTokens,8192);assert.equal(r.model.outputLimitStatus,'server');
  assert.equal(r.model.capabilities.reasoning,null);
});
test('missing or unlimited server output falls back; wrong model and identity are not trusted', async () => {
  for(const [value,status]of [[undefined,'missing'],[null,'missing'],[-1,'unlimited'],[0,'unlimited']]){
    const r=await discoverOutput(outputProps(value));
    assert.equal(r.model.serverOutputTokens,null);assert.equal(r.model.outputLimitStatus,status);
    assert.equal(planBudget(r.model.contextWindow,{serverOutputTokens:r.model.serverOutputTokens}).outputTokens,9830);
  }
  for(const props of [{...outputProps(8192),model_alias:'different'},{...outputProps(8192),build_info:'unverified'}]){
    const r=await discoverOutput(props); assert.equal(r.model.serverOutputTokens,null); assert.equal(r.model.outputLimitStatus,'unverified');
  }
  const r=await discoverStrata('https://strata.test','',{fetch:async url=>url.includes('/props?')?new Response('',{status:404}):stub([loaded()])(url)});
  assert.equal(r.model.outputLimitStatus,'unavailable');
});
test('malformed explicit server output is rejected instead of silently choosing another cap', async () => {
  for(const value of ['8192',true,-2,1.5,{},Number.MAX_SAFE_INTEGER+1])
    await assert.rejects(discoverOutput(outputProps(value)),errorCode('INVALID_SERVER_OUTPUT_BUDGET'));
});
