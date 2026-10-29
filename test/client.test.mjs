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
    outputTokens: null, autoSync: false, followLoadedModel: true, busy: false, ...overrides };
}
function preview(overrides = {}) {
  return { fingerprint: 'preview-one', busy: false,
    server: { model: { id: 'qwen-local', contextSource: 'slots.n_ctx' }, warnings: [] },
    budget: { thresholdTokens: 18842, thresholdPercent: 57.5 },
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
        if (statusReads++ === 0 && initialStatusGate) await initialStatusGate;
        return { ok: true, value: current };
      }
      if (name === 'configure') { current = { ...current, ...payload }; return { ok: true, value: current }; }
      if (name === 'preview') return { ok: true, value: previewResult };
      if (name === 'apply') return { ok: true, value: { applied: true } };
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
    async changeLanguage(value) { await act(async () => { locale=value; for(const fn of localeListeners) fn(); }); },
    button(label) { const button = [...container.querySelectorAll('button')].find(node => node.textContent === label); assert.ok(button, `Missing button ${label}`); return button; },
    async click(button) { await act(async () => { button.click(); }); },
    async setOutput(value) {
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
  assert.equal(details.container.querySelector('h2').textContent, 'Strata Sync');
  assert.ok(!details.container.innerHTML.includes('secret-that-must-not-render'));
  await details.click(details.button('Check differences'));
  assert.match(details.container.textContent, /qwen-local/);
  assert.match(details.container.textContent, /slots.n_ctx/);
  assert.match(details.container.textContent, /57\.50/);
  assert.equal(details.container.querySelectorAll('tbody tr').length, 2);
  assert.match(details.container.textContent, /Choose an existing provider/);
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

test('busy status or a busy preview blocks apply', async t => {
  for (const options of [{ initial: status({ busy: true }) }, { previewResult: preview({ busy: true }) }]) {
    const ui = await mount(options); t.after(() => ui.unmount());
    await ui.click(ui.button('Check differences'));
    assert.equal(ui.button('Back up and sync').disabled, true);
    await ui.click(ui.button('Back up and sync'));
    assert.equal(ui.calls.filter(call => call.name === 'apply').length, 0);
  }
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
  for (const control of ui.container.querySelectorAll('input, select')) assert.equal(control.disabled, false);
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
