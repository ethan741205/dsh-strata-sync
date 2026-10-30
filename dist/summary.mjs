/** An editable, per-request supplement to DSH's native summary instruction. */
const NATIVE_OPENING = 'You are now acting as a compaction engine for this AI coding assistant.';
const NATIVE_HEADINGS = ['Primary Request and Intent', 'Key Technical Concepts', 'Files and Code',
  'Errors and Fixes', 'Pending Jobs', 'Current Work', 'Next Step', 'Critical Context'];
const GUIDANCE_PREFIX = 'Keep the entire checkpoint, including all required headings, within a target of ';
const positive = value => Number.isSafeInteger(value) && value > 0;
export const validSummaryDivisor = value => typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= Number.MAX_SAFE_INTEGER;
export const DEFAULT_SUMMARY_TEMPLATE = `${GUIDANCE_PREFIX}{target} tokens by retaining only information essential to continue the remaining work, consolidating prior summaries, and removing redundant or obsolete details.`;
export const validSummaryTemplate = value => typeof value === 'string' && value.length <= 2048 && value.includes('{target}');
// Share identity across hot reloads/copies without adding fields to native requests.
const augmentedMessages = globalThis[Symbol.for('dsh-strata-sync/summary-augmented')] ??= new WeakSet();
// Duplicate plugin hooks must not independently observe the same native call.
const observedRequests = globalThis[Symbol.for('dsh-strata-sync/summary-observed')] ??= new WeakSet();
export const MAX_RECOVERY_SESSIONS = 128;
// Eight mandatory headings need enough space for a meaningful checkpoint. Do
// not round a tiny target UP; leave native behavior intact instead.
export const MIN_SUMMARY_TARGET = 256;
export function planSummaryTarget(effectiveOutputTokens, sourceTokens, outputDivisor = 2, sourceDivisor = 2) {
  if (![effectiveOutputTokens, sourceTokens].every(positive) || ![outputDivisor, sourceDivisor].every(validSummaryDivisor)) return null;
  const target = Math.floor(Math.min(effectiveOutputTokens / outputDivisor, sourceTokens / sourceDivisor));
  return target >= MIN_SUMMARY_TARGET ? target : null;
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

/** Match DSH's text heuristic: four characters/token plus block/role framing.
 * Price only the selected conversation span, never the system prompt, tool
 * schemas, or final summary instruction. Unknown attachment pricing falls
 * back to native behavior rather than inventing a visual/file token count.
 */
export function estimateSummarySource(messages) {
  if (!Array.isArray(messages) || messages.length < 2) return null;
  let tokens = 0;
  for (const message of messages.slice(0, -1)) {
    if (message?.role === 'system') continue;
    if (!['user', 'assistant', 'tool'].includes(message?.role) || !Array.isArray(message.content)) return null;
    tokens += 4;
    for (const block of message.content) {
      if (['text', 'reasoning'].includes(block?.type) && typeof block.text === 'string') {
        tokens += 4 + Math.ceil(block.text.length / 4);
      } else if (block?.type === 'tool-call' && typeof block.name === 'string' && typeof block.arguments === 'string') {
        tokens += 4 + Math.ceil(block.name.length / 4) + Math.ceil(block.arguments.length / 4);
      } else return null;
    }
  }
  return positive(tokens) ? tokens : null;
}

/** Conservative text-only estimate of the output room before provider dispatch.
 * The supported DSH adapter uses pi-ai 1.1.0: 3.5 chars/token and
 * reserves 4096 tokens before clamping maxTokens. Replayed assistant usage is
 * zeroed by DSH. Include system text, tool schemas and framing as well, even
 * where that adapter's heuristic omits them. This is NOT a tokenizer count or
 * the server's final cap; unknown content leaves the native prompt untouched.
 */
export function estimateEffectiveSummaryBudget(options, contextWindow, template = DEFAULT_SUMMARY_TEMPLATE) {
  if (!positive(contextWindow) || !positive(options?.maxTokens) || !validSummaryTemplate(template) || !Array.isArray(options.messages)) return null;
  const price = text => Math.ceil(text.length / 3.5) + 4;
  let input = 0;
  try {
    if (options.system !== undefined) {
      if (typeof options.system !== 'string') return null;
      input += price(options.system);
    }
    if (options.tools !== undefined) {
      if (!Array.isArray(options.tools)) return null;
      input += price(JSON.stringify(options.tools));
    }
    for (const message of options.messages) {
      if (!['system', 'user', 'assistant', 'tool'].includes(message?.role) || !Array.isArray(message.content)) return null;
      input += 4;
      if (message.role === 'tool' && !message.content.some(block => block.type === 'text' && block.text?.length)) input += price('(no output)');
      for (const block of message.content) {
        if (['text', 'reasoning'].includes(block?.type) && typeof block.text === 'string') input += price(block.text);
        else if (block?.type === 'tool-call' && typeof block.name === 'string' && typeof block.arguments === 'string') {
          // JSON normalization can expand compact numeric literals (e.g. 1e9).
          const normalized = JSON.stringify(JSON.parse(block.arguments));
          input += price(block.name) + Math.max(price(block.arguments), price(normalized));
        } else return null;
      }
    }
    // Reserve the longest possible rendered supplement once, avoiding a
    // self-referential target calculation. The target never exceeds maxTokens.
    input += price('\n- ' + summaryInstruction(options.maxTokens, template));
  } catch { return null; }
  if (!Number.isSafeInteger(input)) return null;
  return Math.max(0, Math.min(options.maxTokens, contextWindow - input - 4096));
}

/** The native waterfall's next() closes over options, so replace only its
 * messages property for the lifetime of this stream; never mutate frozen
 * messages or recursively dispatch a second LLM request.
 */
export function installSummaryGuidance(ctx, resolveContext, getSettings = () => ({})) {
  let closed = false;
  // Only routing identifiers and booleans are retained, never prompts or output.
  // A newer attempt owns settlement, so a late older failure cannot re-arm a
  // session whose newer summary succeeded. Eviction safely returns to native.
  const recovery = new Map();
  const commits = new Map();
  let attempt = 0;
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
      const valid = enabled === true && ['always', 'after-truncation'].includes(mode)
        && [outputDivisor, sourceDivisor].every(validSummaryDivisor) && validSummaryTemplate(template);
      if (!valid || mode !== 'after-truncation') { recovery.clear(); commits.clear(); }
      return valid ? { mode, outputDivisor, sourceDivisor, template } : null;
    } catch { recovery.clear(); commits.clear(); return null; }
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
    const native = nativeSummaryMessage(options);
    const descriptor = options && Object.getOwnPropertyDescriptor(options, 'messages');
    if (closed || !native || !descriptor?.writable || options.signal?.aborted || observedRequests.has(options)) return next();
    // Disabled guidance must not perform even metadata discovery. Native DSH
    // compaction and its request options still pass through unchanged.
    if (!selected) return next();
    const key = selected.mode === 'after-truncation' ? recoveryKey(options) : null;
    if (selected.mode === 'after-truncation' && key === null) return next();
    const sourceTokens = estimateSummarySource(options.messages);
    if (!positive(sourceTokens) || !positive(options.maxTokens)) return next();
    return (async function* () {
      const original = options.messages;
      const observation = key === null ? null : beginRecovery(key);
      let augmented;
      observedRequests.add(options);
      try {
        if (selected.mode === 'always' || observation.state.armed) {
          let contextWindow;
          try { contextWindow = await resolveContext(options); }
          catch { /* Metadata/compatibility failure must not break native inference. */ }
          const effectiveOutput = estimateEffectiveSummaryBudget(options, contextWindow, selected.template);
          const target = planSummaryTarget(effectiveOutput, sourceTokens, selected.outputDivisor, selected.sourceDivisor);
          const current = preferences();
          if (!closed && !options.signal?.aborted && current && Object.keys(selected).every(key => selected[key] === current[key]) && target !== null && options.messages === original) {
            const last = { ...native, content: [{ ...native.content[0], text: `${native.content[0].text}\n- ${summaryInstruction(target, selected.template)}` }] };
            augmented = [...original.slice(0, -1), last];
            augmentedMessages.add(augmented);
            options.messages = augmented;
          }
        }
        let finish;
        // Native DSH uses finish.reason.kind = max-tokens for truncation.
        // Forward all chunks unchanged and call next exactly once. Cordis's
        // next consumes the waterfall and cannot be used to replay a retry.
        for await (const chunk of next()) {
          if (chunk?.type === 'finish') finish = chunk.reason?.kind;
          yield chunk;
        }
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
      } finally {
        if (observation && recovery.get(key) === observation.state && observation.state.latest === observation.ticket && !observation.state.armed) recovery.delete(key);
        observedRequests.delete(options);
        if (augmented) augmentedMessages.delete(augmented);
        if (augmented && options.messages === augmented) options.messages = original;
      }
    })();
  });
  ctx.effect(() => () => { closed = true; recovery.clear(); commits.clear(); remove?.(); removeCommit?.(); }, 'strata-sync: summary guidance lifetime');
}
