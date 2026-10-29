/* Browser entry: DSH's own module loader provides React and services. */
window.__ModuleLoader__.load({
  id: '@ethan741205/dsh-strata-sync',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    const labels = {
      contextWindow: 'Context window', outputTokens: 'Response output limit', headroomTokens: 'Compaction headroom',
      summaryMaxTokens: 'Summary output limit', thresholdTokens: 'Compaction threshold', retainTokens: 'Recent conversation retention',
      model: 'Model', modelId: 'Model', defaultModel: 'Default model',
      thresholdRatio: 'Compaction ratio ceiling', retainRatio: 'Recent conversation retention ratio',
    };
    const css = `.strata-sync{max-width:880px;color:inherit;font:inherit;line-height:1.6}.strata-sync *{box-sizing:border-box}.strata-sync header{border-bottom:1px solid #8884;padding-bottom:16px;margin-bottom:20px}.strata-sync h2{margin:0;font-size:22px}.strata-sync .ss-muted{opacity:.72;font-size:13px}.strata-sync .ss-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}.strata-sync label{display:flex;flex-direction:column;gap:5px;font-size:14px}.strata-sync select,.strata-sync input[type=number]{padding:9px;border:1px solid #8886;border-radius:7px;background:transparent;color:inherit;width:100%}.strata-sync option{color:#17252b;background:#fff}.strata-sync button{padding:9px 15px;border:1px solid #8885;border-radius:7px;background:transparent;color:inherit;cursor:pointer}.strata-sync button.primary{background:#126c65;border-color:#126c65;color:#fff}.strata-sync button:disabled{opacity:.45;cursor:default}.strata-sync .ss-actions{display:flex;gap:9px;flex-wrap:wrap;margin:18px 0}.strata-sync .ss-check{display:flex;flex-direction:row;align-items:center;margin-top:13px}.strata-sync .ss-card{padding:16px;border:1px solid #8884;border-radius:9px;margin:16px 0}.strata-sync .ss-status{padding:10px 13px;border-left:3px solid #21867b;background:#21867b12;margin:13px 0;overflow-wrap:anywhere}.strata-sync .ss-error{border-color:#ce7140;background:#ce714012}.strata-sync table{width:100%;border-collapse:collapse;font-size:14px}.strata-sync td,.strata-sync th{padding:9px 8px;text-align:left;border-bottom:1px solid #8883;overflow-wrap:anywhere}.strata-sync code{font-size:12px;overflow-wrap:anywhere}.strata-sync .ss-scroll{overflow-x:auto}`;
    const fmt = (v) => v == null ? 'Not set' : typeof v === 'number' ? v.toLocaleString('en-US') : typeof v === 'object' ? JSON.stringify(v) : String(v);
    const warningText = {
      DSH_AUTO_COMPACTION_DISABLED: 'Automatic compaction is disabled in an affected Agent preset. Sync preserves that choice.',
      SLOTS_CONTEXT_UNAVAILABLE: 'Live slots do not report a context size. Using the model context reported by Strata.',
      SLOTS_OVERRIDE_MODEL_CONTEXT: 'The active engine context differs from the model metadata. Using the active engine context.',
    };
    function SettingsPage({ rpc }) {
      const [state, setState] = React.useState(null), [preview, setPreview] = React.useState(null);
      const [providerId, setProviderId] = React.useState(''), [output, setOutput] = React.useState('');
      const [auto, setAuto] = React.useState(false), [follow, setFollow] = React.useState(true);
      const [pending, setPending] = React.useState(false), [error, setError] = React.useState('');
      const [notice, setNotice] = React.useState('');
      const refresh = React.useCallback(async () => {
        const s = await rpc('status', {}); setState(s); return s;
      }, [rpc]);
      React.useEffect(() => {
        let disposed = false;
        rpc('status', {}).then(s => {
          if (disposed) return; setState(s); setProviderId(s.providerId || s.providers?.[0]?.id || '');
          setOutput(s.outputTokens == null ? '' : String(s.outputTokens)); setAuto(s.autoSync); setFollow(s.followLoadedModel);
        }).catch(e => { if (!disposed) setError(e.message); });
        const timer = setInterval(() => { refresh().catch(() => {}); }, 15000);
        return () => { disposed = true; clearInterval(timer); };
      }, [rpc, refresh]);
      async function action(fn) { setPending(true); setError(''); setNotice(''); try { await fn(); } catch(e) { setError(e.message || 'The operation failed.'); } finally { setPending(false); } }
      const outputTokens = output.trim() === '' ? null : Number(output);
      const valid = outputTokens === null || Number.isSafeInteger(outputTokens) && outputTokens > 0;
      const dirty = !!state && (providerId !== state.providerId || outputTokens !== state.outputTokens || auto !== state.autoSync || follow !== state.followLoadedModel);
      return h('section', {className:'strata-sync', 'aria-label':'Strata Sync'},
        h('style', null, css),
        h('header', null, h('h2',null,'Strata Sync'), h('p',{className:'ss-muted'},'Align DSH with the model loaded by Strata Server. The server reports the model and context; this plugin calculates output and compaction budgets. A community plugin, not an official Strata or DeepSeek product.')),
        !state && !error && h('div',{className:'ss-status',role:'status'},'Loading sync settings...'),
        state?.busy && h('div',{className:'ss-status',role:'status'},'DSH is running a task. Synchronization will wait until all tasks are idle.'),
        error && h('div',{className:'ss-status ss-error',role:'alert'},error),
        notice && h('div',{className:'ss-status',role:'status'},notice),
        h('div',{className:'ss-grid'},
          h('label',null,'Strata provider',h('select',{value:providerId,onChange:e=>{setProviderId(e.target.value);setPreview(null);},disabled:pending||!state},
            h('option',{value:''},'Choose an existing provider'), ...(state?.providers||[]).map(p=>h('option',{key:p.id,value:p.id},p.id)))),
          h('label',null,'Response output limit (blank for automatic)',h('input',{type:'number',min:1,step:1,value:output,placeholder:'30% of context, up to 16,384',onChange:e=>{setOutput(e.target.value);setPreview(null);},disabled:pending||!state}))),
        h('p',{className:'ss-muted'},'Uses the URL and credentials already configured in DSH. API keys are never displayed or copied here.'),
        h('label',{className:'ss-check'},h('input',{type:'checkbox',checked:follow,onChange:e=>{setFollow(e.target.checked);setPreview(null);},disabled:pending||!state}),'Follow the loaded Strata model as the default'),
        h('label',{className:'ss-check'},h('input',{type:'checkbox',checked:auto,onChange:e=>setAuto(e.target.checked),disabled:pending||!state}),'Automatically sync while idle (check every 60 seconds)'),
        h('div',{className:'ss-actions'},
          h('button',{disabled:pending||!providerId||!valid||!dirty,onClick:()=>action(async()=>{const s=await rpc('configure',{providerId,autoSync:auto,followLoadedModel:follow,outputTokens});setState(s);setPreview(null);setNotice('Sync preferences saved.');})},'Save preferences'),
          h('button',{disabled:pending||!providerId||dirty||!valid,onClick:()=>action(async()=>{setPreview(await rpc('preview',{providerId}));await refresh();})},pending?'Working...':'Check differences'),
          h('button',{className:'primary',disabled:pending||dirty||!preview||state?.busy||preview.busy||!preview.changes?.length,onClick:()=>action(async()=>{const r=await rpc('apply',{fingerprint:preview.fingerprint,providerId});setPreview(null);setNotice(r.applied?'Synced and backed up the original settings. Start a new conversation to use the updated compaction policy.':'Settings already match. No changes needed.');await refresh();})},'Back up and sync')),
        dirty && h('p',{className:'ss-muted'},'Save preferences before checking for differences.'),
        preview && h('div',{className:'ss-card'},
          h('strong',null,'Strata Server'), h('p',null,h('code',null,preview.server?.model?.id)),
          h('div',{className:'ss-grid'},
            h('div',null,h('strong',null,fmt(preview.budget?.contextWindow)),h('div',{className:'ss-muted'},'Context tokens')),
            h('div',null,h('strong',null,fmt(preview.budget?.outputTokens)),h('div',{className:'ss-muted'},'Response output limit')),
            h('div',null,h('strong',null,fmt(preview.budget?.summaryMaxTokens)),h('div',{className:'ss-muted'},'Summary output limit'))),
          h('p',{className:'ss-muted'},'Context source: ',preview.server?.model?.contextSource||'Server model metadata'),
          preview.presetIds?.length > 0 && h('p',{className:'ss-muted'},'Affected presets: ',preview.presetIds.join(', '),'. Existing conversations retain their preset revision. Start a new conversation to use the updated compaction budget.'),
          ...(preview.server?.warnings||[]).map((w,i)=>h('div',{key:i,className:'ss-status ss-error'},typeof w==='string'?(warningText[w]||(w.startsWith('SLOTS_')?'Live slot information is unavailable. Using the model context reported by Strata.':w)):JSON.stringify(w))),
          h('div',{className:'ss-scroll'},h('table',null,h('thead',null,h('tr',null,h('th',null,'Setting'),h('th',null,'Current'),h('th',null,'After sync'))),
            h('tbody',null,...(preview.changes||[]).map(c=>h('tr',{key:(c.target||'')+c.field},h('td',null,labels[c.field]||c.field,c.target&&h('div',{className:'ss-muted'},c.target)),h('td',null,fmt(c.before)),h('td',null,fmt(c.after))))))),
          !preview.changes?.length && h('p',null,'Settings are aligned.'),
          h('p',null,'Effective compaction threshold: ',fmt(preview.budget?.thresholdTokens),' tokens (',preview.budget?.thresholdPercent?.toFixed(2),'%)'),
          h('p',{className:'ss-muted'},'Only DSH settings are updated. Sync does not switch server models, change Strata configuration, or send inference requests. Start a new conversation after syncing.')),
        state?.lastApplied && h('p',{className:'ss-muted'},'Last sync: ',fmt(state.lastApplied?.at||state.lastApplied?.time||state.lastApplied)),
        state?.lastApplied?.backupPath && h('p',{className:'ss-muted'},'Original settings backup: ',h('code',null,state.lastApplied.backupPath)),
        state?.lastError && h('div',{className:'ss-status ss-error'},typeof state.lastError==='string'?state.lastError:state.lastError.message));
    }
    function apply(ctx) {
      const rpc = async (endpoint,payload) => {
        const result = await ctx.connection.rpc.call('/api','strata-sync/'+endpoint,payload);
        if (!result?.ok) throw new Error(result?.error?.message || 'Strata Sync is not ready.');
        return result.value;
      };
      ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name:'settings.section',id:'strata-sync',order:25,label:()=> 'Strata Sync',inject:()=>({rpc}),
      },SettingsPage)), 'strata-sync: settings page');
    }
    return {inject:['slots','connection'],apply};
  },
});
