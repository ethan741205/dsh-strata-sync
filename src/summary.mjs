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
// Eight mandatory headings need enough space for a meaningful checkpoint. Do
// not round a tiny target UP; leave native behavior intact instead.
export const MIN_SUMMARY_TARGET = 256;
export const DEFAULT_SUMMARY_DIVISOR = 16;

export function planSummaryTarget(contextWindow, summaryMaxTokens, sourceTokens, divisor = DEFAULT_SUMMARY_DIVISOR, outputDivisor = 2, sourceDivisor = 2) {
  if (![contextWindow, summaryMaxTokens, sourceTokens].every(positive) || ![divisor, outputDivisor, sourceDivisor].every(validSummaryDivisor)) return null;
  const target = Math.floor(Math.min(contextWindow / divisor, summaryMaxTokens / outputDivisor, sourceTokens / sourceDivisor));
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

/** The native waterfall's next() closes over options, so replace only its
 * messages property for the lifetime of this stream; never mutate frozen
 * messages or recursively dispatch a second LLM request.
 */
export function installSummaryGuidance(ctx, resolveContext, getSettings = () => ({})) {
  let closed = false;
  function preferences() {
    try {
      const value = getSettings();
      const enabled = value.summaryGuidance === undefined ? true : value.summaryGuidance;
      const divisor = value.summaryContextDivisor === undefined ? DEFAULT_SUMMARY_DIVISOR : value.summaryContextDivisor;
      const outputDivisor = value.summaryOutputDivisor === undefined ? 2 : value.summaryOutputDivisor;
      const sourceDivisor = value.summarySourceDivisor === undefined ? 2 : value.summarySourceDivisor;
      const template = value.summaryPromptTemplate === undefined ? DEFAULT_SUMMARY_TEMPLATE : value.summaryPromptTemplate;
      return enabled === true && [divisor, outputDivisor, sourceDivisor].every(validSummaryDivisor) && validSummaryTemplate(template)
        ? { divisor, outputDivisor, sourceDivisor, template } : null;
    } catch { return null; }
  }
  const remove = ctx.on('llm/stream', (options, next) => {
    const native = nativeSummaryMessage(options);
    const descriptor = options && Object.getOwnPropertyDescriptor(options, 'messages');
    if (closed || !native || !descriptor?.writable || options.signal?.aborted) return next();
    // Disabled guidance must not perform even metadata discovery. Native DSH
    // compaction and its request options still pass through unchanged.
    const selected = preferences();
    if (!selected) return next();
    const sourceTokens = estimateSummarySource(options.messages);
    if (!positive(sourceTokens) || !positive(options.maxTokens)) return next();
    return (async function* () {
      const original = options.messages;
      let augmented;
      try {
        let contextWindow;
        try { contextWindow = await resolveContext(options); }
        catch { /* Metadata/compatibility failure must not break native inference. */ }
        const target = planSummaryTarget(contextWindow, options.maxTokens, sourceTokens, selected.divisor, selected.outputDivisor, selected.sourceDivisor);
        const current = preferences();
        if (!closed && !options.signal?.aborted && current && Object.keys(selected).every(key => selected[key] === current[key]) && target !== null && options.messages === original) {
          const last = { ...native, content: [{ ...native.content[0], text: `${native.content[0].text}\n- ${summaryInstruction(target, selected.template)}` }] };
          augmented = [...original.slice(0, -1), last];
          augmentedMessages.add(augmented);
          options.messages = augmented;
        }
        yield* next();
      } finally {
        if (augmented) augmentedMessages.delete(augmented);
        if (augmented && options.messages === augmented) options.messages = original;
      }
    })();
  });
  ctx.effect(() => () => { closed = true; remove?.(); }, 'strata-sync: summary guidance lifetime');
}
