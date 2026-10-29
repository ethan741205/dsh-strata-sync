/* Browser entry: DSH's own module loader provides React and services. */
window.__ModuleLoader__.load({
  id: '@ethan741205/dsh-strata-sync',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    const labels = {
      contextWindow: '上下文', outputTokens: '一般輸出上限', headroomTokens: '壓縮餘裕',
      summaryMaxTokens: '摘要輸出上限', thresholdTokens: '壓縮門檻', retainTokens: '近期對話保留',
      model: '模型', modelId: '模型', defaultModel: '預設模型',
      thresholdRatio: '壓縮比例上限', retainRatio: '近期對話保留比例',
    };
    const css = `.strata-sync{max-width:880px;color:inherit;font:inherit;line-height:1.6}.strata-sync *{box-sizing:border-box}.strata-sync header{border-bottom:1px solid #8884;padding-bottom:16px;margin-bottom:20px}.strata-sync h2{margin:0;font-size:22px}.strata-sync .ss-muted{opacity:.72;font-size:13px}.strata-sync .ss-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}.strata-sync label{display:flex;flex-direction:column;gap:5px;font-size:14px}.strata-sync select,.strata-sync input[type=number]{padding:9px;border:1px solid #8886;border-radius:7px;background:transparent;color:inherit;width:100%}.strata-sync option{color:#17252b;background:#fff}.strata-sync button{padding:9px 15px;border:1px solid #8885;border-radius:7px;background:transparent;color:inherit;cursor:pointer}.strata-sync button.primary{background:#126c65;border-color:#126c65;color:#fff}.strata-sync button:disabled{opacity:.45;cursor:default}.strata-sync .ss-actions{display:flex;gap:9px;flex-wrap:wrap;margin:18px 0}.strata-sync .ss-check{display:flex;flex-direction:row;align-items:center;margin-top:13px}.strata-sync .ss-card{padding:16px;border:1px solid #8884;border-radius:9px;margin:16px 0}.strata-sync .ss-status{padding:10px 13px;border-left:3px solid #21867b;background:#21867b12;margin:13px 0;overflow-wrap:anywhere}.strata-sync .ss-error{border-color:#ce7140;background:#ce714012}.strata-sync table{width:100%;border-collapse:collapse;font-size:14px}.strata-sync td,.strata-sync th{padding:9px 8px;text-align:left;border-bottom:1px solid #8883;overflow-wrap:anywhere}.strata-sync code{font-size:12px;overflow-wrap:anywhere}.strata-sync .ss-scroll{overflow-x:auto}`;
    const fmt = (v) => v == null ? '未指定' : typeof v === 'number' ? v.toLocaleString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
    function Card({ view, rpc }) {
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
      async function action(fn) { setPending(true); setError(''); setNotice(''); try { await fn(); } catch(e) { setError(e.message || '操作失敗'); } finally { setPending(false); } }
      const outputTokens = output.trim() === '' ? null : Number(output);
      const valid = outputTokens === null || Number.isSafeInteger(outputTokens) && outputTokens > 0;
      const dirty = !!state && (providerId !== state.providerId || outputTokens !== state.outputTokens || auto !== state.autoSync || follow !== state.followLoadedModel);
      if (view === 'summary') return '同步 Strata 已載入模型、上下文與 DSH 壓縮預算。';
      return h('section', {className:'strata-sync', 'aria-label':'Strata Sync'},
        h('style', null, css),
        h('header', null, h('h2',null,'Strata Sync'), h('p',{className:'ss-muted'},'模型與上下文由伺服器提供；輸出與壓縮預算由此外掛計算。社群外掛，非 Strata／DeepSeek 官方產品。')),
        state?.busy && h('div',{className:'ss-status',role:'status'},'DSH 有工作正在執行；同步會等到閒置後再套用。'),
        error && h('div',{className:'ss-status ss-error',role:'alert'},error),
        notice && h('div',{className:'ss-status',role:'status'},notice),
        h('div',{className:'ss-grid'},
          h('label',null,'Strata 連線',h('select',{value:providerId,onChange:e=>{setProviderId(e.target.value);setPreview(null);},disabled:pending||!state},
            h('option',{value:''},'選擇已設定的供應者'), ...(state?.providers||[]).map(p=>h('option',{key:p.id,value:p.id},p.id)))),
          h('label',null,'一般輸出上限（留空自動計算）',h('input',{type:'number',min:1,step:1,value:output,placeholder:'上下文的 30%，最多 16,384',onChange:e=>{setOutput(e.target.value);setPreview(null);},disabled:pending||!state}))),
        h('p',{className:'ss-muted'},'使用 DSH 現有的網址與認證，不在此頁顯示或複製 API key。'),
        h('label',{className:'ss-check'},h('input',{type:'checkbox',checked:follow,onChange:e=>{setFollow(e.target.checked);setPreview(null);},disabled:pending||!state}),'切換預設模型，跟隨 Strata 目前載入的模型'),
        h('label',{className:'ss-check'},h('input',{type:'checkbox',checked:auto,onChange:e=>setAuto(e.target.checked),disabled:pending||!state}),'閒置時自動同步（每 60 秒檢查）'),
        h('div',{className:'ss-actions'},
          h('button',{disabled:pending||!providerId||!valid||!dirty,onClick:()=>action(async()=>{const s=await rpc('configure',{providerId,autoSync:auto,followLoadedModel:follow,outputTokens});setState(s);setPreview(null);setNotice('同步偏好已儲存。');})},'儲存偏好'),
          h('button',{disabled:pending||!providerId||dirty||!valid,onClick:()=>action(async()=>{setPreview(await rpc('preview',{providerId}));await refresh();})},pending?'處理中…':'檢查差異'),
          h('button',{className:'primary',disabled:pending||dirty||!preview||state?.busy||preview.busy||!preview.changes?.length,onClick:()=>action(async()=>{const r=await rpc('apply',{fingerprint:preview.fingerprint,providerId});setPreview(null);setNotice(r.applied?'已同步並備份原設定。請開新對話使用更新後的壓縮設定。':'設定已一致，無須變更。');await refresh();})},'備份並同步')),
        dirty && h('p',{className:'ss-muted'},'先儲存偏好，再取得最新差異。'),
        preview && h('div',{className:'ss-card'},
          h('strong',null,'Strata Server'), h('p',null,h('code',null,preview.server?.model?.id)),
          h('div',{className:'ss-grid'},
            h('div',null,h('strong',null,fmt(preview.budget?.contextWindow)),h('div',{className:'ss-muted'},'上下文 tokens')),
            h('div',null,h('strong',null,fmt(preview.budget?.outputTokens)),h('div',{className:'ss-muted'},'一般輸出上限')),
            h('div',null,h('strong',null,fmt(preview.budget?.summaryMaxTokens)),h('div',{className:'ss-muted'},'摘要輸出上限'))),
          h('p',{className:'ss-muted'},'上下文來源：',preview.server?.model?.contextSource||'伺服器模型資訊'),
          preview.presetIds?.length > 0 && h('p',{className:'ss-muted'},'更新範本：',preview.presetIds.join('、'),'。既有對話保留建立時的範本；請開新對話套用新的壓縮預算。'),
          ...(preview.server?.warnings||[]).map((w,i)=>h('div',{key:i,className:'ss-status ss-error'},typeof w==='string'?w:JSON.stringify(w))),
          h('div',{className:'ss-scroll'},h('table',null,h('thead',null,h('tr',null,h('th',null,'設定'),h('th',null,'目前'),h('th',null,'同步後'))),
            h('tbody',null,...(preview.changes||[]).map(c=>h('tr',{key:(c.target||'')+c.field},h('td',null,labels[c.field]||c.field,c.target&&h('div',{className:'ss-muted'},c.target)),h('td',null,fmt(c.before)),h('td',null,fmt(c.after))))))),
          !preview.changes?.length && h('p',null,'設定已對齊。'),
          h('p',null,'計算後壓縮門檻：',fmt(preview.budget?.thresholdTokens),' tokens（',preview.budget?.thresholdPercent?.toFixed(2),'%）'),
          h('p',{className:'ss-muted'},'同步只調整 DSH；不切換 Strata 模型、不修改伺服器，也不發送推論。既有對話保留原路由與範本快照；同步後請開新對話。')),
        state?.lastApplied && h('p',{className:'ss-muted'},'最近同步：',fmt(state.lastApplied?.at||state.lastApplied?.time||state.lastApplied)),
        state?.lastApplied?.backupPath && h('p',{className:'ss-muted'},'原設定備份：',h('code',null,state.lastApplied.backupPath)),
        state?.lastError && h('div',{className:'ss-status ss-error'},typeof state.lastError==='string'?state.lastError:state.lastError.message));
    }
    function apply(ctx) {
      const rpc = async (endpoint,payload) => {
        const result = await ctx.connection.rpc.call('/api','strata-sync/'+endpoint,payload);
        if (!result?.ok) throw new Error(result?.error?.message || 'Strata Sync 服務尚未就緒。');
        return result.value;
      };
      ctx.effect(() => ctx.slots.inject('plugins.item', () => ctx.slots.register({
        name:'plugins.item',id:'strata-sync',order:25,label:'Strata Sync',inject:()=>({rpc}),
      },Card)), 'strata-sync: settings page');
    }
    return {inject:['slots','connection'],apply};
  },
});
