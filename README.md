# dsh-strata-sync

**English** · [简体中文](https://github.com/ethan741205/dsh-strata-sync/blob/main/docs/README.zh-CN.md) · [繁體中文](https://github.com/ethan741205/dsh-strata-sync/blob/main/docs/README.zh-TW.md)

Connect **DeepSeek Harness (DSH)** to the model loaded in **Strata Server**, with model settings and summary controls in one DSH settings page.

The plugin reads Strata's model information, previews the changes, and updates DSH's custom model and context-compaction budgets. It also adds an editable length instruction to supported summary requests, helping the model keep checkpoints concise.

## What you can do

- **Sync model settings:** context window, response output limit, and confirmed input types and reasoning levels.
- **Align compaction budgets:** update the matching policies in enabled DSH Agent presets.
- **Control summary length:** edit the supplemental prompt and adjust two target-length ratios.
- **Sync on startup:** optionally synchronize once when DSH starts.
- **Detect changes while running:** check Strata's model metadata on plugin activation, then every 60 seconds, and warn when the model or settings no longer match.
- **Review and recover:** preview differences, back up settings, and view the last synchronization result.

Strata Server is read-only to this plugin. Synchronization does not switch or load server models, change server settings, or send test inference requests. Unconfirmed model capabilities keep their existing DSH values.

## What's new in 0.12.11

- Summary guidance now supports native image attachments, including images returned by tools. Source-length and output-room estimates account for images separately while preserving the original messages and attachments.
- Diagnostics identify unsupported content and invalid fields using fixed categories, with numeric image costs. Conversation text, image data, attachment identifiers and paths are never copied into audit records.
- A truncated request with unsupported input can arm guidance for the next supported request; successful native checkpoint commitment resets recovery as before.

## What's new in 0.12.10

- The supplemental summary prompt editor starts at two lines to fit the shorter default prompt, and can still be resized vertically for longer custom text.

## What's new in 0.12.9

- The default summary supplement now only sets the target length: `Keep the entire checkpoint, including all required headings, within a target of {target} tokens.`
- DSH's native summary instruction continues to define the checkpoint's content and structure. Existing custom templates remain in use until edited or reset to the default.

## What's new in 0.12.8

- Native session diagnostics record each calculated summary target, whether the instruction was actually applied, and why it was skipped.
- Each request's stream result links to DSH's existing compaction events, distinguishing truncation, cancellation and generation completion from a committed checkpoint.
- Diagnostics contain bounded metadata only. They preserve summary behavior and never send additional inference requests.
- The optional integration uses DSH's experimental plugin-record API; unavailable logging does not block summaries.

See the [audit event format and native persistence test](https://github.com/ethan741205/dsh-strata-sync/blob/main/docs/SUMMARY_AUDIT.md) and [validation notes](https://github.com/ethan741205/dsh-strata-sync/blob/main/docs/VALIDATION.md). Automated native persistence verification uses controlled responses. Two additional live Strata compactions completed without truncation: the default mode recorded no applied target, and every-summary mode recorded an applied 1,328-token target. All 45 saved events reloaded unchanged through the native reader.

## Get started

### 1. Prepare the connection

Load a model in Strata Server. In **DSH → Settings → Models**, configure its OpenAI-compatible provider, API URL and credentials, with an explicit custom model entry.

The plugin reuses that connection; you do not need to copy an API key into it.

### 2. Install the plugin

In DSH's plugin manager, choose **Add plugin** and enter:

```text
dsh-strata-sync
```

Or, after finishing active tasks and fully quitting DSH Desktop, use the official CLI:

```sh
dsh plugin --profile desktop add dsh-strata-sync --registry=https://registry.npmjs.org/
```

Reopen DSH if needed to load the settings page. If the plugin is disabled, enable it in the plugin manager.

### 3. Preview and synchronize

Open **Settings → dsh-strata-sync**:

The main flow appears first: **Check differences → Review changes → Back up and sync**. **Sync preferences** and the optional **Dynamic summary target** are collapsed below it; expand them to adjust options or edit the supplemental prompt.

The change preview shows the conversation budget, compaction headroom, summary output cap, effective compaction trigger and recent-content retention. The formulas explain how the proposed budgets were calculated.

1. Select your Strata provider and click **Save preferences**.
2. Click **Check differences** to inspect the loaded model and proposed changes.
3. Click **Back up and sync**.
4. **Start a new conversation** to use the updated model and Agent preset settings.

Existing conversations keep their selected model route and preset revision. To make future setup automatic, enable **Automatically sync when DSH starts** and save. This option is off by default and takes effect on the next start; it can run during tasks but synchronizes only once.

### When the server model changes

The first read-only check starts on plugin activation without waiting for the 60-second interval. If synchronization is busy, it waits until that operation finishes. With a configured Strata provider, monitoring checks the loaded model and confirmed context, output and capability settings, then repeats every **60 seconds**, even with Settings closed. It compares them with DSH's model and compaction settings. Settings displays a warning for a detected model/context change or settings mismatch; an unavailable check is shown separately rather than reported as a match. The page refreshes this status every 15 seconds, so a completed check may not appear immediately.

These checks do **not** automatically synchronize or modify an active conversation. After switching models in Strata, use **Check differences → Back up and sync**, then **start a new conversation**. The latest synchronization result is a historical record, not confirmation that an existing conversation uses the new budgets.

## Model and output settings

| Setting | How it is chosen |
|---|---|
| Model and context | Strata's loaded text model and verified context capacity. |
| Response output limit | Manual override, if set; otherwise the verified Strata output default. If unavailable or unlimited, use Strata's formula: 30% of context, at least 4,096 and at most 32,768 tokens. |
| Input types | Confirmed server capabilities, such as text or text plus image. |
| Reasoning levels | Verified model-template support; unknown templates preserve existing settings. |
| Default model | Follows the loaded Strata model when **Follow the loaded Strata model as the default** is enabled. |

Keep **Follow Strata output limit** enabled for automatic selection. Turn it off to set a manual override under **Advanced settings**. The preview shows the server default, effective value and source separately.

Quantization does not change the choices for a verified model family: Qwen3.8 Flash Next offers `off / low / medium / xhigh`; the current DeepSeek Flash template offers `off / low / medium / high / max` and defaults to `high`. Older verified templates keep their supported choices. Sync updates the available choices without changing the selected effort. See [verified capabilities](https://github.com/ethan741205/dsh-strata-sync/blob/main/docs/CAPABILITIES.md).

The fallback follows [Strata's local output formula](https://github.com/Niko1221/Strata/blob/main/apps/host/server/agent/profile.mjs): `max(4096, min(32768, floor(context × 0.3)))`.

When synchronizing, the plugin normally sets a 4,096-token summary output cap and compaction headroom. For small windows using calculated output, both are limited to half the remaining conversation budget, rounded down; an 8K window therefore uses 2,048. The effective compaction trigger is the smaller of **80% of context** and **context − response output − headroom**. Recent-content retention is **(context − response output) × 16%**, rounded down. These compaction budgets are calculated by the plugin, not supplied by Strata.

For example, with automatic output calculation, a 32K context uses a 9,830-token response allowance and an 18,842-token compaction trigger. It does **not** necessarily compact at 80%.

## Summary prompt and target length

**Dynamic summary target** is on by default, using **After summary truncation**. You can disable it or choose when to supplement DSH's native summary instructions:

| Mode | Behavior |
|---|---|
| **After summary truncation** (`after-truncation`, the default mode) | Start with the native instruction. If a summary hits its output-token limit, add length guidance to the next native compaction for the same conversation, provider and model. Keep guidance active through unsuccessful attempts; after successful compaction, return to the native instruction. |
| **Every summary** (`always`) | Add the length instruction to every supported summary, including the first attempt. |

The mode is saved as `summaryGuidanceMode`; `summaryGuidance` remains the enable switch. When disabled, DSH uses its native summary and compaction behavior. Choosing a mode does not enable guidance by itself.

**After summary truncation** waits for DSH's next compaction attempt; it does not immediately retry or send another model request. Cancellation, network/authentication errors and context-overflow errors do not activate it. Recovery state is kept only in memory and clears when guidance is disabled, the mode changes, or the plugin reloads or restarts. Conversations do not share recovery state.

The editable **Supplemental summary prompt** starts with:

```text
Keep the entire checkpoint, including all required headings, within a target of {target} tokens.
```

Keep `{target}` in your text—it is replaced with the calculated token target whenever guidance applies. The template can contain up to 2,048 characters. Use **Restore default prompt** to reset it, then **Save preferences** to apply your choice.

Two divisors control the target (both default to **2**, or **50%**):

| Divisor | Default | Limits the target to |
|---|---:|---|
| Output budget (O) | 2 | Estimated effective summary output budget ÷ O |
| Source length (S) | 2 | Estimated content being summarized ÷ S |

The target is the smaller result, rounded down. All divisors accept decimals of at least 1. Existing output/source divisors and explicit enable choices are preserved. New or unspecified guidance is **on**, using **After summary truncation**; explicitly disabled configurations stay disabled.

The effective output budget is an **estimate**, not the raw requested `maxTokens` or a server-confirmed cap. It is the smaller of the request's summary cap and estimated remaining context. The latter uses the smaller verified server/client window, subtracts the full prompt (including system text, tool schemas and the supplement), and allows for the supported pi-ai adapter's 4,096-token safety reserve. Text is estimated at 3.5 characters/token with extra framing. The separate source estimate uses DSH's four-character heuristic and excludes the system prompt, tools and summary instruction. Neither estimate is an exact tokenizer count.

For example, a 4,096-token effective output budget with enough source content gives a **2,048-token target** in either 32K or 64K context. A 2,000-token source instead gives a **1,000-token target**. Less remaining context can reduce the target further. The target is calculated for each supported summary request; the change preview does not display a target estimate.

Native PNG, JPEG, WebP and GIF attachment references are supported. The source estimate follows DSH's serialized-reference heuristic. Output-room estimation reserves at least 1,372 tokens per image using pi-ai's heuristic, plus the native image description, available access-path text and framing. Images are retained and never priced as zero; unsupported attachments and malformed fields leave the native request unchanged with a specific diagnostic category.

This is a writing instruction, **not a hard output limit or a guarantee against truncation**. Reasoning may consume the same output budget; the plugin does not change reasoning, `maxTokens`, `fit_max_tokens` or compaction timing. The server's actual tokenizer, later middleware, or a different adapter version may impose a lower limit.

Saving summary preferences does not change model budgets. Native prompt content is preserved, and no extra inference or retry loop is added. If the request cannot be verified or safely estimated, or the target is below 256 tokens, the original summary request proceeds unchanged.

## Backups and compatibility

Settings writes create a backup of `cordis.patch.yml` under the profile's `backups/strata-sync/` directory. Synchronization checks for concurrent edits and attempts to roll back completed changes if a later step fails. Backups may contain private configuration; keep them local.

Removing the plugin does not undo previously synchronized settings. To restore a backup, fully quit DSH first.

Tested with **DSH Desktop 0.2.1-rc.3**. Use an API-key or unauthenticated OpenAI-compatible provider with an explicit custom model list and an enabled Agent preset containing `compaction-basic`. Contexts below 8,192 tokens, catalog-only providers, nonempty `modelOverrides`, and ambiguous loaded-model metadata are unsupported.

See [verified capabilities and reasoning mappings](https://github.com/ethan741205/dsh-strata-sync/blob/main/docs/CAPABILITIES.md) and [validation notes](https://github.com/ethan741205/dsh-strata-sync/blob/main/docs/VALIDATION.md) for technical details and test coverage.

## Development

Requires Node.js 22 or newer.

```sh
git clone https://github.com/ethan741205/dsh-strata-sync.git
cd dsh-strata-sync
npm ci
npm test
npm run build
npm pack
```

To install your build, fully quit DSH and run `dsh plugin --profile desktop add <path-to-generated.tgz>`.

Source: `src/plugin.mjs` (host integration), `src/core.mjs` (discovery and budgets), `src/summary.mjs` (summary guidance), and `src/client.js` (settings UI).

[npm](https://www.npmjs.com/package/dsh-strata-sync) · [Report an issue](https://github.com/ethan741205/dsh-strata-sync/issues) · [MIT license](https://github.com/ethan741205/dsh-strata-sync/blob/main/LICENSE)
