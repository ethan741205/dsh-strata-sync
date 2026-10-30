import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { installNativeSummaryAudit } from '../src/summary-audit-host.mjs';

const options = { sessionId: 'audit-session', provider: 'strata-server', model: 'test-model' };
const decision = { enabled: true, mode: 'always', requestedMaxTokens: 4096,
  sourceTokensEstimated: 8000, effectiveOutputTokensEstimated: 4096,
  outputDivisor: 2, sourceDivisor: 2, targetTokens: 2048, applied: true, reason: 'applied' };
const completion = { finishReason: 'stop', outcome: 'completed', streamCompleted: true, elapsedMs: 3 };
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

async function harness(t, { loadApi, foreign = false, noSession = false, useDefaultLoader = false } = {}) {
  const ctx = new Context();
  const warnings = [], events = [];
  ctx.logger.exporter({ levels: { default: 3 }, export: message => { if (message.type === 'warn') warnings.push(message.args.join(' ')); } });
  class Session { constructor() { this.id = options.sessionId; } }
  const session = foreign ? { id: options.sessionId } : new Session();
  const api = { Session, appendPluginRecord(value, type, data) {
    assert.equal(value, session);
    const event = { type, seq: events.length, time: Date.now(), data, ignorable: true };
    events.push(event);
    return event.seq;
  } };
  let provider;
  async function provide() {
    provider = ctx.plugin(child => child.provide('sessions', { get: id => id === session.id ? session : undefined }));
    await provider.await();
  }
  if (!noSession) await provide();
  let audit;
  const fiber = ctx.plugin(child => {
    audit = useDefaultLoader ? installNativeSummaryAudit(child, 'test-version')
      : installNativeSummaryAudit(child, 'test-version', loadApi ? value => loadApi(value, api) : async () => api);
  });
  await fiber.await();
  t.after(async () => { await fiber.dispose(); await provider?.dispose(); });
  return { ctx, api, audit, session, events, warnings, fiber, provide,
    async remove() { await provider.dispose(); await tick(); },
    emit(type, data) { ctx.emit('session/event', session, { type, data, seq: 0, time: Date.now() }); },
  };
}

test('host binding delegates to the same native Session and records a request without changing it', async t => {
  const h = await harness(t);
  await h.audit.ready;
  h.emit('compaction/start', { compactionId: 'compaction-a' });
  const before = structuredClone(options);
  const call = h.audit.begin(options);
  call.decision(decision);
  call.finish(completion);
  assert.deepEqual(options, before);
  assert.equal(h.events.length, 2);
  assert.equal(h.events[0].data.targetTokens, 2048);
  assert.equal(h.events[0].data.applied, true);
  assert.equal(h.events[0].data.compactionId, 'compaction-a');
  assert.equal(h.events[1].data.finishReason, 'stop');
  assert.equal(h.warnings.length, 0);
});

test('missing Sessions leaves the parent active and binds when the service becomes available', async t => {
  const h = await harness(t, { noSession: true });
  assert.equal(h.fiber.state, 2);
  assert.equal(h.audit.begin(options), undefined);
  assert.equal(h.audit.begin(options), undefined);
  assert.equal(h.warnings.length, 1);
  await h.provide();
  await h.audit.ready;
  h.audit.begin(options).decision(decision);
  assert.equal(h.events.length, 1);
});

test('incompatible API or load failure is contained and never reveals its exception', async t => {
  for (const loadApi of [async () => ({}), async () => { throw new Error('private path and token must not be logged'); }]) {
    const h = await harness(t, { loadApi });
    await h.audit.ready;
    assert.equal(h.fiber.state, 2);
    assert.equal(h.audit.begin(options), undefined);
    assert.equal(h.audit.begin(options), undefined);
    assert.equal(h.events.length, 0);
    assert.equal(h.warnings.length, 1);
    assert.doesNotMatch(h.warnings.join(''), /private path|token must/);
  }
});

test('foreign Session instances cannot reach the native private record method', async t => {
  const h = await harness(t, { foreign: true });
  await h.audit.ready;
  const call = h.audit.begin(options);
  call.decision(decision);
  call.finish(completion);
  assert.equal(h.events.length, 0);
  assert.equal(h.warnings.length, 1);
});

test('initial unavailability and later write failure share one safe warning', async t => {
  const h = await harness(t, { noSession: true, foreign: true });
  assert.equal(h.audit.begin(options), undefined);
  await h.provide();
  await h.audit.ready;
  const call = h.audit.begin(options);
  call.decision(decision);
  call.finish(completion);
  assert.equal(h.events.length, 0);
  assert.equal(h.warnings.length, 1);
});

test('the production resolver safely declines a context without an installation anchor', async t => {
  const h = await harness(t, { useDefaultLoader: true });
  await h.audit.ready;
  assert.equal(h.fiber.state, 2);
  assert.equal(h.audit.begin(options), undefined);
  assert.equal(h.events.length, 0);
  assert.equal(h.warnings.length, 1);
});

test('disposal while host loading is pending never installs a late sink', async t => {
  const loading = deferred();
  const h = await harness(t, { loadApi: () => loading.promise });
  const disposing = h.fiber.dispose();
  loading.resolve(h.api);
  await disposing;
  await h.audit.ready;
  await tick();
  assert.equal(h.audit.begin(options), undefined);
  assert.equal(h.events.length, 0);
  assert.equal(h.warnings.length, 0);
});

test('Sessions replacement removes the old sink and permits a new binding', async t => {
  let loads = 0;
  const h = await harness(t, { loadApi: async (_ctx, api) => { loads++; return api; } });
  await h.audit.ready;
  await h.remove();
  assert.equal(h.audit.begin(options), undefined);
  await h.provide();
  await tick();
  await tick();
  assert.equal(loads, 2);
  const call = h.audit.begin(options);
  assert.ok(call);
  call.decision(decision);
  assert.equal(h.events.length, 1);
});

test('minimal non-host contexts stay usable and warn once without an injection API', async () => {
  const warnings = [], effects = [];
  const audit = installNativeSummaryAudit({ effect: fn => effects.push(fn()), logger: { warn: text => warnings.push(text) } }, 'test');
  await audit.ready;
  assert.equal(audit.begin(options), undefined);
  assert.equal(warnings.length, 1);
  effects.forEach(cleanup => cleanup());
  assert.equal(audit.begin(options), undefined);
  assert.equal(warnings.length, 1);
});
