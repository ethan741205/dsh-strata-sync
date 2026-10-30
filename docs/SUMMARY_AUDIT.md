# Native summary audit

Version 0.12.8 records summary guidance in the owning DSH session's native log.
The optional audit uses the host's experimental `appendPluginRecord` API; it
does not open, rewrite, compress, or rotate session files itself. DSH supplies
the `type`, `seq`, millisecond `time`, `data`, and `ignorable: true` envelope.
With the desktop Zstd backend, these records live alongside native compaction
events in `<session-root>/<project>/<session>/session.v4.jsonl.zstd`.

The host API is resolved from `profileContext.installAnchor`, using the same
Session implementation as DSH. No second copy of dsh-session is bundled or
installed. Audit initialization is optional and never delays inference. A
missing service/API, incompatible Session, or failed append produces at most
one fixed warning per plugin lifetime; summary processing continues. There is
no silent fallback file and no retroactive audit of earlier requests.

## Event contract (schemaVersion 1)

Each observed compaction request has an independent UUID `attemptId`. There
are two new event types, with no per-token events:

| Event | Meaning |
|---|---|
| `plugin:dsh-strata-sync/summary-guidance` | Decision immediately before native dispatch; applied is recorded after replacing the request's messages. |
| `plugin:dsh-strata-sync/summary-result` | Stream termination, cancellation, error, or early iterator closure. |

Both payloads contain `schemaVersion`, `pluginVersion`, `attemptId`, `provider`,
`model`, `compactionId`, `startSeq`, and `correlation`. The native file already
identifies the session. Identifiers are bounded and control characters are
rejected. Each payload has a 2,048-byte safety limit; unknown properties are
discarded, and no request, prompt, response text, tool argument, credential,
custom template, or raw exception message is copied into these records.

The decision contains:

| Field | Meaning |
|---|---|
| `enabled`, `mode` | Observed switch and mode, or null when invalid/unavailable. |
| `outputDivisor`, `sourceDivisor` | Valid selected divisors, otherwise null. |
| `requestedMaxTokens` | The request's unchanged hard cap. |
| `sourceTokensEstimated` | Selected-source estimate; not a tokenizer measurement. |
| `effectiveOutputTokensEstimated` | Estimated usable output budget, not a server-confirmed cap. |
| `targetTokens` | Calculated candidate, including values rejected for being below 256. Null means no candidate was computed. |
| `applied`, `appliedTargetTokens` | Whether this hook actually added the instruction; appliedTargetTokens is null unless applied. |
| `reason` | A bounded reason code such as applied, disabled, awaiting-truncation, target-too-small, context-unavailable, settings-changed, or cancelled. |

Calculation remains `floor(min(effectiveOutput / outputDivisor,
sourceTokens / sourceDivisor))`. Unarmed after-truncation mode does not perform
metadata discovery just to populate the log. `applied: true` proves this hook
added the instruction to the downstream request. It does not prove receipt by
the server, compliance by the model, or successful checkpoint commitment.

The result adds `decisionSeq` (null if the decision could not be written),
`finishReason`, `outcome`, `streamCompleted`, `elapsedMs`, and a whitelist of
available numeric usage fields. `outcome` is one of `completed`, `truncated`,
`cancelled`, `error`, or `incomplete`. A stream stopped by its consumer is
incomplete even if its last yielded chunk contained stop. A process crash can
leave a decision without a result; absence is not success or a new failure.

## Reading the compaction result

`completed` describes a stream, **not a successful compaction**. Read the native
events for the matching `compactionId`:

1. Match the two plugin records by `attemptId` and `decisionSeq` within the
   same session. Use the result's correlation, which may become uncertain
   after an initially unique decision.
2. Only `unique-open-compaction` supplies a confirmed start/id association.
   Missing starts, overlapping requests, simultaneous compactions, tracking
   overflow, and a compaction ending during a stream are explicitly uncertain.
   Do not infer their association from time proximity or the last record.
3. Native `compaction/summary`, its replacement checkpoint, and an error-free
   matching `compaction/end` establish a committed compaction. An end containing
   an error is a failure even if the stream stopped normally. A missing end is
   unfinished/unknown. Existing native records retain the summary and failure
   detail; the audit does not duplicate them.
4. Multiple sequential attempts can belong to one compaction. Earlier failed
   attempts remain failed even if a later attempt produces its checkpoint.
   Compute a consecutive successful-compaction count from the native lifecycle,
   not by counting stream-result records.

The observer never appends from inside `session/event`, which prohibits
reentrant appends. Audit correlation is bounded and independent of guidance's
existing recovery state. Neither audit records nor their successful persistence
are required for inference. Unknown ignorable events do not enter the model's
conversation surface. Native fork/resume retains them, but future format
migrations treat experimental plugin records on a best-effort basis.

## Verification

Run `npm test` for the ordinary suite, then `npm run test:native-session` on a
machine with DSH Desktop installed. Set `DSH_DESKTOP_EXECUTABLE` to its executable
if it is not in the default Windows location. The native runner uses the
installed Electron in Node mode with a hidden window; it does not start the
desktop profile or its CLI, read credentials, contact a model server, or touch
real session data. Its isolated temporary session directory is created under
this checkout and removed after the test.

The native test uses DSH's real compaction engine, Session, record API, and Zstd
persistence backend with controlled local model responses. It checks targets
and application at dispatch; truncation, committed success, and validation
failure; two flush batches; close and reload in a new Context without the
audit plugin; restored conversation surface; and rejection of unknown events
without the ignorable marker. The same scenarios are compared with auditing
absent to verify unchanged requests, checkpoint content, and native errors.

This is persistence and behavior verification on the installed DSH version,
not a live model quality test. Older DSH versions without compatible plugin
records retain summary guidance but cannot provide these audit records.
