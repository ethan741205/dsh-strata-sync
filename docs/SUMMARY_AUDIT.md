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
custom template, or raw exception message is copied into these records. Input
diagnostics also exclude image data, attachment identifiers, and file paths.

The decision contains:

| Field | Meaning |
|---|---|
| `enabled`, `mode` | Observed switch and mode, or null when invalid/unavailable. |
| `outputDivisor`, `sourceDivisor` | Valid selected divisors, otherwise null. |
| `requestedMaxTokens` | The request's unchanged hard cap. |
| `sourceTokensEstimated` | Selected-source estimate; not a tokenizer measurement. |
| `sourceImageCount`, `sourceImageTokensEstimated` | Number of supported images in the selected source and their estimated token contribution; null when unavailable. |
| `effectiveOutputTokensEstimated` | Estimated usable output budget, not a server-confirmed cap. |
| `budgetImageTokensEstimated` | Estimated image contribution deducted when estimating output room; null when that estimate was not available or not attempted. |
| `targetTokens` | Calculated candidate, including values rejected for being below 256. Null means no candidate was computed. |
| `applied`, `appliedTargetTokens` | Whether this hook actually added the instruction; appliedTargetTokens is null unless applied. |
| `reason` | A bounded reason code such as applied, disabled, awaiting-truncation, target-too-small, context-unavailable, settings-changed, or cancelled. |
| `inputIssue` | Fixed classification of an input-estimation failure, or null; see the categories below. |

The image-estimate fields and `inputIssue` are additive fields in schema version
1; older records can omit them. Image estimates are heuristic contributions,
not image-token counts reported by the server. Zero means a completed estimate
contained no priced images, while null means the estimate was unavailable or
not attempted. The audit never measures or stores image bytes itself.

The two image estimates serve different purposes:

- `sourceImageTokensEstimated` follows DSH's selected-source heuristic: each
  image contributes `4 + ceil(JSON.stringify(imageBlockWithoutOffloaded).length
  / 4)`. The serialized object is the whole image block, with its `offloaded`
  property removed, not just the nested attachment reference. This prices the
  reference structure for source selection; it is not a visual-token estimate.
- `budgetImageTokensEstimated` reserves the provider's image heuristic of
  `ceil(4800 / 3.5) = 1372` tokens per image, plus the image-handle text and its
  framing. Handle-text estimation uses source dimensions conservatively and the
  metadata-only normalized access path when available. The path and handle text
  are used only for local estimation and are never copied into the audit.

Neither estimate is a tokenizer measurement or a server-confirmed image cost.
Images and their original message blocks remain in the request unchanged.

`inputIssue` contains only these fixed enum fields. Unknown values are replaced
with null; if `stage` or `code` is invalid, the entire issue is null. No raw
input values, dynamic field paths, or exception text are copied.

| Field | Allowed values |
|---|---|
| `stage` | `source`, `budget` |
| `code` | `unsupported-image`, `image-access-unavailable`, `unsupported-file`, `unsupported-block`, `unsupported-role`, `invalid-field-type`, `invalid-json`, `empty-source`, `token-overflow` |
| `role` | `system`, `user`, `assistant`, `tool`, `unknown`, null |
| `blockType` | `text`, `reasoning`, `tool-call`, `image`, `file`, `unknown`, null |
| `field` | `messages`, `content`, `text`, `name`, `arguments`, `attachment`, `attachmentId`, `mediaType`, `bytes`, `width`, `height`, `originalDimensions`, `system`, `tools`, null |

For example, `reason: unsupported-input` with
`inputIssue: { stage: source, code: invalid-field-type, role: tool, blockType:
image, field: attachment }` identifies an invalid image-attachment field without
recording its value. `unsupported-image` identifies an image representation the
estimator cannot price; `image-access-unavailable` means the image access metadata
could not be resolved or had an invalid shape. `unsupported-file` identifies an unsupported file block.
These categories do not mean the model rejected the input. The native request
still proceeds unchanged when guidance is skipped. A missing diagnostic in an
older record must not be interpreted as proof of any particular input type.

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
