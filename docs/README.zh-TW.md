# dsh-strata-sync

[English](https://github.com/ethan741205/dsh-strata-sync/blob/main/README.md) · [简体中文](https://github.com/ethan741205/dsh-strata-sync/blob/main/docs/README.zh-CN.md) · **繁體中文**

讓 **DeepSeek Harness（DSH）** 對齊 **Strata Server** 實際載入的模型，並在 DSH **設定 → dsh-strata-sync** 中提供操作介面。

UI 支援 English、简体中文、繁體中文。自動跟隨 DSH 介面語言並即時更新，不提供獨立語言選單。DSH 的 `zh` 對應簡體中文，`zh-Hant`、`zh-TW`、`zh-HK`、`zh-MO` 對應繁體中文；其他語言使用英文。伺服器傳回的未知診斷訊息保留原文，以利排查。

0.10.0 精簡摘要設定，並讓補充提示詞可直接編輯。可保留預設範本，或使用動態 `{target}` 自訂內容；DSH 原生提示詞與輸出硬上限保持不變。

## 功能

### 動態摘要引導

精簡的「**動態摘要目標**」區塊包含啟用開關、上下文除數和可編輯的「**摘要補充提示詞**」；展開「**計算方式與限制**」可調整摘要輸出與原文長度的除數，並查看公式與限制。功能預設開啟，關閉後仍保留 DSH 原生摘要與自動壓縮。

編輯框直接顯示實際附加至原生提示詞的範本，預設內容如下：

```text
Keep the entire checkpoint, including all required headings, within a target of {target} tokens by retaining only information essential to continue the remaining work, consolidating prior summaries, and removing redundant or obsolete details.
```

範本須保留字面的 `{target}`，每次摘要時會將所有出現位置替換為當次計算的目標。長度最多 2,048 個字元；只做文字替換，不執行程式碼。「**還原預設提示詞**」會將編輯框恢復為原本的英文範本，修改或還原後按「**儲存偏好**」才會套用。切換介面語言不會翻譯或覆寫已儲存的範本。這裡只編輯補充內容，不修改 DSH 原生摘要指令。

| 外掛偏好 | 預設值 | 含義 |
|---|---:|---|
| `summaryGuidance` | `true` | 對支援的摘要請求附加補充提示詞。 |
| `summaryContextDivisor` | `16` | 以上下文除以此值。 |
| `summaryOutputDivisor` | `2` | 以當次摘要輸出硬上限除以此值。 |
| `summarySourceDivisor` | `2` | 以原文估算長度除以此值。 |
| `summaryPromptTemplate` | 上方英文範本 | 替換 `{target}` 後附加的補充內容。 |

三項除數都接受至少為 1 的有限數值，也支援 1.5、2.5 等小數。除數越大，對應限制越小；最終取三項限制的最小值並向下取整，不會改變實際輸出硬上限。

每次支援的摘要請求都會重新計算：

```text
上下文 = min(已確認的 Strata 上下文, DSH 既有模型上下文)
目標 = floor(min(上下文 / summaryContextDivisor,
                 本次摘要實際 maxTokens / summaryOutputDivisor,
                 待替換內容的估算 tokens / summarySourceDivisor))
```

原文估算涵蓋這次要替換的對話片段與其中的舊摘要，不含系統提示詞和工具定義。唯讀查詢核對載入模型與上下文，實際輸出硬上限來自當次請求。32K 上下文、4,096-token 摘要上限且原文足夠長時，上下文除數 32、16、8 分別得到 1,024、2,048、2,048 tokens。UI 預覽顯示目標上限，不是未來請求的實際目標。

儲存這些控制項只更改外掛偏好，不會同步模型預算或修改 Strata Server 設定。DSH 原生提示詞、八個章節和請求參數保持不變。預設補充內容只有一句，自訂範本則按輸入內容附加。目標是寫作指令，**不是新的輸出硬上限，也不能保證不截斷**；不增加重試流程或額外推論請求。

無法確認路由或資訊、原生提示詞格式未知、附件用量無法估算、範本無效、請求取消、功能關閉或目標低於 256 tokens 時，保留原生請求。移除外掛會停止附加內容，不重寫已儲存的對話歷史。

### 模型能力自動同步（0.4.0）

預覽新增「輸入類型」、「推理等級」和「推理請求對應」，與 token 預算共用備份、回復及閒置才套用的保護。

- 輸入類型依伺服器明確回報的 `architecture.input_modalities` 設定為文字或文字＋圖片；缺少資訊或格式不支援時保留原值。
- 推理等級從 `/props?model=...` 核對 Strata 身分、模型身分及已審查的對話範本指紋，不單憑名稱猜測。
- 已驗證的 Qwen3.8-Flash-Next：**off／low／medium／xhigh**；DeepSeek-V4.1-Flash：**off／low／high／max**。包含已核對的 Huihui 版本，以範本而非量化名稱判定。
- 使用 DSH 原生請求對應，同時設定是否思考及推理等級。範本未知或無法取得 props 時，保留原推理設定並顯示原因。
- 不修改供應者預設等級或目前對話選擇。供應者預設值與已驗證選項衝突時，跳過推理同步並提示。同步後請開新對話。

詳見[能力驗證與對應表](https://github.com/ethan741205/dsh-strata-sync/blob/main/docs/CAPABILITIES.md)。不新增其他外掛、不修改 Strata 設定。

### 既有同步功能

- 讀取 `/v1/models` 與可用的 `/slots`，確認文字模型的正式 ID 和引擎實際上下文，不從模型名稱猜測。已確認的別名視為同一模型，圖片生成端點不列入文字模型選擇。
- 更新選定 DSH 模型的上下文、輸出上限，以及已啟用 Agent 範本中的原生 `compaction-basic` 策略；預覽會列出受影響的範本。
- 預設使用「跟隨 Strata」選擇輸出上限；手動覆寫放在「進階設定」。分開顯示伺服器原值、實際採用值與來源，也可選擇讓預設模型跟隨伺服器。
- 自動同步預設關閉；在啟動前啟用後，每次 DSH 宿主程序啟動、所有工作閒置時同步一次。查詢途中開始工作時保留待同步狀態，工作完成後補做；成功後不再定期查詢。其他錯誤需手動重試或下次啟動再試。執行期間啟用會在下次啟動生效；立即同步請按「備份並同步」。
- 套用前重新確認伺服器與同一份設定版本、拒絕過期預覽、備份設定；後續寫入失敗時回復已完成的變更。偏好儲存也會核對版本；未編輯的表單跟隨最新值，已有編輯時提示衝突，避免覆蓋其他視窗的變更。
- 同步完成後保留唯讀結果，包含模型、預算、輸出來源及備份資訊，並區分已確認與保留原值的能力。
- 沿用 DSH 現有認證，不在頁面或診斷中顯示金鑰，不跟隨 HTTP 重新導向。

**同步模型或預算設定後請開新對話。** 既有對話保留原模型路由與 Agent 範本版本；外掛不重寫既有對話、不重啟 DSH，也不增加額外推論請求。新版外掛啟用期間，動態摘要引導會作用於支援的摘要請求，不需要修改這些已儲存設定。

## 安裝與使用

套件名稱為 `dsh-strata-sync`（原名 `@ethan741205/dsh-strata-sync`）；遷移時保留原設定，移除舊 scoped 插件後再安裝新套件，避免同時載入兩份。


若要安裝既有的 npm 版本，先完成工作並完全結束 DSH Desktop，再使用官方 DSH CLI 從 npm 官方 registry 安裝：

```sh
dsh plugin --profile desktop add dsh-strata-sync --registry=https://registry.npmjs.org/
```

完成後重新開啟 DSH。首次安裝會自動選取 bundle；已安裝但停用的 bundle 需在外掛管理員重新啟用。

要從原始碼安裝**包含摘要提示詞編輯器的 0.10.0**，請使用 Node.js 22 或更新版本建置，並在最後的安裝命令前完成工作、完全結束 DSH Desktop：

```sh
git clone https://github.com/ethan741205/dsh-strata-sync.git
cd dsh-strata-sync
npm ci
npm test
npm pack
dsh plugin --profile desktop add ./dsh-strata-sync-0.10.0.tgz
```

執行最後一行前同樣需要完全結束 DSH Desktop，安裝完成後重新開啟。在其他目錄執行時，請使用套件的絕對路徑。

先在 DSH 模型設定建立 Strata 供應者，再開啟 **設定 → dsh-strata-sync**：

1. 選擇既有 Strata 供應者，按「儲存偏好」。保留「跟隨 Strata」，需要手動覆寫輸出上限時再展開「進階設定」。
2. 按「檢查差異」，預覽目前載入模型與建議設定。
3. DSH 閒置時按「備份並同步」。
4. 如需自動同步，勾選「啟動 DSH 時自動同步」並儲存，下次啟動生效。原有 `autoSync: true` 會沿用為啟動同步。
5. 開啟新對話，使用更新後的 Agent 範本。

「動態摘要目標」控制項獨立於模型同步。保持「啟用摘要提示補充」開啟、使用預設範本及 16／2／2 的除數，即沿用先前行為，也可修改後儲存偏好。關閉此開關不會停用 DSH 自身的壓縮功能。

不需要把 API key 複製到此外掛；認證問題請在 DSH 模型設定處理。

## 相容性

以 **DSH Desktop 0.2.1-rc.3** 開發及驗證。需要標準桌面服務 `configEditor`、`connection`、`agents`、`credentials`、`llm-pi-ai`，以及含 `compaction-basic` 的已啟用 Agent 範本，或作用中的舊式全域壓縮外掛。僅支援 API key 或無認證的 `openai-completions` 供應者。

Strata 供應者必須明確設定非空的自訂 `models` 清單。僅依賴內建模型目錄，或含非空 `modelOverrides` 的路由，會在預覽時拒絕，尚未備份或寫入；外掛不會將目錄型供應者轉換成自訂清單，或混用不相容格式。

無法確認上下文、未載入文字模型、多個文字模型無法判定、slot 容量互相衝突時，會拒絕同步。別名會對應至已載入的正式模型，明確輸出非文字的端點會排除；無效別名鏈會拒絕。目前 UI 跟隨單一已載入文字模型，不提供多模型選擇器。

啟動等待排程含 DSH 0.2.1-rc.3 的 HMR `executing.exit` 相容處理，避免計時器保留已完成的設定交易；所有寫入仍透過 ConfigEditor 的正常佇列。升級 DSH 後需重新驗證此相容處理。

## 預算策略

Strata 透過 `/props?model=...` 的 `default_generation_settings.params.n_predict` 提供共用 `max_tokens` 預設值，以及模型與上下文資訊。這不是模型硬性上限，客戶端明確指定的請求值會覆寫它。Strata **不提供 DSH 壓縮策略**。下列是此外掛的用戶端策略，配合 DSH 0.2.1-rc.3 原生 4,096-token 上下文安全餘裕：

```text
一般輸出 = 明確手動覆寫值，否則採用已確認的伺服器正整數 n_predict
備用輸出 = min(16384, floor(上下文 × 0.30))
壓縮餘裕 = 4096
摘要 maxTokens = 4096
thresholdRatio = 0.8
retainRatio = 0.16
實際壓縮門檻 = floor(min(上下文 × 0.8, 上下文 − 一般輸出 − 4096))
近期對話保留量 = floor((上下文 − 一般輸出) × 0.16)
```

輸出選擇順序：手動覆寫 → 已確認的伺服器正整數值 → 自動計算。缺少值、null、`-1` 或 `0` 代表沒有固定上限；無法取得或確認伺服器與模型身分時，也使用備用計算並顯示原因。明確但格式錯誤的值會拒絕同步；正數上限若使壓縮空間不足，也會拒絕，不會偷偷換成別的值。UI 顯示「Strata Server 預設值／手動覆寫／自動計算」。摘要上限仍是 4,096，壓縮門檻與保留量依選定的一般輸出上限重算。

下表為沒有手動覆寫或固定伺服器上限時的備用計算範例：

| 上下文 | 一般輸出 | 摘要輸出 | 壓縮餘裕 | 壓縮門檻 | 近期保留量 |
|---|---:|---:|---:|---:|---:|
| 32,768 | 9,830 | 4,096 | 4,096 | 18,842（57.50%） | 3,670 |
| 65,536 | 16,384 | 4,096 | 4,096 | 45,056（68.75%） | 7,864 |

自訂輸出上限必須保留有效的正數壓縮預算，且近期保留量須低於門檻。不支援小於 8,192 的上下文。推理選項僅於確認支援時同步；保留認證、其他供應者與其他模型策略；選定路由的保留量統一為 `retainRatio: 0.16`，以免沿用不相容的絕對值。

此策略可修正 32K 路由沿用原生 `headroomTokens: 65536` 等不適當預算。動態摘要引導依本次摘要上限計算較短的寫作目標，不會提高或降低硬上限；兩項功能都**不能保證模型每次都能在輸出上限內完成回答或摘要**，推理也會消耗輸出 tokens。不讀取或修改 Strata 的 `fit_max_tokens`；伺服器設為 `false` 也不會停用 DSH 自身的輸出限制。

## 備份與復原

每次套用前，將目前 `cordis.patch.yml` 備份至 profile 旁的 `backups/strata-sync/`，UI 會顯示路徑。備份可能包含私人供應者設定，請留在本機，不要公開。

ConfigEditor 負責個別原子寫入與熱載入；跨多項設定採補償回復，並非資料庫交易。若同時有外部修改，可能需要依備份手動復原。關閉自動同步可取消尚未執行的啟動同步，並停用後續啟動同步；移除外掛**不會撤銷已套用的模型與預算**。需要還原時，請先關閉 DSH 再恢復指定備份。

## 開發與版本

0.10.0 加入補充提示詞編輯器、動態 `{target}` 與還原預設功能，精簡三語摘要區塊，新增進階輸出／原文除數與三項除數的小數支援，並沿用備份與版本衝突保護。

0.9.0 加入預設開啟的摘要提示補充開關及可調整的上下文除數（預設 16），沿用偏好儲存與版本衝突保護，並同步三語介面和文件。儲存這兩個控制項不改變原生摘要指令、輸出硬上限、其他預算或伺服器設定。

0.5.0 移除獨立語言選單與產品聲明，改為跟隨 DSH 語言及啟動時單次同步。0.3.0 首次加入三語 UI，0.2.0 將 UI 移入原生設定。

`src/plugin.mjs` 為宿主外掛，`src/client.js` 為原生 ModuleLoader/React UI，`src/core.mjs` 負責資訊讀取與純預算計算，`src/summary.mjs` 提供原生摘要請求中介層。執行 `npm test`、`npm run build`、`npm pack --dry-run` 驗證。套件只包含原創外掛程式，不包含私人應用程式原始碼、認證或對話。

自動測試涵蓋資訊讀取、認證與重新導向安全、預算、回復、並行修改、啟動等待、別名與非文字生成模型、HMR 去重、範本啟用、請求對應及三語介面。動態摘要測試涵蓋目標計算與原生請求整合；UI 測試確認預覽上限與每次請求實際目標的區別。測試使用模擬服務，不產生模型回答，也不代表實際截斷率已驗證。版本與驗證範圍見 [VALIDATION](https://github.com/ethan741205/dsh-strata-sync/blob/main/docs/VALIDATION.md)。參考：[DSH 壓縮文件](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/compaction/compaction-basic/README.md)、[Strata](https://github.com/Niko1221/Strata)。

MIT 授權。
