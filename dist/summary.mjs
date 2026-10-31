/** An editable, per-request supplement to DSH's native summary instruction. */
const NATIVE_OPENING = 'You are now acting as a compaction engine for this AI coding assistant.';
const NATIVE_HEADINGS = ['Primary Request and Intent', 'Key Technical Concepts', 'Files and Code',
  'Errors and Fixes', 'Pending Jobs', 'Current Work', 'Next Step', 'Critical Context'];
const GUIDANCE_PREFIX = 'Keep the entire checkpoint, including all required headings, within a target of ';
const positive = value => Number.isSafeInteger(value) && value > 0;
export const validSummaryDivisor = value => typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= Number.MAX_SAFE_INTEGER;
export const DEFAULT_SUMMARY_TEMPLATE = `${GUIDANCE_PREFIX}{target} tokens.`;
export const validSummaryTemplate = value => typeof value === 'string' && value.length <= 2048 && value.includes('{target}');
// Share identity across hot reloads/copies without adding fields to native requests.
const augmentedMessages = globalThis[Symbol.for('dsh-strata-sync/summary-augmented')] ??= new WeakSet();
// Duplicate plugin hooks must not independently observe the same native call.
const observedRequests = globalThis[Symbol.for('dsh-strata-sync/summary-observed')] ??= new WeakSet();
// Audit ownership must not suppress another hook's existing guidance behavior.
const auditClaims = globalThis[Symbol.for('dsh-strata-sync/summary-audit-claims')] ??= new WeakMap();
export const MAX_RECOVERY_SESSIONS = 128;
// Eight mandatory headings need enough space for a meaningful checkpoint. Do
// not round a tiny target UP; leave native behavior intact instead.
export const MIN_SUMMARY_TARGET = 256;
function summaryTargetCandidate(effectiveOutputTokens, sourceTokens, outputDivisor, sourceDivisor) {
  if (![effectiveOutputTokens, sourceTokens].every(positive) || ![outputDivisor, sourceDivisor].every(validSummaryDivisor)) return null;
  return Math.floor(Math.min(effectiveOutputTokens / outputDivisor, sourceTokens / sourceDivisor));
}
export function planSummaryTarget(effectiveOutputTokens, sourceTokens, outputDivisor = 2, sourceDivisor = 2) {
  const target = summaryTargetCandidate(effectiveOutputTokens, sourceTokens, outputDivisor, sourceDivisor);
  return target !== null && target >= MIN_SUMMARY_TARGET ? target : null;
}

export function summaryInstruction(target, template = DEFAULT_SUMMARY_TEMPLATE) {
  if (!positive(target)) throw new TypeError('A positive integer summary target is required.');
  if (!validSummaryTemplate(template)) throw new TypeError('Summary prompt must include {target} and be at most 2048 characters.');
  return template.replaceAll('{target}', String(target));
}

/** Recognize the shipped native prompt, without storing or replacing its text. */
export function nativeSummaryMessage(options) {
  if (options?.purpose !== 'compaction' || !Array.isArray(options.messages) || augmentedMessages.has(options.messages)) return null;
  const message = options.messages.at(-1);
  if (message?.role !== 'user' || message.content?.length !== 1 || message.content[0]?.type !== 'text') return null;
  const text = message.content[0].text;
  if (typeof text !== 'string' || !text.startsWith(NATIVE_OPENING) || text.includes(GUIDANCE_PREFIX)) return null;
  // Normalize only the recognition view, never the user's native prompt bytes.
  const recognition = text.replace(/\r\n/g, '\n');
  let position = 0;
  for (const heading of NATIVE_HEADINGS) {
    const next = recognition.indexOf(`\n## ${heading}\n`, position);
    if (next < position) return null;
    position = next + heading.length + 4;
  }
  if (!recognition.includes('\nRules:\n') || !recognition.includes('Do not copy it forward verbatim:')) return null;
  return message;
}

const imageMedia = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function resetEstimate(details) {
  Object.assign(details, { imageCount: 0, imageTokens: 0, inputIssue: null });
}
function inputFailure(details, stage, code, role = null, blockType = null, field = null) {
  details.inputIssue = { stage, code,
    role: role === null ? null : ['system', 'user', 'assistant', 'tool'].includes(role) ? role : 'unknown',
    blockType: blockType === null ? null : ['text', 'reasoning', 'tool-call', 'image', 'file'].includes(blockType) ? blockType : 'unknown', field };
  return null;
}
// Validate the installed host's durable image reference without reading image
// bytes or resolving an arbitrary URL. No field value is copied into diagnostics.
function imageReference(block, details, stage, role) {
  const fail = (code, field) => inputFailure(details, stage, code, role, 'image', field);
  const ref = block.attachment;
  if (ref === undefined) return fail('unsupported-image', 'attachment');
  if (!object(ref)) return fail('invalid-field-type', 'attachment');
  if (typeof ref.attachmentId !== 'string') return fail('invalid-field-type', 'attachmentId');
  if (!/^sha256:[a-f0-9]{64}$/.test(ref.attachmentId)) return fail('unsupported-image', 'attachmentId');
  if (typeof ref.mediaType !== 'string') return fail('invalid-field-type', 'mediaType');
  if (!imageMedia.includes(ref.mediaType)) return fail('unsupported-image', 'mediaType');
  for (const field of ['bytes', 'width', 'height']) if (!positive(ref[field])) return fail('invalid-field-type', field);
  if (ref.name !== undefined && typeof ref.name !== 'string') return fail('invalid-field-type', 'name');
  if (ref.originalDimensions !== undefined && (!object(ref.originalDimensions)
      || !positive(ref.originalDimensions.width) || !positive(ref.originalDimensions.height))) return fail('invalid-field-type', 'originalDimensions');
  return ref;
}
// Installed dsh-llm requestImageHandleText format. Previews never enlarge the
// source, so the source dimensions conservatively bound the preview's digits.
// Access paths come from the same metadata-only host resolver as the adapter.
function imageHandleText(ref, access) {
  const identity = ref.name === undefined ? ref.attachmentId : `${JSON.stringify(ref.name)} (${ref.attachmentId})`;
  const preview = `Image ${identity}; request preview ${ref.width}x${ref.height}px.`;
  if (access === undefined) return `${preview} It may be resized or re-encoded; source dimensions, format, and byte size may differ.`;
  if (!object(access) || typeof access.readonlyPath !== 'string') throw new TypeError('Invalid image access metadata.');
  const ext = ref.mediaType === 'image/jpeg' ? 'jpg' : ref.mediaType.slice(6);
  return `${preview} Normalized copy (read-only; may be resized or re-encoded): ${JSON.stringify(access.readonlyPath)} (${ref.width}x${ref.height}px, ${ref.mediaType}). Source dimensions, format, and byte size may differ. Copy to a writable path ending in .${ext} before editing.`;
}

/** Match the installed DSH source heuristic: four characters/token plus
 * framing, including serialized image references (not a visual token count).
 * Never price system text, tool schemas or the final summary instruction here.
 * Optional details contain only fixed diagnostic categories and numeric costs.
 */
export function estimateSummarySource(messages, details = {}) {
  resetEstimate(details);
  const fail = (code, role, block, field) => inputFailure(details, 'source', code, role, block, field);
  if (!Array.isArray(messages)) return fail('invalid-field-type', null, null, 'messages');
  if (messages.length < 2) return fail('empty-source', null, null, 'messages');
  let tokens = 0;
  for (const message of messages.slice(0, -1)) {
    if (message?.role === 'system') continue;
    if (!['user', 'assistant', 'tool'].includes(message?.role)) return fail('unsupported-role', message?.role ?? 'unknown');
    if (!Array.isArray(message.content)) return fail('invalid-field-type', message.role, null, 'content');
    tokens += 4;
    for (const block of message.content) {
      if (['text', 'reasoning'].includes(block?.type)) {
        if (typeof block.text !== 'string') return fail('invalid-field-type', message.role, block.type, 'text');
        tokens += 4 + Math.ceil(block.text.length / 4);
      } else if (block?.type === 'tool-call') {
        for (const field of ['name', 'arguments']) if (typeof block[field] !== 'string') return fail('invalid-field-type', message.role, block.type, field);
        tokens += 4 + Math.ceil(block.name.length / 4) + Math.ceil(block.arguments.length / 4);
      } else if (block?.type === 'image') {
        const ref = imageReference(block, details, 'source', message.role);
        if (!ref) return null;
        let cost;
        try { const { offloaded, ...reference } = block; cost = 4 + Math.ceil(JSON.stringify(reference).length / 4); }
        catch { return fail('invalid-json', message.role, block.type, 'attachment'); }
        tokens += cost; details.imageCount++; details.imageTokens += cost;
      } else return fail(block?.type === 'file' ? 'unsupported-file' : 'unsupported-block', message.role, block?.type ?? 'unknown');
    }
  }
  return positive(tokens) ? tokens : fail(tokens === 0 ? 'empty-source' : 'token-overflow');
}

/** Conservative estimate of the output room before provider dispatch.
 * The supported DSH adapter uses pi-ai 1.1.0: 3.5 chars/token and
 * reserves 4096 tokens before clamping maxTokens. Replayed assistant usage is
 * zeroed by DSH. Include system text, tool schemas and framing as well, even
 * where that adapter's heuristic omits them. Each native image costs pi-ai's
 * 4800 estimated characters plus its host-generated text handle and framing.
 * This is NOT a tokenizer count or the server's final cap.
 */
export function estimateEffectiveSummaryBudget(options, contextWindow, template = DEFAULT_SUMMARY_TEMPLATE, details = {}, resolveImageAccess = () => undefined) {
  resetEstimate(details);
  const fail = (code, role, block, field) => inputFailure(details, 'budget', code, role, block, field);
  if (!positive(contextWindow) || !positive(options?.maxTokens) || !validSummaryTemplate(template)) return null;
  if (!Array.isArray(options.messages)) return fail('invalid-field-type', null, null, 'messages');
  const price = text => Math.ceil(text.length / 3.5) + 4;
  let input = 0;
  try {
    if (options.system !== undefined) {
      if (typeof options.system !== 'string') return fail('invalid-field-type', null, null, 'system');
      input += price(options.system);
    }
    if (options.tools !== undefined) {
      if (!Array.isArray(options.tools)) return fail('invalid-field-type', null, null, 'tools');
      try { input += price(JSON.stringify(options.tools)); }
      catch { return fail('invalid-json', null, null, 'tools'); }
    }
    for (const message of options.messages) {
      if (!['system', 'user', 'assistant', 'tool'].includes(message?.role)) return fail('unsupported-role', message?.role ?? 'unknown');
      if (!Array.isArray(message.content)) return fail('invalid-field-type', message.role, null, 'content');
      input += 4;
      if (message.role === 'tool' && !message.content.some(block => block?.type === 'text' && block.text?.length)) input += price('(no output)');
      for (const block of message.content) {
        if (['text', 'reasoning'].includes(block?.type)) {
          if (typeof block.text !== 'string') return fail('invalid-field-type', message.role, block.type, 'text');
          input += price(block.text);
        } else if (block?.type === 'tool-call') {
          for (const field of ['name', 'arguments']) if (typeof block[field] !== 'string') return fail('invalid-field-type', message.role, block.type, field);
          // JSON normalization can expand compact numeric literals (e.g. 1e9).
          let normalized;
          try { normalized = JSON.stringify(JSON.parse(block.arguments)); }
          catch { return fail('invalid-json', message.role, block.type, 'arguments'); }
          input += price(block.name) + Math.max(price(block.arguments), price(normalized));
        } else if (block?.type === 'image') {
          const ref = imageReference(block, details, 'budget', message.role);
          if (!ref) return null;
          let handle;
          try { handle = imageHandleText(ref, resolveImageAccess(ref)); }
          catch { return fail('image-access-unavailable', message.role, block.type, 'attachment'); }
          const cost = Math.ceil(4800 / 3.5) + 4 + price(handle)
            + (message.role === 'tool' ? price('Attached image(s) from tool result:') + 8 : 0);
          input += cost; details.imageCount++; details.imageTokens += cost;
        } else return fail(block?.type === 'file' ? 'unsupported-file' : 'unsupported-block', message.role, block?.type ?? 'unknown');
      }
    }
    // Reserve the longest possible rendered supplement once, avoiding a
    // self-referential target calculation. The target never exceeds maxTokens.
    input += price('\n- ' + summaryInstruction(options.maxTokens, template));
  } catch { return fail('invalid-field-type'); }
  if (!Number.isSafeInteger(input)) return fail('token-overflow');
  return Math.max(0, Math.min(options.maxTokens, contextWindow - input - 4096));
}

/** The native waterfall's next() closes over options, so replace only its
 * messages property for the lifetime of this stream; never mutate frozen
 * messages or recursively dispatch a second LLM request.
 */
export function installSummaryGuidance(ctx, resolveContext, getSettings = () => ({}), audit) {
  let closed = false;
  // Only routing identifiers and booleans are retained, never prompts or output.
  // A newer attempt owns settlement, so a late older failure cannot re-arm a
  // session whose newer summary succeeded. Eviction safely returns to native.
  const recovery = new Map();
  const commits = new Map();
  let attempt = 0;
  let preferenceAudit;
  function resolveImageAccess(ref) {
    // Same synchronous metadata-only resolution as the native pi-ai adapter.
    // Never read the image, fetch a URL, or retain/log the resulting path.
    const attachments = ctx.get('attachments');
    if (!attachments) return undefined;
    const hostPath = attachments.imageHostPath(ref);
    if (hostPath === undefined) return undefined;
    if (typeof hostPath !== 'string') throw new TypeError('Invalid image host path metadata.');
    const readonlyPath = ctx.get('fs')?.processPathFromHostPath(hostPath);
    if (readonlyPath === undefined) return undefined;
    if (typeof readonlyPath !== 'string') throw new TypeError('Invalid image access metadata.');
    return { readonlyPath };
  }
  // Auditing is observational: a missing/throwing sink must never replace a
  // native stream, change its chunks, or turn a cancellation into an error.
  function beginAudit(options) {
    try { return audit?.begin(options); } catch { return undefined; }
  }
  function record(handle, method, data) {
    try { handle?.[method](data)?.catch?.(() => {}); } catch { /* Fail open. */ }
  }
  function streamAudit(options, handle) {
    if (!handle) return { chunk() {}, complete() {}, fail() {}, close() {} };
    const started = performance.now();
    let finish, usage, completed = false, failed = false;
    return {
      chunk(value) {
        try {
          if (value?.type === 'finish') finish = value.reason?.kind;
          if (value?.type === 'usage') usage = value.usage;
        } catch { /* Observation must not introduce a native stream failure. */ }
      },
      complete() { completed = true; },
      fail() { failed = true; },
      close() {
        try {
          const outcome = options.signal?.aborted || finish === 'aborted' ? 'cancelled'
            : failed ? 'error' : !completed ? 'incomplete'
            : finish === 'max-tokens' ? 'truncated'
            : ['stop', 'tool-calls'].includes(finish) ? 'completed'
            : ['error', 'context-window-exceeded'].includes(finish) ? 'error' : 'incomplete';
          record(handle, 'finish', { finishReason: finish ?? null, outcome, usage,
            streamCompleted: completed, elapsedMs: Math.max(0, Math.floor(performance.now() - started)) });
        } catch { /* Cleanup must not mask the native result or exception. */ }
      },
    };
  }
  function passthrough(options, next, decision) {
    if (!audit || auditClaims.has(options)) return next();
    const claim = {};
    auditClaims.set(options, claim);
    const release = () => { if (auditClaims.get(options) === claim) auditClaims.delete(options); };
    let stream;
    try { stream = next(); }
    catch (error) {
      if (auditClaims.get(options) === claim) {
        const handle = beginAudit(options), tracker = streamAudit(options, handle);
        record(handle, 'decision', decision); tracker.fail(); tracker.close(); release();
      }
      throw error;
    }
    // A later enabled hook can take ownership while next() builds the native
    // stream. A disabled hook must not hide its actual application or suppress it.
    if (auditClaims.get(options) !== claim) return stream;
    const handle = beginAudit(options);
    if (!handle) { release(); return stream; }
    const tracker = streamAudit(options, handle);
    record(handle, 'decision', decision);
    let iterator, synchronous = false, settled = false;
    const underlying = () => {
      if (!iterator) {
        synchronous = typeof stream[Symbol.asyncIterator] !== 'function';
        iterator = synchronous ? stream[Symbol.iterator]() : stream[Symbol.asyncIterator]();
      }
      return iterator;
    };
    const settle = () => { if (!settled) { settled = true; tracker.close(); release(); } };
    async function advance(method, value) {
      try {
        const current = underlying();
        let result;
        if (typeof current[method] === 'function') result = await current[method](value);
        else if (method === 'throw') throw value;
        else result = { value, done: true };
        if (synchronous) result = { ...result, value: await result.value };
        if (result.done) { if (method === 'next') tracker.complete(); settle(); }
        else tracker.chunk(result.value);
        return result;
      } catch (error) { tracker.fail(); settle(); throw error; }
    }
    // Explicit forwarding also preserves return()/throw() before the first
    // next(); an unstarted async-generator wrapper would skip native cleanup.
    return {
      [Symbol.asyncIterator]() { return this; },
      next(value) { return advance('next', value); },
      return(value) { return advance('return', value); },
      throw(error) { return advance('throw', error); },
    };
  }
  function recoveryKey(options) {
    const parts = [options.sessionId, options.provider, options.model];
    return parts.every(value => typeof value === 'string' && value.length > 0 && value.length <= 512)
      ? JSON.stringify(parts) : null;
  }
  function beginRecovery(key) {
    const state = recovery.get(key) ?? { armed: false, latest: 0 };
    state.latest = ++attempt;
    recovery.delete(key);
    recovery.set(key, state);
    while (recovery.size > MAX_RECOVERY_SESSIONS) recovery.delete(recovery.keys().next().value);
    return { state, ticket: state.latest };
  }
  function preferences() {
    try {
      const value = getSettings();
      const enabled = value.summaryGuidance === undefined ? true : value.summaryGuidance;
      const mode = value.summaryGuidanceMode === undefined ? 'after-truncation' : value.summaryGuidanceMode;
      const outputDivisor = value.summaryOutputDivisor === undefined ? 2 : value.summaryOutputDivisor;
      const sourceDivisor = value.summarySourceDivisor === undefined ? 2 : value.summarySourceDivisor;
      const template = value.summaryPromptTemplate === undefined ? DEFAULT_SUMMARY_TEMPLATE : value.summaryPromptTemplate;
      preferenceAudit = { enabled: typeof enabled === 'boolean' ? enabled : null,
        mode: ['always', 'after-truncation'].includes(mode) ? mode : null,
        outputDivisor: validSummaryDivisor(outputDivisor) ? outputDivisor : null,
        sourceDivisor: validSummaryDivisor(sourceDivisor) ? sourceDivisor : null };
      const valid = enabled === true && ['always', 'after-truncation'].includes(mode)
        && [outputDivisor, sourceDivisor].every(validSummaryDivisor) && validSummaryTemplate(template);
      if (!valid || mode !== 'after-truncation') { recovery.clear(); commits.clear(); }
      return valid ? { mode, outputDivisor, sourceDivisor, template } : null;
    } catch {
      preferenceAudit = { enabled: null, mode: null, outputDivisor: null, sourceDivisor: null };
      recovery.clear(); commits.clear(); return null;
    }
  }
  // A stopped stream can still fail native checkpoint validation. DSH records
  // compaction/summary only after that validation, then commits its checkpoint
  // before compaction/end. Reset only after that matching, error-free pair.
  const removeCommit = ctx.on('session/event', (session, event) => {
    if (closed || preferences()?.mode !== 'after-truncation') return;
    const data = event?.data;
    if (typeof session?.id !== 'string' || !session.id || session.id.length > 512
        || typeof data?.compactionId !== 'string' || !data.compactionId || data.compactionId.length > 512) return;
    const id = JSON.stringify([session.id, data.compactionId]);
    if (event.type === 'compaction/summary') {
      const scope = recoveryKey({ sessionId: session.id, provider: data.provider, model: data.model });
      const state = scope === null ? null : recovery.get(scope);
      if (!state?.armed || state.lastCompletedTicket !== state.latest) return;
      commits.delete(id);
      commits.set(id, { scope, state, ticket: state.latest });
      while (commits.size > MAX_RECOVERY_SESSIONS) commits.delete(commits.keys().next().value);
    } else if (event.type === 'compaction/end') {
      const commit = commits.get(id);
      commits.delete(id);
      if (data.error === undefined && commit && recovery.get(commit.scope) === commit.state
          && commit.state.latest === commit.ticket && commit.state.lastCompletedTicket === commit.ticket) recovery.delete(commit.scope);
    }
  });
  const remove = ctx.on('llm/stream', (options, next) => {
    // Reading the current master switch also clears pending recovery when the
    // next request is an ordinary agent call after guidance was disabled.
    const selected = preferences();
    if (closed || options?.purpose !== 'compaction' || observedRequests.has(options) || augmentedMessages.has(options.messages)) return next();
    const decision = { ...preferenceAudit, requestedMaxTokens: positive(options.maxTokens) ? options.maxTokens : null,
      sourceTokensEstimated: null, effectiveOutputTokensEstimated: null, targetTokens: null, applied: false,
      sourceImageCount: null, sourceImageTokensEstimated: null, budgetImageTokensEstimated: null, inputIssue: null };
    const skip = reason => passthrough(options, next, { ...decision, reason });
    const native = nativeSummaryMessage(options);
    const descriptor = options && Object.getOwnPropertyDescriptor(options, 'messages');
    if (!native) return skip('unsupported-prompt');
    if (!descriptor?.writable) return skip('non-writable');
    if (options.signal?.aborted) return skip('cancelled');
    // Disabled guidance must not perform even metadata discovery. Native DSH
    // compaction and its request options still pass through unchanged.
    if (!selected) return skip(decision.enabled === false ? 'disabled' : 'invalid-settings');
    const key = selected.mode === 'after-truncation' ? recoveryKey(options) : null;
    if (selected.mode === 'after-truncation' && key === null) return skip('missing-session-route');
    const sourceDetails = {};
    const sourceTokens = estimateSummarySource(options.messages, sourceDetails);
    decision.sourceTokensEstimated = sourceTokens;
    decision.inputIssue = sourceDetails.inputIssue;
    if (sourceTokens !== null) {
      decision.sourceImageCount = sourceDetails.imageCount;
      decision.sourceImageTokensEstimated = sourceDetails.imageTokens;
    }
    if (!positive(options.maxTokens)) return skip('invalid-max-tokens');
    const claim = {};
    if (audit) auditClaims.set(options, claim);
    const releaseClaim = () => { if (auditClaims.get(options) === claim) auditClaims.delete(options); };
    const stream = (async function* () {
      const original = options.messages;
      const observation = key === null ? null : beginRecovery(key);
      const handle = beginAudit(options);
      const tracker = streamAudit(options, handle);
      let augmented;
      observedRequests.add(options);
      try {
        // Observe terminal outcomes even when this input cannot be estimated:
        // its truncation can arm the next supported request for this session.
        decision.reason = positive(sourceTokens) ? 'awaiting-truncation' : 'unsupported-input';
        if (positive(sourceTokens) && (selected.mode === 'always' || observation.state.armed)) {
          let contextWindow;
          try { contextWindow = await resolveContext(options); }
          catch { /* Metadata/compatibility failure must not break native inference. */ }
          const budgetDetails = {};
          const effectiveOutput = estimateEffectiveSummaryBudget(options, contextWindow, selected.template, budgetDetails, resolveImageAccess);
          const candidate = summaryTargetCandidate(effectiveOutput, sourceTokens, selected.outputDivisor, selected.sourceDivisor);
          const target = candidate !== null && candidate >= MIN_SUMMARY_TARGET ? candidate : null;
          decision.effectiveOutputTokensEstimated = effectiveOutput;
          decision.inputIssue = budgetDetails.inputIssue;
          if (effectiveOutput !== null) decision.budgetImageTokensEstimated = budgetDetails.imageTokens;
          decision.targetTokens = candidate;
          const current = preferences();
          decision.reason = closed ? 'closed' : options.signal?.aborted ? 'cancelled'
            : !current || !Object.keys(selected).every(key => selected[key] === current[key]) ? 'settings-changed'
            : options.messages !== original ? 'messages-changed'
            : !positive(contextWindow) ? 'context-unavailable'
            : effectiveOutput === null ? 'effective-budget-unavailable'
            : effectiveOutput === 0 ? 'insufficient-output-budget'
            : target === null ? 'target-too-small' : 'applied';
          if (!closed && !options.signal?.aborted && current && Object.keys(selected).every(key => selected[key] === current[key]) && target !== null && options.messages === original) {
            const last = { ...native, content: [{ ...native.content[0], text: `${native.content[0].text}\n- ${summaryInstruction(target, selected.template)}` }] };
            augmented = [...original.slice(0, -1), last];
            augmentedMessages.add(augmented);
            options.messages = augmented;
            decision.applied = true;
          }
        }
        record(handle, 'decision', decision);
        let finish;
        // Native DSH uses finish.reason.kind = max-tokens for truncation.
        // Forward all chunks unchanged and call next exactly once. Cordis's
        // next consumes the waterfall and cannot be used to replay a retry.
        for await (const chunk of next()) {
          tracker.chunk(chunk);
          if (chunk?.type === 'finish') finish = chunk.reason?.kind;
          yield chunk;
        }
        tracker.complete();
        const current = preferences();
        if (observation && !closed && !options.signal?.aborted && current?.mode === 'after-truncation'
            && recovery.get(key) === observation.state && observation.state.latest === observation.ticket) {
          if (finish === 'max-tokens') {
            observation.state.armed = true;
            delete observation.state.lastCompletedTicket;
          } else if (finish === 'stop' || finish === 'tool-calls') {
            // Native finishError accepts both. The later summary/end pair,
            // not this finish reason alone, proves the checkpoint committed.
            observation.state.lastCompletedTicket = observation.ticket;
          }
        }
      } catch (error) { tracker.fail(); throw error; }
      finally {
        tracker.close();
        releaseClaim();
        if (observation && recovery.get(key) === observation.state && observation.state.latest === observation.ticket && !observation.state.armed) recovery.delete(key);
        observedRequests.delete(options);
        if (augmented) augmentedMessages.delete(augmented);
        if (augmented && options.messages === augmented) options.messages = original;
      }
    })();
    if (audit) for (const method of ['return', 'throw']) {
      const close = stream[method].bind(stream);
      // Before the first next(), an async generator has not entered its finally.
      // Releasing only our own claim avoids hiding a later reused request.
      stream[method] = value => close(value).finally(releaseClaim);
    }
    return stream;
  });
  ctx.effect(() => () => { closed = true; recovery.clear(); commits.clear(); remove?.(); removeCommit?.(); }, 'strata-sync: summary guidance lifetime');
}
