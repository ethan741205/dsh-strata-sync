/* Browser entry: DSH's own module loader provides React and services. */
window.__ModuleLoader__.load({
  id: 'dsh-strata-sync',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    const translations = {
"Output limit source: ": {"zh-Hant":"輸出上限來源：","zh-Hans":"输出上限来源："},
"Strata Server default": {"zh-Hant":"Strata Server 預設值","zh-Hans":"Strata Server 默认值"},
"Manual override": {"zh-Hant":"手動覆寫","zh-Hans":"手动覆盖"},
"Automatic calculation": {"zh-Hant":"自動計算","zh-Hans":"自动计算"},
"Server has no fixed output limit.": {"zh-Hant":"伺服器未設定固定輸出上限。","zh-Hans":"服务器未设置固定输出上限。"},
"Server output limit could not be verified.": {"zh-Hant":"無法確認伺服器的輸出上限。","zh-Hans":"无法确认服务器的输出上限。"},
"Leave blank to use the server output default; if absent or unlimited, use 30% of context, at least 4,096 and at most 32,768. An explicit override takes priority.": {"zh-Hant":"留空會採用伺服器輸出預設值；未提供或無固定上限時，使用上下文的 30%，最低 4,096、最高 32,768。明確填寫的覆寫值優先。","zh-Hans":"留空采用服务器输出默认值；未提供或无固定上限时，使用上下文的 30%，最低 4,096、最高 32,768。明确填写的覆盖值优先。"},
"Strata returned an invalid output limit. Review the server setting before syncing.": {"zh-Hant":"Strata 回傳無效的輸出上限，請先檢查伺服器設定。","zh-Hans":"Strata 返回无效的输出上限，请先检查服务器设置。"},
  "Syncs once on the next DSH start. Runtime checks only warn; they never apply changes.": {
    "zh-Hant": "下次啟動 DSH 時同步一次。運行中檢查只會提醒，不會自動套用變更。",
    "zh-Hans": "下次启动 DSH 时同步一次。运行中检查只会提醒，不会自动应用更改。"
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
  "Dynamic summary target": {
    "zh-Hant": "動態摘要目標",
    "zh-Hans": "动态摘要目标"
  },
  "When to use guidance": {"zh-Hant":"何時使用長度指引","zh-Hans":"何时使用长度指引"},
  "Every summary": {"zh-Hant":"每次摘要","zh-Hans":"每次摘要"},
  "After summary truncation": {"zh-Hant":"摘要截斷後","zh-Hans":"摘要截断后"},
  "The first summary uses native instructions. If it hits the output limit, subsequent native summaries in the same conversation use guidance until a compaction succeeds. No extra retry is started.": {"zh-Hant":"首次使用原生摘要指令。若達到輸出上限，同一對話後續的原生摘要嘗試會加入長度指引，成功後恢復原生方式。不會額外啟動重試。","zh-Hans":"首次使用原生摘要指令。若达到输出上限，同一对话后续的原生摘要尝试会加入长度指引，成功后恢复原生方式。不会额外启动重试。"},
  "Guidance is added to every supported summary, including the first attempt.": {"zh-Hant":"每次支援的摘要都加入長度指引，包括首次嘗試。","zh-Hans":"每次支持的摘要都加入长度指引，包括首次尝试。"},
  "Supplemental summary prompt": {
    "zh-Hant": "摘要補充提示詞",
    "zh-Hans": "摘要补充提示词"
  },
  "Restore default prompt": {
    "zh-Hant": "還原預設提示詞",
    "zh-Hans": "恢复默认提示词"
  },
  "Appended to DSH's native prompt; {target} becomes the calculated token target. Save preferences to apply.": {
    "zh-Hant": "附加於 DSH 原生提示詞；{target} 會替換為計算出的 token 目標。儲存偏好後套用。",
    "zh-Hans": "附加于 DSH 原生提示词；{target} 会替换为计算出的 token 目标。保存偏好后应用。"
  },
  "Use 1–2,048 characters and include {target}.": {
    "zh-Hant": "請輸入 1–2,048 個字元，並包含 {target}。",
    "zh-Hans": "请输入 1–2,048 个字符，并包含 {target}。"
  },
  "Calculation and limits": {
    "zh-Hant": "計算方式與限制",
    "zh-Hans": "计算方式与限制"
  },
  "How the target is calculated": {
    "zh-Hant": "目標如何計算",
    "zh-Hans": "目标如何计算"
  },
  "When enabled, before each supported Strata summary, calculates a length target and appends one sentence to DSH's native summary prompt.": {
    "zh-Hant": "啟用後，在每次支援的 Strata 摘要請求前，計算長度目標，並在 DSH 原生摘要提示詞後補充一句。",
    "zh-Hans": "启用后，在每次支持的 Strata 摘要请求前，计算长度目标，并在 DSH 原生摘要提示词后补充一句。"
  },
  "Target = floor(min(estimated effective output budget / O, selected content estimate / S)). Default divisors: 2 and 2 (50% each).": {
    "zh-Hant": "目標 = floor(min(估算有效輸出預算 / O, 待壓縮內容估算 / S))。兩個除數預設均為 2（各取 50%）。",
    "zh-Hans": "目标 = floor(min(估算有效输出预算 / O, 待压缩内容估算 / S))。两个除数默认均为 2（各取 50%）。"
  },
  "When guidance cannot be applied, DSH keeps its native summary behavior.": {
    "zh-Hant": "無法套用時，沿用 DSH 原生摘要。",
    "zh-Hans": "无法应用时，沿用 DSH 原生摘要。"
  },
  "Enable summary guidance": {
    "zh-Hant": "啟用摘要提示補充",
    "zh-Hans": "启用摘要提示补充"
  },
  "On by default. Length guidance is applied after a summary is truncated unless you choose Every summary.": {
    "zh-Hant": "預設開啟。除非選擇每次摘要，否則只在摘要截斷後加入長度指引。",
    "zh-Hans": "默认开启。除非选择每次摘要，否则只在摘要截断后加入长度指引。"
  },
  "Output budget divisor (estimated budget ÷ O)": {
    "zh-Hant": "摘要輸出除數（估算可用預算 ÷ O）",
    "zh-Hans": "摘要输出除数（估算可用预算 ÷ O）"
  },
  "Source length divisor (source estimate ÷ S)": {
    "zh-Hant": "原文長度除數（原文估算 ÷ S）",
    "zh-Hans": "原文长度除数（原文估算 ÷ S）"
  },
  "Defaults: O = 2, S = 2 (50% each). Smaller divisors allow longer targets; the smaller of the two bounds wins. Decimals are supported.": {
    "zh-Hant": "預設 O = 2、S = 2（各取 50%）。除數越小，目標可越長；最後取兩項限制的較小值。支援小數。",
    "zh-Hans": "默认 O = 2、S = 2（各取 50%）。除数越小，目标可越长；最后取两项限制的较小值。支持小数。"
  },
  "Enter a finite divisor of at least 1; decimals are allowed.": {
    "zh-Hant": "請輸入大於或等於 1 的有限除數，可使用小數。",
    "zh-Hans": "请输入大于或等于 1 的有限除数，可使用小数。"
  },
  "Save preferences to apply these controls to subsequent summary requests; other model and compaction settings stay unchanged.": {
    "zh-Hant": "儲存偏好後，這些控制項會套用至後續摘要請求；其他模型與壓縮設定保持不變。",
    "zh-Hans": "保存偏好后，这些控制项将应用于后续摘要请求；其他模型与压缩设置保持不变。"
  },
  "The target also depends on the estimated remaining context and source length.": {
    "zh-Hant": "目標也會考慮估算的上下文剩餘空間與原文長度。",
    "zh-Hans": "目标也会考虑估算的上下文剩余空间与原文长度。"
  },
  "The original prompt, output cap and other settings stay unchanged. This is a writing target, not a guaranteed length or an optimal value.": {
    "zh-Hant": "保留原生提示詞、輸出硬上限與其他設定。這是寫作目標，不保證實際長度，也不代表最佳值。",
    "zh-Hans": "保留原生提示词、输出硬上限与其他设置。这是写作目标，不保证实际长度，也不代表最佳值。"
  },
  "The actual target may be lower for shorter content. System prompts and tool schemas are excluded from the content estimate.": {
    "zh-Hant": "內容較短時，實際目標會更低；內容估算不包含系統提示詞與工具定義。",
    "zh-Hans": "内容较短时，实际目标会更低；内容估算不包含系统提示词与工具定义。"
  },
  "If the route or native summary format cannot be verified, DSH uses its original prompt.": {
    "zh-Hant": "無法確認路由或原生摘要格式時，DSH 沿用原本提示詞。",
    "zh-Hans": "无法确认路由或原生摘要格式时，DSH 沿用原本提示词。"
  },
  "Unpriced image/file attachments, cancellation or a disabled plugin preserve native request handling.": {
    "zh-Hant": "無法估算圖片／檔案附件用量、請求取消或外掛停用時，保留原生請求處理。",
    "zh-Hans": "无法估算图片／文件附件用量、请求取消或插件禁用时，保留原生请求处理。"
  },
  "Targets below 256 tokens leave the original prompt unchanged; the native summary still runs.": {
    "zh-Hant": "目標小於 256 tokens 時保留原本提示詞，原生摘要仍會執行。",
    "zh-Hans": "目标小于 256 tokens 时保留原本提示词，原生摘要仍会执行。"
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
    "zh-Hant": "受影響的 Agent 配置已停用自動壓縮，同步會保留此選擇。",
    "zh-Hans": "受影响的 Agent 配置已停用自动压缩，同步会保留此选择。"
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
  "Align DSH with the model loaded by Strata Server. The server supplies model, context and any fixed output default; this plugin calculates fallback output and compaction budgets.": {
    "zh-Hant": "讓 DSH 對齊 Strata Server 已載入的模型。模型、上下文及固定輸出預設值由伺服器提供；此外掛計算備用輸出與壓縮預算。",
    "zh-Hans": "让 DSH 对齐 Strata Server 已加载的模型。模型、上下文及固定输出默认值由服务器提供；此插件计算备用输出与压缩预算。"
  },
  "Loading sync settings...": {
    "zh-Hant": "正在載入同步設定…",
    "zh-Hans": "正在加载同步设置…"
  },
  "A synchronization is applying settings. Please wait.": {
    "zh-Hant": "正在套用同步設定，請稍候。",
    "zh-Hans": "正在应用同步设置，请稍候。"
  },
  "Strata provider": {
    "zh-Hant": "Strata 供應者",
    "zh-Hans": "Strata 提供方"
  },
  "Choose an existing provider": {
    "zh-Hant": "選擇已設定的供應者",
    "zh-Hans": "选择已设置的提供方"
  },
  "Output limit override (blank to follow Strata)": {
    "zh-Hant": "輸出上限覆寫（留空跟隨 Strata）",
    "zh-Hans": "输出上限覆盖（留空跟随 Strata）"
  },
  "Strata default, otherwise automatic": {
    "zh-Hant": "Strata 預設值，否則自動計算",
    "zh-Hans": "Strata 默认值，否则自动计算"
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
  "Affected presets: ": {
    "zh-Hant": "受影響的配置：",
    "zh-Hans": "受影响的配置："
  },
  ". The updated compaction budget applies only to new conversations.": {
    "zh-Hant": "。新的壓縮預算僅對新對話生效。",
    "zh-Hans": "。新的压缩预算仅对新对话生效。"
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
  "dsh-strata-sync is not ready.": {
    "zh-Hant": "dsh-strata-sync 尚未就緒。",
    "zh-Hans": "dsh-strata-sync 尚未就绪。"
  },
  "Server diagnostic: ": {
    "zh-Hant": "伺服器診斷：",
    "zh-Hans": "服务器诊断："
  }
};
    Object.assign(translations, {
      'Runtime model check': {'zh-Hant':'運行中模型檢查','zh-Hans':'运行中模型检查'},
      'Strata model or settings changed.': {'zh-Hant':'Strata 模型或設定已變更。','zh-Hans':'Strata 模型或设置已更改。'},
      'Current model settings are aligned.': {'zh-Hant':'目前模型設定已對齊。','zh-Hans':'当前模型设置已对齐。'},
      'Unable to verify the current server model.': {'zh-Hant':'無法確認目前的伺服器模型。','zh-Hans':'无法确认当前的服务器模型。'},
      'Waiting for the first server check.': {'zh-Hant':'等待首次伺服器檢查。','zh-Hans':'等待首次服务器检查。'},
      'Select a Strata provider to enable model checks.': {'zh-Hant':'選擇 Strata 供應者以啟用模型檢查。','zh-Hans':'选择 Strata 提供方以启用模型检查。'},
      'Check differences, sync, then start a new conversation. Existing conversations keep their previous settings.': {'zh-Hant':'請檢查差異、同步後開啟新對話；既有對話仍保留先前設定。','zh-Hans':'请检查差异、同步后开启新对话；现有对话仍保留之前的设置。'},
      'Previous sync results may be outdated. Check the server connection and try Check differences.': {'zh-Hant':'先前同步結果可能已過時。請確認伺服器連線，再點「檢查差異」。','zh-Hans':'之前的同步结果可能已过时。请确认服务器连接，再点击“检查差异”。'},
      'Checks on plugin activation, then every 60 seconds, even with Settings closed. No automatic changes or inference requests.': {'zh-Hant':'外掛啟用時即檢查，之後每 60 秒檢查一次，關閉設定頁後仍會檢查；不自動改設定或發送推論請求。','zh-Hans':'插件启用时即检查，之后每 60 秒检查一次，关闭设置页后仍会检查；不自动改设置或发送推理请求。'},
      'Last checked: ': {'zh-Hant':'最近檢查：','zh-Hans':'最近检查：'},
      'Previously detected model': {'zh-Hant':'先前偵測的模型','zh-Hans':'之前检测到的模型'},
      'Compaction budget': {'zh-Hant':'壓縮預算','zh-Hans':'压缩预算'},
      'Conversation budget': {'zh-Hant':'對話預算','zh-Hans':'对话预算'},
      'Conversation budget = context − response output. Trigger = min(80% of context, conversation budget − headroom). Retain 16% of the conversation budget.': {'zh-Hant':'對話預算 = 上下文 − 回覆輸出。觸發門檻 = min(上下文的 80%, 對話預算 − 壓縮餘裕)。保留對話預算的 16%。','zh-Hans':'对话预算 = 上下文 − 回复输出。触发门槛 = min(上下文的 80%, 对话预算 − 压缩余量)。保留对话预算的 16%。'},
      'Sync the model and context budgets from Strata Server to DSH.': {'zh-Hant':'將 Strata Server 的模型與上下文預算同步至 DSH。','zh-Hans':'将 Strata Server 的模型与上下文预算同步到 DSH。'},
      'Start here': {'zh-Hant':'從這裡開始','zh-Hans':'从这里开始'},
      'First, check differences to read the loaded model and preview the changes.': {'zh-Hant':'先點「檢查差異」，讀取目前載入的模型並預覽變更。','zh-Hans':'先点击“检查差异”，读取当前加载的模型并预览更改。'},
      'Review changes': {'zh-Hant':'預覽變更','zh-Hans':'预览更改'},
      'Review the changes below, then back up and sync.': {'zh-Hant':'確認下方變更後，點「備份並同步」。','zh-Hans':'确认下方更改后，点击“备份并同步”。'},
      'Check differences before syncing.': {'zh-Hant':'檢查差異後即可同步。','zh-Hans':'检查差异后即可同步。'},
      'Sync preferences': {'zh-Hant':'同步偏好','zh-Hans':'同步偏好'},
      'Output limit, default model and startup sync': {'zh-Hant':'輸出上限、預設模型與啟動同步','zh-Hans':'输出上限、默认模型与启动同步'},
      'Optional': {'zh-Hant':'選用','zh-Hans':'可选'},
      'Enabled': {'zh-Hant':'已啟用','zh-Hans':'已启用'},
      'Save option changes below before checking differences again.': {'zh-Hant':'請先在下方儲存選項變更，再重新檢查差異。','zh-Hans':'请先在下方保存选项更改，再重新检查差异。'},
      'Follow Strata output limit': {'zh-Hant':'輸出上限跟隨 Strata','zh-Hans':'输出上限跟随 Strata'},
      'Use the verified server default. If none is available, calculate 30% of context, at least 4,096 and at most 32,768 tokens.': {'zh-Hant':'採用已確認的伺服器預設值；無固定值時，以上下文的 30% 計算，最低 4,096、最高 32,768 tokens。','zh-Hans':'采用已确认的服务器默认值；无固定值时，按上下文的 30% 计算，最低 4,096、最高 32,768 tokens。'},
      'Advanced settings': {'zh-Hant':'進階設定','zh-Hans':'高级设置'},
      'Manual output limit': {'zh-Hant':'手動輸出上限','zh-Hans':'手动输出上限'},
      'Turn off Follow Strata output limit to enter a manual override.': {'zh-Hant':'關閉「輸出上限跟隨 Strata」後，可輸入手動覆寫值。','zh-Hans':'关闭“输出上限跟随 Strata”后，可输入手动覆盖值。'},
      'A manual limit takes priority over the server default and automatic calculation.': {'zh-Hant':'手動上限優先於伺服器預設值與自動計算。','zh-Hans':'手动上限优先于服务器默认值与自动计算。'},
      'Preferences changed in another window. Reload the latest preferences before saving; this discards your unsaved edits.': {'zh-Hant':'另一個視窗已變更偏好。儲存前請重新載入最新偏好，這會捨棄本視窗未儲存的編輯。','zh-Hans':'另一个窗口已更改偏好。保存前请重新加载最新偏好，这会丢弃此窗口未保存的编辑。'},
      'Reload latest preferences': {'zh-Hant':'重新載入最新偏好','zh-Hans':'重新加载最新偏好'},
      'Latest synchronization result': {'zh-Hant':'最近同步結果','zh-Hans':'最近同步结果'},
      'This records the last synchronization, not a live server check.': {'zh-Hant':'這是最近一次同步的紀錄，並非伺服器即時狀態。','zh-Hans':'这是最近一次同步的记录，并非服务器实时状态。'},
      'Server-provided output limit': {'zh-Hant':'伺服器提供的輸出上限','zh-Hans':'服务器提供的输出上限'},
      'Effective output limit': {'zh-Hant':'實際套用的輸出上限','zh-Hans':'实际应用的输出上限'},
      'No fixed limit': {'zh-Hant':'無固定上限','zh-Hans':'无固定上限'},
      'Not verified': {'zh-Hant':'尚未確認','zh-Hans':'尚未确认'},
      'Check differences to read the server and effective limits.': {'zh-Hant':'點選「檢查差異」以讀取伺服器與實際套用的上限。','zh-Hans':'点击“检查差异”以读取服务器与实际应用的上限。'},
      'Confirmed settings are aligned.': {'zh-Hant':'已確認的設定已對齊。','zh-Hans':'已确认的设置已对齐。'},
      'All synchronized settings are confirmed and aligned.': {'zh-Hant':'所有同步項目均已確認並對齊。','zh-Hans':'所有同步项均已确认并对齐。'},
      'Preserved without confirmation: ': {'zh-Hant':'未能確認，保留原值：','zh-Hans':'无法确认，保留原值：'},
      'items': {'zh-Hant':'項','zh-Hans':'项'},
      'item': {'zh-Hant':'項','zh-Hans':'项'},
      'Backup created': {'zh-Hant':'已建立備份','zh-Hans':'已创建备份'},
      'No settings changed; no new backup was needed.': {'zh-Hant':'設定未變更，無須建立新備份。','zh-Hans':'设置未更改，无需创建新备份。'},
      'This provider uses an unsupported model catalog configuration. Configure an explicit custom model list in DSH before syncing.': {'zh-Hant':'此供應者使用目前不支援的模型目錄設定。請先在 DSH 設定明確的自訂模型清單，再同步。','zh-Hans':'此提供方使用目前不支持的模型目录设置。请先在 DSH 设置明确的自定义模型列表，再同步。'},
    });
    const labels = {
      input: 'Input types', reasoningEfforts: 'Reasoning levels', compat: 'Reasoning request mapping', contextWindow: 'Context window', outputTokens: 'Response output limit', headroomTokens: 'Compaction headroom',
      summaryMaxTokens: 'Summary output limit', thresholdTokens: 'Compaction threshold', retainTokens: 'Recent conversation retention',
      model: 'Model', modelId: 'Model', defaultModel: 'Default model',
      thresholdRatio: 'Compaction ratio ceiling', retainRatio: 'Recent conversation retention ratio',
    };
    const css = `.strata-sync{max-width:880px;color:inherit;font:inherit;line-height:1.6}.strata-sync *{box-sizing:border-box}.strata-sync header{margin-bottom:8px}.strata-sync header p{margin:8px 0 0}.strata-sync h2{margin:0;font-size:22px}.strata-sync .ss-muted{opacity:.72;font-size:13px}.strata-sync .ss-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}.strata-sync label{display:flex;flex-direction:column;gap:5px;font-size:14px}.strata-sync select,.strata-sync input[type=number],.strata-sync textarea{padding:9px;border:1px solid #8886;border-radius:7px;background:transparent;color:inherit;width:100%}.strata-sync textarea{resize:vertical;min-height:64px;font:inherit;line-height:1.5}.strata-sync .ss-prompt-label{margin:12px 0 8px}.strata-sync option{color:#17252b;background:#fff}.strata-sync button{padding:9px 15px;border:1px solid #8885;border-radius:7px;background:transparent;color:inherit;cursor:pointer}.strata-sync button.primary{background:#126c65;border-color:#126c65;color:#fff}.strata-sync button:disabled{opacity:.45;cursor:default}.strata-sync .ss-actions{display:flex;gap:9px;flex-wrap:wrap;margin:18px 0}.strata-sync .ss-check{display:flex;flex-direction:row;align-items:center;margin-top:13px}.strata-sync .ss-card{padding:16px;border:1px solid #8884;border-radius:9px;margin:16px 0}.strata-sync .ss-status{padding:10px 13px;border-left:3px solid #21867b;background:#21867b12;margin:13px 0;overflow-wrap:anywhere}.strata-sync .ss-error{border-color:#ce7140;background:#ce714012}.strata-sync table{width:100%;border-collapse:collapse;font-size:14px}.strata-sync td,.strata-sync th{padding:9px 8px;text-align:left;border-bottom:1px solid #8883;overflow-wrap:anywhere}.strata-sync code{font-size:12px;overflow-wrap:anywhere}.strata-sync .ss-scroll{overflow-x:auto;container-type:inline-size;border:1px solid #8883;border-radius:8px;margin-top:16px}.strata-sync table{table-layout:fixed}.strata-sync th,.strata-sync td{vertical-align:top;padding:12px;line-height:1.5}.strata-sync thead th{font-size:12px;font-weight:600;background:#8881}.strata-sync th:first-child{width:34%}.strata-sync thead th:not(:first-child){width:33%;text-align:right}.strata-sync tbody th{font-weight:500}.strata-sync tbody tr:last-child>*{border-bottom:0}.strata-sync .ss-before,.strata-sync .ss-after{text-align:right;font-variant-numeric:tabular-nums}.strata-sync .ss-before{color:inherit;opacity:.7}.strata-sync .ss-after{background:#21867b0b;font-weight:600}.strata-sync .ss-target{display:block;font-size:11px;font-weight:400;opacity:.65;margin-top:5px;overflow-wrap:anywhere}.strata-sync .ss-values{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}.strata-sync .ss-chip{display:inline-block;padding:2px 7px;border:1px solid #8883;border-radius:5px;font-size:12px;font-weight:400;max-width:100%;overflow-wrap:anywhere}.strata-sync .ss-details{text-align:left;font-weight:400;font-size:12px}.strata-sync .ss-details summary{cursor:pointer;overflow-wrap:anywhere}.strata-sync .ss-details pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 0;font-size:11px;line-height:1.5}.strata-sync .ss-empty{font-weight:400;font-size:12px;opacity:.65}@container(max-width:440px){.strata-sync tbody th:first-child{width:100%}.strata-sync table,.strata-sync tbody,.strata-sync tr,.strata-sync tbody th,.strata-sync td{display:block;width:100%}.strata-sync thead{display:none}.strata-sync tbody tr{padding:10px 12px;border-bottom:1px solid #8883}.strata-sync tbody th,.strata-sync td{border:0;padding:5px 0}.strata-sync td::before{content:attr(data-label);float:left;font-size:12px;font-weight:400;opacity:.7}.strata-sync td{display:flow-root;padding:7px}.strata-sync .ss-values{max-width:72%;margin-left:auto}.strata-sync .ss-details{margin-top:24px}}`;
    const workflowCss = ".strata-sync h3{font-size:16px;margin:0 0 8px}.strata-sync .ss-workflow{border:1px solid #21867b66;border-radius:10px;padding:20px;margin-bottom:18px}.strata-sync .ss-workflow>h3:first-child{margin-top:0}.strata-sync .ss-workflow>p:first-of-type{margin:0 0 16px}.strata-sync .ss-steps{display:flex;flex-wrap:wrap;gap:10px 20px;list-style:none;margin:0 0 20px;padding:0;font-size:13px}.strata-sync .ss-steps li{display:flex;align-items:center;gap:7px;opacity:.65}.strata-sync .ss-steps li[aria-current]{opacity:1;font-weight:600}.strata-sync .ss-step-number{display:inline-grid;place-items:center;width:25px;height:25px;flex-shrink:0;border:1px solid #8885;border-radius:50%;font-variant-numeric:tabular-nums}.strata-sync [aria-current] .ss-step-number{background:#126c65;color:#fff;border-color:#126c65}.strata-sync .ss-options>summary{cursor:pointer;font-size:14px}.strata-sync .ss-option-title::marker{color:#888}.strata-sync .ss-option-title>span:first-child{font-weight:600}.strata-sync .ss-badge{display:inline-block;margin-left:10px;padding:1px 7px;border:1px solid #8884;border-radius:5px;font-size:11px;vertical-align:middle}.strata-sync .ss-option-description{display:inline-block;margin-left:12px;opacity:.65;font-size:12px}.strata-sync button:focus-visible,.strata-sync summary:focus-visible,.strata-sync select:focus-visible{outline:2px solid #21867b;outline-offset:3px}@media(max-width:520px){.strata-sync .ss-workflow{padding:14px}.strata-sync .ss-option-description{display:block;margin-left:16px;margin-top:3px}.strata-sync .ss-steps{gap:8px 12px}}";
    const fmt = (v) => v == null ? 'Not set' : typeof v === 'number' ? v.toLocaleString('en-US') : typeof v === 'object' ? JSON.stringify(v) : String(v);
    const warningText = {
INPUT_UNCONFIRMED: 'Input types are missing or unsupported in server metadata. Existing input settings are preserved.',
REASONING_UNCONFIRMED: 'Reasoning support could not be verified against a reviewed Strata chat template. Existing reasoning settings are preserved.',
REASONING_DEFAULT_CONFLICT: 'The provider default reasoning level is not supported by the verified template. Reasoning settings are preserved; resolve the default in Models first.',
      DSH_AUTO_COMPACTION_DISABLED: 'Automatic compaction is disabled in an affected Agent preset. Sync preserves that choice.',
      SLOTS_CONTEXT_UNAVAILABLE: 'Live slots do not report a context size. Using the model context reported by Strata.',
      SLOTS_OVERRIDE_MODEL_CONTEXT: 'The active engine context differs from the model metadata. Using the active engine context.',
    };
    const modelCss = '.strata-sync code.ss-model{font-size:16px;font-weight:600;line-height:1.5;white-space:normal;overflow-wrap:anywhere}.strata-sync table code.ss-model{font-size:14px}';
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
        if (['model','modelId','defaultModel'].includes(field) && typeof value === 'string') return h('code',{className:'ss-model'},value);
        if (Array.isArray(value)) return h('div',{className:'ss-values'},...value.map((v,i)=>h('span',{className:'ss-chip',key:i},v==='text'?t('Text'):v==='image'?t('Image'):String(v))));
        if (field==='reasoningEfforts' && typeof value==='object') return h('div',{className:'ss-values'},...Object.entries(value).map(([key,wire])=>h('span',{className:'ss-chip',key},wire===key?key:key+' → '+format(wire))));
        if (typeof value==='object') return h('details',{className:'ss-details'},h('summary',null,t('View mapping')),h('pre',null,JSON.stringify(value,null,2)));
        return format(value);
      };
      const diagnostic = (message) => translations[message] ? t(message) : language === 'en' ? message : t('Server diagnostic: ') + message;
      const [state,setState] = React.useState(null), [preview,setPreview] = React.useState(null), [result,setResult] = React.useState(null);
      const [form,setForm] = React.useState({providerId:'',output:'',manual:false,auto:false,follow:true,summaryGuidance:true,summaryGuidanceMode:'after-truncation',summaryOutputDivisor:'2',summarySourceDivisor:'2',summaryPrompt:''});
      const [pending,setPending] = React.useState(false), [error,setError] = React.useState(''), [loadError,setLoadError] = React.useState('');
      const [notice,setNotice] = React.useState(''), [conflict,setConflict] = React.useState(false);
      const formRef=React.useRef(form), baseline=React.useRef(null), requestSeq=React.useRef(0), alive=React.useRef(true);
      const numberValue = value => value.trim()===''?NaN:Number(value);
      const values = (f) => ({providerId:f.providerId,outputTokens:f.manual ? (f.output.trim()==='' ? NaN : Number(f.output)) : null,autoSync:f.auto,followLoadedModel:f.follow,summaryGuidance:f.summaryGuidance,summaryGuidanceMode:f.summaryGuidanceMode,summaryOutputDivisor:numberValue(f.summaryOutputDivisor),summarySourceDivisor:numberValue(f.summarySourceDivisor),summaryPromptTemplate:f.summaryPrompt});
      const preferences = (s) => ({providerId:s.providerId || '',outputTokens:s.outputTokens ?? null,autoSync:!!s.autoSync,followLoadedModel:s.followLoadedModel !== false,summaryGuidance:s.summaryGuidance===undefined?true:s.summaryGuidance===true,summaryGuidanceMode:s.summaryGuidanceMode??'after-truncation',summaryOutputDivisor:s.summaryOutputDivisor??2,summarySourceDivisor:s.summarySourceDivisor??2,summaryPromptTemplate:s.summaryPromptTemplate??s.defaultSummaryPromptTemplate??''});
      const equal = (a,b) => Object.keys(a).every(key=>Object.is(a[key],b[key]));
      const acceptStatus = React.useCallback((s,force=false) => {
        if (!alive.current) return;
        const next=preferences(s), old=baseline.current;
        const untouched=!old || equal(values(formRef.current),old.values);
        if (force || untouched) {
          const nextForm={providerId:next.providerId,output:next.outputTokens==null?'':String(next.outputTokens),manual:next.outputTokens!=null,auto:next.autoSync,follow:next.followLoadedModel,summaryGuidance:next.summaryGuidance,summaryGuidanceMode:next.summaryGuidanceMode,summaryOutputDivisor:String(next.summaryOutputDivisor),summarySourceDivisor:String(next.summarySourceDivisor),summaryPrompt:next.summaryPromptTemplate};
          formRef.current=nextForm; setForm(nextForm); setConflict(false);
          baseline.current={values:next,revision:s.settingsRevision};
        } else if (old.revision!==s.settingsRevision || !equal(old.values,next)) {
          setConflict(true);
        }
        if (old && (old.revision!==s.settingsRevision || !equal(old.values,next))) setPreview(null);
        setState(s); setLoadError('');
      },[]);
      const refresh=React.useCallback(async (force=false) => {
        const seq=++requestSeq.current;
        const s=await rpc('status',{});
        if (seq===requestSeq.current) acceptStatus(s,force);
        return s;
      },[rpc,acceptStatus]);
      React.useEffect(()=>{
        alive.current=true;
        const read=()=>refresh().catch(e=>{if(alive.current)setLoadError(e.message);});
        read(); const timer=setInterval(read,15000);
        return ()=>{alive.current=false;requestSeq.current++;clearInterval(timer);};
      },[refresh]);
      function edit(patch) {
        const next={...formRef.current,...patch};formRef.current=next;setForm(next);setPreview(null);setNotice('');
      }
      async function action(fn) {
        setPending(true);setError('');setNotice('');
        try { await fn(); }
        catch(e) {
          if(e.code==='stale-settings') { setConflict(true); await refresh().catch(()=>{}); }
          else setError(e.code==='unsupported-route'?'This provider uses an unsupported model catalog configuration. Configure an explicit custom model list in DSH before syncing.':e.message||'The operation failed.');
        } finally { if(alive.current)setPending(false); }
      }
      const draft=values(form), isDivisor=value=>Number.isFinite(value)&&value>=1&&value<=Number.MAX_SAFE_INTEGER;
      const validDivisor=[draft.summaryOutputDivisor,draft.summarySourceDivisor].every(isDivisor);
      const validPrompt=typeof draft.summaryPromptTemplate==='string'&&draft.summaryPromptTemplate.length>0&&draft.summaryPromptTemplate.length<=2048&&draft.summaryPromptTemplate.includes('{target}');
      const valid=validDivisor&&validPrompt&&(draft.outputTokens===null || Number.isSafeInteger(draft.outputTokens)&&draft.outputTokens>0);
      const dirty=!!baseline.current&&!equal(draft,baseline.current.values);
      const displayedResult=!result || state?.lastApplied?.at>result.at ? state?.lastApplied : result;
      const liveCheck=state?.liveCheck;
      const liveWarning=liveCheck?.state==='mismatch'||liveCheck?.state==='unavailable';
      const liveTitle={unchecked:'Waiting for the first server check.',unconfigured:'Select a Strata provider to enable model checks.',aligned:'Current model settings are aligned.',mismatch:'Strata model or settings changed.',unavailable:'Unable to verify the current server model.'}[liveCheck?.state];
      const activeBudget=preview?.budget;
      const outputSource=(budget)=>t(({server:'Strata Server default',manual:'Manual override',calculated:'Automatic calculation'})[budget?.outputSource]||'Automatic calculation');
      const preserved=(view)=>{
        const status=view?.capabilityStatus;
        return [(!status ? !view?.server?.model?.capabilities?.input : status.input!=='confirmed')?'Input types':null,
          (!status ? !view?.capabilityEdits?.reasoningEfforts : status.reasoning!=='confirmed')?'Reasoning levels':null].filter(Boolean);
      };
      const alignment=(view)=>{
        const kept=preserved(view);
        return h('div',{className:'ss-status','data-testid':'alignment'},
          h('p',null,t(kept.length?'Confirmed settings are aligned.':'All synchronized settings are confirmed and aligned.')),
          kept.length>0&&h('p',null,t('Preserved without confirmation: '),kept.length,' ',t(kept.length===1?'item':'items'),' — ',kept.map(t).join(', ')));
      };
      const serverLimit=(model)=>model?.serverOutputTokens!=null?format(model.serverOutputTokens):t(['missing','unlimited'].includes(model?.outputLimitStatus)?'No fixed limit':'Not verified');
      const outputValues=(budget,model)=>h('div',{className:'ss-grid'},
        h('div',null,h('strong',null,serverLimit(model)),h('div',{className:'ss-muted'},t('Server-provided output limit'))),
        h('div',null,h('strong',null,format(budget?.outputTokens)),h('div',{className:'ss-muted'},t('Effective output limit'))),
        h('div',null,h('strong',null,outputSource(budget)),h('div',{className:'ss-muted'},t('Output limit source: '))));
      const warnings=(items)=>(items||[]).map((w,i)=>h('div',{key:i,className:'ss-status ss-error'},typeof w==='string'?(t(warningText[w])||(w.startsWith('SLOTS_')?t('Live slot information is unavailable. Using the model context reported by Strata.'):w)):JSON.stringify(w)));
      return h('section',{className:'strata-sync','aria-label':'dsh-strata-sync'},
        h('style',null,css+workflowCss+modelCss),
        h('header',null,h('h2',null,'dsh-strata-sync'),h('p',{className:'ss-muted'},t('Sync the model and context budgets from Strata Server to DSH.'))),
        liveTitle&&h('div',{className:'ss-status'+(liveWarning?' ss-error':''),'data-testid':'live-check',role:'status','aria-live':'polite'},
          h('strong',null,t(liveTitle)),
          ['aligned','mismatch'].includes(liveCheck.state)&&h('p',null,t('Model'),': ',h('code',{className:'ss-model'},liveCheck.modelId), ' · ',t('Context window'),': ',format(liveCheck.contextWindow)),
          liveCheck.modelChanged&&liveCheck.previousModelId&&h('p',{className:'ss-muted'},t('Previously detected model'),': ',h('code',{className:'ss-model'},liveCheck.previousModelId),liveCheck.previousContextWindow?' · '+format(liveCheck.previousContextWindow)+' tokens':''),
          liveCheck.state==='mismatch'&&h('p',null,t('Check differences, sync, then start a new conversation. Existing conversations keep their previous settings.')),
          liveCheck.state==='unavailable'&&h('p',null,t('Previous sync results may be outdated. Check the server connection and try Check differences.')),
          h('p',{className:'ss-muted'},t('Checks on plugin activation, then every 60 seconds, even with Settings closed. No automatic changes or inference requests.')),
          liveCheck.checkedAt&&h('p',{className:'ss-muted'},t('Last checked: '),format(liveCheck.checkedAt))),
        !state&&!loadError&&h('div',{className:'ss-status',role:'status'},t('Loading sync settings...')),
        state?.busy&&h('div',{className:'ss-status',role:'status'},t('A synchronization is applying settings. Please wait.')),
        (error||loadError)&&h('div',{className:'ss-status ss-error',role:'alert'},diagnostic(error||loadError)),
        notice&&h('div',{className:'ss-status',role:'status'},t(notice)),
        conflict&&h('div',{className:'ss-status ss-error'},
          h('p',null,t('Preferences changed in another window. Reload the latest preferences before saving; this discards your unsaved edits.')),
          h('button',{disabled:pending,onClick:()=>action(()=>refresh(true))},t('Reload latest preferences'))),
        h('div',{className:'ss-workflow','data-testid':'sync-workflow'},
          h('h3',null,t('Start here')),
          h('p',{className:'ss-muted'},t('First, check differences to read the loaded model and preview the changes.')),
          h('ol',{className:'ss-steps','aria-label':t('Sync the model and context budgets from Strata Server to DSH.')},
            ...['Check differences','Review changes','Back up and sync'].map((label,index)=>h('li',{key:label,'aria-current':index===(preview?1:result&&!dirty?2:0)?'step':undefined},h('span',{className:'ss-step-number','aria-hidden':true},index+1),t(label)))),
        h('label',null,t('Strata provider'),h('select',{value:form.providerId,onChange:e=>edit({providerId:e.target.value}),disabled:pending||!state},
          h('option',{value:''},t('Choose an existing provider')),...(state?.providers||[]).map(p=>h('option',{key:p.id,value:p.id},p.id)))),
        h('p',{className:'ss-muted'},t('Uses the URL and credentials already configured in DSH. API keys are never displayed or copied here.')),
        h('div',{className:'ss-actions'},
          h('button',{className:preview?'':'primary','data-testid':'check-differences',disabled:pending||!state||!form.providerId||dirty||conflict||!valid,onClick:()=>action(async()=>{setPreview(await rpc('preview',{providerId:form.providerId}));await refresh();})},pending?t('Working...'):t('Check differences'))),
        dirty&&!conflict&&h('p',{className:'ss-status'},t('Save option changes below before checking differences again.')),
        preview&&h('div',{className:'ss-card','data-testid':'sync-preview'},
          h('h3',null,t('Review changes')),
          preview.changes?.length>0&&h('p',{className:'ss-muted'},t('Review the changes below, then back up and sync.')),
          h('strong',null,'Strata Server'),h('p',null,h('code',{className:'ss-model'},preview.server?.model?.id)),
          h('div',{className:'ss-grid'},
            h('div',null,h('strong',null,format(preview.budget?.contextWindow)),h('div',{className:'ss-muted'},t('Context tokens'))),
            h('div',null,h('strong',null,format(preview.budget?.outputTokens)),h('div',{className:'ss-muted'},t('Response output limit'))),
            h('div',null,h('strong',null,format(preview.budget?.summaryMaxTokens)),h('div',{className:'ss-muted'},t('Summary output limit')))),
          h('p',{className:'ss-muted'},t('Output limit source: '),outputSource(preview.budget)),
          ['missing','unlimited'].includes(preview.server?.model?.outputLimitStatus)&&h('p',{className:'ss-muted'},t('Server has no fixed output limit.')),
          ['unavailable','unverified'].includes(preview.server?.model?.outputLimitStatus)&&h('p',{className:'ss-muted'},t('Server output limit could not be verified.')),
          h('p',null,t('Input types'),': ',preview.server?.model?.capabilities?.input?t(preview.server.model.capabilities.input.includes('image')?'Text + image':'Text'):t('Unconfirmed — keep current setting')),
          h('p',{'data-testid':'reasoning-levels'},t('Reasoning levels'),': ',preview.capabilityEdits?.reasoningEfforts?Object.keys(preview.capabilityEdits.reasoningEfforts).join(' / '):t('Unconfirmed — keep current setting')),
          preview.capabilityEdits?.reasoningEfforts&&h('p',{className:'ss-muted'},t('Verified template: '),preview.server?.model?.capabilities?.reasoning?.family),
          h('p',{className:'ss-muted'},t('Only verified capabilities are synchronized. Unknown fields keep their existing values. Reasoning choices do not change the selected effort.')),
          preview.presetIds?.length>0&&h('p',{className:'ss-muted'},t('Affected presets: '),preview.presetIds.join(', '),t('. The updated compaction budget applies only to new conversations.')),
          ...warnings(preview.server?.warnings),
          preview.changes?.length>0&&h('div',{className:'ss-scroll'},h('table',null,h('thead',null,h('tr',null,h('th',{scope:'col'},t('Setting')),h('th',{scope:'col'},t('Current')),h('th',{scope:'col'},t('After sync')))),
            h('tbody',null,...preview.changes.map(c=>h('tr',{key:(c.target||'')+c.field},h('th',{scope:'row'},t(labels[c.field]||c.field),c.target&&h('span',{className:'ss-target',title:c.target},c.target)),h('td',{className:'ss-before','data-label':t('Current')},renderValue(c.field,c.before)),h('td',{className:'ss-after','data-label':t('After sync')},renderValue(c.field,c.after))))))),
          !preview.changes?.length&&!liveWarning&&alignment(preview),
          h('div',{'data-testid':'preview-compaction-budget'},
            h('h4',null,t('Compaction budget')),
            h('div',{className:'ss-grid'},...[
              ['messageBudgetTokens','Conversation budget'],['headroomTokens','Compaction headroom'],['summaryMaxTokens','Summary output limit'],['retainTokens','Recent conversation retention'],
            ].map(([field,label])=>h('div',{key:field,'data-budget-field':field},h('strong',null,format(preview.budget?.[field]),' tokens'),h('div',{className:'ss-muted'},t(label))))),
            h('p',{'data-budget-field':'thresholdTokens'},t('Effective compaction threshold: '),format(preview.budget?.thresholdTokens),' tokens (',preview.budget?.thresholdPercent?.toFixed(2),'%)'),
            h('p',{className:'ss-muted'},t('Conversation budget = context − response output. Trigger = min(80% of context, conversation budget − headroom). Retain 16% of the conversation budget.'))),
          h('p',{className:'ss-muted'},t('Only DSH settings are updated. Sync does not switch server models, change Strata configuration, or send inference requests. Start a new conversation after syncing.'))),
        h('div',{className:'ss-actions','data-testid':'sync-apply'},
          h('button',{className:preview?.changes?.length?'primary':'',disabled:pending||!state||dirty||conflict||!preview||state.busy||!preview.changes?.length,onClick:()=>action(async()=>{
            const r=await rpc('apply',{fingerprint:preview.fingerprint,providerId:form.providerId});
            const view=r.preview||preview;
            setResult({at:new Date().toISOString(),modelId:view.server?.model?.id,providerId:view.providerId||form.providerId,budget:view.budget,capabilityStatus:view.capabilityStatus,serverOutputTokens:view.server?.model?.serverOutputTokens,outputLimitStatus:view.server?.model?.outputLimitStatus,backupPath:r.backupPath,applied:r.applied,warnings:view.server?.warnings});
            setPreview(null);setNotice(r.applied?'Synced and backed up the original settings. Start a new conversation to use the updated compaction policy.':'Settings already match. No changes needed.');await refresh();
          })},t('Back up and sync'))),
        !preview&&!result&&h('p',{className:'ss-muted'},t('Check differences before syncing.'))),
        displayedResult?.budget&&h('div',{className:'ss-card','data-testid':'sync-result'},
          h('strong',null,t('Latest synchronization result')),h('p',{className:'ss-muted'},t('This records the last synchronization, not a live server check.')),
          h('p',null,t('Model'),': ',h('code',{className:'ss-model'},displayedResult.modelId)),h('p',null,t('Context window'),': ',format(displayedResult.budget.contextWindow)),
          outputValues(displayedResult.budget,displayedResult),!liveWarning&&alignment(displayedResult),
          h('p',null,t(displayedResult.backupPath?'Backup created':'No settings changed; no new backup was needed.')),
          displayedResult.backupPath&&h('p',{className:'ss-muted'},t('Original settings backup: '),h('code',null,displayedResult.backupPath)),
          h('p',{className:'ss-muted'},t('Last sync: '),format(displayedResult.at)),...warnings(displayedResult.warnings)),
        h('details',{className:'ss-card ss-options','data-testid':'sync-preferences'},
          h('summary',{className:'ss-option-title'},h('span',null,t('Sync preferences')),h('span',{className:'ss-option-description'},t('Output limit, default model and startup sync'))),
        h('div',{className:'ss-card'},
          h('label',{className:'ss-check'},h('input',{type:'checkbox',checked:!form.manual,'aria-label':t('Follow Strata output limit'),onChange:e=>edit({manual:!e.target.checked}),disabled:pending||!state}),t('Follow Strata output limit')),
          h('p',{className:'ss-muted'},t('Use the verified server default. If none is available, calculate 30% of context, at least 4,096 and at most 32,768 tokens.')),
          activeBudget?outputValues(activeBudget,preview.server?.model):h('p',{className:'ss-muted'},t('Check differences to read the server and effective limits.')),
          h('details',{className:'ss-details',open:form.manual},h('summary',null,t('Advanced settings')),
            h('label',null,t('Manual output limit'),h('input',{type:'number',min:1,step:1,value:form.output,onChange:e=>edit({output:e.target.value}),disabled:pending||!state||!form.manual})),
            h('p',{className:'ss-muted'},t(form.manual?'A manual limit takes priority over the server default and automatic calculation.':'Turn off Follow Strata output limit to enter a manual override.')))),
        h('label',{className:'ss-check'},h('input',{type:'checkbox',checked:form.follow,onChange:e=>edit({follow:e.target.checked}),disabled:pending||!state}),t('Follow the loaded Strata model as the default')),
        h('label',{className:'ss-check'},h('input',{type:'checkbox',checked:form.auto,onChange:e=>edit({auto:e.target.checked}),disabled:pending||!state}),t('Automatically sync when DSH starts')),
        h('p',{className:'ss-muted'},t('Syncs once on the next DSH start. Runtime checks only warn; they never apply changes.'))),
        h('details',{className:'ss-card ss-options','data-testid':'summary-target'},
          h('summary',{className:'ss-option-title'},h('span',null,t('Dynamic summary target')),h('span',{className:'ss-badge'},t(form.summaryGuidance?'Enabled':'Optional'))),
          h('label',{className:'ss-check'},h('input',{type:'checkbox','data-testid':'summary-guidance-toggle','aria-label':t('Enable summary guidance'),checked:form.summaryGuidance,onChange:e=>edit({summaryGuidance:e.target.checked}),disabled:pending||!state}),t('Enable summary guidance')),
          h('label',null,t('When to use guidance'),h('select',{'data-testid':'summary-guidance-mode','aria-label':t('When to use guidance'),value:form.summaryGuidanceMode,onChange:e=>edit({summaryGuidanceMode:e.target.value}),disabled:pending||!state||!form.summaryGuidance},
            h('option',{value:'after-truncation'},t('After summary truncation')),h('option',{value:'always'},t('Every summary')))),
          h('p',{'data-testid':'summary-mode-help',className:'ss-muted'},t(form.summaryGuidanceMode==='after-truncation'
            ?'The first summary uses native instructions. If it hits the output limit, subsequent native summaries in the same conversation use guidance until a compaction succeeds. No extra retry is started.'
            :'Guidance is added to every supported summary, including the first attempt.')),
          h('div',{className:'ss-grid'},
            h('label',null,t('Output budget divisor (estimated budget ÷ O)'),h('input',{type:'number','data-testid':'summary-output-divisor','aria-label':t('Output budget divisor (estimated budget ÷ O)'),'aria-invalid':!isDivisor(draft.summaryOutputDivisor),min:1,max:Number.MAX_SAFE_INTEGER,step:'any',value:form.summaryOutputDivisor,onChange:e=>edit({summaryOutputDivisor:e.target.value}),disabled:pending||!state})),
            h('label',null,t('Source length divisor (source estimate ÷ S)'),h('input',{type:'number','data-testid':'summary-source-divisor','aria-label':t('Source length divisor (source estimate ÷ S)'),'aria-invalid':!isDivisor(draft.summarySourceDivisor),min:1,max:Number.MAX_SAFE_INTEGER,step:'any',value:form.summarySourceDivisor,onChange:e=>edit({summarySourceDivisor:e.target.value}),disabled:pending||!state}))),
          state&&!validDivisor&&h('p',{className:'ss-status ss-error',role:'alert'},t('Enter a finite divisor of at least 1; decimals are allowed.')),
          h('label',{className:'ss-prompt-label'},t('Supplemental summary prompt'),h('textarea',{'data-testid':'summary-prompt','aria-label':t('Supplemental summary prompt'),'aria-invalid':!validPrompt,rows:2,value:form.summaryPrompt,onChange:e=>edit({summaryPrompt:e.target.value}),disabled:pending||!state,spellCheck:false})),
          state&&!validPrompt&&h('p',{className:'ss-status ss-error',role:'alert'},t('Use 1–2,048 characters and include {target}.')),
          h('button',{type:'button','data-testid':'summary-prompt-reset',disabled:pending||!state?.defaultSummaryPromptTemplate||form.summaryPrompt===state.defaultSummaryPromptTemplate,onClick:()=>edit({summaryPrompt:state.defaultSummaryPromptTemplate})},t('Restore default prompt')),
          h('p',{className:'ss-muted'},t("Appended to DSH's native prompt; {target} becomes the calculated token target. Save preferences to apply.")),
          h('details',{className:'ss-details','data-testid':'summary-details'},h('summary',null,t('Calculation and limits')),
            h('p',{className:'ss-muted'},t('Target = floor(min(estimated effective output budget / O, selected content estimate / S)). Default divisors: 2 and 2 (50% each).')),
            h('p',{className:'ss-muted'},t('The target also depends on the estimated remaining context and source length.'),' ',t('When guidance cannot be applied, DSH keeps its native summary behavior.')))),
        h('div',{className:'ss-actions'},
          h('button',{className:dirty?'primary':'',disabled:pending||!state||!form.providerId||!valid||!dirty||conflict,onClick:()=>action(async()=>{
            const changes=Object.fromEntries(Object.entries(values(formRef.current)).filter(([key,value])=>!Object.is(value,baseline.current.values[key])));
            const s=await rpc('configure',{...changes,expectedRevision:baseline.current.revision});
            requestSeq.current++;acceptStatus(s,true);setPreview(null);setNotice('Sync preferences saved.');
          })},t('Save preferences'))),
        state?.lastError&&h('div',{className:'ss-status ss-error'},diagnostic(typeof state.lastError==='string'?state.lastError:state.lastError.message)));
    }
    function apply(ctx) {
      const localeStore = {
        subscribe: listener => ctx.locale.subscribe(listener),
        getSnapshot: () => ctx.locale.getLocale().active,
      };
      const rpc = async (endpoint,payload) => {
        const result = await ctx.connection.rpc.call('/api','strata-sync/'+endpoint,payload);
        if (!result?.ok) {
          const error = new Error(result?.error?.message || 'dsh-strata-sync is not ready.');
          error.code = result?.error?.code;
          throw error;
        }
        return result.value;
      };
      ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name:'settings.section',id:'strata-sync',order:25,label:()=> 'dsh-strata-sync',inject:()=>({rpc,localeStore}),
      },SettingsPage)), 'strata-sync: settings page');
    }
    return {inject:['slots','connection','locale'],apply};
  },
});
