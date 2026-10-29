# DSH Strata Sync

**English** · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md)

A plugin that aligns **DeepSeek Harness (DSH)** with the model actually loaded by **Strata Server**, using a native DSH settings UI.

Open **Settings → Strata Sync** to inspect differences, synchronize an existing Strata provider, or enable automatic synchronization when DSH starts. The interface and README are available in English, Simplified Chinese and Traditional Chinese. The interface automatically follows DSH’s language, including live changes. DSH `zh` uses Simplified Chinese; `zh-Hant`, `zh-TW`, `zh-HK` and `zh-MO` use Traditional Chinese. Other languages fall back to English. There is no separate language preference. Unknown backend diagnostics retain their original text for troubleshooting.

Version 0.6.0 prefers the Strata Server output default and displays its source. Version 0.5.0 follows DSH’s language and replaces periodic auto-sync with one startup attempt. The difference table uses aligned values, capability chips, expandable parameter mappings and a stacked layout in narrow panels.

## What it does

### Automatic model capabilities (0.4.0)

The preview includes **Input types**, **Reasoning levels**, and **Reasoning request mapping**, with the same backup, rollback and idle-only safeguards as token budgets.

- Input types follow the server's explicit `architecture.input_modalities`: text, or text plus image. Unknown or unsupported values preserve the existing field.
- Reasoning requires matching Strata identity, model identity and a reviewed chat-template fingerprint from `/props?model=...`. A model name alone is insufficient.
- Verified Qwen3.8-Flash-Next templates offer **off / low / medium / xhigh**. Verified DeepSeek-V4.1-Flash templates offer **off / low / high / max**, including the inspected Huihui variants. The template, not quantization, determines eligibility.
- Native DSH request mapping sends both thinking enablement and the selected effort. Unknown templates or unavailable props preserve existing reasoning settings and show a warning.
- Provider defaults and current conversation selections are not changed. An incompatible provider default skips reasoning synchronization with a warning. Start a new conversation after syncing.

See [capability evidence and exact mappings](docs/CAPABILITIES.md). No additional plugin or Strata server changes are required.

### Existing synchronization features

- Reads `/v1/models` and, when available, `/slots`. Uses the loaded model ID and actual engine context; it never guesses context from a model name.
- Updates that DSH model's context and output limit, and its native `compaction-basic` policy inside enabled Agent presets. The preview identifies the affected presets.
- Shows server-reported values separately from client-derived budgets.
- Offers an output-budget override and optional default-model following.
- When enabled before startup, synchronizes once per DSH host process/profile after tasks become idle. No periodic server checks. Enabling it during a session takes effect on the next start; use **Back up and sync** for an immediate sync. A failed attempt is shown in the UI and requires manual retry or the next start. No generation requests, model loading or server changes.
- Previews differences, rechecks the server before applying, rejects stale previews, backs up the profile and rolls back completed edits if a later edit fails.
- Uses DSH's existing credential service. Keys never appear in the page or diagnostics; redirects are not followed.

**Start a new conversation after syncing.** Existing conversations keep their selected model route and Agent preset revision. Default-model following and updated preset policies apply to new work; this plugin does not rewrite existing conversations or restart DSH.

## Compatibility

Developed against **DSH desktop 0.2.1-rc.3** and Strata's OpenAI-compatible model/slot metadata. Requires the standard desktop services `configEditor`, `connection`, `agents`, `credentials`, `llm-pi-ai`, and enabled Agent presets containing `compaction-basic` (or an active legacy global compaction plugin). Only API-key or unauthenticated `openai-completions` providers are supported. Configure the provider in DSH Models first.

Unknown context, no loaded model, ambiguous multiple loaded models, or conflicting slot capacities are refused. This version's UI follows the single loaded model; it does not select among multiple simultaneously loaded models.

The startup idle-wait scheduler includes a narrow DSH 0.2.1-rc.3 compatibility adapter for HMR's `executing.exit` context, following the host's own watcher pattern. This prevents timers created during a settings reload from retaining the completed HMR transaction. All writes still go through ConfigEditor and its normal transaction queue. Revalidate this adapter after upgrading DSH.

## Install

Clone and build with Node.js 22 or newer:

```sh
git clone https://github.com/ethan741205/dsh-strata-sync.git
cd dsh-strata-sync
npm ci
npm test
npm pack
dsh plugin --profile desktop add ./ethan741205-dsh-strata-sync-0.6.0.tgz
```

Use an absolute tarball path if running the last command elsewhere. DSH's plugin installer selects the included bundle; it can require a desktop reload to mount the new browser entry. Finish any active task before restarting DSH.

For the desktop profile, fully quit DSH Desktop before using the CLI installer, then reopen it. The bundle is automatically selected on its first installation; an already installed but disabled bundle must be enabled in DSH's plugin manager.

Then open **Settings → Strata Sync**:

1. Choose the existing Strata provider and save preferences.
2. Click **Check differences** to read the loaded model and preview the proposed settings.
3. Click **Back up and sync** while DSH is idle.
4. Optionally enable **Automatically sync when DSH starts** and save. It defaults to off and takes effect on the next start. Existing `autoSync: true` preferences now use startup behavior.
5. Start a new conversation to use the new Agent preset revision.

No API key needs to be copied into this plugin. Set up or repair credentials in DSH Models settings.

## Changes in 0.5.0

- Follows DSH’s native locale service; removes the independent language selector and product disclaimer.
- Performs one optional startup sync per host process/profile, waiting for idle. Hot reloads and reopening Settings do not repeat it.
- Preserves the existing opt-in `autoSync` preference; no recurring server polling.

## Changes in 0.3.0

- Adds English, Simplified Chinese and Traditional Chinese UI selection with local persistence.
- Includes all three README editions in the package.
- Keeps the synchronization backend and budgets unchanged.

## Changes in 0.2.0

- Moves the Strata Sync interface into DSH's native **Settings** navigation.
- Uses English throughout the interface and repository documentation.
- Preserves the synchronization policy, optional idle polling, backups and existing-conversation behavior described below.

## Budget policy

Strata reports model/context and a shared output default through `/props?model=...` → `default_generation_settings.params.n_predict` (the server's shared `max_tokens`). This default is not a hard model limit: an explicit client request overrides it. Strata does **not** supply DSH's compaction policy. The following are this plugin's client-side choices, designed around DSH 0.2.1-rc.3's native 4,096-token context safety margin:

```text
ordinary output = explicit manual override, else verified positive server n_predict
fallback output = min(16384, floor(context × 0.30))
compaction headroom = 4096
summary maxTokens = 4096
thresholdRatio = 0.8
retainRatio = 0.16
effective trigger = floor(min(context × 0.8, context − ordinary output − 4096))
recent retention = floor((context − ordinary output) × 0.16)
```

Output selection: an explicit manual override takes priority; otherwise use a positive integer from matching Strata/model props. Missing/null, `-1` or `0` means no fixed server cap and uses the calculated fallback. Unavailable or unverifiable props also use the fallback and show that the server limit could not be verified. Malformed explicit values are rejected. A positive server cap that leaves too little compaction space is refused, not silently replaced. The source is shown as **Strata Server default**, **Manual override**, or **Automatic calculation**. Summary output remains 4,096; compaction and retention are recalculated from the selected ordinary-output allowance.

These table examples use the calculated fallback (no manual or fixed server limit):

| Context | Ordinary output | Summary output | Headroom | Compaction trigger | Recent retention |
|---|---:|---:|---:|---:|---:|
| 32,768 | 9,830 | 4,096 | 4,096 | 18,842 (57.50%) | 3,670 |
| 65,536 | 16,384 | 4,096 | 4,096 | 45,056 (68.75%) | 7,864 |

An explicit output override must leave a valid positive compaction budget and retention smaller than the trigger. Contexts below 8,192 are unsupported. Reasoning choices synchronize only when verified as described above; credentials, other providers and other model policies are preserved. The selected route's retention is normalized to `retainRatio: 0.16` instead of retaining an incompatible absolute override.

This fixes invalid small-window compaction budgets such as the native `headroomTokens: 65536` default on a 32K route. It **cannot guarantee that a model finishes every response or summary within its token cap**. Reasoning also consumes output tokens. Strata's `fit_max_tokens` is not read or changed, and server-side `false` does not disable DSH's own output clamp.

## Backups and recovery

Every applied settings operation saves the current `cordis.patch.yml` beside the profile under `backups/strata-sync/`. Backups can contain private provider configuration; keep them local. The UI reports the backup path after application. DSH's own config editor handles individual atomic writes and hot reload. Multi-entry updates use compensating rollback, not a database transaction; a concurrent external edit can require manual recovery from the recorded backup.

Disabling auto-sync cancels a pending startup sync and disables it for future starts. Removing the plugin does **not** undo model/budget settings previously applied. Restore the desired backup with DSH stopped if you want to undo them.

## Development

`src/plugin.mjs` is the host plugin, `src/client.js` is the native ModuleLoader/React UI, and `src/core.mjs` is metadata discovery and pure budget planning. Build copies them into the publishable `dist/` directory; no bundled private app source is included.

```sh
npm ci
npm test
npm run build
npm pack --dry-run
```

Automated tests cover metadata validation, credentials/redirect safety, budgets, busy-state guards, stale previews, preservation of unrelated settings, rollback, one-shot startup sync, HMR deduplication, preset activation and UI behavior. Tests use simulated endpoints and DSH services; they do not generate model responses. See [validation notes](docs/VALIDATION.md) for the verified version and the isolated native-host checks.

References: [DSH compaction documentation](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/compaction/compaction-basic/README.md), [Strata](https://github.com/Niko1221/Strata).

MIT licensed.
