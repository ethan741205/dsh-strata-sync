import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { discoverStrata, planBudget, StrataSyncError } from './core.mjs';

export const inject = ['configEditor', 'connection', 'agents', 'credentials', 'agentPresets'];
export const Config = z.object({
  providerId: z.string().default(''),
  autoSync: z.boolean().default(false),
  followLoadedModel: z.boolean().default(true),
  outputTokens: z.number().step(1).min(1),
});

const PACKAGE = '@ethan741205/dsh-strata-sync';
const COMPACTION = '@deepseek-ai/dsh-compaction-basic';
const PRESET = '@deepseek-ai/dsh-agent-preset';
const CHANNEL = '/api/strata-sync';
const clone = (value) => structuredClone(value);
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function refuse(code, message) { const error = new Error(message); error.code = code; throw error; }
function payload(value, keys = []) {
  if (!object(value) || Object.keys(value).some((key) => !keys.includes(key))) refuse('invalid-request', 'Invalid Strata Sync request.');
  return value;
}

/** Native DSH plugin; the server is only queried, never configured or restarted. */
export function apply(ctx, initialConfig) {
  let settings = { providerId: '', autoSync: false, followLoadedModel: true, ...initialConfig };
  let closed = false;
  let inFlight = false;
  let writeBarrier;
  let releaseWrite;
  let lastPreview = null;
  let lastApplied = null;
  let lastError = null;
  let lastFingerprint = null;
  function ensureOpen() { if (closed) refuse('disposed', 'Strata Sync was disabled or reloaded; this operation was cancelled.'); }

  function entry(name, id) {
    const found = ctx.configEditor.entries().filter((row) => row.options.name === name && (id === undefined || row.options.id === id) && row.fiber?.state === 2);
    if (found.length !== 1) refuse('unsupported-profile', `Exactly one active ${name} entry is required.`);
    return found[0];
  }
  function compactionOwners() {
    const owners = [];
    for (const row of ctx.configEditor.entries()) {
      if (row.fiber?.state !== 2) continue;
      const { id, name } = row.options;
      const config = clone(row.options.config ?? {});
      if (name === COMPACTION) owners.push({ id, name, config, targets: [{ id, path: [], config }] });
      if (name !== PRESET) continue;
      const targets = [];
      const walk = (rows, path, labels = []) => {
        if (!Array.isArray(rows)) return;
        for (const [index, child] of rows.entries()) {
          // Do not enable disabled branches or guess unevaluated !!js expressions.
          if (!object(child) || child.disabled) continue;
          const childPath = [...path, index, 'config'];
          const childLabels = [...labels, child.id ?? String(index)];
          if (child.name === COMPACTION) targets.push({ id: `${config.id}/${childLabels.join('/')}`, path: childPath, config: clone(child.config ?? {}) });
          if (child.group === true) walk(child.config, childPath, childLabels);
        }
      };
      walk(config.plugins, ['plugins']);
      if (targets.length) owners.push({ id, name, presetId: config.id, config, targets });
    }
    if (!owners.length) refuse('unsupported-profile', 'No active profile or enabled agent-preset compaction configuration is available. Enable a supported DSH agent preset first.');
    return owners;
  }
  function snapshot() {
    const llmEntry = entry('@deepseek-ai/dsh-llm-pi-ai');
    const owners = compactionOwners();
    const defaultEntry = settings.followLoadedModel ? entry('@deepseek-ai/dsh-agent-default-model') : null;
    return { llmEntry, owners, defaultEntry,
      llm: clone(llmEntry.options.config ?? {}),
      defaults: defaultEntry ? clone(defaultEntry.options.config ?? {}) : null };
  }
  async function checkPresets(owners) {
    for (const owner of owners) {
      if (!owner.presetId) continue;
      const state = await ctx.agentPresets.resolve(owner.presetId);
      ensureOpen();
      if (state.broken) refuse('preset-unavailable', `The DSH agent preset ${owner.presetId} could not activate. Fix its configuration in DSH Settings before syncing.`);
    }
  }
  function providerChoice(providers, requested = settings.providerId) {
    if (requested) {
      if (typeof requested !== 'string' || !own(providers, requested)) refuse('provider-missing', 'Choose an existing Strata provider in DSH Models settings.');
      return requested;
    }
    const candidates = Object.keys(providers).filter((id) => /strata/i.test(id));
    if (candidates.length !== 1) refuse('provider-required', 'Choose which existing provider connects to Strata Server.');
    return candidates[0];
  }
  function busy() {
    // DSH 0.2.1-rc.3 reports maintenance as idle while manual compaction can still run.
    return ctx.agents.list().some((agent) => agent.status !== 'idle' || agent.phase?.kind === 'maintenance');
  }
  function publicSettings() {
    return { providerId: settings.providerId, autoSync: settings.autoSync,
      followLoadedModel: settings.followLoadedModel, outputTokens: settings.outputTokens ?? null };
  }
  function status() {
    let providers = [];
    try {
      const rows = entry('@deepseek-ai/dsh-llm-pi-ai').options.config?.providers ?? {};
      providers = Object.entries(rows).map(([id, route]) => {
        let baseURL = '';
        try { const url = new URL(route.baseURL); if (!url.username && !url.password && !url.search) baseURL = url.href; } catch {}
        return { id, baseURL };
      });
    } catch { /* The page remains usable when the required provider is absent. */ }
    return { ...publicSettings(), busy: busy() || !!writeBarrier, providers, lastPreview, lastApplied, lastError };
  }
  async function credential(providerId, route) {
    if (route.apiKeyEnv) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(route.apiKeyEnv)) refuse('credential-unavailable', 'The provider credential reference is invalid.');
      const resolved = await ctx.credentials.resolve(route.apiKeyEnv);
      if (!resolved?.value) refuse('credential-unavailable', 'The existing provider credential is unavailable. Reconnect it in DSH Models settings.');
      return resolved.value;
    }
    if (/^[a-z][a-z0-9-]*$/.test(providerId)) {
      const record = await ctx.credentials.readRecord(`llm-pi-ai/${providerId}`);
      if (record?.kind === 'api-key' && typeof record.key === 'string') return record.key;
      if (record?.kind === 'grant') refuse('credential-unavailable', 'This plugin supports API-key Strata connections, not OAuth grants.');
    }
    return undefined; // Unauthenticated local Strata servers are also supported.
  }
  async function preview(request = {}) {
    ensureOpen();
    payload(request, ['providerId', 'outputTokens']);
    const before = snapshot();
    await checkPresets(before.owners);
    ensureOpen();
    const providerId = providerChoice(before.llm.providers ?? {}, request.providerId);
    const route = before.llm.providers[providerId];
    if (route.api && route.api !== 'openai-completions') refuse('unsupported-provider', 'Strata Sync currently supports the openai-completions adapter.');
    const outputTokens = request.outputTokens === null ? undefined : request.outputTokens ?? settings.outputTokens;
    if (outputTokens !== undefined && (!Number.isSafeInteger(outputTokens) || outputTokens < 1)) refuse('invalid-budget', 'Output tokens must be a positive integer.');
    const apiKey = await credential(providerId, route);
    ensureOpen();
    const discovered = await discoverStrata(route.baseURL, apiKey);
    ensureOpen();
    const budget = planBudget(discovered.model.contextWindow, { outputTokens });
    const configured = (route.models ?? []).find((model) => model.id === discovered.model.id);
    const compactions = before.owners.flatMap((owner) => owner.targets.map((target) => {
      const base = target.config;
      const policy = (base.modelPolicies ?? []).find((row) => row.provider === providerId && row.model === discovered.model.id);
      return { target: target.id, presetId: owner.presetId ?? null, current: {
        headroomTokens: policy?.headroomTokens ?? base.headroomTokens ?? 65536,
        summaryMaxTokens: policy?.maxTokens ?? base.maxTokens ?? policy?.headroomTokens ?? base.headroomTokens ?? 65536,
        thresholdRatio: policy?.thresholdRatio ?? base.thresholdRatio ?? 0.8,
        retainRatio: policy?.retainTokens !== undefined ? null : policy?.retainRatio ?? (base.retainTokens !== undefined ? null : base.retainRatio ?? 0.16),
        retainTokens: policy?.retainRatio !== undefined ? null : policy?.retainTokens ?? base.retainTokens ?? null,
      } };
    }));
    const current = { model: before.defaults?.provider === providerId ? before.defaults.model : null,
      contextWindow: configured?.contextWindow ?? null, outputTokens: configured?.maxTokens ?? null };
    const desired = {
      ...(settings.followLoadedModel ? { model: discovered.model.id } : {}),
      contextWindow: budget.contextWindow, outputTokens: budget.outputTokens,
    };
    const changes = Object.entries(desired).filter(([field, after]) => current[field] !== after).map(([field, after]) => ({ field, before: current[field] ?? null, after }));
    const compactionDesired = { headroomTokens: budget.headroomTokens, summaryMaxTokens: budget.summaryMaxTokens,
      thresholdRatio: budget.thresholdRatio, retainRatio: budget.retainRatio, retainTokens: null };
    for (const state of compactions) for (const [field, after] of Object.entries(compactionDesired)) {
      if (state.current[field] !== after) changes.push({ target: state.target, field, before: state.current[field], after });
    }
    // A mixed value is intentionally null; per-target values and differences remain explicit.
    for (const field of Object.keys(compactionDesired)) {
      const values = compactions.map((state) => state.current[field]);
      current[field] = values.every((value) => value === values[0]) ? values[0] : null;
    }
    // Fingerprint includes private config only as a one-way digest; no secret crosses the UI boundary.
    const fingerprint = hash({ providerId, model: discovered.model, budget, settings: publicSettings(), profile: before.llm, compaction: before.owners, defaults: before.defaults });
    const warnings = [...discovered.warnings ?? [], ...(before.owners.some((owner) => owner.targets.some((target) => target.config.auto === false)) ? ['DSH_AUTO_COMPACTION_DISABLED'] : [])];
    const presetIds = before.owners.flatMap((owner) => owner.presetId ? [owner.presetId] : []);
    const view = { providerId, server: { baseURL: discovered.baseURL, model: discovered.model, warnings }, budget, current, compactions,
      presetIds, needsNewConversation: presetIds.length > 0, changes, fingerprint, busy: busy() };
    lastPreview = view;
    lastError = null;
    return view;
  }
  async function backup() {
    ensureOpen();
    const documentPath = ctx.configEditor.documentPath;
    const backupDir = join(dirname(documentPath), 'backups', 'strata-sync');
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    ensureOpen();
    const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.yml`;
    const backupPath = join(backupDir, filename);
    const contents = await readFile(documentPath);
    ensureOpen();
    await writeFile(backupPath, contents, { mode: 0o600, flag: 'wx' });
    ensureOpen();
    return backupPath;
  }
  async function applyPreview(request) {
    ensureOpen();
    payload(request, ['fingerprint', 'providerId', 'outputTokens']);
    if (typeof request.fingerprint !== 'string' || !request.fingerprint) refuse('preview-required', 'Preview the proposed changes before applying them.');
    if (busy()) refuse('busy', 'A DSH task is running. Wait until all tasks are idle before syncing.');
    const view = await preview({ ...(request.providerId ? { providerId: request.providerId } : {}), ...(own(request, 'outputTokens') ? { outputTokens: request.outputTokens } : {}) });
    ensureOpen();
    if (view.fingerprint !== request.fingerprint) refuse('stale-preview', 'The server or DSH settings changed. Review a fresh preview.');
    if (view.changes.length === 0) return { applied: false, backupPath: null, preview: view };
    if (busy()) refuse('busy', 'A DSH task started. Sync has been deferred.');
    const before = snapshot();
    writeBarrier = new Promise((resolve) => { releaseWrite = resolve; });
    let backupPath;
    const completed = [];
    try {
      backupPath = await backup();
      ensureOpen();
      const modelId = view.server.model.id;
      const llmNext = clone(before.llm);
      const route = llmNext.providers[view.providerId];
      route.models ??= [];
      let model = route.models.find((row) => row.id === modelId);
      if (!model) { model = { id: modelId, name: view.server.model.name ?? modelId, input: ['text'] }; route.models.push(model); }
      Object.assign(model, { contextWindow: view.budget.contextWindow, maxTokens: view.budget.outputTokens });
      const edits = [
        [before.llmEntry.options.name, before.llmEntry.options.id, before.llm, llmNext],
        ...before.owners.map((owner) => {
          const next = clone(owner.config);
          for (const target of owner.targets) {
            let compaction = next;
            for (const key of target.path) compaction = compaction[key] ??= {};
            compaction.modelPolicies ??= [];
            let policy = compaction.modelPolicies.find((row) => row.provider === view.providerId && row.model === modelId);
            if (!policy) { policy = { provider: view.providerId, model: modelId }; compaction.modelPolicies.push(policy); }
            Object.assign(policy, { headroomTokens: view.budget.headroomTokens, maxTokens: view.budget.summaryMaxTokens,
              thresholdRatio: view.budget.thresholdRatio, retainRatio: view.budget.retainRatio });
            delete policy.retainTokens;
          }
          return [owner.name, owner.id, owner.config, next];
        }),
        ...(settings.followLoadedModel ? [[before.defaultEntry.options.name, before.defaultEntry.options.id, before.defaults, { ...before.defaults, provider: view.providerId, model: modelId }]] : []),
      ];
      // Validate every owner before the first write; inactive placeholders are never edited.
      for (const [name, id] of edits) entry(name, id);
      for (const [name, id, original, next] of edits) {
        ensureOpen();
        if (hash(original) === hash(next)) continue;
        await ctx.configEditor.edit(entry(name, id), (current) => {
          ensureOpen();
          if (hash(current) !== hash(original)) refuse('concurrent-change', 'DSH settings changed during sync. Preview again.');
          return next;
        });
        completed.push([name, id, original, next]);
        if (name === PRESET) await checkPresets([{ presetId: next.id }]);
      }
      lastApplied = { at: new Date().toISOString(), modelId, providerId: view.providerId, backupPath };
      lastFingerprint = view.fingerprint;
      lastError = null;
      return { applied: true, backupPath, preview: view };
    } catch (error) {
      let rollbackFailed = false;
      for (const [name, id, original, written] of completed.reverse()) {
        try {
          await ctx.configEditor.edit(entry(name, id), (current) => {
            if (hash(current) !== hash(written)) refuse('concurrent-change', 'A later settings edit prevents automatic rollback.');
            return original;
          });
        } catch { rollbackFailed = true; }
      }
      if (rollbackFailed) refuse('rollback-required', `Sync was interrupted. Restore the saved profile backup: ${backupPath}`);
      throw error;
    } finally {
      releaseWrite?.();
      writeBarrier = undefined;
      releaseWrite = undefined;
    }
  }
  async function configure(request) {
    ensureOpen();
    payload(request, ['providerId', 'autoSync', 'followLoadedModel', 'outputTokens']);
    if (busy()) refuse('busy', 'Wait until all DSH tasks are idle before changing sync settings.');
    const next = { ...settings };
    if (own(request, 'providerId')) {
      if (typeof request.providerId !== 'string') refuse('invalid-request', 'Provider must be a string.');
      next.providerId = request.providerId;
    }
    for (const key of ['autoSync', 'followLoadedModel']) {
      if (!own(request, key)) continue;
      if (typeof request[key] !== 'boolean') refuse('invalid-request', `${key} must be a boolean.`);
      next[key] = request[key];
    }
    if (own(request, 'outputTokens')) {
      if (request.outputTokens === null) delete next.outputTokens;
      else if (Number.isSafeInteger(request.outputTokens) && request.outputTokens > 0) next.outputTokens = request.outputTokens;
      else refuse('invalid-budget', 'Output tokens must be a positive integer, or null for automatic budgeting.');
    }
    const self = entry(PACKAGE);
    // Editing our own entry can dispose this plugin before edit() resolves.
    // Build the response while this Cordis scope is still alive; never read its
    // injected services after Loader replaces it.
    const response = { ...status(), providerId: next.providerId, autoSync: next.autoSync,
      followLoadedModel: next.followLoadedModel, outputTokens: next.outputTokens ?? null,
      lastPreview: null, lastError: null };
    await backup();
    ensureOpen();
    await ctx.configEditor.edit(self, () => { ensureOpen(); return next; });
    settings = next;
    return response;
  }
  function safeError(error) {
    // Discovery errors contain fixed messages or HTTP status numbers, never response bodies.
    if (error instanceof StrataSyncError) return { code: error.code, message: error.message, details: {} };
    // Adapter/network exceptions may contain credential-bearing URLs or response bodies.
    // Only messages deliberately raised here are exposed verbatim.
    const known = ['disposed','invalid-request','invalid-budget','provider-missing','provider-required','unsupported-profile','unsupported-provider','credential-unavailable','preview-required','busy','stale-preview','concurrent-change','rollback-required','preset-unavailable'];
    return { code: known.includes(error?.code) ? error.code : 'sync-failed',
      message: known.includes(error?.code) ? error.message : 'Unable to synchronize. Check the Strata endpoint, connection, API-key credential and supported model metadata.', details: {} };
  }
  async function run(action) {
    ensureOpen();
    if (inFlight) refuse('busy', 'Another sync operation is running.');
    inFlight = true;
    try { return await action(); } finally { inFlight = false; }
  }
  async function dispatch(endpoint, data) {
    try {
      if (endpoint === 'status') { payload(data); return { ok: true, value: status() }; }
      const actions = { preview: () => preview(data), apply: () => applyPreview(data), configure: () => configure(data) };
      if (!own(actions, endpoint)) refuse('invalid-request', 'Unknown Strata Sync action.');
      return { ok: true, value: await run(actions[endpoint]) };
    } catch (error) { lastError = safeError(error); return { ok: false, error: lastError }; }
  }
  // Native Connection exact routes inherit its Host/Origin/authentication fence.
  // createSharedFetchHandler only invokes these routes for owner Peers. Keep the
  // existing /api Typert interceptor untouched and retain the standard RPC envelope.
  for (const endpoint of ['status', 'preview', 'apply', 'configure']) {
    ctx.connection.fetch.register({
      path: `${CHANNEL}/${endpoint}`, methods: ['POST'], requestBody: 'streaming',
      fetch: async (request) => {
        let rpcId = 'invalid-request';
        try {
          if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
            return new Response('Expected application/json', { status: 415 });
          }
          const maximumBytes = 8192;
          if (Number(request.headers.get('content-length') ?? 0) > maximumBytes) return new Response('Request too large', { status: 413 });
          const reader = request.body?.getReader();
          if (!reader) refuse('invalid-request', 'Missing request body.');
          const chunks = [];
          let size = 0;
          try {
            for (;;) {
              const chunk = await reader.read();
              if (chunk.done) break;
              size += chunk.value.byteLength;
              if (size > maximumBytes) { await reader.cancel(); return new Response('Request too large', { status: 413 }); }
              chunks.push(Buffer.from(chunk.value));
            }
          } finally { reader.releaseLock(); }
          let envelope;
          try { envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch { refuse('invalid-request', 'Invalid JSON request.'); }
          payload(envelope, ['type', 'rpcId', 'method', 'payload']);
          if (envelope.type !== 'client-request' || typeof envelope.rpcId !== 'string' || !envelope.rpcId || envelope.rpcId.length > 128
            || envelope.method !== `strata-sync/${endpoint}` || !own(envelope, 'payload')) refuse('invalid-request', 'Invalid RPC envelope.');
          rpcId = envelope.rpcId;
          return Response.json({ type: 'server-response', rpcId, result: await dispatch(endpoint, envelope.payload) });
        } catch (error) {
          return Response.json({ type: 'server-response', rpcId, result: { ok: false, error: safeError(error) } }, { status: 400 });
        }
      },
    });
  }
  ctx.on('agent/pre-step', async (_event, next) => {
    if (writeBarrier) await writeBarrier;
    return next();
  }, { prepend: true });
  const poll = async () => {
    if (closed || !settings.autoSync || busy() || inFlight) return;
    try {
      await run(async () => {
        const view = await preview();
        if (view.changes.length && view.fingerprint !== lastFingerprint) await applyPreview({ fingerprint: view.fingerprint, providerId: view.providerId });
      });
    } catch (error) { lastError = safeError(error); }
  };
  // DSH 0.2.1-rc.3 can activate us inside HMR's AsyncLocalStorage transaction.
  // A timer otherwise inherits that transaction forever, so later ConfigEditor
  // edits are rejected as nested HMR transactions. Mirror Hmr.watchConfig():
  // detach only timer creation, while every write still uses ConfigEditor and
  // its normal runExclusive queue. `executing` is a version-specific host seam.
  const createTimer = () => setInterval(() => { void poll(); }, 60_000);
  const executing = ctx.get('hmr')?.executing;
  const timer = typeof executing?.exit === 'function' ? executing.exit(createTimer) : createTimer();
  timer.unref?.();
  ctx.effect(() => () => { closed = true; clearInterval(timer); releaseWrite?.(); }, 'strata-sync: polling lifetime');
}
