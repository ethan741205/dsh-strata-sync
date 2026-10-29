/** Read-only Strata discovery and client-side token budgeting. No inference APIs. */
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
 * Derive DSH settings; these are client policy, not values reported by Strata.
 * The 4096 headroom also matches the native pi-ai context safety margin.
 */
export function planBudget(contextWindow, { outputTokens } = {}) {
  if (!isContext(contextWindow) || contextWindow < 8192) {
    fail('UNSUPPORTED_CONTEXT', 'A verified context window of at least 8,192 tokens is required.');
  }
  const output = outputTokens ?? Math.min(16384, Math.floor(contextWindow * 0.3));
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
    source: 'client-derived', contextWindow, outputTokens: output,
    headroomTokens, summaryMaxTokens: headroomTokens, thresholdRatio, retainRatio,
    messageBudgetTokens, thresholdTokens,
    thresholdPercent: thresholdTokens / contextWindow * 100,
    retainTokens, clientSafetyTokens: 4096,
  });
}

async function readJSON(url, apiKey, { fetch: fetchImpl, timeout }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  timer.unref?.();
  try {
    const response = await fetchImpl(url, {
      method: 'GET', redirect: 'error', signal: controller.signal,
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
    if (controller.signal.aborted) fail('TIMEOUT', 'Strata discovery timed out.');
    // Never propagate fetch errors, server bodies, request headers, or credentials.
    fail('CONNECTION_FAILED', 'Unable to read Strata metadata. Check the URL, connection, and credentials.');
  } finally { clearTimeout(timer); controller.abort(); }
}

function modelRecord(row) {
  if (!row || typeof row !== 'object' || !safeLabel(row.id)) return null;
  return {
    id: row.id,
    name: safeLabel(row.name) ? row.name : row.id,
    status: (row.status === 'loaded' || row.status?.value === 'loaded') ? 'loaded' : 'not-loaded',
    contextWindow: isContext(row.meta?.n_ctx) ? row.meta.n_ctx : null,
  };
}

function slotContext(payload, modelId, loadedCount) {
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.slots) ? payload.slots : null;
  if (!rows || rows.length > 1024) return null;
  const associated = rows.filter(row => row && [row.model, row.model_name, row.model_id].includes(modelId));
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
 * Fetch models and optional slots, selecting only explicitly loaded models.
 * Multiple loaded models require options.modelId. Credentials are never returned.
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
  const request = { fetch: fetchImpl, timeout };
  const listing = await readJSON(`${normalized}/models`, apiKey, request);
  if (!listing || !Array.isArray(listing.data) || listing.data.length > 1024) {
    fail('INVALID_MODELS', 'Strata did not return a valid model list.');
  }
  const models = listing.data.map(modelRecord).filter(Boolean);
  if (new Set(models.map(model => model.id)).size !== models.length) {
    fail('INVALID_MODELS', 'Strata returned duplicate model identifiers.');
  }
  const loaded = models.filter(model => model.status === 'loaded');
  if (!loaded.length) fail('NO_LOADED_MODEL', 'Strata has no explicitly loaded model. Load a model in Strata first.');
  let selected;
  if (options.modelId !== undefined) {
    selected = loaded.find(model => model.id === options.modelId);
    if (!selected) fail('MODEL_NOT_LOADED', 'The selected model is not loaded on this server.');
  } else {
    if (loaded.length !== 1) fail('AMBIGUOUS_MODEL', 'Multiple models are loaded. Select a model before syncing.');
    selected = loaded[0];
  }
  const warnings = [];
  let liveContext = null;
  try {
    const root = normalized.slice(0, -3);
    const slots = await readJSON(`${root}/slots`, apiKey, request);
    liveContext = slotContext(slots, selected.id, loaded.length);
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
  return {
    baseURL: normalized,
    model: { id: selected.id, name: selected.name, contextWindow, contextSource: liveContext !== null ? 'slots.n_ctx' : 'models.meta.n_ctx' },
    models, warnings,
  };
}
