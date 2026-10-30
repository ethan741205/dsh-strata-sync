# dsh-strata-sync

[English](https://github.com/ethan741205/dsh-strata-sync/blob/main/README.md) · [简体中文](https://github.com/ethan741205/dsh-strata-sync/blob/main/docs/README.zh-CN.md) · **繁體中文**

讓 **DeepSeek Harness（DSH）** 連接 **Strata Server** 目前載入的模型，在同一個 DSH 設定頁管理模型配置與摘要控制。

外掛讀取 Strata 的模型資訊、預覽差異，再更新 DSH 自訂模型與上下文壓縮預算。它也會為支援的摘要請求補充可編輯的長度指令，幫助模型產生精簡的摘要。

## 可以做什麼

- **同步模型設定：**上下文視窗、回覆輸出上限，以及已確認的輸入類型和推理等級。
- **對齊壓縮預算：**更新已啟用的 DSH Agent 預設中，對應模型的壓縮政策。
- **控制摘要長度：**編輯補充提示詞，調整兩項目標長度比例。
- **啟動時同步：**可選擇在 DSH 啟動後同步一次。
- **運行中偵測變更：**外掛啟用時即檢查 Strata 模型資訊，之後每 60 秒檢查一次，發現模型或設定不一致時提示。
- **預覽與復原：**檢查差異、備份設定，並查看最近一次同步結果。

外掛僅以唯讀方式存取 Strata Server。同步不會切換或載入伺服器模型、修改伺服器設定，也不會傳送測試推論請求。無法確認的模型能力會保留 DSH 原有值。

## 0.12.8 更新內容

- 在原生會話日誌記錄每次計算的摘要目標、是否確實加入指令，以及略過原因。
- 每次請求的生成結果與原生壓縮事件關聯，分辨截斷、取消、生成結束及檢查點正式提交。
- 日誌只包含有大小限制的中繼資料，保留原本摘要行為，不增加推論請求。
- 使用 DSH 實驗性的外掛紀錄介面；日誌不可用時，不會阻擋摘要。

詳見[日誌格式與原生保存測試](https://github.com/ethan741205/dsh-strata-sync/blob/main/docs/SUMMARY_AUDIT.md)及[驗證紀錄](https://github.com/ethan741205/dsh-strata-sync/blob/main/docs/VALIDATION.md)。自動化原生保存驗證使用可控測試回應。另完成兩輪真實 Strata 壓縮，均未截斷：預設模式記錄未套用目標，每次摘要模式記錄已套用 1,328-token 目標；全部 45 筆保存事件經原生讀取器重新讀取後完全一致。

## 開始使用

### 1. 準備連線

先在 Strata Server 載入模型，再到 **DSH → 設定 → 模型**，設定相容 OpenAI 的提供者、API 網址與認證，並明確新增自訂模型項目。

外掛直接沿用這個連線，不必另外複製 API key。

### 2. 安裝外掛

在 DSH 外掛管理員選擇**新增外掛**，輸入：

```text
dsh-strata-sync
```

也可以先完成目前工作、完全結束 DSH Desktop，再使用官方 CLI：

```sh
dsh plugin --profile desktop add dsh-strata-sync --registry=https://registry.npmjs.org/
```

若設定頁尚未出現，請重新開啟 DSH。若外掛處於停用狀態，請在外掛管理員啟用。

### 3. 預覽並同步

開啟**設定 → dsh-strata-sync**：

頁面上方是主要流程：**檢查差異 → 預覽變更 → 備份並同步**。下方的**同步偏好**與選用的**動態摘要目標**預設收合；展開後即可調整選項或編輯摘要補充提示詞。

差異預覽直接顯示對話預算、壓縮餘裕、摘要輸出上限、實際壓縮門檻與近期內容保留量。計算公式說明各項提議預算的來源。

1. 選擇 Strata 提供方，點選**儲存偏好**。
2. 點選**檢查差異**，查看已載入模型與預計修改的設定。
3. 點選**備份並同步**。
4. **開啟新對話**，使用更新後的模型與 Agent 預設。

既有對話會保留原先選定的模型路由和預設版本。如需自動設定，可勾選**啟動 DSH 時自動同步**並儲存。此選項預設關閉，下次啟動才生效；可在任務執行中同步，但只同步一次。

### 伺服器模型變更時

外掛啟用時即開始首次唯讀檢查，不必等待 60 秒；若同步操作正在進行，則等待該操作完成。有已設定的 Strata 提供者時，外掛會檢查已載入模型及已確認的上下文、輸出和能力設定，之後每 **60 秒**再次檢查，並與 DSH 的模型及壓縮設定比較；關閉設定頁後仍會檢查。偵測到模型／上下文變更或設定不一致時，設定頁會顯示警告；無法檢查時會另外提示，不會誤報已對齊。頁面每 15 秒更新檢查狀態，因此已完成的檢查可能不會立即顯示。

這些檢查**不會自動同步，也不會修改正在使用的對話**。在 Strata 切換模型後，請執行**檢查差異 → 備份並同步**，再**開啟新對話**。最近一次同步結果只是歷史紀錄，不代表既有對話已使用新預算。

## 模型與輸出設定

| 設定 | 如何決定 |
|---|---|
| 模型與上下文 | 採用 Strata 已載入的文字模型及已確認的上下文容量。 |
| 回覆輸出上限 | 優先使用手動覆寫值；否則採用已確認的 Strata 輸出預設值。無法取得或未限制時，使用 Strata 官方公式：上下文的 30%，最低 4,096、最高 32,768 tokens。 |
| 輸入類型 | 採用伺服器已確認的能力，例如文字或文字＋圖片。 |
| 推理等級 | 依已驗證的模型範本決定；未知範本保留原有設定。 |
| 預設模型 | 啟用**預設模型跟隨 Strata 已載入的模型**時，跟隨伺服器目前模型。 |

保持**輸出上限跟隨 Strata**開啟，即可自動選擇。關閉後可在**進階設定**輸入手動覆寫值。預覽會分別顯示伺服器預設值、實際套用值及其來源。

量化版本不改變已驗證模型家族的選項：Qwen3.8 Flash Next 提供 `off / low / medium / xhigh`；目前 DeepSeek Flash 範本提供 `off / low / medium / high / max`，原生預設是 `high`。舊範本仍採用其實際支援的選項；同步只更新可選等級，不改變目前選擇。詳見[已驗證的能力](https://github.com/ethan741205/dsh-strata-sync/blob/main/docs/CAPABILITIES.md)。

自動計算採用 [Strata 官方輸出公式](https://github.com/Niko1221/Strata/blob/main/apps/host/server/agent/profile.mjs)：`max(4096, min(32768, floor(context × 0.3)))`。

同步時，摘要輸出上限和壓縮餘裕通常均為 4,096 tokens。小視窗使用自動計算輸出時，兩者最多為剩餘對話預算的一半，向下取整；因此 8K 視窗使用 2,048。實際壓縮門檻取**上下文的 80%**與**上下文 − 回覆輸出預算 − 壓縮餘裕**中的較小值，近期內容保留量為 **（上下文 − 回覆輸出預算）× 16%**，向下取整。這些壓縮預算由外掛計算，並非 Strata 提供的設定。

例如，採用自動輸出計算時，32K 上下文的回覆預算為 9,830 tokens，壓縮門檻為 18,842 tokens，**不一定在 80% 時壓縮**。

## 摘要提示詞與目標長度

**動態摘要目標**預設開啟，採用**摘要截斷後**模式。你可以關閉，或選擇何時在 DSH 原生摘要指令後補充長度要求：

| 模式 | 行為 |
|---|---|
| **摘要截斷後**（`after-truncation`，預設模式） | 首次使用原生指令。摘要達到輸出 token 上限時，於同一對話、提供者和模型的下一次原生壓縮加入長度指引；未成功前持續使用，壓縮成功後恢復原生指令。 |
| **每次摘要**（`always`） | 從第一次開始，對每次支援的摘要加入長度指引。 |

模式儲存於 `summaryGuidanceMode`，`summaryGuidance` 仍是啟用開關。關閉時使用 DSH 原生摘要與壓縮行為；只選擇模式不會自行開啟指引。

**摘要截斷後**會等待 DSH 下一次壓縮嘗試，不會立即重試或額外發送模型請求。手動取消、網路／認證錯誤和上下文超限不會啟動指引。恢復狀態僅存於記憶體，關閉指引、切換模式、重新載入或重新啟動外掛時會清除；不同對話不共用此狀態。

可編輯的**摘要補充提示詞**預設內容為：

```text
Keep the entire checkpoint, including all required headings, within a target of {target} tokens by retaining only information essential to continue the remaining work, consolidating prior summaries, and removing redundant or obsolete details.
```

請保留 `{target}`，每次套用指引時，它會替換成計算出的 token 目標。範本最多 2,048 個字元。點選**還原預設提示詞**可重設內容，再點選**儲存偏好**套用修改。

兩個除數控制目標，預設均為 **2（各取 50%）**：

| 除數 | 預設值 | 將目標限制為 |
|---|---:|---|
| 摘要輸出（O） | 2 | 估算有效摘要輸出預算 ÷ O |
| 原文長度（S） | 2 | 待摘要內容的估算長度 ÷ S |

目標取兩項結果的較小值，再向下取整。除數支援大於或等於 1 的小數。既有輸出／原文除數及明確的啟用選擇會保留，新安裝或未指定時**預設開啟**，採用摘要截斷後模式；明確關閉的設定仍會保留。

有效輸出預算是**估算值**，不是直接把請求的 `maxTokens` 當作伺服器確認的上限。它取本次摘要輸出上限與估算上下文剩餘空間中的較小值；後者使用已確認的伺服器／客戶端視窗較小值，扣除完整提示內容（包含系統提示、工具定義和補充句），再預留支援的 pi-ai 轉接器所用的 4,096 tokens 安全空間。文字以每 token 約 3.5 字元並加上格式成本估算。原文長度另採 DSH 的每 token 約 4 字元估算，不含系統提示、工具和摘要指令。兩者都不是精確 tokenizer 計數。

例如，有效輸出預算為 4,096 tokens 且原文足夠長時，32K 與 64K 上下文的目標都是 **2,048 tokens**；原文只有約 2,000 tokens 時，目標為 **1,000 tokens**。上下文剩餘空間不足時，目標會進一步降低。目標會在每次支援的摘要請求中計算，差異預覽不顯示目標估計值。

這是寫作指令，**不是輸出硬上限，也不能保證不截斷**。思考可能共用輸出預算；外掛不會修改思考設定、`maxTokens`、`fit_max_tokens` 或壓縮時機。伺服器實際 tokenizer、後續中介層或不同轉接器版本仍可能產生更低的上限。

儲存摘要偏好不會改變模型預算，也不會替換原生提示詞或增加額外推論、重試循環。無法驗證請求、無法安全估算內容，或目標小於 256 tokens 時，會沿用原本的摘要請求。

## 備份與相容性

寫入設定前，會將 `cordis.patch.yml` 備份至設定目錄下的 `backups/strata-sync/`。同步會檢查是否有並行修改，並在後續步驟失敗時嘗試回復已完成的變更。備份可能包含私人設定，請儲存在本機。

移除外掛不會撤銷已經同步的設定。如需還原備份，請先完全結束 DSH。

已在 **DSH Desktop 0.2.1-rc.3** 上驗證。請使用 API key 或不需認證的 OpenAI 相容提供者，明確設定自訂模型清單，並啟用包含 `compaction-basic` 的 Agent 預設。不支援小於 8,192 tokens 的上下文、僅使用模型目錄的提供者、非空的 `modelOverrides`，或無法明確判斷已載入模型的資訊。

技術細節與測試範圍請見[已驗證能力與推理對應](https://github.com/ethan741205/dsh-strata-sync/blob/main/docs/CAPABILITIES.md)及[驗證紀錄](https://github.com/ethan741205/dsh-strata-sync/blob/main/docs/VALIDATION.md)。

## 開發

需要 Node.js 22 或更新版本。

```sh
git clone https://github.com/ethan741205/dsh-strata-sync.git
cd dsh-strata-sync
npm ci
npm test
npm run build
npm pack
```

安裝自行建置的版本前，請完全結束 DSH，再執行 `dsh plugin --profile desktop add <path-to-generated.tgz>`。

原始碼：`src/plugin.mjs`（宿主整合）、`src/core.mjs`（資訊讀取與預算）、`src/summary.mjs`（摘要引導）、`src/client.js`（設定介面）。

[npm](https://www.npmjs.com/package/dsh-strata-sync) · [回報問題](https://github.com/ethan741205/dsh-strata-sync/issues) · [MIT 授權](https://github.com/ethan741205/dsh-strata-sync/blob/main/LICENSE)
