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

async function mount({ initial = status(), previewResult = preview(), failEndpoint, initialStatusGate } = {}) {
  const calls = [], intervals = new Map(), effectDisposers = [];
  let plugin, registration, component, current = initial, timerId = 0, unmounted = false, statusReads = 0;
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load(entry) {
      assert.equal(typeof entry.id, 'string');
      plugin = entry.factory(name => { assert.equal(name, 'react'); return React; });
    } } },
    setInterval(callback, delay) { const id = ++timerId; intervals.set(id, { callback, delay }); return id; },
    clearInterval(id) { intervals.delete(id); },
  });
  assert.deepEqual([...plugin.inject].sort(), ['connection', 'slots']);
  plugin.apply({
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
    container, calls, intervals,
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
  assert.ok(!/[\u3400-\u9fff]/u.test(details.container.textContent), 'Settings UI should use English text');
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
  for (const control of ui.container.querySelectorAll('input, select, button')) {
    assert.equal(control.disabled, true, `Control available before initial status: ${control.tagName}`);
  }
  assert.equal(ui.calls.length, 1);
  await act(async () => { release(); await gate; });
  for (const control of ui.container.querySelectorAll('input, select')) assert.equal(control.disabled, false);
  assert.equal(ui.button('Check differences').disabled, false);
  assert.equal(ui.button('Back up and sync').disabled, true);
});
