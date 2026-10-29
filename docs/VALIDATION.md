# Validation

Validation date: 2026-10-30 (Asia/Taipei).

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
