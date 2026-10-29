import test from 'node:test';
import assert from 'node:assert/strict';
import { planModelCapabilities, discoverStrata } from '../src/core.mjs';
import { capabilityChanges, mergeCapabilityEdits } from '../src/plugin.mjs';
const qwen = '12827f24b742ea4e80cdc12dbcf9622227056b9f797252a3149263d4f9aaadce';
const deepseek = '6f9bd1f87d9dad376b4c79683934b4254396d826ae514ab0244efa904ce1d1a4';
const proof = templateHash => ({ verifiedStrata: true, modelMatched: true, templateHash });

test('input types are synchronized only from a complete supported server declaration', () => {
  assert.deepEqual(planModelCapabilities(['image','text']).input, ['text','image']);
  assert.deepEqual(planModelCapabilities(['text']).input, ['text']);
  for (const value of [undefined, null, [], ['image'], ['text','audio'], ['text','text'], 'text']) {
    assert.equal(planModelCapabilities(value).input, null);
    assert.ok(planModelCapabilities(value).warnings.includes('INPUT_UNCONFIRMED'));
  }
});

test('reviewed templates offer exact native effort names, including explicit off', () => {
  const q = planModelCapabilities(['text'], proof(qwen)).reasoning;
  const d = planModelCapabilities(['text'], proof(deepseek)).reasoning;
  assert.deepEqual(q.efforts, { off:'none', low:'low', medium:'medium', xhigh:'xhigh' });
  assert.deepEqual(d.efforts, { off:'none', low:'low', high:'high', max:'max' });
  for (const r of [q,d]) {
    assert.equal(r.compat.thinkingFormat, 'chat-template');
    assert.deepEqual(r.compat.chatTemplateKwargs.enable_thinking, { $var:'thinking.enabled' });
    assert.deepEqual(r.compat.chatTemplateKwargs.reasoning_effort, { $var:'thinking.effort', omitWhenOff:true });
  }
});

test('missing identity, unknown templates and mismatched models never infer reasoning from names', () => {
  for (const evidence of [{}, proof('unknown'), {...proof(qwen),verifiedStrata:false}, {...proof(qwen),modelMatched:false}]) {
    const c = planModelCapabilities(['text'], evidence);
    assert.equal(c.reasoning, null);
    assert.ok(c.warnings.includes('REASONING_UNCONFIRMED'));
  }
});

test('model mapping preserves unrelated compatibility and does not set a reasoning default', () => {
  const capabilities = planModelCapabilities(['text','image'], proof(qwen));
  const route = {reasoning:'low',compat:{chatTemplateKwargs:{preserve_thinking:true}}};
  const model = {compat:{supportsStore:false,chatTemplateKwargs:{custom_flag:true}}};
  const {edits,warnings} = capabilityChanges(capabilities,route,model);
  assert.deepEqual(warnings, []);
  assert.equal(edits.compat.supportsStore, undefined);
  assert.equal(edits.compat.chatTemplateKwargs.custom_flag, undefined);
  const merged = mergeCapabilityEdits(model,route,edits);
  assert.equal(merged.compat.supportsStore, false);
  assert.equal(merged.compat.chatTemplateKwargs.preserve_thinking, true);
  assert.equal(merged.compat.chatTemplateKwargs.custom_flag, true);
  assert.equal(edits.reasoning, undefined);
  assert.equal(route.reasoning, 'low');
});

test('an incompatible explicit provider default preserves reasoning but still syncs input', () => {
  const {edits,warnings} = capabilityChanges(planModelCapabilities(['text'],proof(deepseek)),{reasoning:'medium'});
  assert.deepEqual(edits, {input:['text']});
  assert.deepEqual(warnings, ['REASONING_DEFAULT_CONFLICT']);
  assert.deepEqual(capabilityChanges(planModelCapabilities(undefined),{}).edits, {});
});

test('discovery never exposes raw templates or private props and degrades on mismatched props', async () => {
  const data = [{id:'qwen3.8-flash-next',status:'loaded',meta:{n_ctx:32768},architecture:{input_modalities:['text','image']}}];
  const result = await discoverStrata('https://strata.test', '', {fetch:async url => new Response(JSON.stringify(
    url.endsWith('/models') ? {data} : url.endsWith('/slots') ? [{n_ctx:32768}] :
      {model_alias:'wrong',build_info:'Strata 0.2.7',chat_template:'private template text',model_path:'/private/path'}))});
  assert.deepEqual(result.model.capabilities.input,['text','image']);
  assert.equal(result.model.capabilities.reasoning,null);
  assert.ok(!JSON.stringify(result).includes('private'));
});
