# Verified model capabilities

Capability synchronization uses the preview, backup, rollback and coordinated configuration-write workflow. It does not send generation requests or alter Strata Server.

## Input types

The selected `/v1/models` row must explicitly report `architecture.input_modalities` as `text` or `text` plus `image`. The plugin writes the equivalent DSH model `input` array. It does not assume that a model family always has vision enabled. Missing, malformed, duplicated or unsupported modalities preserve the existing field; a new model leaves it unspecified.

## Reasoning choices

The optional, authenticated `GET /props?model=...` response must identify Strata in `build_info` (including the DeepSeek engine's `Strata ds4-0.1` format), match the selected canonical model or one of its validated loaded aliases in `model_alias`, and return a reviewed `chat_template`. Aliases must resolve through `alias_of` to that loaded canonical text model. An alias belonging to another model is not accepted. The SHA-256 fingerprint is calculated after CRLF-to-LF normalization. Names, quantization labels, and a template merely mentioning reasoning are insufficient. Only matching fingerprints enable automatic reasoning synchronization.

| Reviewed template | SHA-256 | DSH selection → template value |
|---|---|---|
| Qwen3.8-Flash-Next, checked on Huihui v2 UD-IQ4_XS | `12827f24b742ea4e80cdc12dbcf9622227056b9f797252a3149263d4f9aaadce` | `low → low`, `medium → medium`, `xhigh → xhigh` |
| DeepSeek-V4.1-Flash, current served template | `06cada875e3a04665f9cf47deae9ef32e16ede2c6511205a4031c8b48140d01b` | `low → low`, `medium → medium`, `high → high`, `max → max` |
| DeepSeek-V4.1-Flash, legacy pack template | `6f9bd1f87d9dad376b4c79683934b4254396d826ae514ab0244efa904ce1d1a4` | `low → low`, `high → high`, `max → max` |

Every profile includes `off` as an explicit thinking-disabled choice. The current DeepSeek template maps low/medium/high/max to 50/62/75/100 internally and defaults to high. The legacy template lacks named `medium`; this is a template-version difference, not a quantization policy. Numeric 1–100 efforts are not exposed because DSH's selector uses named levels. No duplicate high/max aliases are added to Qwen.

Quantization names do not select effort options. Qwen variants sharing its reviewed template receive `off / low / medium / xhigh`; DeepSeek variants sharing the current served template receive `off / low / medium / high / max`. The same rule applies to Huihui variants. Unknown templates preserve existing settings rather than guessing from a familiar model or quantization label.

Inspection date: 2026-10-30. Qwen and the current DeepSeek template were read from the running server's `/props`; the legacy DeepSeek template was inspected from installed packs. The current server reports `Strata ds4-0.1`, the loaded canonical DeepSeek ID, 65,536 context and unlimited default output. Metadata-only discovery was verified against that snapshot. This verifies template support, not model output quality. Template bytes and private configuration are not distributed with the plugin. Any changed or unreviewed template keeps existing reasoning settings, even if its filename is familiar.

## Native DSH dispatch

DSH's `reasoningEfforts` maps offered selector keys to wire values. Model-level `compat.thinkingFormat: chat-template` uses native `chatTemplateKwargs` placeholders:

```json
{
  "thinking": { "$var": "thinking.enabled" },
  "enable_thinking": { "$var": "thinking.enabled" },
  "reasoning_effort": { "$var": "thinking.effort", "omitWhenOff": true }
}
```

`supportsReasoningEffort: false` prevents a competing top-level effort dispatch. When off is selected, both thinking booleans are false and the effort is omitted. When enabled, the matching template value is sent alongside true. This matters for DeepSeek: an effort value by itself does not establish the template's thinking flag.

The plugin merges these reserved dispatch settings into the selected model, preserving unrelated compatibility fields and custom template kwargs. It does not set the provider's default effort, rewrite existing conversations, or change the current session selection. If an explicit provider default is not among verified choices, reasoning updates are skipped with a warning; confirmed input types can still sync. Resolve such a default in DSH Models before applying reasoning synchronization. Existing sessions holding an unsupported selection should start a new conversation or choose a supported level.

Metadata, capability changes and the current configuration participate in stale-preview detection. Raw `/props`, template text and server paths never cross into the plugin UI or saved public diagnostics. Optional metadata failures only skip capability fields; required model/context failures still block synchronization.

## References

- [Strata model metadata and props](https://github.com/Niko1221/Strata/blob/main/serve/server.py)
- [Strata template handling and effort conversion](https://github.com/Niko1221/Strata/blob/main/serve/frontend.py)
- [DSH custom model schema](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-pi-ai/src/config.ts)
- [DSH reasoning selector and dispatch mapping](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-pi-ai/src/catalog.ts)

The broad Strata parser vocabulary is not treated as proof of a particular model template's supported levels.
