# dsh-strata-sync

[English](https://github.com/ethan741205/dsh-strata-sync/blob/main/README.md) · [简体中文](https://github.com/ethan741205/dsh-strata-sync/blob/main/docs/README.zh-CN.md) · **繁體中文**

讓 **DeepSeek Harness（DSH）** 連接 **Strata Server** 目前載入的模型，在同一個 DSH 設定頁管理模型配置與摘要控制。

外掛讀取 Strata 的模型資訊、預覽差異，再更新 DSH 自訂模型與上下文壓縮預算。它也會為支援的摘要請求補充可編輯的長度指令，幫助模型產生精簡的摘要。

## 可以做什麼

- **同步模型設定：**上下文視窗、回覆輸出上限，以及已確認的輸入類型和推理等級。
- **對齊壓縮預算：**更新已啟用的 DSH Agent 預設中，對應模型的壓縮政策。
- **控制摘要長度：**編輯補充提示詞，調整兩項目標長度比例。
- **啟動時同步：**可選擇在 DSH 啟動並閒置後同步一次。
- **預覽與復原：**檢查差異、備份設定，並查看最近一次同步結果。

外掛僅以唯讀方式存取 Strata Server。同步不會切換或載入伺服器模型、修改伺服器設定，也不會傳送測試推論請求。無法確認的模型能力會保留 DSH 原有值。

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

1. 選擇 Strata 提供方，點選**儲存偏好**。
2. 點選**檢查差異**，查看已載入模型與預計修改的設定。
3. 在 DSH 閒置時，點選**備份並同步**。
4. **開啟新對話**，使用更新後的模型與 Agent 預設。

既有對話會保留原先選定的模型路由和預設版本。如需自動設定，可勾選**啟動 DSH 時自動同步**並儲存。此選項預設關閉，下次啟動才生效；會等待閒置，不會持續輪詢。

## 模型與輸出設定

| 設定 | 如何決定 |
|---|---|
| 模型與上下文 | 採用 Strata 已載入的文字模型及已確認的上下文容量。 |
| 回覆輸出上限 | 優先使用手動覆寫值；否則採用已確認的 Strata 輸出預設值。無法取得或未限制時，使用上下文的 30%，最多 16,384 tokens。 |
| 輸入類型 | 採用伺服器已確認的能力，例如文字或文字＋圖片。 |
| 推理等級 | 依已驗證的模型範本決定；未知範本保留原有設定。 |
| 預設模型 | 啟用**預設模型跟隨 Strata 已載入的模型**時，跟隨伺服器目前模型。 |

保持**輸出上限跟隨 Strata**開啟，即可自動選擇。關閉後可在**進階設定**輸入手動覆寫值。預覽會分別顯示伺服器預設值、實際套用值及其來源。

同步時，外掛將摘要輸出上限和壓縮預留空間均設為 4,096 tokens。實際壓縮門檻取**上下文的 80%**與**上下文 − 回覆輸出預算 − 4,096**中的較小值，近期內容保留量為 **（上下文 − 回覆輸出預算）× 16%**，向下取整。這些是外掛計算的客戶端預算，並非 Strata 提供的設定。

例如，採用自動輸出計算時，32K 上下文的回覆預算為 9,830 tokens，壓縮門檻為 18,842 tokens，**不一定在 80% 時壓縮**。

## 摘要提示詞與目標長度

**動態摘要目標**預設關閉。啟用後會在 DSH 原生摘要指令後補充要求；關閉時使用 DSH 原生摘要與壓縮行為。

可編輯的**摘要補充提示詞**預設內容為：

```text
Keep the entire checkpoint, including all required headings, within a target of {target} tokens by retaining only information essential to continue the remaining work, consolidating prior summaries, and removing redundant or obsolete details.
```

請保留 `{target}`，每次支援的摘要請求前，它會替換成計算出的 token 目標。範本最多 2,048 個字元。點選**還原預設提示詞**可重設內容，再點選**儲存偏好**套用修改。

兩個除數控制目標，預設均為 **2（各取 50%）**：

| 除數 | 預設值 | 將目標限制為 |
|---|---:|---|
| 摘要輸出（O） | 2 | 估算有效摘要輸出預算 ÷ O |
| 原文長度（S） | 2 | 待摘要內容的估算長度 ÷ S |

目標取兩項結果的較小值，再向下取整。除數支援大於或等於 1 的小數。既有輸出／原文除數及明確的啟用選擇會保留，新安裝或未指定時仍**預設關閉**。

有效輸出預算是**估算值**，不是直接把請求的 `maxTokens` 當作伺服器確認的上限。它取本次摘要輸出上限與估算上下文剩餘空間中的較小值；後者使用已確認的伺服器／客戶端視窗較小值，扣除完整提示內容（包含系統提示、工具定義和補充句），再預留支援的 pi-ai 轉接器所用的 4,096 tokens 安全空間。文字以每 token 約 3.5 字元並加上格式成本估算。原文長度另採 DSH 的每 token 約 4 字元估算，不含系統提示、工具和摘要指令。兩者都不是精確 tokenizer 計數。

例如，有效輸出預算為 4,096 tokens 且原文足夠長時，32K 與 64K 上下文的目標都是 **2,048 tokens**；原文只有約 2,000 tokens 時，目標為 **1,000 tokens**。上下文剩餘空間不足時，目標會進一步降低。介面僅以提議的摘要上限預覽目標上界，尚未扣除個別請求的成本。

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
