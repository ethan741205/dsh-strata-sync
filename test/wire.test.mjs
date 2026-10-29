import test from 'node:test';
import assert from 'node:assert/strict';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import { planModelCapabilities } from '../src/core.mjs';

for (const templateHash of ['12827f24b742ea4e80cdc12dbcf9622227056b9f797252a3149263d4f9aaadce','6f9bd1f87d9dad376b4c79683934b4254396d826ae514ab0244efa904ce1d1a4']) {
  const r=planModelCapabilities(['text'],{verifiedStrata:true,modelMatched:true,templateHash}).reasoning;
  for (const effort of Object.keys(r.efforts)) test(`${r.family}: ${effort} sends the verified native thinking fields`, async () => {
    const realFetch=globalThis.fetch;
    let body;
    try {
      globalThis.fetch=async (_url,init)=>{
        body=JSON.parse(init.body);
        return new Response('data: '+JSON.stringify({id:'mock',object:'chat.completion.chunk',created:0,model:'mock',choices:[{index:0,delta:{role:'assistant',content:'OK'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
      };
      const model={id:'mock',name:'Mock',api:'openai-completions',provider:'strata-test',baseUrl:'http://127.0.0.1:1/v1',
        reasoning:true,thinkingLevelMap:Object.fromEntries(['off','minimal','low','medium','high','xhigh','max'].map(l=>[l,r.efforts[l]??null])),
        input:['text'],contextWindow:32768,maxTokens:9830,cost:{input:0,output:0,cacheRead:0,cacheWrite:0},compat:r.compat};
      const events=[];
      for await (const event of streamSimple(model,{messages:[{role:'user',content:'Mock only',timestamp:0}]},{apiKey:'dummy',reasoning:effort,maxTokens:16})) events.push(event.type);
      assert.ok(!events.includes('error'));assert.ok(events.includes('done'));
      assert.equal(body.chat_template_kwargs.thinking,effort!=='off');
      assert.equal(body.chat_template_kwargs.enable_thinking,effort!=='off');
      assert.equal(body.chat_template_kwargs.reasoning_effort,effort==='off'?undefined:r.efforts[effort]);
      assert.equal(body.reasoning_effort,undefined);
    } finally {globalThis.fetch=realFetch;}
  });
}
