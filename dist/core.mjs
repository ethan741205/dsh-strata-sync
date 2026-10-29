/** Read-only Strata discovery and client-side token budgeting. No inference APIs. */
import { createHash } from 'node:crypto';
export class StrataSyncError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StrataSyncError';
    this.code = code;
  }
}

const fail = (code, message) => { throw new StrataSyncError(code, message); };
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_CONTEXT = 16 * 1024 * 1024;
const isContext = value => Number.isSafeInteger(value) && value > 0 && value <= MAX_CONTEXT;
const safeLabel = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value);

// Reviewed template bytes, not a model-name heuristic. See docs/CAPABILITIES.md.
const TEMPLATE_PROFILES = {
  '12827f24b742ea4e80cdc12dbcf9622227056b9f797252a3149263d4f9aaadce': {
    family: 'Qwen3.8-Flash-Next', efforts: { off: 'none', low: 'low', medium: 'medium', xhigh: 'xhigh' },
  },
  '6f9bd1f87d9dad376b4c79683934b4254396d826ae514ab0244efa904ce1d1a4': {
    family: 'DeepSeek-V4.1-Flash', efforts: { off: 'none', low: 'low', high: 'high', max: 'max' },
  },
};

export function planModelCapabilities(modalities, evidence = {}) {
  const validInput = Array.isArray(modalities) && modalities.length > 0 && modalities.length <= 2
    && modalities.includes('text') && new Set(modalities).size === modalities.length
    && modalities.every(value => value === 'text' || value === 'image');
  const input = validInput ? ['text', ...(modalities.includes('image') ? ['image'] : [])] : null;
  const profile = evidence.verifiedStrata && evidence.modelMatched ? TEMPLATE_PROFILES[evidence.templateHash] : null;
  return {
    input, inputSource: input ? 'models.architecture.input_modalities' : null,
    reasoning: profile ? { family: profile.family, templateHash: evidence.templateHash,
      efforts: { ...profile.efforts },
      // Native pi-ai dispatch: enable thinking AND select effort. Off sends false,
      // never just omits a field and accidentally inherits server thinking defaults.
      compat: { thinkingFormat: 'chat-template', supportsReasoningEffort: false,
        chatTemplateKwargs: { thinking: { $var: 'thinking.enabled' }, enable_thinking: { $var: 'thinking.enabled' },
          reasoning_effort: { $var: 'thinking.effort', omitWhenOff: true } } },
    } : null,
    warnings: [...(!input ? ['INPUT_UNCONFIRMED'] : []), ...(!profile ? ['REASONING_UNCONFIRMED'] : [])],
  };
}

/** Accept either the server root or an OpenAI-compatible /v1 base URL. */
export function normalizeBaseURL(value) {
  let url;
  try { url = new URL(value); } catch { fail('INVALID_URL', 'Enter a valid HTTP or HTTPS Strata server URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    fail('INVALID_URL', 'The server URL must use HTTP or HTTPS without embedded credentials, a query, or a fragment.');
  }
  let pathname = url.pathname.replace(/\/+$/u, '');
  if (!pathname.endsWith('/v1')) pathname += '/v1';
  url.pathname = pathname;
  return url.href.replace(/\/$/u, '');
}

/**
 * Select the output allowance, then derive DSH's client-side compaction policy.
 * The 4096 headroom also matches the native pi-ai context safety margin.
 */
export function planBudget(contextWindow, { outputTokens, serverOutputTokens } = {}) {
  if (!isContext(contextWindow) || contextWindow < 8192) {
    fail('UNSUPPORTED_CONTEXT', 'A verified context window of at least 8,192 tokens is required.');
  }
  const output = outputTokens ?? serverOutputTokens ?? Math.min(16384, Math.floor(contextWindow * 0.3));
  const outputSource = outputTokens != null ? 'manual' : serverOutputTokens != null ? 'server' : 'calculated';
  if (!Number.isSafeInteger(output) || output < 1 || output >= contextWindow) {
    fail('INVALID_OUTPUT_BUDGET', 'The output budget must be a positive integer smaller than the context window.');
  }
  const headroomTokens = 4096;
  const thresholdRatio = 0.8;
  const retainRatio = 0.16;
  const messageBudgetTokens = contextWindow - output;
  const thresholdTokens = Math.floor(Math.min(contextWindow * thresholdRatio, messageBudgetTokens - headroomTokens));
  const retainTokens = Math.floor(messageBudgetTokens * retainRatio);
  if (thresholdTokens <= 0 || retainTokens >= thresholdTokens) {
    fail('INVALID_OUTPUT_BUDGET', 'This output budget leaves too little room for automatic compaction; lower it.');
  }
  return Object.freeze({
    source: 'client-derived', contextWindow, outputTokens: output, outputSource,
    headroomTokens, summaryMaxTokens: headroomTokens, thresholdRatio, retainRatio,
    messageBudgetTokens, thresholdTokens,
    thresholdPercent: thresholdTokens / contextWindow * 100,
    retainTokens, clientSafetyTokens: 4096,
  });
}

async function readJSON(url, apiKey, { fetch: fetchImpl, timeout, signal }) {
  if (signal?.aborted) fail('ABORTED', 'Strata discovery was cancelled.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  timer.unref?.();
  try {
    const response = await fetchImpl(url, {
      method: 'GET', redirect: 'error', signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
      headers: { Accept: 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    });
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      fail('REDIRECT_REJECTED', 'Strata discovery does not follow redirects. Use the final server URL.');
    }
    if (!response.ok) fail('HTTP_ERROR', `Strata discovery returned HTTP ${response.status}.`);
    const declaredLength = response.headers.get('content-length');
    if (declaredLength && Number(declaredLength) > MAX_RESPONSE_BYTES) {
      fail('RESPONSE_TOO_LARGE', 'Strata discovery returned an oversized response.');
    }
    if (!response.body?.getReader) fail('INVALID_RESPONSE', 'Strata discovery returned an unreadable response.');
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          fail('RESPONSE_TOO_LARGE', 'Strata discovery returned an oversized response.');
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { fail('INVALID_JSON', 'Strata discovery did not return valid JSON.'); }
  } catch (error) {
    if (error instanceof StrataSyncError) throw error;
    if (signal?.aborted) fail('ABORTED', 'Strata discovery was cancelled.');
    if (controller.signal.aborted) fail('TIMEOUT', 'Strata discovery timed out.');
    // Never propagate fetch errors, server bodies, request headers, or credentials.
    fail('CONNECTION_FAILED', 'Unable to read Strata metadata. Check the URL, connection, and credentials.');
  } finally { clearTimeout(timer); controller.abort(); }
}

function modelRecord(row) {
  if (!row || typeof row !== 'object' || !safeLabel(row.id)) return null;
  const aliasOf = row.alias_of;
  if (aliasOf !== undefined && (!safeLabel(aliasOf) || aliasOf === row.id)) {
    fail('INVALID_MODELS', 'Strata returned an invalid model alias.');
  }
  const outputModalities = row.architecture?.output_modalities;
  if (outputModalities !== undefined && (!Array.isArray(outputModalities) || !outputModalities.length
    || !outputModalities.every(safeLabel) || new Set(outputModalities).size !== outputModalities.length)) {
    fail('INVALID_MODELS', 'Strata returned invalid model output modalities.');
  }
  return {
    id: row.id,
    name: safeLabel(row.name) ? row.name : row.id,
    status: (row.status === 'loaded' || row.status?.value === 'loaded') ? 'loaded' : 'not-loaded',
    contextWindow: isContext(row.meta?.n_ctx) ? row.meta.n_ctx : null,
    modalities: row.architecture?.input_modalities,
    aliasOf,
    outputModalities,
  };
}

function loadedTextModels(models) {
  const byId = new Map(models.map(model => [model.id, model]));
  const identities = new Map();
  const roots = new Map();
  for (const model of models.filter(row => row.status === 'loaded')) {
    let root = model;
    const visited = new Set();
    while (root.aliasOf !== undefined) {
      if (visited.has(root.id)) fail('INVALID_MODELS', 'Strata returned a cyclic model alias.');
      visited.add(root.id);
      root = byId.get(root.aliasOf);
      if (!root || root.status !== 'loaded') {
        fail('INVALID_MODELS', 'Strata returned a loaded alias without a loaded canonical model.');
      }
    }
    // Older Strata builds omit output_modalities. Explicit image/audio outputs
    // are separate generators, not additional loaded chat models.
    if (root.outputModalities !== undefined && !root.outputModalities.includes('text')) continue;
    if (model.outputModalities !== undefined && !model.outputModalities.includes('text')) {
      fail('INVALID_MODELS', 'Strata returned conflicting model alias output modalities.');
    }
    roots.set(root.id, root);
    identities.set(model.id, root.id);
  }
  return { loaded: [...roots.values()], identities };
}

function slotContext(payload, modelIds, loadedCount) {
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.slots) ? payload.slots : null;
  if (!rows || rows.length > 1024) return null;
  const associated = rows.filter(row => row && [row.model, row.model_name, row.model_id].some(id => modelIds.has(id)));
  // Unlabelled slots are only safe when the server exposes exactly one loaded model.
  const candidates = associated.length ? associated : loadedCount === 1
    ? rows.filter(row => row && !row.model && !row.model_name && !row.model_id) : [];
  const values = candidates.map(row => row.n_ctx).filter(isContext);
  if (new Set(values).size > 1) {
    fail('AMBIGUOUS_CONTEXT', 'Strata slots report different context sizes for this model; automatic alignment is unavailable.');
  }
  if (values.length !== candidates.length || !values.length) return null;
  return values[0];
}

/**
 * Fetch models and optional slots, selecting explicitly loaded text models.
 * Aliases resolve to the canonical model; multiple canonical text models require
 * options.modelId. Credentials are never returned.
 */
export async function discoverStrata(baseURL, apiKey = '', options = {}) {
  const normalized = normalizeBaseURL(baseURL);
  if (typeof apiKey !== 'string' || apiKey.length > 8192 || /[\r\n\u0000]/u.test(apiKey)) {
    fail('INVALID_CREDENTIAL', 'The API key contains invalid characters.');
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeout = options.timeout ?? 15000;
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeout) || timeout < 1 || timeout > 120000) {
    fail('INVALID_OPTIONS', 'A fetch implementation and timeout between 1 and 120000 milliseconds are required.');
  }
  const request = { fetch: fetchImpl, timeout, signal: options.signal };
  const listing = await readJSON(`${normalized}/models`, apiKey, request);
  if (!listing || !Array.isArray(listing.data) || listing.data.length > 1024) {
    fail('INVALID_MODELS', 'Strata did not return a valid model list.');
  }
  const models = listing.data.map(modelRecord).filter(Boolean);
  if (new Set(models.map(model => model.id)).size !== models.length) {
    fail('INVALID_MODELS', 'Strata returned duplicate model identifiers.');
  }
  const { loaded, identities } = loadedTextModels(models);
  if (!loaded.length) fail('NO_LOADED_MODEL', 'Strata has no explicitly loaded text model. Load a text model in Strata first.');
  let selected;
  if (options.modelId !== undefined) {
    selected = loaded.find(model => model.id === identities.get(options.modelId));
    if (!selected) fail('MODEL_NOT_LOADED', 'The selected model is not loaded on this server.');
  } else {
    if (loaded.length !== 1) fail('AMBIGUOUS_MODEL', 'Multiple models are loaded. Select a model before syncing.');
    selected = loaded[0];
  }
  const selectedIds = new Set([...identities].filter(([, id]) => id === selected.id).map(([id]) => id));
  const warnings = [];
  let liveContext = null;
  try {
    const root = normalized.slice(0, -3);
    const slots = await readJSON(`${root}/slots`, apiKey, request);
    liveContext = slotContext(slots, selectedIds, loaded.length);
    if (liveContext === null) warnings.push('SLOTS_CONTEXT_UNAVAILABLE');
  } catch (error) {
    if (error.code === 'AMBIGUOUS_CONTEXT') throw error;
    warnings.push(`SLOTS_${error.code ?? 'UNAVAILABLE'}`);
  }
  const contextWindow = liveContext ?? selected.contextWindow;
  if (!isContext(contextWindow)) fail('CONTEXT_UNAVAILABLE', 'The loaded model has no verified context size; automatic alignment is unavailable.');
  if (liveContext !== null && selected.contextWindow !== null && liveContext !== selected.contextWindow) {
    warnings.push('SLOTS_OVERRIDE_MODEL_CONTEXT');
  }
  let evidence = {};
  let props;
  try {
    props = await readJSON(`${normalized.slice(0, -3)}/props?model=${encodeURIComponent(selected.id)}`, apiKey, request);
    evidence = {
      verifiedStrata: typeof props.build_info === 'string' && /^Strata \d+\.\d+(?:\.\d+)?(?:\b|$)/u.test(props.build_info),
      modelMatched: selectedIds.has(props.model_alias),
      templateHash: typeof props.chat_template === 'string'
        ? createHash('sha256').update(props.chat_template.replace(/\r\n/g, '\n')).digest('hex') : null,
    };
  } catch { /* Optional metadata: preserve reasoning and calculate output on failure. */ }
  let serverOutputTokens = null;
  let outputLimitStatus = props == null ? 'unavailable' : 'unverified';
  if (evidence.verifiedStrata && evidence.modelMatched) {
    const value = props.default_generation_settings?.params?.n_predict;
    outputLimitStatus = value == null ? 'missing' : value === -1 || value === 0 ? 'unlimited' : 'server';
    if (outputLimitStatus === 'server') {
      if (!Number.isSafeInteger(value) || value < 1) {
        fail('INVALID_SERVER_OUTPUT_BUDGET', 'Strata returned an invalid output limit. Review the server setting before syncing.');
      }
      serverOutputTokens = value;
    }
  }
  const capabilities = planModelCapabilities(selected.modalities, evidence);
  warnings.push(...capabilities.warnings);
  return {
    baseURL: normalized,
    verifiedServer: evidence.verifiedStrata === true && evidence.modelMatched === true,
    model: { id: selected.id, name: selected.name, contextWindow, contextSource: liveContext !== null ? 'slots.n_ctx' : 'models.meta.n_ctx', serverOutputTokens, outputLimitStatus, capabilities },
    models: models.map(({modalities, ...model}) => model), warnings,
  };
}
