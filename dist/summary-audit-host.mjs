import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSummaryAudit } from './summary-audit.mjs';

/** Resolve from the launcher's installation, never from a plugin's private
 * node_modules. Session's private record method requires this exact module.
 */
async function loadHostApi(ctx) {
  const anchor = ctx.get('profileContext')?.installAnchor;
  if (typeof anchor !== 'string' || !isAbsolute(anchor)) throw new Error('Native session installation is unavailable.');
  const filename = createRequire(anchor).resolve('@deepseek-ai/dsh-session');
  return import(pathToFileURL(filename).href);
}

/** Optional child scope: missing Sessions must not disable model syncing or
 * summary guidance. ready settles after the first binding attempt (or owner
 * disposal); it can remain pending while Sessions is absent. Requests never
 * await it. loadApi is a narrow test seam, not a user setting.
 */
export function installNativeSummaryAudit(ctx, pluginVersion, loadApi = loadHostApi) {
  let sink;
  let closed = false;
  let warned = false;
  let generation = 0;
  let settleReady;
  const ready = new Promise(resolve => { settleReady = resolve; });
  function warn() {
    if (warned || closed) return;
    warned = true;
    try { ctx.logger?.warn?.('dsh-strata-sync: native summary audit is unavailable or incomplete; summary processing is unchanged.'); } catch {}
  }
  const proxy = {
    ready,
    begin(options) {
      if (closed) return undefined;
      try {
        if (!sink) { warn(); return undefined; }
        return sink.begin(options);
      } catch { warn(); return undefined; }
    },
  };
  try {
    ctx.effect(() => () => { closed = true; generation++; sink = undefined; settleReady(); }, 'strata-sync: native audit binding lifetime');
    if (typeof ctx.inject !== 'function') { warn(); settleReady(); return proxy; }
    ctx.inject(['sessions'], async child => {
      const epoch = ++generation;
      let disposed = false;
      try {
        child.effect(() => () => {
          disposed = true;
          if (generation === epoch) { generation++; sink = undefined; }
          settleReady();
        }, 'strata-sync: native audit Sessions binding');
        if (typeof child.sessions?.get !== 'function') throw new Error('Native Sessions is unavailable.');
        const api = await loadApi(child);
        if (closed || disposed || generation !== epoch) return;
        if (typeof api?.Session !== 'function' || typeof api?.appendPluginRecord !== 'function') throw new Error('Native plugin records are unavailable.');
        sink = createSummaryAudit(child, {
          pluginVersion,
          onWarning: warn,
          appendPluginRecord(session, type, data) {
            if (!(session instanceof api.Session)) throw new Error('Native Session identity does not match.');
            return api.appendPluginRecord(session, type, data);
          },
        });
      } catch {
        if (!closed && !disposed && generation === epoch) warn();
      } finally { settleReady(); }
    });
  } catch { warn(); settleReady(); }
  return proxy;
}
