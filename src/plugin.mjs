import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { discoverStrata, planBudget, StrataSyncError } from './core.mjs';
import { DEFAULT_SUMMARY_TEMPLATE, validSummaryDivisor, validSummaryTemplate, installSummaryGuidance } from './summary.mjs';

export const inject = ['configEditor', 'connection', 'credentials', 'agentPresets'];
export const Config = z.object({
  providerId: z.string().default(''),
  autoSync: z.boolean().default(false),
  followLoadedModel: z.boolean().default(true),
  outputTokens: z.number().step(1).min(1),
  summaryGuidance: z.boolean().default(false),
  summaryOutputDivisor: z.number().min(1).max(Number.MAX_SAFE_INTEGER).default(2),
  summarySourceDivisor: z.number().min(1).max(Number.MAX_SAFE_INTEGER).default(2),
  summaryPromptTemplate: z.string().default(DEFAULT_SUMMARY_TEMPLATE),
});

const PACKAGE = 'dsh-strata-sync';
const COMPACTION = '@deepseek-ai/dsh-compaction-basic';
const PRESET = '@deepseek-ai/dsh-agent-preset';
const CHANNEL = '/api/strata-sync';
// Survives plugin hot reloads, but not a new DSH host process. One completed attempt per profile.
const startupKey = Symbol.for('dsh-strata-sync/startup');
const startupProfiles = globalThis[startupKey] ??= new Map();
const clone = (value) => structuredClone(value);
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export function capabilityChanges(capabilities, route, configured = {}) {
  const edits = {}, warnings = [];
  if (capabilities.input) edits.input = capabilities.input;
  if (capabilities.reasoning) {
    const supported = capabilities.reasoning.efforts;
    if (route.reasoning !== undefined && !own(supported, route.reasoning)) warnings.push('REASONING_DEFAULT_CONFLICT');
    else {
      edits.reasoningEfforts = supported;
      edits.compat = clone(capabilities.reasoning.compat);
    }
  }
  return { edits, warnings };
}
export function mergeCapabilityEdits(model, route, edits) {
  const result = clone(edits);
  if (edits.compat) result.compat = { ...model.compat, ...edits.compat,
    chatTemplateKwargs: { ...route.compat?.chatTemplateKwargs, ...model.compat?.chatTemplateKwargs, ...edits.compat.chatTemplateKwargs } };
  return result;
}
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
  let liveCheck = { state: 'unchecked', checkedAt: null };
  let liveBaseline = null;
  let liveRevision = 0;
  let monitorRunning = false;
  const monitorAbort = new AbortController();
  const previewSnapshots = new WeakMap();
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
    refreshSettings();
    const llmEntry = entry('@deepseek-ai/dsh-llm-pi-ai');
    const owners = compactionOwners();
    const defaultEntry = settings.followLoadedModel ? entry('@deepseek-ai/dsh-agent-default-model') : null;
    return { llmEntry, owners, defaultEntry,
      llm: clone(llmEntry.options.config ?? {}),
      defaults: defaultEntry ? clone(defaultEntry.options.config ?? {}) : null,
      settings: publicSettings() };
  }
  function snapshotRevision(value) {
    return hash({ llmId: value.llmEntry.options.id, llm: value.llm, owners: value.owners,
      defaultId: value.defaultEntry?.options.id ?? null, defaults: value.defaults, settings: value.settings });
  }
  function assertSnapshot(before) {
    if (snapshotRevision(before) !== snapshotRevision(snapshot())) {
      refuse('stale-preview', 'The DSH settings changed during discovery. Review a fresh preview.');
    }
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
  function refreshSettings() {
    settings = { providerId: '', autoSync: false, followLoadedModel: true, ...entry(PACKAGE).options.config };
  }
  function publicSettings(value = settings) {
    return { providerId: value.providerId ?? '', autoSync: value.autoSync ?? false,
      followLoadedModel: value.followLoadedModel ?? true, outputTokens: value.outputTokens ?? null,
      summaryGuidance: value.summaryGuidance ?? false,
      summaryOutputDivisor: value.summaryOutputDivisor ?? 2, summarySourceDivisor: value.summarySourceDivisor ?? 2,
      summaryPromptTemplate: value.summaryPromptTemplate ?? DEFAULT_SUMMARY_TEMPLATE };
  }
  function status() {
    refreshSettings();
    let providers = [];
    try {
      const rows = entry('@deepseek-ai/dsh-llm-pi-ai').options.config?.providers ?? {};
      providers = Object.entries(rows).map(([id, route]) => {
        let baseURL = '';
        try { const url = new URL(route.baseURL); if (!url.username && !url.password && !url.search) baseURL = url.href; } catch {}
        return { id, baseURL };
      });
    } catch { /* The page remains usable when the required provider is absent. */ }
    return { ...publicSettings(), defaultSummaryPromptTemplate: DEFAULT_SUMMARY_TEMPLATE, settingsRevision: hash(publicSettings()),
      // UI busy describes a configuration write, never a running Agent task.
      busy: !!writeBarrier, providers, lastPreview, lastApplied, lastError, liveCheck };
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
  async function summaryContext(options) {
    ensureOpen();
    refreshSettings();
    const routes = entry('@deepseek-ai/dsh-llm-pi-ai').options.config?.providers ?? {};
    const providerId = providerChoice(routes);
    if (options.provider !== providerId) return null;
    const route = clone(routes[providerId]);
    if (route.api && route.api !== 'openai-completions') return null;
    if (!Array.isArray(route.models) || Object.keys(route.modelOverrides ?? {}).length) return null;
    const model = route.models.find(row => row.id === options.model);
    if (!Number.isSafeInteger(model?.contextWindow) || model.contextWindow < 1) return null;
    const revision = hash({ route, settings: publicSettings() });
    const apiKey = await credential(providerId, route);
    ensureOpen();
    const discovered = await discoverStrata(route.baseURL, apiKey, {
      modelId: options.model, timeout: 2000, signal: options.signal,
    });
    ensureOpen();
    refreshSettings();
    const current = entry('@deepseek-ai/dsh-llm-pi-ai').options.config?.providers ?? {};
    if (hash({ route: current[providerId], settings: publicSettings() }) !== revision || !discovered.verifiedServer) return null;
    // A server/client mismatch must not enlarge the target past either capacity.
    return Math.min(discovered.model.contextWindow, model.contextWindow);
  }
  installSummaryGuidance(ctx, summaryContext, () => {
    ensureOpen();
    refreshSettings();
    return settings;
  });
  async function preview(request = {}, observation = {}) {
    ensureOpen();
    payload(request, ['providerId', 'outputTokens']);
    const before = snapshot();
    // Monitoring reads existing policy configuration without activating presets.
    if (observation.record !== false) await checkPresets(before.owners);
    ensureOpen();
    const providerId = providerChoice(before.llm.providers ?? {}, request.providerId);
    const route = before.llm.providers[providerId];
    if (route.api && route.api !== 'openai-completions') refuse('unsupported-provider', 'Strata Sync currently supports the openai-completions adapter.');
    if (!Array.isArray(route.models) || route.models.length === 0 || Object.keys(route.modelOverrides ?? {}).length) {
      refuse('unsupported-route', 'Use a dedicated Strata provider with an explicit models list and no modelOverrides. Catalog-backed routes are not supported for synchronization.');
    }
    const outputTokens = request.outputTokens === null ? undefined : request.outputTokens ?? settings.outputTokens;
    if (outputTokens !== undefined && (!Number.isSafeInteger(outputTokens) || outputTokens < 1)) refuse('invalid-budget', 'Output tokens must be a positive integer.');
    const apiKey = await credential(providerId, route);
    ensureOpen();
    const discovered = await discoverStrata(route.baseURL, apiKey, observation.discovery);
    ensureOpen();
    assertSnapshot(before);
    const budget = planBudget(discovered.model.contextWindow, { outputTokens, serverOutputTokens: discovered.model.serverOutputTokens });
    const configured = (route.models ?? []).find((model) => model.id === discovered.model.id);
    const capabilities = discovered.model.capabilities;
    const { edits: capabilityEdits, warnings: capabilityWarnings } = capabilityChanges(capabilities, route, configured);
    const capabilityStatus = { input: capabilityEdits.input ? 'confirmed' : 'preserved',
      reasoning: capabilityEdits.reasoningEfforts ? 'confirmed' : 'preserved' };
    discovered.warnings.push(...capabilityWarnings);
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
    for (const [field, after] of Object.entries(capabilityEdits)) {
      let previous = configured?.[field];
      if (field === 'compat') previous = { thinkingFormat: configured?.compat?.thinkingFormat,
        supportsReasoningEffort: configured?.compat?.supportsReasoningEffort,
        chatTemplateKwargs: Object.fromEntries(Object.keys(after.chatTemplateKwargs).map(key=>[key,configured?.compat?.chatTemplateKwargs?.[key]])) };
      if (JSON.stringify(previous) !== JSON.stringify(after)) changes.push({ field,
        before: field === 'compat' ? 'Existing request mapping' : previous ?? null, after });
    }
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
    const fingerprint = hash({ providerId, model: discovered.model, budget, profileRevision: snapshotRevision(before) });
    const warnings = [...discovered.warnings ?? [], ...(before.owners.some((owner) => owner.targets.some((target) => target.config.auto === false)) ? ['DSH_AUTO_COMPACTION_DISABLED'] : [])];
    const presetIds = before.owners.flatMap((owner) => owner.presetId ? [owner.presetId] : []);
    const view = { providerId, server: { baseURL: discovered.baseURL, model: discovered.model, warnings }, budget, current, compactions, capabilityEdits, capabilityStatus,
      presetIds, needsNewConversation: presetIds.length > 0, changes, fingerprint, busy: !!writeBarrier };
    previewSnapshots.set(view, before);
    if (observation.record !== false) {
      lastPreview = view;
      lastError = null;
      liveRevision++;
      // A fresh manual check can acknowledge a switch to an already aligned
      // model. There is no configuration write for the user to apply then.
      recordLiveCheck(view, view.changes.length === 0);
    }
    return view;
  }
  function recordLiveCheck(view, acknowledge = false) {
    // Manual previews may use documented fallbacks, but a live green status
    // must not certify an unknown output default or a stale listing context.
    const incomplete = ['unavailable', 'unverified'].includes(view.server.model.outputLimitStatus)
      || view.server.warnings.some(warning => warning.startsWith('SLOTS_') && warning !== 'SLOTS_OVERRIDE_MODEL_CONTEXT');
    if (incomplete) {
      liveCheck = { state: 'unavailable', checkedAt: new Date().toISOString(),
        error: { code: 'INCOMPLETE_METADATA', message: 'Current model metadata could not be fully verified.' } };
      return;
    }
    const identity = { providerId: view.providerId, baseURL: view.server.baseURL,
      modelId: view.server.model.id, contextWindow: view.budget.contextWindow };
    if (acknowledge || !liveBaseline || liveBaseline.providerId !== identity.providerId || liveBaseline.baseURL !== identity.baseURL) {
      liveBaseline = identity;
    }
    const modelChanged = liveBaseline.modelId !== identity.modelId || liveBaseline.contextWindow !== identity.contextWindow;
    liveCheck = { state: modelChanged || view.changes.length ? 'mismatch' : 'aligned', checkedAt: new Date().toISOString(),
      modelId: identity.modelId, contextWindow: identity.contextWindow, modelChanged,
      ...(modelChanged ? { previousModelId: liveBaseline.modelId, previousContextWindow: liveBaseline.contextWindow } : {}),
      // Only field identifiers are needed by the warning; no configuration values.
      changes: view.changes.map(({ field, target }) => ({ field, ...(target ? { target } : {}) })) };
  }
  async function monitorModel() {
    if (closed || monitorRunning || inFlight || writeBarrier) return;
    monitorRunning = true;
    const revision = liveRevision;
    try {
      const view = await preview({}, { record: false, discovery: {
        timeout: 3000, signal: AbortSignal.any([monitorAbort.signal, AbortSignal.timeout(10000)]),
      } });
      if (!closed && revision === liveRevision) recordLiveCheck(view);
    } catch (error) {
      if (!closed && revision === liveRevision) {
        const unconfigured = ['provider-required', 'provider-missing'].includes(error?.code);
        liveCheck = { state: unconfigured ? 'unconfigured' : 'unavailable', checkedAt: new Date().toISOString(), error: safeError(error) };
      }
    } finally { monitorRunning = false; }
  }
  function appliedSummary(view, backupPath, applied) {
    return { at: new Date().toISOString(), modelId: view.server.model.id, providerId: view.providerId, backupPath, applied,
      budget: clone(view.budget), capabilityStatus: clone(view.capabilityStatus), warnings: clone(view.server.warnings),
      serverOutputTokens: view.server.model.serverOutputTokens ?? null, outputLimitStatus: view.server.model.outputLimitStatus,
      needsNewConversation: view.needsNewConversation };
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

    const view = await preview({ ...(request.providerId ? { providerId: request.providerId } : {}), ...(own(request, 'outputTokens') ? { outputTokens: request.outputTokens } : {}) });
    ensureOpen();
    if (view.fingerprint !== request.fingerprint) refuse('stale-preview', 'The server or DSH settings changed. Review a fresh preview.');
    const before = previewSnapshots.get(view);
    assertSnapshot(before);
    if (view.changes.length === 0) {
      lastApplied = appliedSummary(view, null, false);
      liveRevision++;
      recordLiveCheck(view, true);
      return { applied: false, backupPath: null, preview: view };
    }

    writeBarrier = new Promise((resolve) => { releaseWrite = resolve; });
    let backupPath;
    const completed = [];
    try {
      backupPath = await backup();
      ensureOpen();
      assertSnapshot(before);

      const modelId = view.server.model.id;
      const llmNext = clone(before.llm);
      const route = llmNext.providers[view.providerId];
      route.models ??= [];
      let model = route.models.find((row) => row.id === modelId);
      if (!model) { model = { id: modelId, name: view.server.model.name ?? modelId }; route.models.push(model); }
      Object.assign(model, { contextWindow: view.budget.contextWindow, maxTokens: view.budget.outputTokens });
      Object.assign(model, mergeCapabilityEdits(model, route, view.capabilityEdits));
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

          // ConfigEditor may queue this callback behind another settings edit.
          // Recheck every owner when our first write actually begins.
          if (completed.length === 0) assertSnapshot(before);
          if (hash(current) !== hash(original)) refuse('concurrent-change', 'DSH settings changed during sync. Preview again.');
          return next;
        });
        completed.push([name, id, original, next]);
        if (name === PRESET) await checkPresets([{ presetId: next.id }]);
      }
      lastApplied = appliedSummary(view, backupPath, true);
      lastFingerprint = view.fingerprint;
      lastError = null;
      liveRevision++;
      recordLiveCheck({ ...view, changes: [] }, true);
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
    payload(request, ['providerId', 'autoSync', 'followLoadedModel', 'outputTokens', 'summaryGuidance', 'summaryOutputDivisor', 'summarySourceDivisor', 'summaryPromptTemplate', 'expectedRevision']);
    refreshSettings();
    if (typeof request.expectedRevision !== 'string' || request.expectedRevision !== hash(publicSettings())) {
      refuse('stale-settings', 'Sync preferences changed. Reload the latest preferences before saving.');
    }

    const next = { ...settings };
    if (own(request, 'providerId')) {
      if (typeof request.providerId !== 'string') refuse('invalid-request', 'Provider must be a string.');
      next.providerId = request.providerId;
    }
    for (const key of ['autoSync', 'followLoadedModel', 'summaryGuidance']) {
      if (!own(request, key)) continue;
      if (typeof request[key] !== 'boolean') refuse('invalid-request', `${key} must be a boolean.`);
      next[key] = request[key];
    }
    for (const key of ['summaryOutputDivisor', 'summarySourceDivisor']) {
      if (!own(request, key)) continue;
      if (!validSummaryDivisor(request[key])) refuse('invalid-budget', 'Summary divisors must be finite numbers from 1 to Number.MAX_SAFE_INTEGER.');
      next[key] = request[key];
    }
    if (own(request, 'summaryPromptTemplate')) {
      if (!validSummaryTemplate(request.summaryPromptTemplate)) refuse('invalid-request', 'Summary prompt must include {target} and be at most 2048 characters.');
      next.summaryPromptTemplate = request.summaryPromptTemplate;
    }
    if (own(request, 'outputTokens')) {
      if (request.outputTokens === null) delete next.outputTokens;
      else if (Number.isSafeInteger(request.outputTokens) && request.outputTokens > 0) next.outputTokens = request.outputTokens;
      else refuse('invalid-budget', 'Output tokens must be a positive integer, or null for automatic budgeting.');
    }
    const self = entry(PACKAGE);
    const original = clone(self.options.config ?? {});
    // Editing our own entry can dispose this plugin before edit() resolves.
    // Build the response while this Cordis scope is still alive; never read its
    // injected services after Loader replaces it.
    const response = { ...status(), ...publicSettings(next),
      settingsRevision: hash(publicSettings(next)), lastPreview: null, lastError: null,
      liveCheck: { state: 'unchecked', checkedAt: null } };
    await backup();
    ensureOpen();
    await ctx.configEditor.edit(self, (current) => {
      ensureOpen();
      if (hash(current) !== hash(original) || hash(publicSettings(current)) !== request.expectedRevision) {
        refuse('stale-settings', 'Sync preferences changed while saving. Reload the latest preferences.');
      }

      return next;
    });
    settings = next;
    lastPreview = null;
    lastError = null;
    liveRevision++;
    liveCheck = response.liveCheck;
    return response;
  }
  function safeError(error) {
    // Discovery errors contain fixed messages or HTTP status numbers, never response bodies.
    if (error instanceof StrataSyncError) return { code: error.code, message: error.message, details: {} };
    // Adapter/network exceptions may contain credential-bearing URLs or response bodies.
    // Only messages deliberately raised here are exposed verbatim.
    const known = ['disposed','invalid-request','invalid-budget','provider-missing','provider-required','unsupported-profile','unsupported-provider','unsupported-route','credential-unavailable','preview-required','busy','stale-preview','stale-settings','concurrent-change','rollback-required','preset-unavailable'];
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
  const profile = ctx.configEditor.documentPath;
  if (!startupProfiles.has(profile)) startupProfiles.set(profile, { pending: !!settings.autoSync });
  const startup = startupProfiles.get(profile);
  let timer;
  const poll = async () => {
    if (closed || !startup.pending) return;
    try {
      refreshSettings();
      if (!settings.autoSync) { startup.pending = false; clearInterval(timer); return; }
      if (inFlight || startup.running) return;
    } catch (error) {
      // The host can withdraw a required entry during reload. Do not leave an
      // unhandled timer rejection or retry an unsupported profile indefinitely.
      lastError = safeError(error);
      startup.pending = false;
      clearInterval(timer);
      return;
    }
    // Concurrent sync/disposed attempts keep the one
    // startup operation pending; successful/no-op and terminal errors consume it.
    startup.running = true;
    let deferred = false;
    try {
      await run(async () => {
        const view = await preview();
        if (view.changes.length && view.fingerprint !== lastFingerprint) await applyPreview({ fingerprint: view.fingerprint, providerId: view.providerId });
      });
    } catch (error) {
      lastError = safeError(error);
      deferred = error?.code === 'busy' || (closed && error?.code === 'disposed');
    } finally {
      startup.running = false;
      if (!deferred) { startup.pending = false; clearInterval(timer); }
    }
  };
  // DSH 0.2.1-rc.3 can activate us inside HMR's AsyncLocalStorage transaction.
  // A timer otherwise inherits that transaction forever, so later ConfigEditor
  // edits are rejected as nested HMR transactions. Mirror Hmr.watchConfig():
  // detach only timer creation, while every write still uses ConfigEditor and
  // its normal runExclusive queue. `executing` is a version-specific host seam.
  // Startup writes still run once; the separate monitor only reads metadata.
  const createTimer = () => setInterval(() => { void poll(); }, 1_000);
  const executing = ctx.get('hmr')?.executing;
  if (startup.pending) timer = typeof executing?.exit === 'function' ? executing.exit(createTimer) : createTimer();
  timer?.unref?.();
  const createMonitor = () => setInterval(monitorModel, 60_000);
  const monitorTimer = typeof executing?.exit === 'function' ? executing.exit(createMonitor) : createMonitor();
  monitorTimer?.unref?.();
  ctx.effect(() => () => {
    closed = true; clearInterval(timer); clearInterval(monitorTimer); monitorAbort.abort(); releaseWrite?.();
  }, 'strata-sync: startup and monitor lifetime');
}
