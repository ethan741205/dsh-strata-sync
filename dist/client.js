/* Browser entry: DSH's own module loader provides React and services. */
window.__ModuleLoader__.load({
  id: '@ethan741205/dsh-strata-sync',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    const translations = {
  "Runs once on the next DSH start. Waits for running tasks to finish; no periodic server checks.": {
    "zh-Hant": "下次啟動 DSH 時同步一次；若有工作執行中，會等到閒置，不再定期檢查伺服器。",
    "zh-Hans": "下次启动 DSH 时同步一次；如有任务运行中，会等待空闲，不再定期检查服务器。"
  },
  "Image": {"zh-Hant":"圖片","zh-Hans":"图片"},
  "View mapping": {"zh-Hant":"查看參數對應","zh-Hans":"查看参数映射"},

  "Existing request mapping": { "zh-Hant": "既有請求對應", "zh-Hans": "已有请求映射" },

  "Input types": {
    "zh-Hant": "輸入類型",
    "zh-Hans": "输入类型"
  },
  "Reasoning levels": {
    "zh-Hant": "推理等級",
    "zh-Hans": "推理等级"
  },
  "Reasoning request mapping": {
    "zh-Hant": "推理請求對應",
    "zh-Hans": "推理请求映射"
  },
  "Unconfirmed — keep current setting": {
    "zh-Hant": "無法確認 — 保留原設定",
    "zh-Hans": "无法确认 — 保留原设置"
  },
  "Text": {
    "zh-Hant": "文字",
    "zh-Hans": "文本"
  },
  "Text + image": {
    "zh-Hant": "文字＋圖片",
    "zh-Hans": "文本＋图片"
  },
  "Input types are missing or unsupported in server metadata. Existing input settings are preserved.": {
    "zh-Hant": "伺服器未提供可確認的輸入類型，保留原輸入設定。",
    "zh-Hans": "服务器未提供可确认的输入类型，保留原输入设置。"
  },
  "Reasoning support could not be verified against a reviewed Strata chat template. Existing reasoning settings are preserved.": {
    "zh-Hant": "無法以已核對的 Strata 對話範本確認推理選項，保留原推理設定。",
    "zh-Hans": "无法用已核对的 Strata 对话模板确认推理选项，保留原推理设置。"
  },
  "The provider default reasoning level is not supported by the verified template. Reasoning settings are preserved; resolve the default in Models first.": {
    "zh-Hant": "供應者預設推理等級不在已驗證範本支援範圍，保留原推理設定；請先至模型設定調整預設值。",
    "zh-Hans": "提供方默认推理等级不在已验证模板支持范围，保留原推理设置；请先到模型设置调整默认值。"
  },
  "Verified template: ": {
    "zh-Hant": "已驗證範本：",
    "zh-Hans": "已验证模板："
  },
  "Only verified capabilities are synchronized. Unknown fields keep their existing values. Reasoning choices do not change the selected effort.": {
    "zh-Hant": "只同步已確認的能力；未知欄位保留原值。更新推理選項不會改動目前選擇的等級。",
    "zh-Hans": "只同步已确认的能力；未知字段保留原值。更新推理选项不会改动当前选择的等级。"
  }
,
  "Context window": {
    "zh-Hant": "上下文視窗",
    "zh-Hans": "上下文窗口"
  },
  "Response output limit": {
    "zh-Hant": "回覆輸出上限",
    "zh-Hans": "回复输出上限"
  },
  "Compaction headroom": {
    "zh-Hant": "壓縮餘裕",
    "zh-Hans": "压缩余量"
  },
  "Summary output limit": {
    "zh-Hant": "摘要輸出上限",
    "zh-Hans": "摘要输出上限"
  },
  "Compaction threshold": {
    "zh-Hant": "壓縮門檻",
    "zh-Hans": "压缩阈值"
  },
  "Recent conversation retention": {
    "zh-Hant": "近期對話保留量",
    "zh-Hans": "近期对话保留量"
  },
  "Model": {
    "zh-Hant": "模型",
    "zh-Hans": "模型"
  },
  "Default model": {
    "zh-Hant": "預設模型",
    "zh-Hans": "默认模型"
  },
  "Compaction ratio ceiling": {
    "zh-Hant": "壓縮比例上限",
    "zh-Hans": "压缩比例上限"
  },
  "Recent conversation retention ratio": {
    "zh-Hant": "近期對話保留比例",
    "zh-Hans": "近期对话保留比例"
  },
  "Not set": {
    "zh-Hant": "未設定",
    "zh-Hans": "未设置"
  },
  "Automatic compaction is disabled in an affected Agent preset. Sync preserves that choice.": {
    "zh-Hant": "受影響的 Agent 範本已停用自動壓縮，同步會保留此選擇。",
    "zh-Hans": "受影响的 Agent 预设已停用自动压缩，同步会保留此选择。"
  },
  "Live slots do not report a context size. Using the model context reported by Strata.": {
    "zh-Hant": "執行中的 slot 未提供上下文大小，將使用 Strata 模型資訊。",
    "zh-Hans": "运行中的 slot 未提供上下文大小，将使用 Strata 模型信息。"
  },
  "The active engine context differs from the model metadata. Using the active engine context.": {
    "zh-Hant": "引擎的實際上下文與模型資訊不同，將採用引擎的實際值。",
    "zh-Hans": "引擎的实际上下文与模型信息不同，将采用引擎的实际值。"
  },
  "Live slot information is unavailable. Using the model context reported by Strata.": {
    "zh-Hant": "無法取得執行中的 slot 資訊，將使用 Strata 模型資訊。",
    "zh-Hans": "无法获取运行中的 slot 信息，将使用 Strata 模型信息。"
  },
  "The operation failed.": {
    "zh-Hant": "操作失敗。",
    "zh-Hans": "操作失败。"
  },
  "Align DSH with the model loaded by Strata Server. The server reports the model and context; this plugin calculates output and compaction budgets.": {
    "zh-Hant": "讓 DSH 對齊 Strata Server 已載入的模型。模型與上下文由伺服器提供，輸出與壓縮預算由此外掛計算。",
    "zh-Hans": "让 DSH 对齐 Strata Server 已加载的模型。模型与上下文由服务器提供，输出与压缩预算由此插件计算。"
  },
  "Loading sync settings...": {
    "zh-Hant": "正在載入同步設定…",
    "zh-Hans": "正在加载同步设置…"
  },
  "DSH is running a task. Synchronization will wait until all tasks are idle.": {
    "zh-Hant": "DSH 正在執行工作，同步會等到所有工作閒置後進行。",
    "zh-Hans": "DSH 正在执行任务，同步会等到所有任务空闲后进行。"
  },
  "Strata provider": {
    "zh-Hant": "Strata 供應者",
    "zh-Hans": "Strata 提供方"
  },
  "Choose an existing provider": {
    "zh-Hant": "選擇已設定的供應者",
    "zh-Hans": "选择已设置的提供方"
  },
  "Response output limit (blank for automatic)": {
    "zh-Hant": "回覆輸出上限（留空自動計算）",
    "zh-Hans": "回复输出上限（留空自动计算）"
  },
  "30% of context, up to 16,384": {
    "zh-Hant": "上下文的 30%，最多 16,384",
    "zh-Hans": "上下文的 30%，最多 16,384"
  },
  "Uses the URL and credentials already configured in DSH. API keys are never displayed or copied here.": {
    "zh-Hant": "使用 DSH 現有的網址與認證，不在此顯示或複製 API key。",
    "zh-Hans": "使用 DSH 现有的网址与认证，不在此显示或复制 API key。"
  },
  "Follow the loaded Strata model as the default": {
    "zh-Hant": "預設模型跟隨 Strata 已載入的模型",
    "zh-Hans": "默认模型跟随 Strata 已加载的模型"
  },
  "Automatically sync when DSH starts": {
    "zh-Hant": "啟動 DSH 時自動同步",
    "zh-Hans": "启动 DSH 时自动同步"
  },
  "Sync preferences saved.": {
    "zh-Hant": "同步偏好已儲存。",
    "zh-Hans": "同步偏好已保存。"
  },
  "Save preferences": {
    "zh-Hant": "儲存偏好",
    "zh-Hans": "保存偏好"
  },
  "Working...": {
    "zh-Hant": "處理中…",
    "zh-Hans": "处理中…"
  },
  "Check differences": {
    "zh-Hant": "檢查差異",
    "zh-Hans": "检查差异"
  },
  "Synced and backed up the original settings. Start a new conversation to use the updated compaction policy.": {
    "zh-Hant": "已同步並備份原設定。請開新對話使用更新後的壓縮政策。",
    "zh-Hans": "已同步并备份原设置。请开启新对话使用更新后的压缩策略。"
  },
  "Settings already match. No changes needed.": {
    "zh-Hant": "設定已一致，無須變更。",
    "zh-Hans": "设置已一致，无需更改。"
  },
  "Back up and sync": {
    "zh-Hant": "備份並同步",
    "zh-Hans": "备份并同步"
  },
  "Save preferences before checking for differences.": {
    "zh-Hant": "請先儲存偏好，再檢查差異。",
    "zh-Hans": "请先保存偏好，再检查差异。"
  },
  "Context tokens": {
    "zh-Hant": "上下文 tokens",
    "zh-Hans": "上下文 tokens"
  },
  "Context source: ": {
    "zh-Hant": "上下文來源：",
    "zh-Hans": "上下文来源："
  },
  "Server model metadata": {
    "zh-Hant": "伺服器模型資訊",
    "zh-Hans": "服务器模型信息"
  },
  "Affected presets: ": {
    "zh-Hant": "受影響的範本：",
    "zh-Hans": "受影响的预设："
  },
  ". Existing conversations retain their preset revision. Start a new conversation to use the updated compaction budget.": {
    "zh-Hant": "。既有對話保留原範本版本，請開新對話套用更新的壓縮預算。",
    "zh-Hans": "。已有对话保留原预设版本，请开启新对话应用更新的压缩预算。"
  },
  "Setting": {
    "zh-Hant": "設定",
    "zh-Hans": "设置"
  },
  "Current": {
    "zh-Hant": "目前",
    "zh-Hans": "当前"
  },
  "After sync": {
    "zh-Hant": "同步後",
    "zh-Hans": "同步后"
  },
  "Settings are aligned.": {
    "zh-Hant": "設定已對齊。",
    "zh-Hans": "设置已对齐。"
  },
  "Effective compaction threshold: ": {
    "zh-Hant": "實際壓縮門檻：",
    "zh-Hans": "实际压缩阈值："
  },
  "Only DSH settings are updated. Sync does not switch server models, change Strata configuration, or send inference requests. Start a new conversation after syncing.": {
    "zh-Hant": "同步只更新 DSH 設定，不切換伺服器模型、不修改 Strata 設定，也不發送推論。同步後請開新對話。",
    "zh-Hans": "同步只更新 DSH 设置，不切换服务器模型、不修改 Strata 设置，也不发送推理请求。同步后请开启新对话。"
  },
  "Last sync: ": {
    "zh-Hant": "最近同步：",
    "zh-Hans": "最近同步："
  },
  "Original settings backup: ": {
    "zh-Hant": "原設定備份：",
    "zh-Hans": "原设置备份："
  },
  "Strata Sync is not ready.": {
    "zh-Hant": "Strata Sync 尚未就緒。",
    "zh-Hans": "Strata Sync 尚未就绪。"
  },
  "Server diagnostic: ": {
    "zh-Hant": "伺服器診斷：",
    "zh-Hans": "服务器诊断："
  }
};
    const labels = {
      input: 'Input types', reasoningEfforts: 'Reasoning levels', compat: 'Reasoning request mapping', contextWindow: 'Context window', outputTokens: 'Response output limit', headroomTokens: 'Compaction headroom',
      summaryMaxTokens: 'Summary output limit', thresholdTokens: 'Compaction threshold', retainTokens: 'Recent conversation retention',
      model: 'Model', modelId: 'Model', defaultModel: 'Default model',
      thresholdRatio: 'Compaction ratio ceiling', retainRatio: 'Recent conversation retention ratio',
    };
    const css = `.strata-sync{max-width:880px;color:inherit;font:inherit;line-height:1.6}.strata-sync *{box-sizing:border-box}.strata-sync header{border-bottom:1px solid #8884;padding-bottom:16px;margin-bottom:20px}.strata-sync h2{margin:0;font-size:22px}.strata-sync .ss-muted{opacity:.72;font-size:13px}.strata-sync .ss-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}.strata-sync label{display:flex;flex-direction:column;gap:5px;font-size:14px}.strata-sync select,.strata-sync input[type=number]{padding:9px;border:1px solid #8886;border-radius:7px;background:transparent;color:inherit;width:100%}.strata-sync option{color:#17252b;background:#fff}.strata-sync button{padding:9px 15px;border:1px solid #8885;border-radius:7px;background:transparent;color:inherit;cursor:pointer}.strata-sync button.primary{background:#126c65;border-color:#126c65;color:#fff}.strata-sync button:disabled{opacity:.45;cursor:default}.strata-sync .ss-actions{display:flex;gap:9px;flex-wrap:wrap;margin:18px 0}.strata-sync .ss-check{display:flex;flex-direction:row;align-items:center;margin-top:13px}.strata-sync .ss-card{padding:16px;border:1px solid #8884;border-radius:9px;margin:16px 0}.strata-sync .ss-status{padding:10px 13px;border-left:3px solid #21867b;background:#21867b12;margin:13px 0;overflow-wrap:anywhere}.strata-sync .ss-error{border-color:#ce7140;background:#ce714012}.strata-sync table{width:100%;border-collapse:collapse;font-size:14px}.strata-sync td,.strata-sync th{padding:9px 8px;text-align:left;border-bottom:1px solid #8883;overflow-wrap:anywhere}.strata-sync code{font-size:12px;overflow-wrap:anywhere}.strata-sync .ss-scroll{overflow-x:auto;container-type:inline-size;border:1px solid #8883;border-radius:8px;margin-top:16px}.strata-sync table{table-layout:fixed}.strata-sync th,.strata-sync td{vertical-align:top;padding:12px;line-height:1.5}.strata-sync thead th{font-size:12px;font-weight:600;background:#8881}.strata-sync th:first-child{width:34%}.strata-sync thead th:not(:first-child){width:33%;text-align:right}.strata-sync tbody th{font-weight:500}.strata-sync tbody tr:last-child>*{border-bottom:0}.strata-sync .ss-before,.strata-sync .ss-after{text-align:right;font-variant-numeric:tabular-nums}.strata-sync .ss-before{color:inherit;opacity:.7}.strata-sync .ss-after{background:#21867b0b;font-weight:600}.strata-sync .ss-target{display:block;font-size:11px;font-weight:400;opacity:.65;margin-top:5px;overflow-wrap:anywhere}.strata-sync .ss-values{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}.strata-sync .ss-chip{display:inline-block;padding:2px 7px;border:1px solid #8883;border-radius:5px;font-size:12px;font-weight:400;max-width:100%;overflow-wrap:anywhere}.strata-sync .ss-details{text-align:left;font-weight:400;font-size:12px}.strata-sync .ss-details summary{cursor:pointer;overflow-wrap:anywhere}.strata-sync .ss-details pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 0;font-size:11px;line-height:1.5}.strata-sync .ss-empty{font-weight:400;font-size:12px;opacity:.65}@container(max-width:440px){.strata-sync tbody th:first-child{width:100%}.strata-sync table,.strata-sync tbody,.strata-sync tr,.strata-sync tbody th,.strata-sync td{display:block;width:100%}.strata-sync thead{display:none}.strata-sync tbody tr{padding:10px 12px;border-bottom:1px solid #8883}.strata-sync tbody th,.strata-sync td{border:0;padding:5px 0}.strata-sync td::before{content:attr(data-label);float:left;font-size:12px;font-weight:400;opacity:.7}.strata-sync td{display:flow-root;padding:7px}.strata-sync .ss-values{max-width:72%;margin-left:auto}.strata-sync .ss-details{margin-top:24px}}`;
    const fmt = (v) => v == null ? 'Not set' : typeof v === 'number' ? v.toLocaleString('en-US') : typeof v === 'object' ? JSON.stringify(v) : String(v);
    const warningText = {
INPUT_UNCONFIRMED: 'Input types are missing or unsupported in server metadata. Existing input settings are preserved.',
REASONING_UNCONFIRMED: 'Reasoning support could not be verified against a reviewed Strata chat template. Existing reasoning settings are preserved.',
REASONING_DEFAULT_CONFLICT: 'The provider default reasoning level is not supported by the verified template. Reasoning settings are preserved; resolve the default in Models first.',
      DSH_AUTO_COMPACTION_DISABLED: 'Automatic compaction is disabled in an affected Agent preset. Sync preserves that choice.',
      SLOTS_CONTEXT_UNAVAILABLE: 'Live slots do not report a context size. Using the model context reported by Strata.',
      SLOTS_OVERRIDE_MODEL_CONTEXT: 'The active engine context differs from the model metadata. Using the active engine context.',
    };
    function normalizeLanguage(id) {
      const tag = String(id || 'en').toLowerCase();
      if (/^zh(?:-|$)/.test(tag)) return /(?:hant|tw|hk|mo)(?:-|$)/.test(tag) ? 'zh-Hant' : 'zh-Hans';
      return 'en';
    }
    function SettingsPage({ rpc, localeStore }) {
      const language = normalizeLanguage(React.useSyncExternalStore(localeStore.subscribe, localeStore.getSnapshot, localeStore.getSnapshot));
      const t = (text) => translations[text]?.[language] ?? text;
      const format = (value) => value == null ? t('Not set') : typeof value === 'string' ? t(value) : fmt(value);
      const renderValue = (field,value) => {
        if (value == null) return h('span',{className:'ss-empty'},t('Not set'));
        if (Array.isArray(value)) return h('div',{className:'ss-values'},...value.map((v,i)=>h('span',{className:'ss-chip',key:i},v==='text'?t('Text'):v==='image'?t('Image'):String(v))));
        if (field==='reasoningEfforts' && typeof value==='object') return h('div',{className:'ss-values'},...Object.entries(value).map(([key,wire])=>h('span',{className:'ss-chip',key},wire===key?key:key+' → '+format(wire))));
        if (typeof value==='object') return h('details',{className:'ss-details'},h('summary',null,t('View mapping')),h('pre',null,JSON.stringify(value,null,2)));
        return format(value);
      };
      const diagnostic = (message) => translations[message] ? t(message) : language === 'en' ? message : t('Server diagnostic: ') + message;
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
        h('header', null, h('h2',null,'Strata Sync'), h('p',{className:'ss-muted'},t("Align DSH with the model loaded by Strata Server. The server reports the model and context; this plugin calculates output and compaction budgets."))),
        !state && !error && h('div',{className:'ss-status',role:'status'},t("Loading sync settings...")),
        state?.busy && h('div',{className:'ss-status',role:'status'},t("DSH is running a task. Synchronization will wait until all tasks are idle.")),
        error && h('div',{className:'ss-status ss-error',role:'alert'},diagnostic(error)),
        notice && h('div',{className:'ss-status',role:'status'},t(notice)),
        h('div',{className:'ss-grid'},
          h('label',null,t("Strata provider"),h('select',{value:providerId,onChange:e=>{setProviderId(e.target.value);setPreview(null);},disabled:pending||!state},
            h('option',{value:''},t("Choose an existing provider")), ...(state?.providers||[]).map(p=>h('option',{key:p.id,value:p.id},p.id)))),
          h('label',null,t("Response output limit (blank for automatic)"),h('input',{type:'number',min:1,step:1,value:output,placeholder:t("30% of context, up to 16,384"),onChange:e=>{setOutput(e.target.value);setPreview(null);},disabled:pending||!state}))),
        h('p',{className:'ss-muted'},t("Uses the URL and credentials already configured in DSH. API keys are never displayed or copied here.")),
        h('label',{className:'ss-check'},h('input',{type:'checkbox',checked:follow,onChange:e=>{setFollow(e.target.checked);setPreview(null);},disabled:pending||!state}),t("Follow the loaded Strata model as the default")),
        h('label',{className:'ss-check'},h('input',{type:'checkbox',checked:auto,onChange:e=>setAuto(e.target.checked),disabled:pending||!state}),t("Automatically sync when DSH starts")),
        h('p',{className:'ss-muted'},t("Runs once on the next DSH start. Waits for running tasks to finish; no periodic server checks.")),
        h('div',{className:'ss-actions'},
          h('button',{disabled:pending||!providerId||!valid||!dirty,onClick:()=>action(async()=>{const s=await rpc('configure',{providerId,autoSync:auto,followLoadedModel:follow,outputTokens});setState(s);setPreview(null);setNotice('Sync preferences saved.');})},t("Save preferences")),
          h('button',{disabled:pending||!providerId||dirty||!valid,onClick:()=>action(async()=>{setPreview(await rpc('preview',{providerId}));await refresh();})},pending?t("Working..."):t("Check differences")),
          h('button',{className:'primary',disabled:pending||dirty||!preview||state?.busy||preview.busy||!preview.changes?.length,onClick:()=>action(async()=>{const r=await rpc('apply',{fingerprint:preview.fingerprint,providerId});setPreview(null);setNotice(r.applied?'Synced and backed up the original settings. Start a new conversation to use the updated compaction policy.':'Settings already match. No changes needed.');await refresh();})},t("Back up and sync"))),
        dirty && h('p',{className:'ss-muted'},t("Save preferences before checking for differences.")),
        preview && h('div',{className:'ss-card'},
          h('strong',null,'Strata Server'), h('p',null,h('code',null,preview.server?.model?.id)),
          h('div',{className:'ss-grid'},
            h('div',null,h('strong',null,format(preview.budget?.contextWindow)),h('div',{className:'ss-muted'},t("Context tokens"))),
            h('div',null,h('strong',null,format(preview.budget?.outputTokens)),h('div',{className:'ss-muted'},t("Response output limit"))),
            h('div',null,h('strong',null,format(preview.budget?.summaryMaxTokens)),h('div',{className:'ss-muted'},t("Summary output limit")))),
          h('p',null,t('Input types'),': ',preview.server?.model?.capabilities?.input ? t(preview.server.model.capabilities.input.includes('image')?'Text + image':'Text') : t('Unconfirmed — keep current setting')),
          h('p',null,t('Reasoning levels'),': ',preview.capabilityEdits?.reasoningEfforts ? Object.keys(preview.capabilityEdits.reasoningEfforts).join(' / ') : t('Unconfirmed — keep current setting')),
          preview.capabilityEdits?.reasoningEfforts && h('p',{className:'ss-muted'},t('Verified template: '),preview.server.model.capabilities.reasoning.family),
          h('p',{className:'ss-muted'},t('Only verified capabilities are synchronized. Unknown fields keep their existing values. Reasoning choices do not change the selected effort.')),
          h('p',{className:'ss-muted'},t("Context source: "),preview.server?.model?.contextSource||t("Server model metadata")),
          preview.presetIds?.length > 0 && h('p',{className:'ss-muted'},t("Affected presets: "),preview.presetIds.join(', '),t(". Existing conversations retain their preset revision. Start a new conversation to use the updated compaction budget.")),
          ...(preview.server?.warnings||[]).map((w,i)=>h('div',{key:i,className:'ss-status ss-error'},typeof w==='string'?(t(warningText[w])||(w.startsWith('SLOTS_')?t("Live slot information is unavailable. Using the model context reported by Strata."):w)):JSON.stringify(w))),
          preview.changes?.length > 0 && h('div',{className:'ss-scroll'},h('table',null,h('thead',null,h('tr',null,h('th',{scope:'col'},t("Setting")),h('th',{scope:'col'},t("Current")),h('th',{scope:'col'},t("After sync")))),
            h('tbody',null,...(preview.changes||[]).map(c=>h('tr',{key:(c.target||'')+c.field},h('th',{scope:'row'},t(labels[c.field]||c.field),c.target&&h('span',{className:'ss-target',title:c.target},c.target)),h('td',{className:'ss-before','data-label':t('Current')},renderValue(c.field,c.before)),h('td',{className:'ss-after','data-label':t('After sync')},renderValue(c.field,c.after))))))),
          !preview.changes?.length && h('p',null,t("Settings are aligned.")),
          h('p',null,t("Effective compaction threshold: "),format(preview.budget?.thresholdTokens),' tokens (',preview.budget?.thresholdPercent?.toFixed(2),'%)'),
          h('p',{className:'ss-muted'},t("Only DSH settings are updated. Sync does not switch server models, change Strata configuration, or send inference requests. Start a new conversation after syncing."))),
        state?.lastApplied && h('p',{className:'ss-muted'},t("Last sync: "),format(state.lastApplied?.at||state.lastApplied?.time||state.lastApplied)),
        state?.lastApplied?.backupPath && h('p',{className:'ss-muted'},t("Original settings backup: "),h('code',null,state.lastApplied.backupPath)),
        state?.lastError && h('div',{className:'ss-status ss-error'},diagnostic(typeof state.lastError==='string'?state.lastError:state.lastError.message)));
    }
    function apply(ctx) {
      const localeStore = {
        subscribe: listener => ctx.locale.subscribe(listener),
        getSnapshot: () => ctx.locale.getLocale().active,
      };
      const rpc = async (endpoint,payload) => {
        const result = await ctx.connection.rpc.call('/api','strata-sync/'+endpoint,payload);
        if (!result?.ok) throw new Error(result?.error?.message || 'Strata Sync is not ready.');
        return result.value;
      };
      ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name:'settings.section',id:'strata-sync',order:25,label:()=> 'Strata Sync',inject:()=>({rpc,localeStore}),
      },SettingsPage)), 'strata-sync: settings page');
    }
    return {inject:['slots','connection','locale'],apply};
  },
});
