import test from 'node:test';
import assert from 'node:assert/strict';
import { createSummaryAudit, SUMMARY_GUIDANCE_EVENT, SUMMARY_RESULT_EVENT, MAX_AUDIT_BYTES, MAX_AUDIT_SESSIONS } from '../src/summary-audit.mjs';

function harness({ append, version = '0.12.7-test', onWarning } = {}) {
  const listeners = new Set(), disposals = [], sessions = new Map(), warnings = [];
  let publishing = false;
  const ctx = {
    sessions: { get: id => sessions.get(id) }, logger: { warn: text => warnings.push(text) },
    on(name, callback) {
      assert.equal(name, 'session/event');
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    effect(register) { disposals.push(register()); },
  };
  function session(id = 'session-a') {
    const value = { id, events: [] };
    sessions.set(id, value);
    return value;
  }
  function emit(value, type, data, plugin = false) {
    assert.equal(publishing, false, 'Native Session does not allow reentrant append');
    const event = { type, seq: value.events.length, time: Date.now(), data: structuredClone(data), ...(plugin ? { ignorable: true } : {}) };
    value.events.push(event);
    publishing = true;
    try { for (const listener of listeners) listener(value, event); }
    finally { publishing = false; }
    return event.seq;
  }
  const defaultAppend = (value, type, data) => emit(value, type, data, true);
  const audit = createSummaryAudit(ctx, { appendPluginRecord: append === undefined ? defaultAppend : append, pluginVersion: version, onWarning });
  return { audit, ctx, session, emit, sessions, warnings, listeners,
    dispose() { for (const fn of disposals) fn(); },
    start(value, id = 'compact-a') { return emit(value, 'compaction/start', { compactionId: id }); },
    end(value, id = 'compact-a') { return emit(value, 'compaction/end', { compactionId: id }); },
  };
}
const options = (sessionId = 'session-a') => ({ sessionId, provider: 'strata-server', model: 'qwen' });
const decision = changes => ({ enabled: true, mode: 'after-truncation', outputDivisor: 1.5, sourceDivisor: 2,
  requestedMaxTokens: 4096, sourceTokensEstimated: 8000, effectiveOutputTokensEstimated: 4096,
  targetTokens: 2730, applied: true, reason: 'applied', ...changes });
const result = changes => ({ finishReason: 'stop', outcome: 'completed', streamCompleted: true,
  elapsedMs: 1200, usage: { inputTokens: 8000, outputTokens: 2000, totalTokens: 10000, cacheReadTokens: 7900 }, ...changes });
const records = session => session.events.filter(event => event.type.startsWith('plugin:'));

test('native records retain targets, application and stream result without duplicating native compaction events', () => {
  const h = harness(), session = h.session();
  const startSeq = h.start(session);
  const call = h.audit.begin(options());
  call.decision(decision());
  call.finish(result());
  h.emit(session, 'compaction/summary', { compactionId: 'compact-a', provider: 'strata-server', model: 'qwen' });
  h.end(session);
  const [guided, ended] = records(session);
  assert.equal(guided.type, SUMMARY_GUIDANCE_EVENT);
  assert.equal(ended.type, SUMMARY_RESULT_EVENT);
  assert.equal(guided.data.targetTokens, 2730);
  assert.equal(guided.data.appliedTargetTokens, 2730);
  assert.equal(guided.data.applied, true);
  assert.equal(guided.data.outputDivisor, 1.5);
  assert.equal(guided.data.startSeq, startSeq);
  assert.equal(guided.data.compactionId, 'compact-a');
  assert.equal(guided.data.correlation, 'unique-open-compaction');
  assert.equal(guided.data.schemaVersion, 1);
  assert.equal(guided.data.pluginVersion, '0.12.7-test');
  assert.equal(ended.data.attemptId, guided.data.attemptId);
  assert.equal(ended.data.decisionSeq, guided.seq);
  assert.equal(ended.data.finishReason, 'stop');
  assert.equal(ended.data.outcome, 'completed');
  assert.deepEqual(ended.data.usage, result().usage);
  assert.equal(ended.data.elapsedMs, 1200);
  assert.ok(guided.ignorable && ended.ignorable);
  assert.ok(Number.isSafeInteger(guided.time));
  assert.equal(records(session).length, 2, 'Existing native summary/end remains the authoritative commit result');
  assert.equal(h.warnings.length, 0);
});

test('skipped and rejected targets preserve calculation evidence and null only when not computed', () => {
  const h = harness(), session = h.session();
  h.start(session);
  for (const fields of [
    { targetTokens: null, applied: false, reason: 'awaiting-truncation' },
    { targetTokens: 255, applied: false, reason: 'target-too-small' },
    { targetTokens: 0, applied: false, reason: 'target-too-small' },
    { targetTokens: 2730, applied: false, reason: 'settings-changed' },
    { targetTokens: null, applied: false, reason: 'effective-budget-unavailable' },
    { targetTokens: null, applied: false, reason: 'insufficient-output-budget' },
  ]) {
    const call = h.audit.begin(options());
    call.decision(decision(fields));
    call.finish(result());
    const record = records(session).at(-2).data;
    assert.equal(record.targetTokens, fields.targetTokens);
    assert.equal(record.appliedTargetTokens, null);
    assert.equal(record.applied, false);
    assert.equal(record.reason, fields.reason);
  }
});

test('multiple sequential attempts share a compaction, while attempts and outcomes stay distinct', () => {
  const h = harness(), session = h.session();
  h.start(session);
  const first = h.audit.begin(options());
  first.decision(decision({ targetTokens: null, applied: false, reason: 'awaiting-truncation' }));
  first.finish(result({ finishReason: 'max-tokens', outcome: 'truncated' }));
  const second = h.audit.begin(options());
  second.decision(decision());
  second.finish(result());
  h.end(session);
  const rows = records(session);
  assert.notEqual(rows[0].data.attemptId, rows[2].data.attemptId);
  assert.ok(rows.every(row => row.data.compactionId === 'compact-a'));
  assert.equal(rows[1].data.outcome, 'truncated');
  assert.equal(rows[3].data.outcome, 'completed');
});

test('context overflow retains its structured finish kind without being called truncation', () => {
  const h = harness(), session = h.session();
  h.start(session);
  const call = h.audit.begin(options());
  call.decision(decision());
  call.finish(result({ finishReason: 'context-window-exceeded', outcome: 'error' }));
  const saved = records(session).at(-1).data;
  assert.equal(saved.finishReason, 'context-window-exceeded');
  assert.equal(saved.outcome, 'error');
});

test('overlapping attempts invalidate earlier candidate association in the result', () => {
  const h = harness(), session = h.session();
  h.start(session);
  const first = h.audit.begin(options());
  first.decision(decision());
  const second = h.audit.begin(options());
  second.decision(decision());
  first.finish(result());
  second.finish(result());
  const rows = records(session);
  assert.equal(rows[0].data.correlation, 'unique-open-compaction', 'Decision describes the association known at that time');
  for (const row of rows.slice(1)) {
    assert.equal(row.data.correlation, 'overlapping-attempts');
    assert.equal(row.data.compactionId, null);
    assert.equal(row.data.startSeq, null);
  }
});

test('multiple open compactions, missing starts and premature ends are never guessed', () => {
  const h = harness(), session = h.session();
  let call = h.audit.begin(options());
  call.decision(decision());
  call.finish(result());
  assert.equal(records(session)[0].data.correlation, 'missing-compaction-start');
  h.start(session, 'first');
  h.start(session, 'second');
  call = h.audit.begin(options());
  call.decision(decision());
  call.finish(result());
  assert.equal(records(session).at(-1).data.correlation, 'ambiguous-compaction');
  h.end(session, 'first');
  call = h.audit.begin(options());
  call.decision(decision());
  h.end(session, 'second');
  call.finish(result());
  assert.equal(records(session).at(-1).data.correlation, 'compaction-ended-during-stream');
  assert.equal(records(session).at(-1).data.compactionId, null);
});

test('sessions and Session instance replacements cannot share ownership or write to detached sessions', () => {
  const h = harness(), a = h.session(), b = h.session('session-b');
  h.start(a, 'compact-a');
  h.start(b, 'compact-b');
  const one = h.audit.begin(options()), two = h.audit.begin(options('session-b'));
  one.decision(decision());
  two.decision(decision());
  one.finish(result());
  two.finish(result());
  assert.equal(records(a)[1].data.compactionId, 'compact-a');
  assert.equal(records(b)[1].data.compactionId, 'compact-b');
  const oldCall = h.audit.begin(options());
  h.session();
  oldCall.decision(decision());
  oldCall.finish(result());
  assert.equal(records(a).length, 2);
  assert.equal(h.warnings.length, 1);
});

test('records whitelist finite scalar metadata, keep below their bound, and never copy private payloads', () => {
  const h = harness({ version: 'v'.repeat(500) }), session = h.session();
  h.start(session);
  const call = h.audit.begin({ ...options(), provider: 'p'.repeat(500), model: 'x\nsecret', apiKey: 'PRIVATE-KEY', messages: ['PRIVATE-PROMPT'] });
  call.decision(decision({ outputDivisor: NaN, sourceDivisor: Infinity, requestedMaxTokens: -0,
    sourceTokensEstimated: 1n, effectiveOutputTokensEstimated: undefined,
    settings: { apiKey: 'PRIVATE-KEY' }, prompt: 'PRIVATE-PROMPT' }));
  call.finish(result({ usage: { outputTokens: 25, totalTokens: Infinity, rawOutput: 'PRIVATE-SUMMARY' },
    error: new Error('PRIVATE-ERROR'), rawOutput: 'PRIVATE-SUMMARY', reason: 'PRIVATE-ERROR' }));
  for (const record of records(session)) {
    const encoded = JSON.stringify(record.data);
    assert.ok(Buffer.byteLength(encoded) <= MAX_AUDIT_BYTES);
    assert.doesNotMatch(encoded, /PRIVATE|secret/);
    assert.equal(record.data.provider, null);
    assert.equal(record.data.model, null);
    assert.equal(record.data.pluginVersion, null);
  }
  assert.equal(records(session)[0].data.requestedMaxTokens, null);
  assert.equal(records(session)[0].data.sourceTokensEstimated, null);
  assert.equal(records(session)[0].data.outputDivisor, null);
  assert.deepEqual(records(session)[1].data.usage, { outputTokens: 25 });
});

test('input diagnostics retain fixed categories and numeric image estimates without private content', () => {
  const h = harness(), session = h.session();
  h.start(session);
  const call = h.audit.begin(options());
  call.decision(decision({ applied: false, targetTokens: null, reason: 'unsupported-input',
    sourceImageCount: 2, sourceImageTokensEstimated: 2048, budgetImageTokensEstimated: 2056,
    inputIssue: { stage: 'source', code: 'invalid-field-type', role: 'tool', blockType: 'image', field: 'attachment',
      text: 'PRIVATE-PROMPT', attachment: { path: 'PRIVATE-PATH', data: 'PRIVATE-IMAGE' },
      arguments: 'PRIVATE-TOOL-ARGUMENT', error: 'PRIVATE-ERROR' },
  }));
  call.finish(result());
  const saved = records(session)[0].data;
  assert.deepEqual(saved.inputIssue, { stage: 'source', code: 'invalid-field-type', role: 'tool', blockType: 'image', field: 'attachment' });
  assert.equal(saved.sourceImageCount, 2);
  assert.equal(saved.sourceImageTokensEstimated, 2048);
  assert.equal(saved.budgetImageTokensEstimated, 2056);
  assert.equal(saved.schemaVersion, 1, 'Diagnostic fields are an additive schema extension');
  assert.doesNotMatch(JSON.stringify(records(session)), /PRIVATE/);
  assert.equal(records(session)[1].data.inputIssue, undefined, 'The issue belongs to the decision, not the stream result');
});

test('input diagnostic fields reject unknown values instead of copying caller strings', () => {
  const h = harness(), session = h.session();
  h.start(session);
  for (const inputIssue of [
    undefined, null, 'PRIVATE', ['PRIVATE'],
    { stage: 'PRIVATE', code: 'unsupported-image' },
    { stage: 'source', code: 'PRIVATE' },
    { stage: 'budget', code: 'unsupported-file', role: 'PRIVATE', blockType: 'PRIVATE', field: 'PRIVATE' },
  ]) {
    const call = h.audit.begin(options());
    call.decision(decision({ inputIssue, sourceImageCount: -0,
      sourceImageTokensEstimated: Infinity, budgetImageTokensEstimated: 1n }));
    call.finish(result());
    const saved = records(session).at(-2).data;
    assert.deepEqual(saved.inputIssue, inputIssue?.stage === 'budget'
      ? { stage: 'budget', code: 'unsupported-file', role: null, blockType: null, field: null } : null);
    assert.equal(saved.sourceImageCount, null);
    assert.equal(saved.sourceImageTokensEstimated, null);
    assert.equal(saved.budgetImageTokensEstimated, null);
    assert.doesNotMatch(JSON.stringify(saved), /PRIVATE/);
  }
});

test('attachment diagnostics keep only fixed field names, never attachment metadata values', () => {
  const h = harness(), session = h.session();
  h.start(session);
  for (const field of ['attachmentId', 'mediaType', 'bytes', 'width', 'height', 'originalDimensions', 'name']) {
    const call = h.audit.begin(options());
    call.decision(decision({ applied: false, targetTokens: null, reason: 'unsupported-input',
      inputIssue: { stage: 'source', code: 'invalid-field-type', role: 'user', blockType: 'image', field,
        value: 'PRIVATE-ATTACHMENT-METADATA', attachmentId: 'PRIVATE-ID', mediaType: 'PRIVATE-TYPE',
        name: 'PRIVATE-NAME', bytes: 'PRIVATE-BYTES', width: 'PRIVATE-WIDTH', height: 'PRIVATE-HEIGHT',
        originalDimensions: { width: 'PRIVATE-ORIGINAL-WIDTH', height: 'PRIVATE-ORIGINAL-HEIGHT' } },
    }));
    call.finish(result());
    const saved = records(session).at(-2).data;
    assert.deepEqual(saved.inputIssue, { stage: 'source', code: 'invalid-field-type', role: 'user', blockType: 'image', field });
    assert.doesNotMatch(JSON.stringify(saved), /PRIVATE/);
    assert.ok(Buffer.byteLength(JSON.stringify(saved)) <= MAX_AUDIT_BYTES);
  }
});

test('all classified input failures are retained within the audit payload bound', () => {
  const h = harness({ version: 'v'.repeat(32) }), session = h.session();
  h.start(session, 'c'.repeat(64));
  const codes = ['unsupported-image', 'image-access-unavailable', 'unsupported-file', 'unsupported-block', 'unsupported-role',
    'invalid-field-type', 'invalid-json', 'empty-source', 'token-overflow'];
  for (const code of codes) {
    const call = h.audit.begin({ ...options(), provider: 'p'.repeat(128), model: 'm'.repeat(128) });
    call.decision(decision({ outputDivisor: Number.MAX_SAFE_INTEGER, sourceDivisor: Number.MAX_SAFE_INTEGER,
      requestedMaxTokens: Number.MAX_SAFE_INTEGER, sourceTokensEstimated: Number.MAX_SAFE_INTEGER,
      effectiveOutputTokensEstimated: Number.MAX_SAFE_INTEGER, targetTokens: Number.MAX_SAFE_INTEGER,
      sourceImageCount: Number.MAX_SAFE_INTEGER, sourceImageTokensEstimated: Number.MAX_SAFE_INTEGER,
      budgetImageTokensEstimated: Number.MAX_SAFE_INTEGER,
      inputIssue: { stage: 'budget', code, role: 'assistant', blockType: 'tool-call', field: 'arguments' },
    }));
    call.finish(result());
    const saved = records(session).at(-2).data;
    assert.equal(saved.inputIssue.code, code);
    assert.ok(Buffer.byteLength(JSON.stringify(saved)) <= MAX_AUDIT_BYTES);
  }
  assert.equal(records(session).length, codes.length * 2);
  assert.equal(h.warnings.length, 0);
});

test('missing API, write exceptions and rejected async adapters fail open with one safe warning', async () => {
  for (const append of [null, () => { throw new Error('PRIVATE-CREDENTIAL'); }, () => Promise.reject(new Error('PRIVATE-CREDENTIAL'))]) {
    const h = harness({ append });
    h.session();
    for (let index = 0; index < 2; index++) {
      const call = h.audit.begin(options());
      assert.doesNotThrow(() => call?.decision(decision()));
      assert.doesNotThrow(() => call?.finish(result()));
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.warnings.length, 1);
    assert.doesNotMatch(h.warnings[0], /PRIVATE-CREDENTIAL/);
  }
});

test('duplicate calls and disposal do not add extra records or leave session listeners active', () => {
  const h = harness(), session = h.session();
  h.start(session);
  const call = h.audit.begin(options());
  call.decision(decision());
  call.decision(decision({ targetTokens: 12 }));
  call.finish(result());
  call.finish(result());
  assert.equal(records(session).length, 2);
  const pending = h.audit.begin(options());
  h.dispose();
  pending.decision(decision());
  pending.finish(result());
  assert.equal(h.audit.begin(options()), undefined);
  assert.equal(records(session).length, 2);
  assert.equal(h.listeners.size, 0);
});

test('host binding can share one safe warning across setup and runtime failures', () => {
  let warningCalls = 0;
  const h = harness({ append: () => { throw new Error('private'); }, onWarning: () => { warningCalls++; } });
  h.session();
  const call = h.audit.begin(options());
  call.decision(decision());
  call.finish(result());
  assert.equal(warningCalls, 1);
  assert.equal(h.warnings.length, 0);
});

test('bounded tracking refuses to invent uniqueness after overflow and releases completed sessions', () => {
  const h = harness();
  for (let index = 0; index < MAX_AUDIT_SESSIONS + 2; index++) {
    const session = h.session('finished-' + index);
    h.start(session);
    h.end(session);
  }
  assert.equal(h.warnings.length, 0, 'Completed session tracking is released');
  for (let index = 0; index < MAX_AUDIT_SESSIONS; index++) h.start(h.session('open-' + index));
  const extra = h.session('overflow');
  h.start(extra);
  const call = h.audit.begin(options('overflow'));
  call.decision(decision());
  call.finish(result());
  assert.equal(records(extra)[0].data.correlation, 'tracking-limit');
  assert.equal(records(extra)[0].data.compactionId, null);
  assert.equal(h.warnings.length, 1);
});

test('untrusted getters and an unavailable logger cannot throw into inference', () => {
  const h = harness(), session = h.session();
  h.ctx.logger.warn = () => { throw new Error('logger unavailable'); };
  const call = h.audit.begin(options());
  assert.doesNotThrow(() => call.decision({ get targetTokens() { throw new Error('PRIVATE'); } }));
  assert.doesNotThrow(() => call.finish(result()));
  assert.equal(records(session).length, 1);
  assert.equal(records(session)[0].data.decisionSeq, null);
  assert.doesNotThrow(() => h.audit.begin({ get sessionId() { throw new Error('PRIVATE'); } }));
});
