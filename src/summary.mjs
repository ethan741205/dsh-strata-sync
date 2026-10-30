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
  function preferences() {
    try {
      const value = getSettings();
      const enabled = value.summaryGuidance === undefined ? false : value.summaryGuidance;
      const outputDivisor = value.summaryOutputDivisor === undefined ? 2 : value.summaryOutputDivisor;
      const sourceDivisor = value.summarySourceDivisor === undefined ? 2 : value.summarySourceDivisor;
      const template = value.summaryPromptTemplate === undefined ? DEFAULT_SUMMARY_TEMPLATE : value.summaryPromptTemplate;
      return enabled === true && [outputDivisor, sourceDivisor].every(validSummaryDivisor) && validSummaryTemplate(template)
        ? { outputDivisor, sourceDivisor, template } : null;
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
        const effectiveOutput = estimateEffectiveSummaryBudget(options, contextWindow, selected.template);
        const target = planSummaryTarget(effectiveOutput, sourceTokens, selected.outputDivisor, selected.sourceDivisor);
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
