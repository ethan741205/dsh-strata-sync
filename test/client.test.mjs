import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { DEFAULT_SUMMARY_TEMPLATE } from '../src/summary.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { act } = React;
const source = fs.readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');

function status(overrides = {}) {
  return { providerId: 'strata', providers: [{ id: 'strata', apiKey: 'secret-that-must-not-render' }],
    outputTokens: null, autoSync: false, followLoadedModel: true, busy: false, settingsRevision: 'prefs-1',
    summaryGuidance:true,summaryPromptTemplate:DEFAULT_SUMMARY_TEMPLATE,defaultSummaryPromptTemplate:DEFAULT_SUMMARY_TEMPLATE,...overrides };
}
function preview(overrides = {}) {
  return { fingerprint: 'preview-one', busy: false,
    server: { model: { id: 'qwen-local', contextSource: 'slots.n_ctx' }, warnings: [] },
    budget: { contextWindow:32768,outputTokens:9830,summaryMaxTokens:4096,outputSource:'calculated',thresholdTokens: 18842, thresholdPercent: 57.5 },
    changes: [{ field: 'contextWindow', before: 65536, after: 32768 }, { field: 'headroomTokens', before: 65536, after: 4096 }],
    ...overrides };
}

async function mount({ initial = status(), previewResult = preview(), failEndpoint, initialStatusGate, storage = new Map(), locale = 'en' } = {}) {
  const localeListeners = new Set();
  const calls = [], intervals = new Map(), effectDisposers = [];
  let plugin, registration, component, current = initial, timerId = 0, unmounted = false, statusReads = 0;
  vm.runInNewContext(source, {
    window: { localStorage: {getItem: key => storage.get(key), setItem: (key,value) => storage.set(key,value)}, __ModuleLoader__: { load(entry) {
      assert.equal(typeof entry.id, 'string');
      plugin = entry.factory(name => { assert.equal(name, 'react'); return React; });
    } } },
    setInterval(callback, delay) { const id = ++timerId; intervals.set(id, { callback, delay }); return id; },
    clearInterval(id) { intervals.delete(id); },
  });
  assert.deepEqual([...plugin.inject].sort(), ['connection', 'locale', 'slots']);
  plugin.apply({
    locale: { getLocale: () => ({active: locale}), subscribe: fn => { localeListeners.add(fn); return () => localeListeners.delete(fn); } },
    connection: { rpc: { async call(channel, endpoint, payload) {
      const name = endpoint.replace(/^strata-sync\//, '');
      calls.push({ channel, name, payload });
      if (name === failEndpoint) return { ok: false, error: { message: 'Connection unavailable' } };
      if (name === 'status') {
        const response=current;
        if (statusReads++ === 0 && initialStatusGate) await initialStatusGate;
        return { ok: true, value: response };
      }
      if (name === 'configure') {
        if(payload.expectedRevision!==current.settingsRevision) return {ok:false,error:{code:'stale-settings',message:'Preferences changed.'}};
        const {expectedRevision,...changes}=payload;
        current={...current,...changes,settingsRevision:current.settingsRevision+'-saved'};
        return { ok: true, value: current };
      }
      if (name === 'preview') return { ok: true, value: previewResult };
      if (name === 'apply') return { ok: true, value: { applied: true, preview:previewResult,backupPath:'profile/backups/test.yml' } };
      throw new Error(`Unexpected endpoint: ${name}`);
    } } },
    effect(callback) { effectDisposers.push(callback()); },
    slots: {
      inject(name, callback) { assert.equal(name, 'settings.section'); return callback(); },
      register(metadata, card) { assert.equal(metadata.name, 'settings.section'); registration = metadata; component = card; return () => {}; },
    },
  });
  assert.equal(registration.id, 'strata-sync');
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(React.createElement(component, registration.inject())); });
  return {
    container, calls, intervals, localeListeners,
    setStatus(value) { current={...current,...value}; },
    setFailure(value) { failEndpoint=value; },
    async poll() { await act(async()=>{for(const {callback}of intervals.values())await callback();}); },
    async changeLanguage(value) { await act(async () => { locale=value; for(const fn of localeListeners) fn(); }); },
    button(label) { const button = [...container.querySelectorAll('button')].find(node => node.textContent === label); assert.ok(button, `Missing button ${label}`); return button; },
    async click(button) { await act(async () => { button.click(); }); },
    async setOutput(value) {
      const auto=container.querySelector('input[aria-label="Follow Strata output limit"]');
      if(auto?.checked) await act(async()=>{auto.click();});
      const input = container.querySelector('input[type=number]');
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
    },
    async setDivisor(value,testid='summary-output-divisor') {
      const input=container.querySelector(`[data-testid="${testid}"]`);
      await act(async()=>{
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,value);
        input.dispatchEvent(new window.Event('input',{bubbles:true}));
      });
    },
    async setPrompt(value) {
      const input=container.querySelector('[data-testid="summary-prompt"]');
      await act(async()=>{
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(input,value);
        input.dispatchEvent(new window.Event('input',{bubbles:true}));
      });
    },
    async unmount() {
      if (unmounted) return; unmounted = true;
      await act(async () => { root.unmount(); });
      effectDisposers.forEach(dispose => dispose?.()); container.remove();
    },
  };
}

test('fallback output help includes Strata ratio and both bounds in all locales', async t => {
  const ui=await mount();t.after(()=>ui.unmount());
  for(const locale of ['en','zh-Hans','zh-Hant']) {
    await ui.changeLanguage(locale);
    assert.match(ui.container.textContent,/30%/);
    assert.match(ui.container.textContent,/4,096/);
    assert.match(ui.container.textContent,/32,768/);
    assert.doesNotMatch(ui.container.textContent,/16,384/);
  }
});

test('native module loader registers an English Settings section without displaying credentials', async t => {
  const details = await mount(); t.after(() => details.unmount());
  assert.equal(details.container.querySelector('h2').textContent, 'dsh-strata-sync');
  assert.ok(!details.container.innerHTML.includes('secret-that-must-not-render'));
  await details.click(details.button('Check differences'));
  assert.match(details.container.textContent, /qwen-local/);
  assert.match(details.container.textContent, /slots.n_ctx/);
  assert.match(details.container.textContent, /57\.50/);
  assert.equal(details.container.querySelectorAll('tbody tr').length, 2);
  assert.match(details.container.textContent, /Choose an existing provider/);
});

test('all locales lead with a read-only check, then review before sync, with optional controls collapsed', async () => {
  for (const locale of ['en','zh-Hans','zh-Hant']) {
    const ui=await mount({locale,initial:status({summaryGuidance:false})});
    try {
      const workflow=ui.container.querySelector('[data-testid="sync-workflow"]');
      const optional=ui.container.querySelector('[data-testid="summary-target"]');
      const preferences=ui.container.querySelector('[data-testid="sync-preferences"]');
      const check=ui.container.querySelector('[data-testid="check-differences"]');
      const apply=ui.container.querySelector('[data-testid="sync-apply"] button');
      assert.equal(optional.open,false);
      assert.equal(preferences.open,false);
      assert.ok(workflow.compareDocumentPosition(optional)&window.Node.DOCUMENT_POSITION_FOLLOWING);
      assert.equal(workflow.querySelector('button'),check);
      assert.ok(check.classList.contains('primary'));
      assert.equal(apply.disabled,true);
      await ui.click(check);
      assert.equal(ui.calls.some(c=>c.name==='configure'||c.name==='apply'),false);
      const review=workflow.querySelector('[data-testid="sync-preview"]');
      assert.ok(review.querySelector('table'));
      assert.ok(review.compareDocumentPosition(apply)&window.Node.DOCUMENT_POSITION_FOLLOWING);
      assert.ok(apply.classList.contains('primary'));
      assert.equal(apply.disabled,false);
      await ui.click(optional.querySelector('summary'));
      assert.equal(optional.open,true);
      assert.ok(optional.querySelector('[data-testid="summary-guidance-toggle"]'));
      assert.ok(optional.querySelector('textarea'));
    } finally { await ui.unmount(); }
  }
});

test('omitted summary guidance defaults off in all locales without writing preferences', async t => {
  for (const locale of ['en','zh-Hans','zh-Hant']) {
    const ui=await mount({initial:status({summaryGuidance:undefined}),locale});
    try {
      assert.equal(ui.container.querySelector('[data-testid="summary-guidance-toggle"]').checked,false);
      await ui.click(ui.button(locale==='en'?'Check differences':locale==='zh-Hans'?'检查差异':'檢查差異'));
      assert.equal(ui.container.querySelector('[data-testid="summary-target-ceiling"]'),null);
      assert.equal(ui.container.querySelector('[data-testid="summary-guidance-off"]'),null);
      assert.equal(ui.calls.some(c=>c.name==='configure'||c.name==='apply'),false);
    } finally { await ui.unmount(); }
  }
});

test('explicitly enabled summary guidance uses two 50% bounds and preview does not write preferences or infer', async t => {
  const ui=await mount();t.after(()=>ui.unmount());
  const card=ui.container.querySelector('[data-testid="summary-target"]');
  assert.match(card.textContent,/Dynamic summary target/);
  assert.match(card.textContent,/Appended to DSH's native prompt/);
  assert.match(card.textContent,/DSH keeps its native summary behavior/);
  assert.equal(card.querySelectorAll('input,select,button,textarea').length,5);
  assert.equal(card.querySelector('[data-testid="summary-divisor"]'),null);
  assert.equal(card.querySelector('textarea').value,DEFAULT_SUMMARY_TEMPLATE);
  assert.equal(card.querySelector('[data-testid="summary-guidance-toggle"]').checked,true);
  assert.equal(card.querySelector('[data-testid="summary-output-divisor"]').value,'2');
  assert.equal(card.querySelector('[data-testid="summary-details"]').querySelectorAll('p').length,2);
  assert.equal(card.querySelector('[data-testid="summary-target-ceiling"]'),null);
  assert.equal(card.querySelector('details').open,false);
  await ui.click(ui.button('Check differences'));
  assert.match(card.querySelector('[data-testid="summary-target-ceiling"]').textContent,/2,048 tokens/);
  assert.match(card.textContent,/Target = floor\(min\(estimated effective output budget \/ O/);
  assert.equal(ui.calls.some(c=>c.name==='configure'||c.name==='apply'),false);
  assert.ok(ui.calls.every(c=>['status','preview'].includes(c.name)));
});

test('summary preview ceiling follows context and summary cap without claiming the actual target', async t => {
  const ui=await mount({previewResult:preview({budget:{contextWindow:65536,summaryMaxTokens:4096}})});t.after(()=>ui.unmount());
  await ui.click(ui.button('Check differences'));
  const card=ui.container.querySelector('[data-testid="summary-target"]');
  assert.match(card.querySelector('[data-testid="summary-target-ceiling"]').textContent,/2,048 tokens/);
  assert.match(card.textContent,/Maximum target for this preview/);
});

test('summary controls save only changed preferences with their revision and persist off state',async t=>{
  const ui=await mount();t.after(()=>ui.unmount());
  await ui.click(ui.container.querySelector('[data-testid="summary-guidance-toggle"]'));
  await ui.setDivisor('32');
  assert.equal(ui.button('Check differences').disabled,true);
  await ui.click(ui.button('Save preferences'));
  const saved=ui.calls.find(call=>call.name==='configure').payload;
  assert.deepEqual(JSON.parse(JSON.stringify(saved)),{summaryGuidance:false,summaryOutputDivisor:32,expectedRevision:'prefs-1'});
  assert.equal(ui.button('Save preferences').disabled,true);
  await ui.poll();
  assert.equal(ui.container.querySelector('[data-testid="summary-guidance-toggle"]').checked,false);
  assert.equal(ui.container.querySelector('[data-testid="summary-output-divisor"]').value,'32');
  await ui.click(ui.button('Check differences'));
  assert.equal(ui.container.querySelector('[data-testid="summary-target-ceiling"]'),null);
  assert.equal(ui.container.querySelector('[data-testid="summary-guidance-off"]'),null);
  assert.equal(ui.calls.some(call=>call.name==='apply'),false);
});

test('saved divisor changes the preview while the summary output bound still applies',async t=>{
  const ui=await mount();t.after(()=>ui.unmount());
  for(const [divisor,ceiling]of [['4','1,024'],['2','2,048'],['1','4,096']]){
    await ui.setDivisor(divisor);
    await ui.click(ui.button('Save preferences'));
    await ui.click(ui.button('Check differences'));
    assert.match(ui.container.querySelector('[data-testid="summary-target-ceiling"]').textContent,new RegExp(ceiling+' tokens'));
  }
  assert.equal(ui.calls.filter(call=>call.name==='configure').length,3);
});

test('preview below the summary target minimum shows native fallback in all locales',async t=>{
  const ui=await mount();t.after(()=>ui.unmount());
  await ui.setDivisor('256');
  await ui.click(ui.button('Save preferences'));
  await ui.click(ui.button('Check differences'));
  for(const [locale,message]of [
    ['en','The native summary prompt remains unchanged.'],
    ['zh-Hant','將保留原生摘要提示詞'],
    ['zh-Hans','将保留原生摘要提示词']]){
    await ui.changeLanguage(locale);
    assert.equal(ui.container.querySelector('[data-testid="summary-target-ceiling"]'),null);
    assert.ok(ui.container.querySelector('[data-testid="summary-target-native"]').textContent.includes(message));
  }
});

test('invalid divisors produce local errors and cannot be saved or sent to preview',async t=>{
  const ui=await mount();t.after(()=>ui.unmount());
  for(const value of ['','0','-1','0.5','9007199254740992']){
    await ui.setDivisor(value);
    assert.equal(ui.container.querySelector('[data-testid="summary-output-divisor"]').getAttribute('aria-invalid'),'true');
    assert.match(ui.container.querySelector('[role="alert"]').textContent,/finite divisor of at least 1/);
    assert.equal(ui.button('Save preferences').disabled,true);
    assert.equal(ui.button('Check differences').disabled,true);
    await ui.click(ui.button('Save preferences'));
    await ui.click(ui.button('Check differences'));
  }
  assert.equal(ui.calls.some(call=>call.name==='configure'||call.name==='preview'),false);
  await ui.setDivisor('32');
  assert.equal(ui.container.querySelector('[role="alert"]'),null);
  assert.equal(ui.button('Save preferences').disabled,false);
});

test('summary toggle, divisor and validation follow all three DSH locales',async t=>{
  const ui=await mount();t.after(()=>ui.unmount());
  await ui.setDivisor('0');
  for(const [locale,toggle,divisor,error]of [
    ['en','Enable summary guidance','Output budget divisor (estimated budget ÷ O)','Enter a finite divisor of at least 1'],
    ['zh-Hant','啟用摘要提示補充','摘要輸出除數（估算可用預算 ÷ O）','請輸入大於或等於 1'],
    ['zh-Hans','启用摘要提示补充','摘要输出除数（估算可用预算 ÷ O）','请输入大于或等于 1']]){
    await ui.changeLanguage(locale);
    assert.equal(ui.container.querySelector('[data-testid="summary-guidance-toggle"]').getAttribute('aria-label'),toggle);
    assert.equal(ui.container.querySelector('[data-testid="summary-output-divisor"]').getAttribute('aria-label'),divisor);
    assert.ok(ui.container.querySelector('[role="alert"]').textContent.includes(error));
  }
  assert.equal(ui.calls.some(call=>call.name==='configure'),false);
});

test('summary preferences follow external changes and reject conflicting dirty forms',async t=>{
  const ui=await mount();t.after(()=>ui.unmount());
  ui.setStatus({summaryGuidance:false,summaryOutputDivisor:32,settingsRevision:'prefs-2'});await ui.poll();
  assert.equal(ui.container.querySelector('[data-testid="summary-guidance-toggle"]').checked,false);
  assert.equal(ui.container.querySelector('[data-testid="summary-output-divisor"]').value,'32');
  assert.equal(ui.button('Save preferences').disabled,true);
  await ui.setDivisor('64');
  ui.setStatus({summaryOutputDivisor:8,settingsRevision:'prefs-3'});await ui.poll();
  assert.equal(ui.container.querySelector('[data-testid="summary-output-divisor"]').value,'64');
  assert.equal(ui.button('Save preferences').disabled,true);
  assert.match(ui.container.textContent,/Preferences changed in another window/);
  await ui.click(ui.button('Reload latest preferences'));
  assert.equal(ui.container.querySelector('[data-testid="summary-output-divisor"]').value,'8');
  assert.equal(ui.container.querySelector('[data-testid="summary-guidance-toggle"]').checked,false);
});

test('summary guidance follows DSH Chinese locales without changing preferences', async t => {
  const ui=await mount();t.after(()=>ui.unmount());
  await ui.click(ui.button('Check differences'));
  await ui.changeLanguage('zh-Hans');
  const card=ui.container.querySelector('[data-testid="summary-target"]');
  assert.match(card.textContent,/动态摘要目标/);
  assert.match(card.textContent,/附加于 DSH 原生提示词/);
  assert.match(card.textContent,/本次预览的目标上限：2,048 tokens/);
  assert.match(card.textContent,/无法应用时，沿用 DSH 原生摘要/);
  assert.equal(card.querySelector('[data-testid="summary-details"]').querySelectorAll('p').length,2);
  await ui.changeLanguage('zh-Hant');
  assert.match(card.textContent,/動態摘要目標/);
  assert.match(card.textContent,/附加於 DSH 原生提示詞/);
  assert.match(card.textContent,/本次預覽的目標上限：2,048 tokens/);
  assert.match(card.textContent,/無法套用時，沿用 DSH 原生摘要/);
  assert.equal(card.querySelector('[data-testid="summary-details"]').querySelectorAll('p').length,2);
  assert.equal(ui.calls.some(c=>c.name==='configure'||c.name==='apply'),false);
});

test('summary preview omits a numeric ceiling when its inputs are unavailable', async t => {
  const ui=await mount({previewResult:preview({budget:{summaryMaxTokens:4096}})});t.after(()=>ui.unmount());
  await ui.click(ui.button('Check differences'));
  const card=ui.container.querySelector('[data-testid="summary-target"]');
  assert.equal(card.querySelector('[data-testid="summary-target-ceiling"]'),null);
  assert.match(card.textContent,/DSH keeps its native summary behavior/);
  assert.doesNotMatch(card.textContent,/NaN|undefined|Infinity/);
});

test('compact summary card displays the exact editable prompt and hides detailed explanations',async t=>{
  const ui=await mount();t.after(()=>ui.unmount());
  const card=ui.container.querySelector('[data-testid="summary-target"]');
  const editor=card.querySelector('[data-testid="summary-prompt"]');
  const details=card.querySelector('[data-testid="summary-details"]');
  assert.equal(editor.value,DEFAULT_SUMMARY_TEMPLATE);
  assert.equal(editor.closest('details')===card,true);
  assert.equal(card.open,false);
  assert.equal(details.open,false);
  assert.equal(card.querySelectorAll(':scope > p').length,1);
  assert.equal(card.querySelector('[data-testid="summary-output-divisor"]').closest('details')===card,true);
  assert.equal(card.querySelector('[data-testid="summary-source-divisor"]').closest('details')===card,true);
  assert.equal(ui.button('Restore default prompt').disabled,true);
});

test('custom prompt saves literally, survives locale changes and can reset independently',async t=>{
  const ui=await mount();t.after(()=>ui.unmount());
  const custom='請在 {target} tokens 內摘要。 Keep <img src=x onerror=alert(1)> as plain text.';
  await ui.setPrompt(custom);
  assert.equal(ui.button('Check differences').disabled,true);
  assert.equal(ui.container.querySelector('[data-testid="summary-target"] img'),null);
  await ui.click(ui.button('Save preferences'));
  assert.deepEqual(JSON.parse(JSON.stringify(ui.calls.find(call=>call.name==='configure').payload)),{
    summaryPromptTemplate:custom,expectedRevision:'prefs-1',
  });
  for(const [locale,label,reset]of [
    ['en','Supplemental summary prompt','Restore default prompt'],
    ['zh-Hant','摘要補充提示詞','還原預設提示詞'],
    ['zh-Hans','摘要补充提示词','恢复默认提示词']]){
    await ui.changeLanguage(locale);
    const editor=ui.container.querySelector('[data-testid="summary-prompt"]');
    assert.equal(editor.value,custom);
    assert.equal(editor.getAttribute('aria-label'),label);
    assert.ok(ui.button(reset));
  }
  await ui.changeLanguage('en');
  await ui.setDivisor('32');
  await ui.click(ui.button('Restore default prompt'));
  assert.equal(ui.container.querySelector('[data-testid="summary-prompt"]').value,DEFAULT_SUMMARY_TEMPLATE);
  assert.equal(ui.container.querySelector('[data-testid="summary-output-divisor"]').value,'32');
  assert.equal(ui.calls.filter(call=>call.name==='configure').length,1);
  await ui.click(ui.button('Save preferences'));
  assert.deepEqual(JSON.parse(JSON.stringify(ui.calls.filter(call=>call.name==='configure').at(-1).payload)),{
    summaryOutputDivisor:32,summaryPromptTemplate:DEFAULT_SUMMARY_TEMPLATE,expectedRevision:'prefs-1-saved',
  });
});

test('invalid prompt templates are blocked locally in all locales without writes',async t=>{
  const ui=await mount();t.after(()=>ui.unmount());
  for(const value of ['', 'No target placeholder.', '{Target}', '{target}'+ 'x'.repeat(2041)]){
    await ui.setPrompt(value);
    assert.equal(ui.container.querySelector('[data-testid="summary-prompt"]').getAttribute('aria-invalid'),'true');
    assert.equal(ui.button('Save preferences').disabled,true);
    assert.equal(ui.button('Check differences').disabled,true);
    await ui.click(ui.button('Save preferences'));
  }
  for(const [locale,error]of [['en','include {target}'],['zh-Hant','並包含 {target}'],['zh-Hans','并包含 {target}']]){
    await ui.changeLanguage(locale);
    assert.ok(ui.container.querySelector('[role="alert"]').textContent.includes(error));
  }
  await ui.changeLanguage('en');
  await ui.setPrompt('Keep {target} tokens.');
  assert.equal(ui.container.querySelector('[role="alert"]'),null);
  assert.equal(ui.button('Save preferences').disabled,false);
  assert.equal(ui.calls.some(call=>call.name==='configure'||call.name==='preview'),false);
});

test('custom prompts participate in external preference conflicts',async t=>{
  const ui=await mount();t.after(()=>ui.unmount());
  ui.setStatus({summaryPromptTemplate:'External {target}.',settingsRevision:'prefs-2'});await ui.poll();
  assert.equal(ui.container.querySelector('[data-testid="summary-prompt"]').value,'External {target}.');
  await ui.setPrompt('My local {target}.');
  ui.setStatus({summaryPromptTemplate:'New external {target}.',settingsRevision:'prefs-3'});await ui.poll();
  assert.equal(ui.container.querySelector('[data-testid="summary-prompt"]').value,'My local {target}.');
  assert.equal(ui.button('Save preferences').disabled,true);
  await ui.click(ui.button('Reload latest preferences'));
  assert.equal(ui.container.querySelector('[data-testid="summary-prompt"]').value,'New external {target}.');
});

test('both divisors accept decimals and the preview uses the custom output divisor',async t=>{
  const ui=await mount();t.after(()=>ui.unmount());
  const pairs=[['summary-output-divisor','1.5'],['summary-source-divisor','2.5']];
  for(const [id,value]of pairs){
    assert.equal(ui.container.querySelector(`[data-testid="${id}"]`).getAttribute('step'),'any');
    await ui.setDivisor(value,id);
    assert.equal(ui.container.querySelector(`[data-testid="${id}"]`).getAttribute('aria-invalid'),'false');
  }
  await ui.click(ui.button('Save preferences'));
  assert.deepEqual(JSON.parse(JSON.stringify(ui.calls.find(call=>call.name==='configure').payload)),{
    summaryOutputDivisor:1.5,summarySourceDivisor:2.5,expectedRevision:'prefs-1',
  });
  await ui.click(ui.button('Check differences'));
  assert.match(ui.container.querySelector('[data-testid="summary-target-ceiling"]').textContent,/2,730 tokens/);
  assert.equal(ui.container.querySelector('[data-testid="summary-source-divisor"]').value,'2.5');
  for(const id of ['summary-output-divisor','summary-source-divisor']){
    await ui.setDivisor('0.5',id);
    assert.equal(ui.button('Save preferences').disabled,true);
    assert.equal(ui.container.querySelector(`[data-testid="${id}"]`).getAttribute('aria-invalid'),'true');
    await ui.setDivisor('2',id);
  }
});

test('dirty preferences must save before preview, and successful apply invalidates the preview', async t => {
  const ui = await mount(); t.after(() => ui.unmount());
  assert.equal(ui.button('Back up and sync').disabled, true);
  await ui.setOutput('9830');
  assert.equal(ui.button('Check differences').disabled, true);
  assert.equal(ui.button('Save preferences').disabled, false);
  await ui.click(ui.button('Check differences'));
  assert.equal(ui.calls.filter(call => call.name === 'preview').length, 0);
  await ui.click(ui.button('Save preferences'));
  assert.equal(ui.calls.find(call => call.name === 'configure').payload.outputTokens, 9830);
  assert.equal(ui.button('Check differences').disabled, false);
  await ui.click(ui.button('Check differences'));
  assert.equal(ui.button('Back up and sync').disabled, false);
  await ui.click(ui.button('Back up and sync'));
  assert.equal(ui.calls.find(call => call.name === 'apply').payload.fingerprint, 'preview-one');
  assert.equal(ui.button('Back up and sync').disabled, true);
  assert.match(ui.container.textContent, /backed up/i);
  assert.equal(ui.container.querySelector('table'), null);
});

test('editing a previewed budget invalidates it and blocks stale apply', async t => {
  const ui = await mount(); t.after(() => ui.unmount());
  await ui.click(ui.button('Check differences'));
  assert.equal(ui.button('Back up and sync').disabled, false);
  await ui.setOutput('4096');
  assert.equal(ui.button('Back up and sync').disabled, true);
  assert.equal(ui.container.querySelector('table'), null);
  await ui.click(ui.button('Back up and sync'));
  assert.equal(ui.calls.filter(call => call.name === 'apply').length, 0);
});

test('a concurrent sync write blocks apply until the write barrier clears', async t => {
  const ui=await mount({initial:status({busy:true}),previewResult:preview({busy:true})});t.after(()=>ui.unmount());
  await ui.click(ui.button('Check differences'));
  assert.equal(ui.button('Back up and sync').disabled,true);
  await ui.click(ui.button('Back up and sync'));
  assert.equal(ui.calls.filter(call=>call.name==='apply').length,0);
  ui.setStatus({busy:false});await ui.poll();
  assert.equal(ui.button('Back up and sync').disabled,false);
  await ui.click(ui.button('Back up and sync'));
  assert.equal(ui.calls.filter(call=>call.name==='apply').length,1);
});

test('RPC errors are visible and do not enable apply', async t => {
  const ui = await mount({ failEndpoint: 'preview' }); t.after(() => ui.unmount());
  await ui.click(ui.button('Check differences'));
  assert.equal(ui.container.querySelector('[role=alert]').textContent, 'Connection unavailable');
  assert.equal(ui.button('Back up and sync').disabled, true);
});

test('settings unmount clears the periodic refresh timer', async () => {
  const ui = await mount();
  assert.equal(ui.intervals.size, 1);
  assert.equal([...ui.intervals.values()][0].delay, 15000);
  await ui.unmount();
  assert.equal(ui.intervals.size, 0);
});

test('initial loading disables controls until authoritative preferences arrive', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const ui = await mount({ initialStatusGate: gate }); t.after(() => ui.unmount());
  for (const control of ui.container.querySelectorAll('input, select:not([aria-label="Language"]), button')) {
    assert.equal(control.disabled, true, `Control available before initial status: ${control.tagName}`);
  }
  assert.equal(ui.calls.length, 1);
  await act(async () => { release(); await gate; });
  for (const control of ui.container.querySelectorAll('input:not([type=number]), select')) assert.equal(control.disabled, false);
  assert.equal(ui.container.querySelector('input[type=number]').disabled,true);
  assert.equal(ui.button('Check differences').disabled, false);
  assert.equal(ui.button('Back up and sync').disabled, true);
});

async function changeLanguage(ui, value) { await ui.changeLanguage(value); }

test('Chinese locales translate previews and notices without changing synchronization preferences', async t => {
  const ui = await mount({ previewResult: preview({ server: { model: { id: 'qwen-local' }, warnings: ['SLOTS_CONTEXT_UNAVAILABLE'] } }) });
  t.after(() => ui.unmount());
  const initialCalls = ui.calls.length;
  await changeLanguage(ui, 'zh-Hant');
  assert.equal(ui.calls.length, initialCalls);
  await ui.click(ui.button('檢查差異'));
  assert.match(ui.container.textContent, /上下文視窗/);
  assert.match(ui.container.textContent, /執行中的 slot 未提供上下文大小/);
  await changeLanguage(ui, 'zh-Hans');
  assert.match(ui.container.textContent, /上下文窗口/);
  assert.match(ui.container.textContent, /运行中的 slot 未提供上下文大小/);
  assert.equal(ui.calls.filter(c => c.name === 'configure' || c.name === 'apply').length, 0);
  await ui.click(ui.button('备份并同步'));
  assert.match(ui.container.textContent, /已同步并备份/);
  await changeLanguage(ui, 'zh-Hant');
  assert.match(ui.container.textContent, /已同步並備份/);
});

test('DSH locale owns the UI; stale local preference is ignored, unknown locales use English', async t => {
  for (const [locale, label] of [['zh-TW','檢查差異'],['zh','检查差异'],['zh-HK','檢查差異'],['zh-CN','检查差异'],['fr','Check differences']]) {
    const ui = await mount({locale,storage:new Map([['strata-sync.language','en']])});
    assert.ok(ui.button(label));
    assert.equal(ui.container.querySelector('[aria-label="Language"]'),null);
    assert.doesNotMatch(ui.container.textContent,/community plugin|官方產品|官方产品/);
    assert.equal(ui.localeListeners.size,1);
    await ui.unmount();
    assert.equal(ui.localeListeners.size,0);
  }
});

test('unknown backend diagnostics remain intact with a localized label', async t => {
  const ui = await mount({ failEndpoint: 'preview' }); t.after(() => ui.unmount());
  await changeLanguage(ui, 'zh-Hans');
  await ui.click(ui.button('检查差异'));
  assert.equal(ui.container.querySelector('[role=alert]').textContent, '服务器诊断：Connection unavailable');
});

test('current DeepSeek preview shows exact verified choices in every locale', async t => {
  const efforts={off:'none',low:'low',medium:'medium',high:'high',max:'max'};
  const ui=await mount({previewResult:preview({
    server:{model:{id:'deepseek-v4.1-flash',capabilities:{input:['text','image'],reasoning:{family:'DeepSeek-V4.1-Flash'}}},warnings:[]},
    capabilityEdits:{reasoningEfforts:efforts},
    capabilityStatus:{input:'confirmed',reasoning:'confirmed'},
    changes:[{field:'reasoningEfforts',before:null,after:efforts}],
  })});t.after(()=>ui.unmount());
  await ui.click(ui.button('Check differences'));
  for(const [locale,label]of [['en','Reasoning levels'],['zh-Hans','推理等级'],['zh-Hant','推理等級']]) {
    await ui.changeLanguage(locale);
    assert.equal(ui.container.querySelector('[data-testid="reasoning-levels"]').textContent,`${label}: off / low / medium / high / max`);
    assert.doesNotMatch(ui.container.querySelector('[data-testid="reasoning-levels"]').textContent,/xhigh/);
    assert.match(ui.container.querySelector('table').textContent,/medium/);
  }
});

test('capability preservation warnings and labels are translated in both Chinese locales', async t => {
  const ui=await mount({previewResult:preview({server:{model:{id:'unknown',capabilities:{input:null,reasoning:null}},warnings:['INPUT_UNCONFIRMED','REASONING_UNCONFIRMED','REASONING_DEFAULT_CONFLICT']}})});t.after(()=>ui.unmount());
  await ui.click(ui.button('Check differences'));
  assert.match(ui.container.textContent,/Existing input settings are preserved/);
  await changeLanguage(ui,'zh-Hant');
  assert.match(ui.container.textContent,/無法確認 — 保留原設定/);
  assert.match(ui.container.textContent,/供應者預設推理等級/);
  await changeLanguage(ui,'zh-Hans');
  assert.match(ui.container.textContent,/无法确认 — 保留原设置/);
  assert.match(ui.container.textContent,/提供方默认推理等级/);
});

test('output provenance and fallback explanations are available in all three languages',async t=>{
 for(const [source,labels]of [['server',['Strata Server default','Strata Server 預設值','Strata Server 默认值']],['manual',['Manual override','手動覆寫','手动覆盖']],['calculated',['Automatic calculation','自動計算','自动计算']]]){
   const ui=await mount({previewResult:preview({budget:{outputTokens:8192,outputSource:source},server:{model:{id:'qwen',outputLimitStatus:'unlimited'}}})});t.after(()=>ui.unmount());
   await ui.click(ui.button('Check differences'));
   for(const [i,locale]of ['en','zh-Hant','zh-Hans'].entries()){await changeLanguage(ui,locale);assert.ok(ui.container.textContent.includes(labels[i]));}
   assert.match(ui.container.textContent,/服务器未设置固定输出上限/);
 }
});

test('untouched forms follow external preference changes without enabling Save',async t=>{
  const ui=await mount();t.after(()=>ui.unmount());
  await ui.click(ui.button('Check differences'));
  ui.setStatus({outputTokens:8192,settingsRevision:'prefs-2'});await ui.poll();
  assert.equal(ui.container.querySelector('input[type=number]').value,'8192');
  assert.equal(ui.container.querySelector('input[aria-label="Follow Strata output limit"]').checked,false);
  assert.equal(ui.button('Save preferences').disabled,true);
  assert.equal(ui.container.querySelector('table'),null);
  await ui.click(ui.button('Save preferences'));
  assert.equal(ui.calls.filter(c=>c.name==='configure').length,0);
});

test('an unselected provider stays untouched when external preferences arrive',async t=>{
  const ui=await mount({initial:status({providerId:''})});t.after(()=>ui.unmount());
  assert.equal(ui.container.querySelector('select').value,'');
  ui.setStatus({outputTokens:8192,settingsRevision:'prefs-2'});await ui.poll();
  assert.equal(ui.container.querySelector('input[type=number]').value,'8192');
  assert.doesNotMatch(ui.container.textContent,/Preferences changed in another window/);
  assert.equal(ui.button('Save preferences').disabled,true);
});

test('locally edited forms report external conflicts and require explicit reload',async t=>{
  const ui=await mount();t.after(()=>ui.unmount());
  await ui.setOutput('4096');
  ui.setStatus({outputTokens:8192,settingsRevision:'prefs-2'});await ui.poll();
  assert.equal(ui.container.querySelector('input[type=number]').value,'4096');
  assert.equal(ui.button('Save preferences').disabled,true);
  assert.equal(ui.button('Check differences').disabled,true);
  assert.match(ui.container.textContent,/Preferences changed in another window/);
  await ui.click(ui.button('Reload latest preferences'));
  assert.equal(ui.container.querySelector('input[type=number]').value,'8192');
  assert.equal(ui.button('Save preferences').disabled,true);
  assert.equal(ui.button('Check differences').disabled,false);
});

test('configure sends only edited fields with the baseline revision and handles unseen conflicts',async t=>{
  const ui=await mount();t.after(()=>ui.unmount());
  await ui.setOutput('4096');
  ui.setStatus({autoSync:true,settingsRevision:'prefs-2'});
  await ui.click(ui.button('Save preferences'));
  const payload=ui.calls.find(c=>c.name==='configure').payload;
  assert.equal(payload.expectedRevision,'prefs-1');
  assert.equal(payload.outputTokens,4096);
  assert.equal(Object.keys(payload).length,2);
  assert.match(ui.container.textContent,/Preferences changed in another window/);
  assert.equal(ui.button('Save preferences').disabled,true);
  await ui.click(ui.button('Reload latest preferences'));
  await ui.setOutput('4096');await ui.click(ui.button('Save preferences'));
  assert.equal(ui.calls.filter(c=>c.name==='configure')[1].payload.expectedRevision,'prefs-2');
  assert.equal(ui.button('Save preferences').disabled,true);
});

test('initial status failure recovers on refresh and initializes authoritative preferences',async t=>{
  const ui=await mount({failEndpoint:'status',initial:status({outputTokens:8192,autoSync:true})});t.after(()=>ui.unmount());
  assert.match(ui.container.textContent,/Connection unavailable/);
  assert.equal(ui.button('Check differences').disabled,true);
  ui.setFailure(undefined);await ui.poll();
  assert.equal(ui.container.querySelector('input[type=number]').value,'8192');
  assert.equal(ui.container.querySelector('[role=alert]'),null);
  assert.equal(ui.button('Check differences').disabled,false);
  assert.equal(ui.button('Save preferences').disabled,true);
});

test('automatic output mode is primary and manual override is under Advanced settings',async t=>{
  const ui=await mount({previewResult:preview({budget:{contextWindow:32768,outputTokens:4096,outputSource:'manual'},server:{model:{id:'qwen',serverOutputTokens:8192,outputLimitStatus:'server'}}})});t.after(()=>ui.unmount());
  assert.equal(ui.container.querySelector('input[aria-label="Follow Strata output limit"]').checked,true);
  const input=ui.container.querySelector('input[type=number]');
  assert.equal(input.disabled,true);assert.equal(input.closest('details').open,false);
  await ui.setOutput('4096');assert.equal(input.closest('details').open,true);
  await ui.click(ui.button('Save preferences'));await ui.click(ui.button('Check differences'));
  assert.match(ui.container.textContent,/Server-provided output limit/);
  assert.match(ui.container.textContent,/Effective output limit/);
  assert.match(ui.container.textContent,/8,192/);assert.match(ui.container.textContent,/4,096/);
  await ui.click(ui.container.querySelector('input[aria-label="Follow Strata output limit"]'));
  await ui.click(ui.button('Save preferences'));
  assert.equal(ui.calls.filter(c=>c.name==='configure').at(-1).payload.outputTokens,null);
});

test('successful sync retains a readonly result including provenance and backup',async t=>{
  const ui=await mount({previewResult:preview({capabilityStatus:{input:'confirmed',reasoning:'preserved'}})});t.after(()=>ui.unmount());
  await ui.click(ui.button('Check differences'));await ui.click(ui.button('Back up and sync'));
  const result=ui.container.querySelector('[data-testid="sync-result"]');
  assert.ok(result);assert.match(result.textContent,/qwen-local/);assert.match(result.textContent,/32,768/);
  assert.match(result.textContent,/9,830/);assert.match(result.textContent,/Automatic calculation/);
  assert.match(result.textContent,/profile\/backups\/test.yml/);assert.match(result.textContent,/Backup created/);
  assert.equal(result.querySelector('input,button,select'),null);
  assert.equal(ui.button('Back up and sync').disabled,true);
  await ui.poll();assert.ok(ui.container.querySelector('[data-testid="sync-result"]'));
});

test('last synchronization result is restored from status after reopening settings',async t=>{
  const ui=await mount({initial:status({lastApplied:{at:'2026-10-30T01:00:00Z',modelId:'deepseek',budget:{contextWindow:32768,outputTokens:8192,outputSource:'server'},serverOutputTokens:8192,outputLimitStatus:'server',capabilityStatus:{input:'confirmed',reasoning:'confirmed'},backupPath:'profile/backups/latest.yml'}})});t.after(()=>ui.unmount());
  const result=ui.container.querySelector('[data-testid="sync-result"]');
  assert.match(result.textContent,/deepseek/);assert.match(result.textContent,/8,192/);
  assert.match(result.textContent,/All synchronized settings are confirmed and aligned/);
});

test('partial alignment lists preserved fields in all locales instead of claiming full alignment',async t=>{
  const ui=await mount({previewResult:preview({changes:[],capabilityStatus:{input:'confirmed',reasoning:'preserved'}})});t.after(()=>ui.unmount());
  await ui.click(ui.button('Check differences'));
  for(const [locale,text]of [['en','Preserved without confirmation: 1 item — Reasoning levels'],['zh-Hant','未能確認，保留原值：1 項 — 推理等級'],['zh-Hans','无法确认，保留原值：1 项 — 推理等级']]){
    await ui.changeLanguage(locale);
    assert.ok(ui.container.querySelector('[data-testid="alignment"]').textContent.includes(text));
  }
  assert.doesNotMatch(ui.container.textContent,/所有同步项均已确认并对齐/);
});

test('an older delayed status response cannot replace a newer periodic response',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const ui=await mount({initialStatusGate:gate});t.after(()=>ui.unmount());
  ui.setStatus({outputTokens:8192,settingsRevision:'prefs-new'});await ui.poll();
  assert.equal(ui.container.querySelector('input[type=number]').value,'8192');
  await act(async()=>{release();await gate;});
  assert.equal(ui.container.querySelector('input[type=number]').value,'8192');
  await ui.setOutput('4096');await ui.click(ui.button('Save preferences'));
  assert.equal(ui.calls.find(c=>c.name==='configure').payload.expectedRevision,'prefs-new');
});

test('newer sync results from another window replace the local result on refresh',async t=>{
  const ui=await mount();t.after(()=>ui.unmount());
  await ui.click(ui.button('Check differences'));await ui.click(ui.button('Back up and sync'));
  ui.setStatus({lastApplied:{at:'2099-01-01T00:00:00Z',modelId:'newer-model',budget:{contextWindow:65536,outputTokens:16384,outputSource:'server'},capabilityStatus:{input:'confirmed',reasoning:'confirmed'},backupPath:'newer.yml'}});
  await ui.poll();
  const result=ui.container.querySelector('[data-testid="sync-result"]');
  assert.match(result.textContent,/newer-model/);assert.match(result.textContent,/65,536/);assert.match(result.textContent,/newer.yml/);
  assert.doesNotMatch(result.textContent,/qwen-local/);
});
