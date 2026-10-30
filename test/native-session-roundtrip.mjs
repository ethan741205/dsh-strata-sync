import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { zstdDecompressSync, zstdCompressSync } from 'node:zlib';
import { installSummaryGuidance } from '../src/summary.mjs';
import { SUMMARY_GUIDANCE_EVENT, SUMMARY_RESULT_EVENT } from '../src/summary-audit.mjs';
import { installNativeSummaryAudit } from '../src/summary-audit-host.mjs';

assert.ok(process.versions.electron, 'Run with scripts/test-native-session.mjs.');
const hostRequire = createRequire(process.argv[2]);
const hostImport = name => import(pathToFileURL(hostRequire.resolve(name)).href);
const { Context, Service } = await hostImport('@deepseek-ai/cordis');
const { SessionStore, Session, pluginRecordOf } = await hostImport('@deepseek-ai/dsh-session');
const backend = await hostImport('@deepseek-ai/dsh-session-persistence-jsonl');
const { BasicCompactionEngine } = await hostImport('@deepseek-ai/dsh-compaction-basic');
const { createUserMessage } = await hostImport('@deepseek-ai/dsh-llm');
const hostVersion = hostRequire('@deepseek-ai/dsh-session/package.json').version;
const temporaryParent = resolve(fileURLToPath(new URL('../', import.meta.url)));
const directory = await mkdtemp(join(temporaryParent, '.native-audit-'));
assert.ok(resolve(directory).startsWith(temporaryParent + sep));
const root = join(directory, 'sessions');
const sessionId = `audit-${randomUUID()}`;

async function context() {
  const ctx = new Context();
  ctx.provide('profileContext', { installAnchor: process.argv[2] });
  const sessionsFiber = ctx.plugin(SessionStore);
  await sessionsFiber.await();
  assert.equal(sessionsFiber.state, 2);
  const persistenceFiber = ctx.plugin(backend, { root, compression: 'zstd' });
  await persistenceFiber.await();
  assert.equal(persistenceFiber.state, 2);
  return { ctx, async close() { await persistenceFiber.dispose(); await sessionsFiber.dispose(); } };
}

const text = value => ({ type: 'text', text: value });
class TestMeter extends Service {
  constructor(ctx) { super(ctx, 'tokenMeter'); }
  estimateMessage(message) { return 8 + Math.ceil(message.content.reduce((n, block) => n + (block.text?.length ?? 0), 0) / 4); }
  measure(session) {
    const nodes = session.surface.nodes.map(seq => {
      const tokens = this.estimateMessage(session.deriveEventMessage(session.eventAt(seq)));
      return { seq, tokens, heuristicTokens: tokens };
    });
    return { nodes, totalTokens: nodes.reduce((n, node) => n + node.tokens, 0) };
  }
}
class TestLlm extends Service {
  constructor(ctx) { super(ctx, 'llm'); this.calls = []; }
  stream(options) {
    return this.ctx.waterfall(this, 'llm/stream', options, () => this.respond(options));
  }
  async *respond(options) {
    this.calls.push({ maxTokens: options.maxTokens, messages: options.messages.map(message => ({ role: message.role, content: message.content })) });
    const content = this.calls.length === 3 ? 'oversized synthetic summary '.repeat(2000) : 'Synthetic checkpoint; continue the fixture task.';
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: content };
    yield { type: 'block-end', index: 0, block: text(content) };
    yield { type: 'usage', usage: { inputTokens: 6010, outputTokens: this.calls.length === 1 ? 4096 : 100, totalTokens: this.calls.length === 1 ? 10106 : 6110 } };
    yield { type: 'finish', reason: { kind: this.calls.length === 1 ? 'max-tokens' : 'stop' } };
  }
}
async function scenario(ctx, session, logging) {
  let llm, engine, audit;
  const fiber = ctx.plugin(child => {
    new TestMeter(child);
    llm = new TestLlm(child);
    engine = new BasicCompactionEngine(child, { auto: false, maxTokens: 4096 });
    audit = logging ? installNativeSummaryAudit(child, 'test') : undefined;
    installSummaryGuidance(child, async () => 32768, () => ({
      summaryGuidance: true, summaryGuidanceMode: 'after-truncation', summaryOutputDivisor: 1.5,
    }), audit);
  });
  await fiber.await();
  await audit?.ready;
  assert.equal(fiber.state, 2);
  const source = session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [text('fixture source '.repeat(2000))] }), { surfaceOp: 'append' });
  session.append('turn/start', { turn: 1 });
  const agent = { session, options: { provider: 'fixture-provider', model: 'fixture-model' } };
  const signal = new AbortController().signal;
  const before = structuredClone(session.surface.nodes);
  await assert.rejects(engine.compactRegion(source.seq, source.seq, agent, signal), error => error.code === 'MAX_TOKENS');
  assert.deepEqual(session.surface.nodes, before, 'A truncated checkpoint must leave the source surface intact.');
  assert.equal(await ctx.sessions.flush(session), true);
  const firstBatch = session.snapshotEvents();
  const committed = await engine.compactRegion(source.seq, source.seq, agent, signal);
  assert.equal(committed.shadowedSeqs.length, 1);
  assert.equal(session.surface.nodes.length, 1);
  const checkpoint = session.deriveEventMessage(session.eventAt(session.surface.nodes[0]));
  assert.ok(checkpoint.content.some(block => block.text?.includes('Synthetic checkpoint')));
  const extraSource = session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [text('second fixture source '.repeat(1500))] }), { surfaceOp: 'append' });
  const beforeValidationFailure = structuredClone(session.surface.nodes);
  await assert.rejects(engine.compactRegion(extraSource.seq, extraSource.seq, agent, signal), /summary is not smaller/);
  assert.deepEqual(session.surface.nodes, beforeValidationFailure, 'Native post-stream validation must still reject oversized summaries.');
  session.append('turn/end', { turn: 1 });
  assert.equal(await ctx.sessions.flush(session), true);
  const result = { firstBatch, events: session.snapshotEvents(), nodes: [...session.surface.nodes],
    messages: session.surface.nodes.map(seq => session.deriveEventMessage(session.eventAt(seq)).content),
    calls: structuredClone(llm.calls) };
  await fiber.dispose();
  return result;
}

async function sessionFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? sessionFiles(join(dir, entry.name))
    : entry.name === 'session.v4.jsonl.zstd' ? [join(dir, entry.name)] : []))).flat();
}
function frames(buffer) {
  const output = []; let offset = 0;
  while (offset < buffer.length) {
    const value = zstdDecompressSync(buffer.subarray(offset), { info: true });
    assert.ok(value.engine.bytesWritten > 0);
    output.push(value.buffer);
    offset += value.engine.bytesWritten;
  }
  return output;
}

let a, b, writer, reader, detach, controlWriter, controlDetach;
try {
  a = await context();
  // Metadata only: a short absolute project path keeps the backend's encoded
  // project component below Windows path limits. No file is created there.
  const session = a.ctx.sessions.prepare(sessionId, { meta: { cwd: resolve(sep, 'dsh-audit-fixture') } });
  writer = await a.ctx.sessionPersistence.create(session.header);
  detach = a.ctx.sessions.enter(session);
  a.ctx.sessions.announce(session);
  const run = await scenario(a.ctx, session, true);
  const expected = run.events;
  const guidance = expected.filter(event => event.type === SUMMARY_GUIDANCE_EVENT);
  const results = expected.filter(event => event.type === SUMMARY_RESULT_EVENT);
  assert.equal(guidance.length, 3);
  assert.equal(results.length, 3);
  assert.deepEqual(guidance.map(event => [event.data.targetTokens, event.data.applied, event.data.reason]), [
    [null, false, 'awaiting-truncation'], [2730, true, 'applied'], [null, false, 'awaiting-truncation'],
  ]);
  assert.deepEqual(results.map(event => [event.data.outcome, event.data.finishReason]), [
    ['truncated', 'max-tokens'], ['completed', 'stop'], ['completed', 'stop'],
  ]);
  for (const [index, decision] of guidance.entries()) {
    const result = results[index];
    assert.equal(decision.ignorable, true);
    assert.equal(result.ignorable, true);
    assert.ok(Number.isSafeInteger(decision.time));
    assert.equal(result.data.attemptId, decision.data.attemptId);
    assert.equal(result.data.decisionSeq, decision.seq);
    assert.equal(result.data.compactionId, decision.data.compactionId);
    assert.equal(decision.data.correlation, 'unique-open-compaction');
    assert.equal(result.data.streamCompleted, true);
    const opening = expected.find(event => event.seq === decision.data.startSeq);
    assert.equal(opening.type, 'compaction/start');
    assert.equal(opening.data.compactionId, decision.data.compactionId);
    const ending = expected.find(event => event.type === 'compaction/end' && event.data.compactionId === decision.data.compactionId);
    assert.ok(ending);
    assert.equal(ending.data.error === undefined, index === 1,
      'Only the middle request committed; a stop finish on the last request did not.');
    assert.ok(Buffer.byteLength(JSON.stringify(decision.data)) <= 2048);
    assert.ok(Buffer.byteLength(JSON.stringify(result.data)) <= 2048);
  }
  assert.equal(results[0].data.usage.outputTokens, 4096);
  assert.equal(results[1].data.usage.outputTokens, 100);
  assert.match(run.calls[1].messages.at(-1).content[0].text, /target of 2730 tokens/);
  assert.equal(expected.filter(event => event.type === 'compaction/summary').length, 1);
  assert.ok(expected.filter(event => event.type.startsWith('plugin:')).every(event => session.deriveEventMessage(event) === null));
  for (const event of [...guidance, ...results]) {
    assert.doesNotMatch(JSON.stringify(event.data), /fixture source|Synthetic checkpoint|oversized synthetic|compaction engine/,
      'Plugin records contain metadata only, not source, prompt, or summary text.');
  }
  const physical = (await sessionFiles(root)).find(file => file.includes(sessionId));
  assert.ok(frames(await readFile(physical)).length >= 3, 'Two flushes produce multiple Zstd frames.');

  // Repeat the real native compaction transactions with the same hook but no
  // audit sink: requests, checkpoint text and failure semantics must match.
  const control = a.ctx.sessions.prepare(`control-${randomUUID()}`, { meta: { cwd: resolve(sep, 'dsh-audit-fixture') } });
  controlWriter = await a.ctx.sessionPersistence.create(control.header);
  controlDetach = a.ctx.sessions.enter(control); a.ctx.sessions.announce(control);
  const baseline = await scenario(a.ctx, control, false);
  assert.deepEqual(run.calls, baseline.calls);
  assert.deepEqual(run.messages, baseline.messages);
  assert.deepEqual(run.events.filter(event => event.type === 'compaction/end').map(event => event.data.error ?? null),
    baseline.events.filter(event => event.type === 'compaction/end').map(event => event.data.error ?? null));
  await controlWriter.close(); controlWriter = null;
  controlDetach(); controlDetach = null;
  await writer.close(); writer = null;
  detach(); detach = null;
  await a.close(); a = null;
  b = await context();
  reader = await b.ctx.sessionPersistence.open(sessionId, 'read');
  const loaded = await reader.read();
  assert.deepEqual(loaded.events, expected);
  assert.deepEqual(loaded.events.slice(0, run.firstBatch.length), run.firstBatch);
  assert.equal(pluginRecordOf(loaded.events.find(event => event.type === SUMMARY_GUIDANCE_EVENT && event.data.applied)).data.targetTokens, 2730);
  const restored = Session.fromRestore(sessionId, loaded.events, reader.header, reader.inheritedEventCount, loaded.eventState);
  assert.deepEqual(restored.surface.nodes, run.nodes);
  assert.deepEqual(restored.surface.nodes.map(seq => restored.deriveEventMessage(restored.eventAt(seq)).content), run.messages);
  await reader.close(); reader = null;

  // Fault injection is confined to the disposable test artifact. A plain
  // JSON.parse would accept it; the real native admission must reject it.
  const corrupt = frames(await readFile(physical)).map(frame => {
    const lines = frame.toString().split('\n').filter(Boolean).map(line => {
      const event = JSON.parse(line);
      if (event.type === SUMMARY_GUIDANCE_EVENT) delete event.ignorable;
      return JSON.stringify(event);
    });
    return zstdCompressSync(Buffer.from(lines.join('\n') + '\n'));
  });
  await writeFile(physical, Buffer.concat(corrupt));
  await assert.rejects(async () => {
    reader = await b.ctx.sessionPersistence.open(sessionId, 'read');
    await reader.read();
  }, /unknown to this harness and not marked ignorable/);
  console.log(JSON.stringify({ test: 'native-session-roundtrip', hostVersion, status: 'passed',
    nativeCompactions: 3, decisions: guidance.length, results: results.length, targetTokens: 2730,
    zstdIncrementalRead: true, restoredWithoutPlugin: true, nativeRequiredEventRejection: true,
    unchangedRequestsAndCompactionBehavior: true, liveInference: false }));
} finally {
  await reader?.close();
  await writer?.close();
  detach?.();
  await controlWriter?.close();
  controlDetach?.();
  await a?.close();
  await b?.close();
  // Only remove this test's freshly created, checked temporary directory.
  assert.ok(resolve(directory).startsWith(temporaryParent + sep));
  await rm(directory, { recursive: true, force: true });
}
