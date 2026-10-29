# Validation

Validation date: 2026-10-30 (Asia/Taipei).

## Package rename and target ratio 0.8.1

- Package identity, native bundle and client module now use `dsh-strata-sync`; the GitHub repository is unchanged. Existing scoped installations must be migrated, not loaded alongside the renamed plugin.
- The context contribution to the target changes from `/ 32` to `/ 16`. Summary-cap and selected-source bounds stay at `/ 2`; with a 4,096 summary cap, sufficiently long sources at both 32K and 64K now target 2,048 tokens. Other model and compaction settings are unchanged.
- Necessary verification consists of the 86 affected summary, plugin and UI tests plus the package verifier. Existing 0.8.0 native-runtime integration evidence below is historical; it was not rerun for this arithmetic/name change.

## Dynamic summary guidance 0.8.0

- Each supported native summary receives exactly one appended sentence. The target is `floor(min(context / 32, request.maxTokens / 2, selected-content estimate / 2))`; context is the smaller of verified server and existing client capacity. Source estimates exclude system messages, tool schemas and the summary instruction. Unknown attachment pricing and targets below 256 leave the native request unchanged.
- The official `llm/stream` waterfall is used without replacing the compaction engine. Tests exercise actual Cordis 4.0.5 services, plugin lifecycle and waterfall dispatch, with immutable native messages, concurrent summaries, duplicate hooks, cancellation, metadata failures, early stream closure, native errors and unload. All non-message request options and the complete native prompt are preserved.
- Plugin-level integration tests verify fresh metadata reads per summary, selected-provider/loaded-model matching, server identity, concurrent configuration edits and conservative client/server context matching. They assert zero configuration writes or backups during summary guidance. No prompt, raw tool content or credentials are recorded by the feature.
- A separate local integration probe called the **installed DSH 0.2.1-rc.3 native `BasicCompactionEngine.summarize()`** through its shipped Cordis runtime. Synthetic text yielded 1,024 at 32K and 2,048 at 64K; its original prompt, 4,096 output cap, signals, tools and configuration remained unchanged. Unloading the hook restored the original prompt. The adapter returned synthetic chunks: **no inference service was contacted**.
- English, Simplified Chinese and Traditional Chinese settings-render tests cover the read-only explanation, preview ceiling, unavailable values and live locale changes without adding preferences. All three READMEs describe the same behavior and limitations. Package verification checks the new runtime module is included and the authentic native-prompt test fixture is excluded from the public tarball.
- The target is a heuristic writing instruction. These checks establish integration and preservation, **not** that a real model always meets the target, never truncates, or stops compacting frequently. Natural-work model validation remains separate. No server or model settings are changed by this feature.

## npm documentation packaging 0.7.1

- The 0.7.0 tarball included all three root-level README files. Using the npm 11.19.0 publish-time manifest reader (`pacote` with `fullMetadata` and `fullReadJson`) selected `README.zh-TW.md` rather than `README.md`; the result matched the registry's README filename and length.
- Version 0.7.1 keeps only the English `README.md` at the package root. The translated READMEs move into `docs/`, along with capability and validation documentation included in the package. README links use absolute GitHub URLs so their destinations work from the npm package page as well as GitHub.
- All three READMEs now make public-registry installation the primary path and retain source/tarball installation as an alternative. Package metadata supplies explicit documentation, issue-reporting, discovery and publishing information.
- All **95 tests pass**, including the 94 existing tests and a new publish-artifact regression test. The verifier uses npm's package metadata reader and actual pack file list to check the chosen README, all 11 public files, documentation links, entry points, current build artifacts and publishing metadata. It runs again through `prepublishOnly` for directory publication. Dependency audit reported no known vulnerabilities.
- This patch changes release packaging and documentation, not the synchronization runtime. The native DSH checks described under 0.7.0 remain the prior integration baseline. Registry publication and npm website rendering must be verified separately after release.
- The observed 0.7.0 npm page showed no README even though registry metadata contained its text, matching a staged-publishing website/registry discrepancy reported in [npm/cli issue 9405](https://github.com/npm/cli/issues/9405). The root README selection issue is separately reproducible; fixing it does not by itself prove the website discrepancy is resolved.

## Synchronization and settings safeguards 0.7.0

- All **94 tests pass**, including 29 new regression tests. Coverage now includes changes during discovery and queued writes, revision-checked preference patches, multi-window conflicts, busy-to-idle startup deferral, startup readiness errors, alias resolution, non-text generators, unsupported catalog routes, delayed status responses and retained sync results.
- Explicitly verified the originally reported races: changing model settings during an apply query now rejects the stale preview without overwriting the newer value; a task beginning during startup discovery leaves synchronization pending until idle.
- The UI follows untouched preferences from other windows, reports conflicts for locally edited preferences, sends only changed fields with their baseline revision, and ignores older delayed status responses. Latest synchronization results from other windows replace older local results.
- All three locales cover automatic/manual output controls, provenance, partial capability alignment and result summaries. No independent language selector was added.
- Packed 0.7.0 and installed it through the official DSH plugin installer into the existing isolated DSH Desktop 0.2.1-rc.3 web profile. Startup synchronization, native preference saving/hot reload, manual 8,192-token output preview/application and result-card retention succeeded.
- Returned the isolated profile to automatic output mode. With a fixture server default of 4,096 and context 32,768, preview and apply used 4,096 output tokens and a 24,576-token (75%) compaction threshold. The UI distinguished the server default, effective value and source, and reported a backup.
- Native English and Simplified Chinese settings were checked through the browser. The installed host offers en/zh; Traditional Chinese is covered by automated locale/rendering tests. Reviewed the native result-card layout visually.
- Catalog-only routes and nonempty modelOverrides are rejected during preview; support for editing catalog overrides is not claimed. Existing explicit custom model lists remain supported, including adding the newly loaded canonical model.
- The fixture accepts metadata requests only. Production DSH, OpenCode and Strata server settings were not modified, and no inference requests were sent.

## Server output defaults 0.6.0

- All 65 tests pass. New coverage includes fixed server caps, absent/null and unlimited (-1/0) defaults, unavailable props, wrong model/Strata identity, invalid types, insufficient compaction space, manual precedence, stale-preview rejection after server-cap changes, applied model limits and translated output provenance.
- Uses the existing metadata-only GET /props?model=... response, specifically default_generation_settings.params.n_predict. [Strata server source](https://github.com/Niko1221/Strata/blob/main/serve/server.py) exposes the shared max_tokens default there; it is a default rather than a hard model maximum.
- Native isolated DSH 0.2.1-rc.3 startup sync adopted an 8,192-token fixture default at 32,768 context and saved a backup. English and Chinese previews reported the server source, a 20,480-token compaction threshold and unchanged 4,096 summary allowance.
- Changing only the fixture cap to -1 yielded a fresh preview of 9,830 output tokens, Automatic calculation, and an 18,842-token compaction threshold. This fallback preview was not applied. Traditional Chinese provenance is covered by UI tests.
- The updated English settings screenshot is retained locally only; it is not published with this release. Production DSH and the actual Strata server were not modified; no inference requests were sent.

## DSH language and startup synchronization 0.5.0

- All 58 tests pass. Regression coverage includes DSH locale subscriptions and cleanup, ignoring obsolete browser language preferences, Chinese regional variants, idle deferral, one attempt per process/profile, no repeat reads after completion/failure, HMR deduplication and manual retry availability.
- Installed the packed 0.5.0 bundle only in the existing isolated DSH Desktop 0.2.1-rc.3 web profile. Native English and Chinese UI switches automatically update the plugin. The language selector and product disclaimer are absent. The stock host exposes en/zh; Traditional Chinese regional mapping is covered by automated tests.
- Enabled startup sync in the UI. Saving the preference left the model at 32,768/9,830. Restarted only the isolated host; it synchronized the fixture model to 65,536/16,384 and displayed its successful sync timestamp and backup path. No Apply action or inference was used.
- The English screenshot is a fresh native-host capture. Older screenshots are not linked from the current READMEs.
- Production DSH and Strata configuration were not changed. Language integration uses DSH's locale service (getLocale/subscribe), described in [upstream client locale source](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/locale/src/client/index.ts).

## Difference-table layout 0.4.1

All 56 existing tests passed after the UI renderer change. In the isolated native host, a 32K-to-64K preview rendered a 528px table without horizontal overflow, with approximately 180/174/174px columns and right-aligned current/after values. English, Traditional Chinese and Simplified Chinese headers and values were checked in the live DOM. This version also renders capability arrays as chips, nested mappings as expandable details, and stacks rows when the table container is narrower than 440px. The narrow layout has not received a separate visual check. Browser screenshot capture timed out, so existing 0.4.0 screenshots are retained rather than presented as new captures. No synchronization was applied in this layout check.

## Capability synchronization 0.4.0

- All 56 automated tests pass. New checks cover verified template profiles, exact native efforts, unknown/malformed inputs, unverified reasoning preservation, conflicting provider defaults, localized warnings, stale capabilities, rollback and preservation of unrelated compatibility fields.
- Eight SDK wire tests use the public pi-ai 1.1.0 SDK (matching the installed DSH package version) with mocked fetch responses. Qwen off/low/medium/xhigh and DeepSeek off/low/high/max produce the expected thinking booleans and effort values. No inference endpoint is contacted.
- Queried the real Strata server's model and props metadata read-only: 32K Qwen with text/image input and the reviewed Qwen template. Inspected installed DeepSeek and Huihui tokenizer templates without loading them. Raw templates stay outside the repository.
- Installed the plugin into the isolated native DSH Desktop 0.2.1-rc.3 test profile. The fixture served the reviewed Qwen and DeepSeek templates as metadata. Preview/apply succeeded for each, retained 32K/9,830 budgets, saved profile backups, and the second preview showed no changes.
- Opened DSH's native Models editor and confirmed Qwen's context, output, text/image input and off/low/medium/xhigh entries. The DeepSeek test profile saved off/low/high/max.
- Unknown templates are covered by preservation tests; the plugin does not infer supported efforts from a model name or claim all future templates are compatible.
- Model inference quality, physical vision encoding and the production DSH profile were not changed or tested.

## Multilingual release 0.3.0

- All 38 automated tests pass, including Chinese preview labels and warnings, translated apply notices, local language persistence, invalid-language fallback and unchanged RPC write behavior on language switching.
- Packed and installed 0.3.0 in the isolated DSH Desktop 0.2.1-rc.3 web profile.
- Verified English, Traditional Chinese and Simplified Chinese in Settings → Strata Sync, including metadata preview and budget labels.
- Verified the selected language remains after leaving and reopening the Settings section.
- Captured the three native screenshots linked from the README editions.
- The npm package includes all three README editions. Unknown backend diagnostics deliberately retain their original text.
- No production DSH or Strata settings were changed; the native check only read metadata.

## Previous version scope

Version **0.2.0** moves the English interface to **Settings → Strata Sync**. Its Settings navigation, preferences, preview and synchronization were verified in the native host. The synchronization backend is unchanged from 0.1.0; the earlier full automatic-polling validation is retained below.

## Completed automated checks for 0.2.0

`npm test`: 35 passing tests covering discovery, native-client registration and UI behavior, budgeting, credentials, redirects, concurrent changes, lifecycle disposal, rollback, preset activation, retention inheritance and HMR timer context.

The updated UI tests require registration in `settings.section`, reject the old `plugins.item` location, and verify English UI text. Repository source and documentation were also scanned for remaining Chinese text; the screenshot was replaced with the English Settings page.

`npm run build` and `npm pack` produce the native host and browser entries. The package contains original plugin code only; no extracted DSH code, credentials, user conversations, server configuration or backups are distributed.

## Native Settings validation for 0.2.0

Using the installed DSH Desktop 0.2.1-rc.3 host with an isolated web profile and a metadata-only local fixture:

- Installed version 0.2.0 using the official plugin installer.
- Navigated through Account menu → Settings → Strata Sync; confirmed the page is a first-level Settings section.
- Switched only the isolated test profile to English to capture an entirely English screenshot.
- Previewed the context mismatch, used **Back up and sync**, and verified the saved context/output limits were 32,768/9,830 with a profile backup.
- Saved and cleared an output-budget override using **Save preferences**.
- Checked again and confirmed the settings were aligned.

No production DSH settings or Strata server settings were changed.

## Earlier native backend validation for 0.1.0

Tested using the installed DSH Desktop 0.2.1-rc.3 host in an isolated web profile, with a local metadata-only fixture. The real user profile and running inference server were not modified.

- Installed the packed bundle through the official DSH plugin installer.
- Opened the actual DSH Plugins page and Strata Sync UI used by version 0.1.0.
- Saved preferences, previewed a 64K-to-32K mismatch, and applied the change.
- Confirmed the native ConfigEditor saved the model limit and the exact provider/model policy in four enabled Agent presets: `standard`, `ptc`, `minimal`, and `cordis`.
- Confirmed the original profile was backed up, preset activation succeeded, and a second preview reported no differences.
- Toggled auto-sync off and on in the real UI, changed the fixture to 65,536 tokens, and verified the normal 60-second poll updated the DSH model from 32,768/9,830 to 65,536/16,384 without a manual apply or application restart.
- Verified metadata traffic uses only `GET /v1/models` and `GET /slots`; no inference endpoint is implemented by the fixture.

The native test exposed two host integration details now covered by regression tests: inactive root compaction placeholders must not be edited, and a timer created during HMR reload must exit the inherited transaction context before future ConfigEditor calls.

## Limits of validation

This validates configuration synchronization and native UI integration, not model answer quality or completion of arbitrary long summaries. No inference benchmark was run. Existing DSH conversations retain their Agent preset revision; start a new conversation after synchronization. The production DSH profile has not been modified or restarted by this validation.
