# Validation

Validation date: 2026-10-30 (Asia/Taipei).

## Current summary behavior

- Summary guidance is off by default in the schema, host fallback, request middleware and English, Simplified Chinese and Traditional Chinese interfaces. Explicit enable choices, output/source divisors and editable templates are supported.
- The writing target is the smaller of estimated effective summary output budget / output divisor and selected-source estimate / source divisor, rounded down. Both divisors default to 2 (50%).
- Effective output room is estimated against the supported pi-ai 1.1.0 context clamp, including the supplement, system text and tools. It is not a server tokenizer result. Reasoning and later request transformations can reduce usable answer space.
- The native summary prompt and request options are preserved. Unknown content, unverified metadata and targets below 256 tokens keep native behavior. The hook sends no extra inference requests and adds no retry loop.

## Automated verification

All **155 automated tests pass** for the current runtime. Coverage includes:

- Actual pi-ai context clamping across multiple input sizes, near-full and exhausted context, independent source length, additional prompt costs, disabled-mode zero discovery and restored native requests.
- Native Cordis waterfall dispatch, immutable messages, concurrent summaries, duplicate hooks, cancellation, metadata failures, early stream closure, native errors and unload.
- Verified model discovery, selected-provider/loaded-model matching, alias validation, input types, model-specific reasoning choices and eight mocked SDK wire cases.
- Preference validation, idle guards, stale-preview rejection, concurrent edits, backup and rollback, startup synchronization, hot reload and enabled Agent preset policies.
- Three-language settings rendering, editable prompt preservation, custom divisors, preview ceilings, default-off behavior and preference conflicts.

The package verifier checks the public file list, English root README selection, translated documentation links, entry points, source/build consistency and publishing metadata. It excludes private configuration, user conversations, credentials, backups and the native-prompt test fixture from the public package.

## Compatibility and limits

The integration targets **DSH Desktop 0.2.1-rc.3**, Cordis 4.0.5 and pi-ai 1.1.0. Native-host preview, synchronization, backup and interface checks used an isolated DSH profile and metadata-only fixture server. Native-summary integration probes used synthetic adapter responses.

These checks validate configuration, dispatch and preservation of native behavior. They do **not** establish that real models always follow the writing target, never truncate, or compact at an optimal frequency. No inference benchmark was run for this release. Server configuration and the user's running DSH profile were not changed.

Existing conversations retain their Agent preset revision; start a new conversation after synchronizing model settings.
