import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { apply, Config } from '../src/plugin.mjs';

const PKG = 'dsh-strata-sync';
const LLM = '@deepseek-ai/dsh-llm-pi-ai';
const COMPACT = '@deepseek-ai/dsh-compaction-basic';
const DEFAULT = '@deepseek-ai/dsh-agent-default-model';
const PRESET = '@deepseek-ai/dsh-agent-preset';
test('native config schema supplies summary defaults and validates persisted preferences', () => {
  assert.equal(Config({}).summaryGuidance, true);
  assert.equal(Config({}).summaryContextDivisor, 16);
  assert.equal(Config({ summaryGuidance: false, summaryContextDivisor: 32 }).summaryGuidance, false);
  assert.equal(Config({ summaryOutputDivisor: 1.5 }).summaryOutputDivisor, 1.5);
  assert.equal(Config({}).summarySourceDivisor, 2);
  for (const config of [{ summaryGuidance: 'true' }, ...[0, -1, 0.5, '16', Number.MAX_SAFE_INTEGER + 1].map(summaryContextDivisor => ({ summaryContextDivisor }))]) {
    assert.throws(() => Config(config));
  }
});
async function harness(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-sync-test-'));
  const documentPath = join(dir, 'cordis.patch.yml');
  await writeFile(documentPath, 'original test configuration\n');
  const entries = [
    { options: { id: 'llm-pi-ai', name: LLM, config: { providers: {
      'strata-server': { api: 'openai-completions', baseURL: 'http://127.0.0.1:8080/v1', apiKeyEnv: 'TEST_KEY', models: [
        { id: 'qwen', name: 'Qwen custom label', contextWindow: 65536, maxTokens: 16384, reasoning: true, input: ['text','image'] },
        { id: 'other-model', contextWindow: 65536, maxTokens: 16384 },
      ] },
      cloud: { baseURL: 'https://cloud.invalid/v1', apiKeyEnv: 'CLOUD_KEY' },
    } } } },
    { options: { id: 'compaction-basic', name: COMPACT, config: { modelPolicies: [
      { provider: 'cloud', model: 'cloud-model', maxTokens: 8192, headroomTokens: 8192 },
    ] } } },
    { options: { id: 'agent-default-model', name: DEFAULT, config: { provider: 'strata-server', model: 'qwen', keepCustom: true } } },
    { options: { id: 'strata-sync', name: PKG, config: { providerId: 'strata-server', autoSync: !!options.autoSync, followLoadedModel: true } } },
  ];
  for (const entry of entries) entry.fiber = { state: 2 };
  if (options.presets) {
    entries[1].fiber = undefined; // Native Web/Desktop keeps this profile placeholder inactive.
    for (const id of options.presets) entries.push({ fiber: { state: 2 }, options: {
      id: `preset-${id}`, name: PRESET, config: { id, name: `${id} preset`, plugins: [
        { id: 'compaction', name: 'cordis:group', group: true, config: [
          { id: 'compaction-basic', name: COMPACT, config: { maxTokens: id === 'standard' ? 65536 : 12000,
            modelPolicies: [{ provider: 'cloud', model: 'cloud-model', maxTokens: 8192 }] } },
          { id: 'keep-pruner', name: '@deepseek-ai/dsh-compaction-tool-result-pruner', config: { thresholdChars: 8192 } },
        ] },
        { id: 'disabled-compaction', name: COMPACT, disabled: true, config: { maxTokens: 12345 } },
        { id: 'conditional', name: 'cordis:group', group: true, disabled: { __jsExpr: 'process.platform === "win32"' }, config: [{ id: 'conditional-compaction', name: COMPACT }] },
      ] },
    } });
  }
  let poll, requests = 0, writes = 0;
  const routes = new Map();
  let running = false;
  const effects = [];
  const callbacks = {};
  const realInterval = globalThis.setInterval, realClear = globalThis.clearInterval, realFetch = globalThis.fetch;
  globalThis.setInterval = (fn) => {
    // Real timers retain the AsyncLocalStorage context of their creation site.
    const scope = AsyncLocalStorage.snapshot();
    poll = () => scope(fn);
    return { unref() {} };
  };
  globalThis.clearInterval = () => {};
  globalThis.fetch = async (url, init) => {
    requests++;
    assert.equal(init.method, 'GET');
    assert.equal(init.headers.Authorization, 'Bearer do-not-expose-test-secret');
    if (options.beforeFetch) await options.beforeFetch(url);
    if (options.serverStatus) return new Response('private server error body must not be shown', { status: options.serverStatus });
    if (url.includes('/props?') && options.props) return new Response(JSON.stringify(options.props()),{headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify(url.endsWith('/models') ? { data: [{ id: 'qwen', status: { value: 'loaded' }, meta: { n_ctx: 32768 }, ...(options.modalities ? {architecture:{input_modalities:options.modalities}} : {}) }] } : [{ n_ctx: 32768 }]), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const ctx = {
    configEditor: {
      documentPath, entries: () => entries,
      edit: async (entry, change) => {
        if (options.hmrStore?.getStore()) throw Error('HMR transactions cannot be nested');
        if (!entries.includes(entry) || !entry.fiber) throw Error('Configuration entry is no longer available');
        if (entry.fiber.state !== 2) throw Error('Configuration plugin is no longer active');
        await options.beforeEdit?.(entry);
        const next = change(structuredClone(entry.options.config));
        if (options.rejectCompaction && entry.options.name === COMPACT) throw Error('injected write failure');
        entry.options.config = structuredClone(next);
        writes++;
      },
    },
    agents: { list: () => running ? [{ status: 'running' }] : [] },
    agentPresets: { resolve: async id => ({ id, ...(options.presetBrokenAfterWrite && writes >= 2 ? { broken: 'private diagnostic' } : {}) }) },
    get: name => name === 'hmr' && options.hmrStore ? { executing: options.hmrStore } : undefined,
    credentials: { resolve: async () => ({ value: 'do-not-expose-test-secret' }) },
    connection: { fetch: { register: (route) => {
      assert.match(route.path, /^\/api\/strata-sync\/(status|preview|apply|configure)$/);
      assert.deepEqual(route.methods, ['POST']); assert.equal(route.requestBody, 'streaming');
      routes.set(route.path, route);
    } } },
    on: (name, callback) => { callbacks[name] = callback; },
    effect: (callback) => { effects.push(callback()); },
  };
  if (options.hmrStore) options.hmrStore.run(true, () => apply(ctx, entries[3].options.config));
  else apply(ctx, entries[3].options.config);
  const raw = (method, request) => routes.get(`/api/strata-sync/${method}`).fetch(request);
  // The real Connection implementation rejects non-owner Peers before invoking
  // an exact route. Mirror that admission boundary without weakening the plugin.
  const call = async (method, data = {}, owner = true) => {
    if (!owner) return { ok: false, error: { code: 'forbidden' } };
    const response = await raw(method, new Request(`http://dsh.test/api/strata-sync/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'test-rpc', method: `strata-sync/${method}`, payload: data }),
    }));
    return (await response.json()).result;
  };
  const dispose = () => { for (const cleanup of effects.splice(0)) cleanup?.(); };
  return { call, raw, entries, ctx, dispose, stream: (options, next) => callbacks['llm/stream'](options, next), get requests() { return requests; }, get writes() { return writes; },
    reload: () => { dispose(); poll=undefined; apply(ctx, entries[3].options.config); }, setRunning: value => { running = value; },
    poll: async () => { poll?.(); for (let i = 0; i < 25; i++) { await new Promise(resolve => setTimeout(resolve, 5)); } },
    backupCount: async () => { try { return (await readdir(join(dir, 'backups', 'strata-sync'))).length; } catch { return 0; } },
    close: async () => { dispose(); globalThis.setInterval = realInterval; globalThis.clearInterval = realClear; globalThis.fetch = realFetch; await rm(dir, { recursive: true, force: true }); },
  };
}

const nativeSummaryPrompt = () => readFile(new URL('./fixtures/native-summary-instruction.txt', import.meta.url), 'utf8');
async function summaryRequest(overrides = {}) {
  return { provider: 'strata-server', model: 'qwen', purpose: 'compaction', maxTokens: 4096,
    sessionId: 'test-summary', messages: [
      { role: 'system', content: [{ type: 'text', text: 'System prompt is not compactable.'.repeat(400) }] },
      { role: 'user', content: [{ type: 'text', text: 'Selected history. '.repeat(4000) }] },
      { role: 'user', content: [{ type: 'text', text: await nativeSummaryPrompt() }] },
    ], ...overrides };
}
const verifiedProps = () => ({ build_info: 'Strata 0.1.52', model_alias: 'qwen', default_generation_settings: { params: { n_predict: -1 } } });

test('live summaries recheck verified metadata and append one sentence without configuration writes', async () => {
  const h = await harness({ props: verifiedProps });
  try {
    h.setRunning(true);
    const before = structuredClone(h.entries.map(row => row.options.config));
    for (const [maxTokens, target] of [[4096,2048],[1024,512]]) {
      const options = await summaryRequest({ maxTokens });
      const original = structuredClone(options);
      let dispatches = 0;
      for await (const chunk of h.stream(options, async function* () {
        dispatches++;
        assert.ok(options.messages.at(-1).content[0].text.startsWith(original.messages.at(-1).content[0].text + '\n- '));
        assert.match(options.messages.at(-1).content[0].text, new RegExp(`target of ${target} tokens`));
        assert.deepEqual({ ...options, messages: original.messages }, original);
        yield { type: 'finish', reason: { kind: 'stop' } };
      })) assert.equal(chunk.reason.kind, 'stop');
      assert.equal(dispatches,1);
      assert.deepEqual(options, original);
    }
    assert.equal(h.requests,6);
    assert.equal(h.writes,0);
    assert.equal(await h.backupCount(),0);
    assert.deepEqual(h.entries.map(row => row.options.config), before);
  } finally { await h.close(); }
});

test('summary guidance is confined to the selected provider and actually loaded model', async () => {
  const h = await harness({ props: verifiedProps });
  try {
    for (const route of [{ provider:'cloud' },{ model:'other-model' }]) {
      const options = await summaryRequest(route), original = structuredClone(options);
      for await (const _ of h.stream(options, async function* () { assert.deepEqual(options,original); yield {}; })) {}
    }
    // Other providers never receive discovery traffic; the unloaded model is
    // rejected by its model listing before any optional metadata is requested.
    assert.equal(h.requests,1);
    assert.equal(h.writes,0);
  } finally { await h.close(); }
});

test('unverified servers and model edits during discovery leave native summaries untouched', async () => {
  for (const changed of [false,true]) {
    let h;
    h = await harness({ props: () => changed ? verifiedProps() : { build_info:'Unknown',model_alias:'qwen' },
      beforeFetch: changed ? async url => {
        if (url.endsWith('/models')) h.entries[0].options.config.providers['strata-server'].models[0].contextWindow = 16384;
      } : undefined });
    try {
      const options = await summaryRequest(), original = structuredClone(options);
      for await (const _ of h.stream(options, async function* () { assert.deepEqual(options,original); yield {}; })) {}
      assert.equal(h.writes,0);
    } finally { await h.close(); }
  }
});

test('summary target respects a smaller existing client context without syncing any settings', async () => {
  const h = await harness({ props: verifiedProps });
  try {
    h.entries[0].options.config.providers['strata-server'].models[0].contextWindow = 16384;
    const options = await summaryRequest();
    for await (const _ of h.stream(options, async function* () {
      assert.match(options.messages.at(-1).content[0].text,/target of 1024 tokens/); yield {};
    })) {}
    assert.equal(h.writes,0);
  } finally { await h.close(); }
});

test('summary preferences default on, save independently, survive reload and control native requests', async () => {
  const h = await harness({ props: verifiedProps });
  try {
    const initial = (await h.call('status')).value;
    assert.equal(initial.summaryGuidance, true);
    assert.equal(initial.summaryContextDivisor, 16);
    const others = structuredClone(h.entries.slice(0, 3));
    const saved = await h.call('configure', { expectedRevision: initial.settingsRevision, summaryGuidance: false, summaryContextDivisor: 32 });
    assert.equal(saved.ok, true);
    assert.equal(saved.value.summaryGuidance, false);
    assert.equal(saved.value.summaryContextDivisor, 32);
    assert.deepEqual(h.entries.slice(0, 3), others);
    assert.equal(await h.backupCount(), 1);
    h.reload();
    const off = (await h.call('status')).value;
    assert.equal(off.summaryGuidance, false); assert.equal(off.summaryContextDivisor, 32);
    const options = await summaryRequest(), original = structuredClone(options);
    let calls = 0;
    for await (const _ of h.stream(options, async function* () { calls++; assert.deepEqual(options, original); yield {}; })) {}
    assert.equal(calls, 1); assert.equal(h.requests, 0);
    const enabled = await h.call('configure', { expectedRevision: off.settingsRevision, summaryGuidance: true });
    assert.equal(enabled.value.summaryContextDivisor, 32);
    h.reload();
    for await (const _ of h.stream(options, async function* () {
      assert.match(options.messages.at(-1).content[0].text, /target of 1024 tokens/); yield {};
    })) {}
    assert.deepEqual(options, original);
    assert.equal(h.writes, 2); assert.equal(h.requests, 3);
    assert.deepEqual(h.entries.slice(0, 3), others);
  } finally { await h.close(); }
});

test('summary preference validation rejects invalid values before backup and revision protects concurrent edits', async () => {
  const h = await harness();
  try {
    const initial = (await h.call('status')).value;
    for (const patch of [{ summaryGuidance: null }, { summaryGuidance: 1 },
      ...['summaryContextDivisor', 'summaryOutputDivisor', 'summarySourceDivisor'].flatMap(key => [null, 0, -1, 0.5, '16', Number.MAX_SAFE_INTEGER + 1].map(value => ({ [key]: value }))),
      ...[null, '', 'No placeholder', '{target}' + 'a'.repeat(2048)].map(summaryPromptTemplate => ({ summaryPromptTemplate }))]) {
      const result = await h.call('configure', { expectedRevision: initial.settingsRevision, ...patch });
      assert.equal(result.ok, false);
      assert.ok(['invalid-budget', 'invalid-request'].includes(result.error.code));
    }
    assert.equal(h.writes, 0); assert.equal(await h.backupCount(), 0);
    h.entries[3].options.config.summaryContextDivisor = 64;
    const stale = await h.call('configure', { expectedRevision: initial.settingsRevision, summaryGuidance: false });
    assert.equal(stale.error.code, 'stale-settings');
    assert.equal(h.writes, 0);
  } finally { await h.close(); }
});

test('summary preference changes during discovery keep the original request', async () => {
  for (const patch of [{ summaryGuidance: false }, { summaryContextDivisor: 32 }, { summaryOutputDivisor: 1.5 }, { summarySourceDivisor: 3.5 }, { summaryPromptTemplate: 'Summarize in {target} tokens.' }]) {
    let h;
    h = await harness({ props: verifiedProps, beforeFetch: async url => {
      if (url.endsWith('/models')) Object.assign(h.entries[3].options.config, patch);
    } });
    try {
      const options = await summaryRequest(), original = structuredClone(options);
      for await (const _ of h.stream(options, async function* () { assert.deepEqual(options, original); yield {}; })) {}
      assert.equal(h.writes, 0);
    } finally { await h.close(); }
  }
});

test('custom template and fractional divisors persist, render literally, and reset without touching other settings', async () => {
  const h = await harness({ props: verifiedProps });
  try {
    const initial = (await h.call('status')).value;
    assert.equal(initial.summaryPromptTemplate, initial.defaultSummaryPromptTemplate);
    const others = structuredClone(h.entries.slice(0, 3));
    const template = 'Condense into {target} tokens. Keep ${literal} and <tags> intact; limit {target}.';
    const saved = await h.call('configure', { expectedRevision: initial.settingsRevision,
      summaryPromptTemplate: template, summaryContextDivisor: 8.5, summaryOutputDivisor: 1.5, summarySourceDivisor: 2.5 });
    assert.equal(saved.ok, true);
    h.reload();
    const current = (await h.call('status')).value;
    assert.equal(current.summaryPromptTemplate, template);
    assert.equal(current.summaryContextDivisor, 8.5);
    assert.equal(current.summaryOutputDivisor, 1.5);
    assert.equal(current.summarySourceDivisor, 2.5);
    const options = await summaryRequest(), original = structuredClone(options);
    for await (const _ of h.stream(options, async function* () {
      assert.equal(options.messages.at(-1).content[0].text, original.messages.at(-1).content[0].text + '\n- ' + template.replaceAll('{target}', '2730'));
      assert.equal(options.maxTokens, 4096); yield {};
    })) {}
    const reset = await h.call('configure', { expectedRevision: current.settingsRevision, summaryPromptTemplate: current.defaultSummaryPromptTemplate });
    assert.equal(reset.value.summaryPromptTemplate, initial.summaryPromptTemplate);
    assert.equal(reset.value.summaryOutputDivisor, 1.5);
    assert.deepEqual(h.entries.slice(0, 3), others);
    assert.deepEqual(options, original);
  } finally { await h.close(); }
});

test('exact routes use the native owner-only admission boundary without server queries or writes', async () => {
  const h = await harness(); try {
    const result = await h.call('preview', {}, false);
    assert.equal(result.ok, false); assert.equal(result.error.code, 'forbidden');
    assert.equal(h.requests, 0); assert.equal(h.writes, 0);
  } finally { await h.close(); }
});

test('RPC envelope must match the registered endpoint and is bounded to 8 KiB', async () => {
  const h = await harness(); try {
    const mismatched = await h.raw('apply', new Request('http://dsh.test/api/strata-sync/apply', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'test', method: 'strata-sync/status', payload: {} }),
    }));
    assert.equal(mismatched.status, 400);
    assert.equal((await mismatched.json()).result.error.code, 'invalid-request');
    const huge = await h.raw('status', new Request('http://dsh.test/api/strata-sync/status', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: ' '.repeat(8193),
    }));
    assert.equal(huge.status, 413); assert.equal(h.requests, 0); assert.equal(h.writes, 0);
  } finally { await h.close(); }
});

test('safe discovery errors keep their category without leaking provider response content', async () => {
  const h = await harness({ serverStatus: 401 }); try {
    const result = await h.call('preview');
    assert.equal(result.ok, false); assert.equal(result.error.code, 'HTTP_ERROR');
    assert.deepEqual(result.error.details, {});
    assert.match(result.error.message, /401/);
    assert.ok(!JSON.stringify(result).includes('private server error body'));
    assert.equal(h.writes, 0);
  } finally { await h.close(); }
});

test('busy task prevents application and backup creation', async () => {
  const h = await harness(); try {
    const p = (await h.call('preview')).value;
    h.setRunning(true);
    const result = await h.call('apply', { fingerprint: p.fingerprint });
    assert.equal(result.ok, false); assert.equal(result.error.code, 'busy');
    assert.equal(h.writes, 0); assert.equal(await h.backupCount(), 0);
  } finally { await h.close(); }
});

test('stale preview fails after a concurrent model setting change', async () => {
  const h = await harness(); try {
    const p = (await h.call('preview')).value;
    h.entries[0].options.config.providers['strata-server'].models[0].name = 'Updated elsewhere';
    const result = await h.call('apply', { fingerprint: p.fingerprint });
    assert.equal(result.ok, false); assert.equal(result.error.code, 'stale-preview');
    assert.equal(h.writes, 0); assert.equal(await h.backupCount(), 0);
  } finally { await h.close(); }
});

test('apply preserves credentials, reasoning, other models and unrelated policies', async () => {
  const h = await harness(); try {
    const before = structuredClone(h.entries[0].options.config);
    const otherPolicy = structuredClone(h.entries[1].options.config.modelPolicies[0]);
    const p = (await h.call('preview')).value;
    assert.equal(p.budget.thresholdTokens, 18842);
    assert.ok(!JSON.stringify(p).includes('do-not-expose-test-secret'));
    const result = await h.call('apply', { fingerprint: p.fingerprint });
    assert.equal(result.ok, true); assert.equal(result.value.applied, true);
    const route = h.entries[0].options.config.providers['strata-server'];
    assert.equal(route.apiKeyEnv, 'TEST_KEY');
    assert.equal(route.models[0].reasoning, true); assert.deepEqual(route.models[0].input, ['text','image']);
    assert.equal(route.models[0].name, 'Qwen custom label'); assert.equal(route.models[0].contextWindow, 32768);
    assert.equal(route.models[0].maxTokens, 9830);
    assert.deepEqual(route.models[1], before.providers['strata-server'].models[1]);
    assert.deepEqual(h.entries[0].options.config.providers.cloud, before.providers.cloud);
    assert.deepEqual(h.entries[1].options.config.modelPolicies[0], otherPolicy);
    assert.equal(h.entries[1].options.config.modelPolicies[1].headroomTokens, 4096);
    assert.equal(await readFile(result.value.backupPath, 'utf8'), 'original test configuration\n');
    const second = (await h.call('preview')).value;
    const secondApply = await h.call('apply', { fingerprint: second.fingerprint });
    assert.equal(secondApply.value.applied, false); assert.equal(await h.backupCount(), 1);
  } finally { await h.close(); }
});

test('confirmed input changes apply once while unknown reasoning remains intact', async () => {
  const h=await harness({modalities:['text']});try {
    const model=h.entries[0].options.config.providers['strata-server'].models[0];
    model.reasoningEfforts={off:'none',high:'high'};
    const p=(await h.call('preview')).value;
    assert.deepEqual(p.changes.find(c=>c.field==='input').after,['text']);
    assert.ok(p.server.warnings.includes('REASONING_UNCONFIRMED'));
    assert.equal((await h.call('apply',{fingerprint:p.fingerprint})).ok,true);
    const current=h.entries[0].options.config.providers['strata-server'].models[0];
    assert.deepEqual(current.input,['text']);
    assert.deepEqual(current.reasoningEfforts,model.reasoningEfforts);
    assert.equal((await h.call('preview')).value.changes.length,0);
  }finally{await h.close();}
});

test('capability changes participate in stale-preview detection', async () => {
  const modalities=['text','image'];const h=await harness({modalities});try {
    const p=(await h.call('preview')).value;modalities.pop();
    const result=await h.call('apply',{fingerprint:p.fingerprint});
    assert.equal(result.error.code,'stale-preview');assert.equal(h.writes,0);
  }finally{await h.close();}
});

test('capability edits roll back when a later edit fails', async () => {
  const h=await harness({modalities:['text'],rejectCompaction:true});try {
    const original=structuredClone(h.entries[0].options.config);
    const p=(await h.call('preview')).value;
    assert.equal((await h.call('apply',{fingerprint:p.fingerprint})).ok,false);
    assert.deepEqual(h.entries[0].options.config,original);
  }finally{await h.close();}
});

test('a failed second config write rolls the first config back', async () => {
  const h = await harness({ rejectCompaction: true }); try {
    const original = structuredClone(h.entries[0].options.config);
    const p = (await h.call('preview')).value;
    const result = await h.call('apply', { fingerprint: p.fingerprint });
    assert.equal(result.ok, false);
    assert.deepEqual(result.error.details, {});
    assert.deepEqual(h.entries[0].options.config, original);
    assert.equal(await h.backupCount(), 1);
  } finally { await h.close(); }
});

test('startup sync waits for idle and performs no further server reads', async () => {
  const h = await harness({ autoSync: true }); try {
    h.setRunning(true); await h.poll(); assert.equal(h.requests, 0);
    h.setRunning(false); await h.poll(); assert.equal(await h.backupCount(), 1);
    const writes = h.writes, requests = h.requests;
    await h.poll(); assert.equal(await h.backupCount(), 1); assert.equal(h.writes, writes); assert.equal(h.requests,requests);
  } finally { await h.close(); }
});

test('disposal during delayed startup discovery prevents any backup or settings write', async () => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const h = await harness({ autoSync: true, beforeFetch: async url => { if (url.endsWith('/models')) await wait; } });
  try {
    await h.poll();
    assert.equal(h.requests, 1);
    h.dispose(); release();
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(h.writes, 0);
    assert.equal(await h.backupCount(), 0);
  } finally { release(); await h.close(); }
});

test('native preset owners are edited instead of the inactive root compaction placeholder', async () => {
  const h = await harness({ presets: ['standard', 'coding'] }); try {
    const roots = structuredClone(h.entries[1].options.config);
    const presetBefore = structuredClone(h.entries[4].options.config);
    const p = (await h.call('preview')).value;
    assert.deepEqual(p.presetIds, ['standard', 'coding']);
    assert.equal(p.needsNewConversation, true);
    assert.equal(p.current.summaryMaxTokens, null); // Different preset values are not falsely presented as equal.
    assert.deepEqual(p.compactions.map(row => row.current.summaryMaxTokens), [65536, 12000]);
    assert.ok(p.changes.some(row => row.target === 'standard/compaction/compaction-basic' && row.field === 'summaryMaxTokens'));
    const result = await h.call('apply', { fingerprint: p.fingerprint });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(h.entries[1].options.config, roots);
    for (const entry of h.entries.slice(4)) {
      const policy = entry.options.config.plugins[0].config[0].config.modelPolicies[1];
      assert.equal(policy.provider, 'strata-server'); assert.equal(policy.model, 'qwen');
      assert.equal(policy.headroomTokens, 4096); assert.equal(policy.maxTokens, 4096);
    }
    const after = h.entries[4].options.config;
    assert.deepEqual(after.plugins[0].config[0].config.modelPolicies[0], presetBefore.plugins[0].config[0].config.modelPolicies[0]);
    assert.deepEqual(after.plugins[0].config[1], presetBefore.plugins[0].config[1]);
    assert.deepEqual(after.plugins.slice(1), presetBefore.plugins.slice(1));
    const next = (await h.call('preview')).value;
    assert.deepEqual(next.changes, []);
  } finally { await h.close(); }
});

test('inactive required owner is rejected before creating a backup or editing models', async () => {
  const h = await harness({ presets: ['standard'] }); try {
    const p = (await h.call('preview')).value;
    h.entries[2].fiber = undefined;
    const result = await h.call('apply', { fingerprint: p.fingerprint });
    assert.equal(result.ok, false); assert.equal(result.error.code, 'unsupported-profile');
    assert.equal(h.writes, 0); assert.equal(await h.backupCount(), 0);
  } finally { await h.close(); }
});

test('failed preset activation rolls back the preset and the preceding model edit', async () => {
  const h = await harness({ presets: ['standard'], presetBrokenAfterWrite: true }); try {
    const before = h.entries.map(entry => structuredClone(entry.options.config));
    const p = (await h.call('preview')).value;
    const result = await h.call('apply', { fingerprint: p.fingerprint });
    assert.equal(result.ok, false); assert.equal(result.error.code, 'preset-unavailable');
    assert.ok(!JSON.stringify(result).includes('private diagnostic'));
    assert.deepEqual(h.entries.map(entry => entry.options.config), before);
    assert.equal(await h.backupCount(), 1);
  } finally { await h.close(); }
});

test('the selected route ratio overrides global or previous route token retention without changing other routes', async () => {
  const h = await harness({ presets: ['standard'] }); try {
    const base = h.entries[4].options.config.plugins[0].config[0].config;
    base.retainTokens = 15000;
    base.modelPolicies.push({ provider: 'strata-server', model: 'qwen', retainTokens: 10000 });
    const p = (await h.call('preview')).value;
    assert.equal(p.compactions[0].current.retainTokens, 10000);
    assert.equal(p.compactions[0].current.retainRatio, null);
    const result = await h.call('apply', { fingerprint: p.fingerprint });
    assert.equal(result.ok, true, JSON.stringify(result));
    const after = h.entries[4].options.config.plugins[0].config[0].config;
    assert.equal(after.retainTokens, 15000);
    assert.equal(after.modelPolicies[1].retainTokens, undefined);
    assert.equal(after.modelPolicies[1].retainRatio, 0.16);
    const next = (await h.call('preview')).value;
    assert.equal(next.compactions[0].current.retainTokens, null);
    assert.equal(next.compactions[0].current.retainRatio, 0.16);
    assert.deepEqual(next.changes, []);
  } finally { await h.close(); }
});

test('a timer created during HMR reload exits the inherited transaction before later ConfigEditor writes', async () => {
  const hmrStore = new AsyncLocalStorage();
  const h = await harness({ autoSync: true, presets: ['standard'], hmrStore }); try {
    await h.poll();
    assert.equal(h.entries[0].options.config.providers['strata-server'].models[0].contextWindow, 32768);
    assert.equal(h.entries[4].options.config.plugins[0].config[0].config.modelPolicies[1].maxTokens, 4096);
    assert.equal(await h.backupCount(), 1);
    assert.equal((await h.call('status')).value.lastError, null);
    const writes = h.writes;
    await h.poll();
    assert.equal(h.writes, writes); assert.equal(await h.backupCount(), 1);
  } finally { await h.close(); hmrStore.disable(); }
});

test('startup is not repeated by HMR or by enabling the option later in the same process', async () => {
  for (const enabled of [true,false]) {
    const h=await harness({autoSync:enabled}); try {
      await h.poll(); const requests=h.requests;
      h.entries[3].options.config.autoSync=true;
      h.reload(); await h.poll();
      assert.equal(h.requests,requests);
      assert.equal(requests>0,enabled);
    } finally { await h.close(); }
  }
});
test('failed startup reports its error without periodic retries; manual preview remains available', async () => {
  const h=await harness({autoSync:true,serverStatus:503}); try {
    await h.poll(); const requests=h.requests;
    assert.ok((await h.call('status')).value.lastError);
    await h.poll(); h.reload(); await h.poll(); assert.equal(h.requests,requests);
    await h.call('preview'); assert.ok(h.requests>requests);
  } finally { await h.close(); }
});

test('server output default updates model and compaction policy; changed default invalidates preview', async () => {
  let cap=8192;
  const h=await harness({props:()=>({build_info:'Strata 0.1.52',model_alias:'qwen',default_generation_settings:{params:{n_predict:cap}}})});
  try {
    const first=await h.call('preview');assert.equal(first.value.budget.outputTokens,8192);assert.equal(first.value.budget.outputSource,'server');
    cap=4096;
    const stale=await h.call('apply',{fingerprint:first.value.fingerprint});assert.equal(stale.error.code,'stale-preview');assert.equal(h.writes,0);
    const fresh=await h.call('preview');const applied=await h.call('apply',{fingerprint:fresh.value.fingerprint});assert.equal(applied.ok,true);
    assert.equal(h.entries[0].options.config.providers['strata-server'].models[0].maxTokens,4096);
    assert.equal(fresh.value.budget.thresholdTokens,24576);
    const manual=await h.call('preview',{outputTokens:2048});assert.equal(manual.value.budget.outputSource,'manual');assert.equal(manual.value.budget.outputTokens,2048);
  } finally {await h.close();}
});
test('unsafe server output fails before backup or settings writes',async()=>{
 const h=await harness({props:()=>({build_info:'Strata 0.1.52',model_alias:'qwen',default_generation_settings:{params:{n_predict:32000}}})});
 try{const r=await h.call('preview');assert.equal(r.error.code,'INVALID_OUTPUT_BUDGET');assert.equal(h.writes,0);assert.equal(await h.backupCount(),0);}finally{await h.close();}
});

test('settings changed during apply discovery invalidate the preview instead of becoming the new baseline', async () => {
  let mutate = false, h;
  h = await harness({ beforeFetch: async url => {
    if (mutate && url.endsWith('/models')) h.entries[0].options.config.providers['strata-server'].models[0].maxTokens = 7777;
  } });
  try {
    const first = (await h.call('preview')).value;
    mutate = true;
    const result = await h.call('apply', { fingerprint: first.fingerprint });
    assert.equal(result.error.code, 'stale-preview');
    assert.equal(h.entries[0].options.config.providers['strata-server'].models[0].maxTokens, 7777);
    assert.equal(h.writes, 0); assert.equal(await h.backupCount(), 0);
  } finally { await h.close(); }
});

test('a compaction change during initial discovery prevents returning an actionable stale preview', async () => {
  let h;
  h = await harness({ beforeFetch: async url => {
    if (url.endsWith('/models')) h.entries[1].options.config.maxTokens = 7777;
  } });
  try {
    const result = await h.call('preview');
    assert.equal(result.error.code, 'stale-preview');
    assert.equal(h.entries[1].options.config.maxTokens, 7777);
    assert.equal(h.writes, 0); assert.equal(await h.backupCount(), 0);
  } finally { await h.close(); }
});

test('all owner snapshots are rechecked when the first queued write starts', async () => {
  let h;
  h = await harness({ beforeEdit: async () => { h.entries[1].options.config.maxTokens = 7777; } });
  try {
    const first = (await h.call('preview')).value;
    const originalModel = structuredClone(h.entries[0].options.config);
    const result = await h.call('apply', { fingerprint: first.fingerprint });
    assert.equal(result.error.code, 'stale-preview');
    assert.deepEqual(h.entries[0].options.config, originalModel);
    assert.equal(h.entries[1].options.config.maxTokens, 7777);
    assert.equal(h.writes, 0); assert.equal(await h.backupCount(), 1);
  } finally { await h.close(); }
});

test('a task starting before the queued write defers without changing configuration', async () => {
  let h;
  h = await harness({ beforeEdit: async () => { h.setRunning(true); } });
  try {
    const first = (await h.call('preview')).value;
    const result = await h.call('apply', { fingerprint: first.fingerprint });
    assert.equal(result.error.code, 'busy'); assert.equal(h.writes, 0);
  } finally { await h.close(); }
});

test('startup discovery interrupted by a new task completes once after returning to idle', async () => {
  let h, first = true;
  h = await harness({ autoSync: true, beforeFetch: async url => {
    if (first && url.endsWith('/models')) { first = false; h.setRunning(true); }
  } });
  try {
    await h.poll();
    assert.equal((await h.call('status')).value.lastError.code, 'busy');
    assert.equal(h.writes, 0); assert.equal(await h.backupCount(), 0);
    const busyRequests = h.requests;
    await h.poll(); assert.equal(h.requests, busyRequests);
    h.setRunning(false); await h.poll();
    assert.equal((await h.call('status')).value.lastError, null);
    assert.equal(await h.backupCount(), 1);
    assert.equal(h.entries[0].options.config.providers['strata-server'].models[0].contextWindow, 32768);
    const requests = h.requests, writes = h.writes;
    await h.poll(); h.reload(); await h.poll();
    assert.equal(h.requests, requests); assert.equal(h.writes, writes);
  } finally { await h.close(); }
});

test('startup readiness errors are reported without unhandled timer rejection or recurring requests', async () => {
  const h = await harness({ autoSync: true });
  try {
    h.entries[3].fiber.state = 0;
    await h.poll();
    h.entries[3].fiber.state = 2;
    assert.equal((await h.call('status')).value.lastError.code, 'unsupported-profile');
    await h.poll();
    assert.equal(h.requests, 0); assert.equal(h.writes, 0);
  } finally { await h.close(); }
});

test('configure requires a current revision and stale clients cannot clear a newer override', async () => {
  const h = await harness();
  try {
    const initial = (await h.call('status')).value;
    assert.match(initial.settingsRevision, /^[a-f0-9]{64}$/);
    const missing = await h.call('configure', { outputTokens: 8192 });
    assert.equal(missing.error.code, 'stale-settings'); assert.equal(await h.backupCount(), 0);
    const saved = await h.call('configure', { expectedRevision: initial.settingsRevision, outputTokens: 8192 });
    assert.equal(saved.ok, true);
    assert.notEqual(saved.value.settingsRevision, initial.settingsRevision);
    assert.equal(saved.value.outputTokens, 8192);
    const stale = await h.call('configure', { expectedRevision: initial.settingsRevision, outputTokens: null });
    assert.equal(stale.error.code, 'stale-settings');
    assert.equal(h.entries[3].options.config.outputTokens, 8192);
    assert.equal(h.writes, 1); assert.equal(await h.backupCount(), 1);
    const patched = await h.call('configure', { expectedRevision: saved.value.settingsRevision, autoSync: true });
    assert.equal(patched.ok, true);
    assert.equal(patched.value.outputTokens, 8192);
    assert.equal(patched.value.followLoadedModel, true);
    assert.equal(patched.value.providerId, 'strata-server');
    assert.equal(patched.value.autoSync, true);
  } finally { await h.close(); }
});

test('status observes externally updated preferences and queued saves use a compare-and-swap check', async () => {
  let h;
  h = await harness({ beforeEdit: async entry => {
    if (entry.options.name === PKG) entry.options.config.outputTokens = 7777;
  } });
  try {
    const initial = (await h.call('status')).value;
    h.entries[3].options.config.outputTokens = 8192;
    const latest = (await h.call('status')).value;
    assert.notEqual(latest.settingsRevision, initial.settingsRevision);
    assert.equal(latest.outputTokens, 8192);
    const saved = await h.call('configure', { expectedRevision: latest.settingsRevision, outputTokens: null });
    assert.equal(saved.error.code, 'stale-settings');
    assert.equal(h.entries[3].options.config.outputTokens, 7777); assert.equal(h.writes, 0);
  } finally { await h.close(); }
});

test('catalog-backed routes and modelOverrides are rejected during preview before network or writes', async () => {
  const cases = [route => { delete route.models; }, route => { route.models = []; },
    route => { route.modelOverrides = { qwen: { maxTokens: 8192 } }; }];
  for (const mutate of cases) {
    const h = await harness();
    try {
      mutate(h.entries[0].options.config.providers['strata-server']);
      const original = structuredClone(h.entries[0].options.config);
      const result = await h.call('preview');
      assert.equal(result.error.code, 'unsupported-route');
      assert.match(result.error.message, /explicit models list/);
      assert.deepEqual(h.entries[0].options.config, original);
      assert.equal(h.requests, 0); assert.equal(h.writes, 0); assert.equal(await h.backupCount(), 0);
    } finally { await h.close(); }
  }
});

test('an explicit custom route can add the newly loaded model without replacing other entries', async () => {
  const h = await harness();
  try {
    h.entries[0].options.config.providers['strata-server'].models = [{ id: 'older-model', maxTokens: 8192 }];
    const first = (await h.call('preview')).value;
    const result = await h.call('apply', { fingerprint: first.fingerprint });
    assert.equal(result.ok, true);
    const models = h.entries[0].options.config.providers['strata-server'].models;
    assert.deepEqual(models[0], { id: 'older-model', maxTokens: 8192 });
    assert.equal(models[1].id, 'qwen'); assert.equal(models[1].contextWindow, 32768);
  } finally { await h.close(); }
});

test('the successful result retains safe budget provenance and preserved capability status', async () => {
  const h = await harness({ modalities: ['text'], props: () => ({ build_info: 'Strata 0.1.52', model_alias: 'qwen', default_generation_settings: { params: { n_predict: 8192 } } }) });
  try {
    const first = (await h.call('preview')).value;
    assert.deepEqual(first.capabilityStatus, { input: 'confirmed', reasoning: 'preserved' });
    const result = await h.call('apply', { fingerprint: first.fingerprint });
    assert.equal(result.ok, true);
    const summary = (await h.call('status')).value.lastApplied;
    assert.equal(summary.modelId, 'qwen'); assert.equal(summary.budget.contextWindow, 32768);
    assert.equal(summary.budget.outputTokens, 8192); assert.equal(summary.budget.outputSource, 'server');
    assert.equal(summary.serverOutputTokens, 8192); assert.equal(summary.outputLimitStatus, 'server');
    assert.deepEqual(summary.capabilityStatus, first.capabilityStatus);
    assert.ok(summary.warnings.includes('REASONING_UNCONFIRMED'));
    assert.equal(summary.backupPath, result.value.backupPath);
    assert.equal(summary.applied, true);
    assert.ok(!JSON.stringify(summary).includes('do-not-expose-test-secret'));
    const aligned = (await h.call('preview')).value;
    assert.equal((await h.call('apply', { fingerprint: aligned.fingerprint })).value.applied, false);
    assert.equal((await h.call('status')).value.lastApplied.applied, false);
    assert.equal(await h.backupCount(), 1);
  } finally { await h.close(); }
});
