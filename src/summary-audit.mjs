import { randomUUID } from 'node:crypto';

export const SUMMARY_GUIDANCE_EVENT = 'plugin:dsh-strata-sync/summary-guidance';
export const SUMMARY_RESULT_EVENT = 'plugin:dsh-strata-sync/summary-result';
export const MAX_AUDIT_BYTES = 2048;
export const MAX_AUDIT_SESSIONS = 128;
const MAX_OPEN_COMPACTIONS = 16;
const MAX_ACTIVE_ATTEMPTS = 16;
const nonnegative = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0) ? value : null;
const divisor = value => typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= Number.MAX_SAFE_INTEGER ? value : null;
const identifier = (value, bytes = 128) => typeof value === 'string' && value.length > 0
  && Buffer.byteLength(value) <= bytes && !/[\x00-\x1f\x7f]/.test(value) ? value : null;
const choice = (value, values) => values.includes(value) ? value : null;
const reasons = ['applied', 'disabled', 'invalid-settings', 'awaiting-truncation', 'unsupported-input',
  'invalid-max-tokens', 'missing-session-route', 'context-unavailable', 'target-too-small',
  'settings-changed', 'cancelled', 'messages-changed', 'closed', 'non-writable', 'unsupported-prompt',
  'effective-budget-unavailable', 'insufficient-output-budget'];
const inputIssueCodes = ['unsupported-image', 'image-access-unavailable', 'unsupported-file', 'unsupported-block', 'unsupported-role',
  'invalid-field-type', 'invalid-json', 'empty-source', 'token-overflow'];
function inputIssue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const stage = choice(value.stage, ['source', 'budget']);
  const code = choice(value.code, inputIssueCodes);
  if (stage === null || code === null) return null;
  // Only fixed categories may cross this boundary. Never retain a caller's
  // actual role/type/field string, attachment, path, or arbitrary nested data.
  return { stage, code,
    role: choice(value.role, ['system', 'user', 'assistant', 'tool', 'unknown']),
    blockType: choice(value.blockType, ['text', 'reasoning', 'tool-call', 'image', 'file', 'unknown']),
    field: choice(value.field, ['messages', 'content', 'text', 'name', 'arguments', 'attachment',
      'attachmentId', 'mediaType', 'bytes', 'width', 'height', 'originalDimensions', 'system', 'tools']),
  };
}

/** Small, optional native records. Neither this state nor its persistence is
 * used to decide whether to alter a summary or to retry an inference request.
 * appendPluginRecord must come from the host's own dsh-session module: its
 * private Session method cannot accept an instance from a second copy.
 */
export function createSummaryAudit(ctx, { appendPluginRecord, pluginVersion, onWarning } = {}) {
  let closed = false;
  let warned = false;
  let saturated = false;
  const states = new Map();
  const version = identifier(pluginVersion, 32);
  function warn() {
    if (warned || closed) return;
    warned = true;
    try {
      const result = typeof onWarning === 'function' ? onWarning()
        : ctx.logger?.warn?.('dsh-strata-sync: native summary audit is unavailable or incomplete; summary processing is unchanged.');
      if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => {});
    } catch {}
  }
  function uncertain(state, reason) {
    for (const attempt of state.active) attempt.correlation = reason;
  }
  function stateFor(session) {
    let state = states.get(session);
    if (!state && !saturated) {
      if (states.size >= MAX_AUDIT_SESSIONS) {
        // Losing a live start must never make a later start look unique. Once
        // the bound is reached, retain no new correlations until reload.
        saturated = true;
        for (const retained of states.values()) uncertain(retained, 'tracking-limit');
        warn();
      } else {
        state = { open: new Map(), active: new Set(), overflow: false };
        states.set(session, state);
      }
    }
    return state;
  }
  let remove;
  try {
    remove = ctx.on('session/event', (session, event) => {
      // Never append inside this listener: native Session rejects reentrant
      // publication. Start/end tracking is independent of native inference.
      try {
        if (closed || !session || !['compaction/start', 'compaction/end'].includes(event?.type)) return;
        const id = identifier(event.data?.compactionId, 64);
        if (id === null) return;
        const state = stateFor(session);
        if (!state || saturated || state.overflow) return;
        if (event.type === 'compaction/start') {
          if (state.open.has(id) || state.open.size >= MAX_OPEN_COMPACTIONS) {
            state.overflow = true;
            uncertain(state, 'ambiguous-compaction');
            state.open.clear();
            return;
          }
          state.open.set(id, nonnegative(event.seq));
          if (state.open.size > 1) uncertain(state, 'ambiguous-compaction');
        } else {
          state.open.delete(id);
          for (const attempt of state.active) if (attempt.compactionId === id) attempt.correlation = 'compaction-ended-during-stream';
          if (state.open.size === 0 && state.active.size === 0) states.delete(session);
        }
      } catch { warn(); }
    });
    ctx.effect(() => () => {
      closed = true;
      states.clear();
      try { remove?.(); } catch {}
    }, 'strata-sync: summary audit lifetime');
  } catch {
    warn();
    try { remove?.(); } catch {}
    closed = true;
    states.clear();
  }
  if (typeof appendPluginRecord !== 'function') warn();

  function write(session, type, data) {
    if (closed || typeof appendPluginRecord !== 'function') return null;
    try {
      if (ctx.sessions?.get(session.id) !== session) { warn(); return null; }
      if (Buffer.byteLength(JSON.stringify(data)) > MAX_AUDIT_BYTES) { warn(); return null; }
      const seq = appendPluginRecord(session, type, data);
      // The native API is synchronous. An incompatible async implementation
      // must not leak a rejection into inference or invent a durable sequence.
      if (seq && typeof seq.then === 'function') { Promise.resolve(seq).catch(() => {}); warn(); return null; }
      if (nonnegative(seq) === null) { warn(); return null; }
      return seq;
    } catch { warn(); return null; }
  }
  return {
    begin(options) {
      try {
        if (closed || typeof appendPluginRecord !== 'function') return undefined;
        const session = ctx.sessions?.get(options?.sessionId);
        if (!session) { warn(); return undefined; }
        const provider = identifier(options?.provider);
        const model = identifier(options?.model);
        const state = stateFor(session);
        const entry = state?.open.size === 1 ? state.open.entries().next().value : undefined;
        const attempt = {
          attemptId: randomUUID(), compactionId: entry?.[0] ?? null, startSeq: entry?.[1] ?? null,
          correlation: saturated || state?.overflow ? 'tracking-limit'
            : !entry ? (state?.open.size ? 'ambiguous-compaction' : 'missing-compaction-start')
              : state.active.size ? 'overlapping-attempts' : 'unique-open-compaction',
        };
        if (state) {
          if (state.active.size) uncertain(state, 'overlapping-attempts');
          if (state.active.size >= MAX_ACTIVE_ATTEMPTS) {
            state.overflow = true;
            uncertain(state, 'tracking-limit');
            attempt.correlation = 'tracking-limit';
          } else state.active.add(attempt);
        }
        let decided = false;
        let finished = false;
        let decisionSeq = null;
        const common = () => ({ schemaVersion: 1, pluginVersion: version, attemptId: attempt.attemptId,
          compactionId: attempt.correlation === 'unique-open-compaction' ? attempt.compactionId : null,
          startSeq: attempt.correlation === 'unique-open-compaction' ? attempt.startSeq : null,
          correlation: attempt.correlation, provider, model });
        return {
          decision(data = {}) {
            if (decided || finished || closed) return;
            decided = true;
            try {
              decisionSeq = write(session, SUMMARY_GUIDANCE_EVENT, {
                ...common(), enabled: typeof data.enabled === 'boolean' ? data.enabled : null,
                mode: choice(data.mode, ['always', 'after-truncation']),
                outputDivisor: divisor(data.outputDivisor), sourceDivisor: divisor(data.sourceDivisor),
                requestedMaxTokens: nonnegative(data.requestedMaxTokens),
                sourceTokensEstimated: nonnegative(data.sourceTokensEstimated),
                sourceImageCount: nonnegative(data.sourceImageCount),
                sourceImageTokensEstimated: nonnegative(data.sourceImageTokensEstimated),
                effectiveOutputTokensEstimated: nonnegative(data.effectiveOutputTokensEstimated),
                budgetImageTokensEstimated: nonnegative(data.budgetImageTokensEstimated),
                targetTokens: nonnegative(data.targetTokens), applied: data.applied === true,
                appliedTargetTokens: data.applied === true ? nonnegative(data.targetTokens) : null,
                reason: choice(data.reason, reasons),
                inputIssue: inputIssue(data.inputIssue),
              });
            } catch { warn(); }
          },
          finish(data = {}) {
            if (finished) return;
            finished = true;
            state?.active.delete(attempt);
            if (state && !state.overflow && state.open.size === 0 && state.active.size === 0) states.delete(session);
            if (closed) return;
            try {
              const usage = {};
              for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
                const value = nonnegative(data.usage?.[key]);
                if (value !== null) usage[key] = value;
              }
              write(session, SUMMARY_RESULT_EVENT, { ...common(), decisionSeq,
                finishReason: choice(data.finishReason, ['stop', 'tool-calls', 'max-tokens', 'aborted', 'error', 'context-window-exceeded']),
                outcome: choice(data.outcome, ['completed', 'truncated', 'cancelled', 'error', 'incomplete']) ?? 'incomplete',
                streamCompleted: data.streamCompleted === true, elapsedMs: nonnegative(data.elapsedMs), usage,
              });
            } catch { warn(); }
          },
        };
      } catch { warn(); return undefined; }
    },
  };
}
