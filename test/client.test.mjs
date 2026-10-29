import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

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
    outputTokens: null, autoSync: false, followLoadedModel: true, busy: false, settingsRevision: 'prefs-1', ...overrides };
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
    async unmount() {
      if (unmounted) return; unmounted = true;
      await act(async () => { root.unmount(); });
      effectDisposers.forEach(dispose => dispose?.()); container.remove();
    },
  };
}

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

test('summary guidance shows a preview ceiling without adding preferences or inference requests', async t => {
  const ui=await mount();t.after(()=>ui.unmount());
  const card=ui.container.querySelector('[data-testid="summary-target"]');
  assert.match(card.textContent,/Dynamic summary target/);
  assert.match(card.textContent,/appends one sentence/);
  assert.match(card.textContent,/not a guaranteed length or an optimal value/);
  assert.equal(card.querySelectorAll('input,select,button').length,0);
  assert.equal(card.querySelector('[data-testid="summary-target-ceiling"]'),null);
  assert.equal(card.querySelector('details').open,false);
  await ui.click(ui.button('Check differences'));
  assert.match(card.querySelector('[data-testid="summary-target-ceiling"]').textContent,/2,048 tokens/);
  assert.match(card.textContent,/System prompts and tool schemas are excluded/);
  assert.match(card.textContent,/smaller of the verified Strata window and the existing DSH model window/);
  assert.match(card.textContent,/preview ceiling assumes the proposed budgets/);
  assert.match(card.textContent,/Unpriced image\/file attachments, cancellation or a disabled plugin/);
  assert.equal(ui.calls.some(c=>c.name==='configure'||c.name==='apply'),false);
  assert.ok(ui.calls.every(c=>['status','preview'].includes(c.name)));
});

test('summary preview ceiling follows context and summary cap without claiming the actual target', async t => {
  const ui=await mount({previewResult:preview({budget:{contextWindow:65536,summaryMaxTokens:4096}})});t.after(()=>ui.unmount());
  await ui.click(ui.button('Check differences'));
  const card=ui.container.querySelector('[data-testid="summary-target"]');
  assert.match(card.querySelector('[data-testid="summary-target-ceiling"]').textContent,/2,048 tokens/);
  assert.match(card.textContent,/actual target may be lower/);
});

test('summary guidance follows DSH Chinese locales without changing preferences', async t => {
  const ui=await mount();t.after(()=>ui.unmount());
  await ui.click(ui.button('Check differences'));
  await ui.changeLanguage('zh-Hans');
  const card=ui.container.querySelector('[data-testid="summary-target"]');
  assert.match(card.textContent,/动态摘要目标/);
  assert.match(card.textContent,/后补充一句/);
  assert.match(card.textContent,/本次预览的目标上限：2,048 tokens/);
  assert.match(card.textContent,/不代表最佳值/);
  assert.match(card.textContent,/已有模型窗口的较小值/);
  assert.match(card.textContent,/无法估算图片／文件附件用量/);
  await ui.changeLanguage('zh-Hant');
  assert.match(card.textContent,/動態摘要目標/);
  assert.match(card.textContent,/後補充一句/);
  assert.match(card.textContent,/本次預覽的目標上限：2,048 tokens/);
  assert.match(card.textContent,/系統提示詞與工具定義/);
  assert.match(card.textContent,/既有模型視窗的較小值/);
  assert.match(card.textContent,/無法估算圖片／檔案附件用量/);
  assert.equal(ui.calls.some(c=>c.name==='configure'||c.name==='apply'),false);
});

test('summary preview omits a numeric ceiling when its inputs are unavailable', async t => {
  const ui=await mount({previewResult:preview({budget:{summaryMaxTokens:4096}})});t.after(()=>ui.unmount());
  await ui.click(ui.button('Check differences'));
  const card=ui.container.querySelector('[data-testid="summary-target"]');
  assert.equal(card.querySelector('[data-testid="summary-target-ceiling"]'),null);
  assert.match(card.textContent,/DSH uses its original prompt/);
  assert.doesNotMatch(card.textContent,/NaN|undefined|Infinity/);
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

test('busy status blocks apply and latest idle status unlocks a busy preview', async t => {
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
