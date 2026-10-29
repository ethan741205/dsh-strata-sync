# Validation

Validation date: 2026-10-30 (Asia/Taipei).

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
