# Validation

Validation date: 2026-10-30 (Asia/Taipei).

## Automated checks

`npm test`: 35 passing tests covering discovery, native-client registration and UI behavior, budgeting, credentials, redirects, concurrent changes, lifecycle disposal, rollback, preset activation, retention inheritance and HMR timer context.

`npm run build` and `npm pack` produce the native host and browser entries. The package contains original plugin code only; no extracted DSH code, credentials, user conversations, server configuration or backups are distributed.

## Native DSH host

Tested using the installed DSH Desktop 0.2.1-rc.3 host in an isolated web profile, with a local metadata-only fixture. The real user profile and running inference server were not modified.

- Installed the packed bundle through the official DSH plugin installer.
- Opened the actual DSH Plugins page and Strata Sync UI.
- Saved preferences, previewed a 64K-to-32K mismatch, and applied the change.
- Confirmed the native ConfigEditor saved the model limit and the exact provider/model policy in four enabled Agent presets: `standard`, `ptc`, `minimal`, and `cordis`.
- Confirmed the original profile was backed up, preset activation succeeded, and a second preview reported no differences.
- Toggled auto-sync off and on in the real UI, changed the fixture to 65,536 tokens, and verified the normal 60-second poll updated the DSH model from 32,768/9,830 to 65,536/16,384 without a manual apply or application restart.
- Verified metadata traffic uses only `GET /v1/models` and `GET /slots`; no inference endpoint is implemented by the fixture.

The native test exposed two host integration details now covered by regression tests: inactive root compaction placeholders must not be edited, and a timer created during HMR reload must exit the inherited transaction context before future ConfigEditor calls.

## Limits of validation

This validates configuration synchronization and native UI integration, not model answer quality or completion of arbitrary long summaries. No inference benchmark was run. Existing DSH conversations retain their Agent preset revision; start a new conversation after synchronization. The production DSH profile has not been modified or restarted by this validation.
