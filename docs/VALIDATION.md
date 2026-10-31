# Validation

Validation date: 2026-10-31 (Asia/Taipei).

## Current summary behavior

- Summary guidance is on by default in the schema, host fallback, request middleware and English, Simplified Chinese and Traditional Chinese interfaces. Explicit enable choices, output/source divisors and editable templates are supported.
- `summaryGuidanceMode` selects `always` or `after-truncation` (the default). The latter starts with native summaries, activates guidance for the same conversation/provider/model only after a summary reaches its output-token limit, and returns to native instructions after successful compaction. It waits for the next native compaction rather than adding a request or retry loop.
- Cancellation, network/authentication errors and context overflow do not arm recovery. Recovery state is in memory only and resets on disable, mode changes, plugin reload or restart. Concurrent conversations retain separate state.
- The writing target is the smaller of estimated effective summary output budget / output divisor and selected-source estimate / source divisor, rounded down. Both divisors default to 2 (50%).
- Effective output room is estimated against the supported pi-ai 1.1.0 context clamp, including the supplement, system text and tools. It is not a server tokenizer result. Reasoning and later request transformations can reduce usable answer space.
- The native summary prompt and request options are preserved. Unknown content, unverified metadata and targets below 256 tokens keep native behavior. The hook sends no extra inference requests and adds no retry loop.
- Version 0.12.9 shortens the default supplement to a target-length instruction only. DSH's native content and formatting requirements still apply; saved custom templates retain their configured text.
- Version 0.12.11 supports the installed host's durable PNG/JPEG/WebP/GIF image references in user and tool messages. The source estimate includes the image block structure, excluding only its `offloaded` flag, matching DSH's heuristic. The output estimate reserves pi-ai's 4,800 estimated characters per image (1,372 tokens), its native description/access-path text, and framing. The original blocks are preserved; images are not zero-priced. These remain heuristics, not server tokenizer measurements.
- Unsupported inputs now include a bounded `inputIssue` category and field rather than raw data. Truncation of an unsupported input is observed for recovery, so a later supported request can receive guidance without a new inference or retry loop.

## Automated verification

Version **0.12.11 passed 250 automated tests** plus native session persistence verification. Unspecified summary guidance is enabled in both host and interface defaults, using after-truncation mode. Explicit disable choices are preserved. Coverage includes the cases below.

- Native audit decisions preserve the calculated candidate (including rejected small values), applied state and skip reason; stream records preserve terminal outcome and numeric usage. Records are bounded, use a field whitelist, and never copy prompts, summaries or raw exception messages.
- Audit failures preserve native chunks, error identity, cancellation and iterator cleanup. Duplicate hooks, mixed disabled/enabled hooks, settings changes during discovery, concurrent attempts, early closure before first iteration, hot reload and missing host services are covered.
- `npm run test:native-session` passed against installed **DSH 0.2.1-rc.5**. It uses the real host module resolver, Session, BasicCompactionEngine and Zstd persistence backend with local controlled responses and a synthetic native image reference. Three transactions verify truncation, a **2730-token applied target with committed checkpoint**, and a normally stopped stream rejected by native size validation. The original image survives dispatch and persistence/reload; source and output-room image costs are nonzero. The same transactions without auditing produce identical model requests, checkpoint content and native errors.
- Eight focused image tests cover user/tool images, multiple images, the real pi-ai clamp, long image names and normalized paths, immutable native blocks, privacy-safe failure categories, access-resolution failures and unsupported-input truncation followed by successful recovery. The actual Cordis attachment/filesystem metadata resolver is exercised with synthetic services. No live model inference was performed for 0.12.11.
- Native persistence verification writes two batches, flushes, closes and reopens in a new Context without loading the audit plugin. All six plugin records and their native lifecycle associations survive unchanged; restored conversation content is identical. A negative fixture missing `ignorable` is rejected by the native reader. Temporary test data is removed, and no real sessions or live models are used. See [event contract and test setup](SUMMARY_AUDIT.md).

- The main preview omits the estimated summary-target card, while retaining summary output limits and all guidance controls. The aligned model-status card no longer repeats the existing-conversation policy reminder. These presentation changes leave runtime summary calculations and model/compaction settings unchanged.

- Preview copy omits the technical context-source label and explains that updated compaction budgets apply only to new conversations. Chinese interfaces call affected Agent presets configurations; English retains the native preset terminology. All three translations are checked without changing synchronization preferences.

- Optional `after-truncation` mode: untouched first request, exact native `max-tokens` finish detection, guidance on subsequent native attempts, and reset only after a matching `compaction/summary` followed by an error-free `compaction/end`. Completed `stop` or text-bearing `tool-calls` streams can become commit candidates; a finish alone cannot reset recovery. Failed native checkpoint validation leaves it armed.
- Session/provider/model isolation, bounded in-memory recovery state, missing event identities, unmatched commits, late completion races, native cancellation, early iterator closure, duplicate hooks and disposal. Tests use the real Cordis waterfall and synthetic model responses; no live inference is dispatched.
- Mode defaults and validation, preference backup/persistence/reload, stale-edit protection and three-language selection/help. Model/context budgets remain unchanged when saving the mode.

- Initial monitoring is scheduled immediately after plugin activation yields, outside the HMR transaction. Tests cover read-only startup, disposal before execution, hot reload, short deferral during configuration writes, ordinary recovery intervals after failure, and avoiding duplicate reads after manual checks or startup synchronization.

- Subsequent runtime monitoring on a separate 60-second timer, including while Settings is closed and Agent tasks run. It makes metadata GET requests only: no configuration writes, backups, preset activation or inference. Startup synchronization still runs once.
- Loaded-model switches, context/output changes, manual acknowledgement of an already configured model, explicit synchronization, transient failure/recovery, incomplete metadata, cancellation, overlapping checks, hot reload, concurrent edits and late responses. Failed or mixed metadata cannot produce a live aligned status.
- Three-language runtime warnings and recovery, historical-success suppression, main-preview conversation/headroom/summary/retention budgets, effective threshold and formula, absence of summary estimates and default-enabled guidance controls.

- Current DeepSeek recognition accepts the `Strata ds4-0.1` build format and the reviewed served-template fingerprint. Unknown/malformed identities, wrong model aliases and unreviewed templates remain unconfirmed. Both legacy DeepSeek choices and the new `medium` choice are covered.
- The prior authenticated metadata-only compatibility check against DeepSeek Huihui 2.00 bpw confirmed 65,536 context, unlimited server output, a 19,660-token fallback, text/image input and `off / low / medium / high / max`, without warnings or configuration changes. No inference request was sent.
- Qwen and current DeepSeek retain their respective family choices across quantization labels. The three-language UI shows every current DeepSeek option, including `medium`, without introducing Qwen's `xhigh`.

- Automatic output matches Strata's 30% formula with a 4,096 floor and 32,768 ceiling. Tests cover 8K through 1M contexts, rounding at the ceiling, unchanged server/manual precedence, valid small-window compaction budgets and all three UI translations. The 8K calculated-output case limits compaction headroom and summary cap to 2,048; 32K and larger retain 4,096.

- Actual pi-ai context clamping across multiple input sizes, near-full and exhausted context, independent source length, additional prompt costs, disabled-mode zero discovery and restored native requests.
- Native Cordis waterfall dispatch, immutable messages, concurrent summaries, duplicate hooks, cancellation, metadata failures, early stream closure, native errors and unload.
- Verified model discovery, selected-provider/loaded-model matching, alias validation, input types, model-specific reasoning choices and thirteen mocked SDK wire cases. Off sends false thinking flags and omits the effort; other choices send true and their exact native effort name. These cases validate request mapping, not generated-answer quality.
- Preference validation, synchronization write guards, stale-preview rejection, concurrent edits, backup and rollback, startup synchronization, hot reload and enabled Agent preset policies.
- Synchronization during suspended generation and summary streams, including maintenance status, uses synthetic responses with a mocked ConfigEditor. Requests complete unchanged; simultaneous sync is rejected, new steps wait during writes, and both success and rollback release the barrier. These tests do not exercise a live desktop task or native ConfigEditor reload during a real model stream.
- Three-language settings rendering, editable prompt preservation, custom divisors, default-enabled guidance with explicit-disable preservation and preference conflicts.

The package verifier checks the public file list, English root README selection, translated documentation links, entry points, source/build consistency and publishing metadata. It excludes private configuration, user conversations, credentials, backups and the native-prompt test fixture from the public package.

## Live desktop verification

On 2026-10-31 (Asia/Taipei), 0.12.8 was installed and enabled in DSH Desktop 0.2.1-rc.5. Two manual native compactions used a dedicated synthetic-data conversation and the live Strata deepseek-v4.1-flash model:

| Mode | Calculated target | Applied | Output tokens | Result |
|---|---:|---|---:|---|
| after-truncation (initial, unarmed) | null | false | 421 | stop; checkpoint committed |
| always (temporary test setting) | 1328 | true | 498 | stop; checkpoint committed |

Both requests retained their 4096-token hard cap. The second target matched floor(min(4096 / 1.5, 2657 / 2)). Native summary events, replacement checkpoints and error-free ends confirmed both commits. The native persistence reader reopened all 45 events across 17 Zstd frames in a separate Context without the audit plugin; every event matched the saved data, the restored surface was valid, and verification left the source file unchanged. The original after-truncation settings were restored; both configuration files matched their pre-test bytes. Private session content and identifiers are excluded from this public report.

## Compatibility and limits

Core synchronization was validated with **DSH Desktop 0.2.1-rc.3**, Cordis 4.0.5 and pi-ai 1.1.0; the native audit and persistence integration was validated with **0.2.1-rc.5**. Native-host preview, synchronization, backup and interface checks used an isolated DSH profile and metadata-only fixture server. Native-summary integration probes used synthetic adapter responses. The experimental record API is capability-checked and is not claimed compatible with all earlier or future DSH builds.

These checks validate configuration, dispatch and preservation of native behavior. Runtime model-switch monitoring and Settings states were verified with mocked server responses and rendered UI tests, not by switching the user's live model. They do **not** establish that real models always follow the writing target, never truncate, or compact at an optimal frequency. No inference benchmark was run for this release. Live verification temporarily changed only the summary guidance mode and then restored the original configuration; server configuration was not changed.

Existing conversations retain their Agent preset revision; start a new conversation after synchronizing model settings.
