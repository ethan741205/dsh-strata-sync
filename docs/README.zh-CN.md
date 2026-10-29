# dsh-strata-sync

[English](https://github.com/ethan741205/dsh-strata-sync/blob/main/README.md) · **简体中文** · [繁體中文](https://github.com/ethan741205/dsh-strata-sync/blob/main/docs/README.zh-TW.md)

让 **DeepSeek Harness（DSH）** 对齐 **Strata Server** 实际加载的模型，并在 DSH **设置 → dsh-strata-sync** 中提供操作界面。

UI 支持 English、简体中文、繁體中文。自动跟随 DSH 界面语言并实时更新，不提供独立语言菜单。DSH 的 `zh` 对应简体中文，`zh-Hant`、`zh-TW`、`zh-HK`、`zh-MO` 对应繁体中文；其他语言使用英文。服务器返回的未知诊断消息保留原文，方便排查。

0.10.0 精简摘要设置，并让补充提示词可直接编辑。可保留默认模板，或使用动态 `{target}` 自定义内容；DSH 原生提示词与输出硬上限保持不变。

## 功能

### 动态摘要引导

精简的“**动态摘要目标**”区域包含启用开关、上下文除数和可编辑的“**摘要补充提示词**”；展开“**计算方式与限制**”可调整摘要输出与原文长度的除数，并查看公式与限制。功能默认开启，关闭后仍保留 DSH 原生摘要与自动压缩。

编辑框直接显示实际附加到原生提示词的模板，默认内容如下：

```text
Keep the entire checkpoint, including all required headings, within a target of {target} tokens by retaining only information essential to continue the remaining work, consolidating prior summaries, and removing redundant or obsolete details.
```

模板须保留字面的 `{target}`，每次摘要时会将所有出现位置替换为本次计算的目标。长度最多 2,048 个字符；只做文本替换，不执行代码。“**恢复默认提示词**”会将编辑框恢复为原本的英文模板，修改或恢复后点击“**保存偏好**”才会应用。切换界面语言不会翻译或覆盖已保存的模板。这里只编辑补充内容，不修改 DSH 原生摘要指令。

| 插件偏好 | 默认值 | 含义 |
|---|---:|---|
| `summaryGuidance` | `true` | 对支持的摘要请求附加补充提示词。 |
| `summaryContextDivisor` | `16` | 以上下文除以此值。 |
| `summaryOutputDivisor` | `2` | 以本次摘要输出硬上限除以此值。 |
| `summarySourceDivisor` | `2` | 以原文估算长度除以此值。 |
| `summaryPromptTemplate` | 上方英文模板 | 替换 `{target}` 后附加的补充内容。 |

三项除数都接受至少为 1 的有限数值，也支持 1.5、2.5 等小数。除数越大，对应限制越小；最终取三项限制的最小值并向下取整，不会改变实际输出硬上限。

每次支持的摘要请求都会重新计算：

```text
上下文 = min(已确认的 Strata 上下文, DSH 已有模型上下文)
目标 = floor(min(上下文 / summaryContextDivisor,
                 本次摘要实际 maxTokens / summaryOutputDivisor,
                 待替换内容的估算 tokens / summarySourceDivisor))
```

原文估算涵盖这次要替换的对话片段及其中的旧摘要，不含系统提示词和工具定义。只读查询核对加载模型与上下文，实际输出硬上限来自当前请求。32K 上下文、4,096-token 摘要上限且原文足够长时，上下文除数 32、16、8 分别得到 1,024、2,048、2,048 tokens。UI 预览显示目标上限，不是未来请求的实际目标。

保存这些控件只修改插件偏好，不会同步模型预算或修改 Strata Server 设置。DSH 原生提示词、八个章节和请求参数保持不变。默认补充内容只有一句，自定义模板则按输入内容附加。目标是写作指令，**不是新的输出硬上限，也不能保证不截断**；不增加重试流程或额外推理请求。

无法确认路由或信息、原生提示词格式未知、附件用量无法估算、模板无效、请求取消、功能关闭或目标低于 256 tokens 时，保留原生请求。移除插件会停止附加内容，不改写已保存的对话历史。

### 模型能力自动同步（0.4.0）

预览新增“输入类型”“推理等级”和“推理请求映射”，与 token 预算共用备份、回滚及空闲时才应用的保护。

- 输入类型按服务器明确报告的 `architecture.input_modalities` 设置为文本或文本＋图片；缺少信息或格式不支持时保留原值。
- 推理等级从 `/props?model=...` 核对 Strata 身份、模型身份及已审查的对话模板指纹，不只凭名称猜测。
- 已验证的 Qwen3.8-Flash-Next：**off／low／medium／xhigh**；DeepSeek-V4.1-Flash：**off／low／high／max**。包含已核对的 Huihui 版本，以模板而非量化名称判定。
- 使用 DSH 原生请求映射，同时设置是否思考及推理等级。模板未知或无法获取 props 时，保留原推理设置并显示原因。
- 不修改提供方默认等级或当前对话选择。提供方默认值与已验证选项冲突时，跳过推理同步并提示。同步后请开启新对话。

详见[能力验证与映射表](https://github.com/ethan741205/dsh-strata-sync/blob/main/docs/CAPABILITIES.md)。不新增其他插件、不修改 Strata 设置。

### 已有同步功能

- 读取 `/v1/models` 和可用的 `/slots`，确认文本模型的正式 ID 和引擎实际上下文，不从模型名称猜测。已确认的别名视为同一模型，图片生成端点不计入文本模型选择。
- 更新选定 DSH 模型的上下文、输出上限，以及已启用 Agent 预设中的原生 `compaction-basic` 策略；预览会列出受影响的预设。
- 默认使用“跟随 Strata”选择输出上限；手动覆盖放在“高级设置”。分别显示服务器原值、实际采用值与来源，也可选择让默认模型跟随服务器。
- 自动同步默认关闭；在启动前启用后，每次 DSH 宿主进程启动、所有任务空闲时同步一次。查询途中开始任务时保留待同步状态，任务完成后补做；成功后不再定期查询。其他错误需手动重试或下次启动再试。运行期间启用会在下次启动生效；立即同步请点击“备份并同步”。
- 应用前重新确认服务器与同一份设置版本、拒绝过期预览、备份设置；后续写入失败时回滚已完成的更改。偏好保存也会核对版本；未编辑的表单跟随最新值，已有编辑时提示冲突，避免覆盖其他窗口的更改。
- 同步完成后保留只读结果，包含模型、预算、输出来源及备份信息，并区分已确认与保留原值的能力。
- 沿用 DSH 现有认证，不在页面或诊断中显示密钥，不跟随 HTTP 重定向。

**同步模型或预算设置后请开启新对话。** 已有对话保留原模型路由与 Agent 预设版本；插件不改写已有对话、不重启 DSH，也不增加额外推理请求。新版插件启用期间，动态摘要引导会作用于支持的摘要请求，不需要修改这些已保存设置。

## 安装与使用

包名为 `dsh-strata-sync`（原名 `@ethan741205/dsh-strata-sync`）；迁移时保留原设置，移除旧 scoped 插件后再安装新包，避免同时加载两份。


如需安装已有的 npm 版本，先完成任务并完全退出 DSH Desktop，再使用官方 DSH CLI 从 npm 官方 registry 安装：

```sh
dsh plugin --profile desktop add dsh-strata-sync --registry=https://registry.npmjs.org/
```

完成后重新打开 DSH。首次安装会自动选中 bundle；已安装但禁用的 bundle 需在插件管理器重新启用。

要从源码安装**包含摘要提示词编辑器的 0.10.0**，请使用 Node.js 22 或更新版本构建，并在最后的安装命令前完成任务、完全退出 DSH Desktop：

```sh
git clone https://github.com/ethan741205/dsh-strata-sync.git
cd dsh-strata-sync
npm ci
npm test
npm pack
dsh plugin --profile desktop add ./dsh-strata-sync-0.10.0.tgz
```

执行最后一行前同样需要完全退出 DSH Desktop，安装完成后重新打开。在其他目录执行时，请使用安装包的绝对路径。

先在 DSH 模型设置建立 Strata 提供方，再打开 **设置 → dsh-strata-sync**：

1. 选择已有 Strata 提供方，点击“保存偏好”。保留“跟随 Strata”，需要手动覆盖输出上限时再展开“高级设置”。
2. 点击“检查差异”，预览当前加载模型与建议设置。
3. DSH 空闲时点击“备份并同步”。
4. 如需自动同步，勾选“启动 DSH 时自动同步”并保存，下次启动生效。原有 `autoSync: true` 会沿用为启动同步。
5. 开启新对话，使用更新后的 Agent 预设。

“动态摘要目标”控件独立于模型同步。保持“启用摘要提示补充”开启、使用默认模板及 16／2／2 的除数，即沿用先前行为，也可修改后保存偏好。关闭此开关不会禁用 DSH 自身的压缩功能。

无需把 API key 复制到此插件；认证问题请在 DSH 模型设置处理。

## 兼容性

基于 **DSH Desktop 0.2.1-rc.3** 开发和验证。需要标准桌面服务 `configEditor`、`connection`、`agents`、`credentials`、`llm-pi-ai`，以及包含 `compaction-basic` 的已启用 Agent 预设，或生效中的旧式全局压缩插件。仅支持 API key 或无认证的 `openai-completions` 提供方。

Strata 提供方必须明确设置非空的自定义 `models` 列表。仅依赖内置模型目录，或包含非空 `modelOverrides` 的路由，会在预览时拒绝，尚未备份或写入；插件不会将目录型提供方转换为自定义列表，或混用不兼容格式。

无法确认上下文、未加载文本模型、多个文本模型无法判定、slot 容量相互冲突时，会拒绝同步。别名会对应到已加载的正式模型，明确输出非文本的端点会排除；无效别名链会拒绝。目前 UI 跟随单个已加载文本模型，不提供多模型选择器。

启动等待调度包含 DSH 0.2.1-rc.3 的 HMR `executing.exit` 兼容处理，避免计时器保留已完成的设置事务；所有写入仍通过 ConfigEditor 的正常队列。升级 DSH 后需重新验证此兼容处理。

## 预算策略

Strata 通过 `/props?model=...` 的 `default_generation_settings.params.n_predict` 提供共享 `max_tokens` 默认值，以及模型与上下文信息。这不是模型硬性上限，客户端明确指定的请求值会覆盖它。Strata **不提供 DSH 压缩策略**。以下是此插件的客户端策略，配合 DSH 0.2.1-rc.3 原生 4,096-token 上下文安全余量：

```text
普通输出 = 明确手动覆盖值，否则采用已确认的服务器正整数 n_predict
备用输出 = min(16384, floor(上下文 × 0.30))
压缩余量 = 4096
摘要 maxTokens = 4096
thresholdRatio = 0.8
retainRatio = 0.16
实际压缩阈值 = floor(min(上下文 × 0.8, 上下文 − 普通输出 − 4096))
近期对话保留量 = floor((上下文 − 普通输出) × 0.16)
```

输出选择顺序：手动覆盖 → 已确认的服务器正整数值 → 自动计算。缺少值、null、`-1` 或 `0` 表示没有固定上限；无法获取或确认服务器与模型身份时，也使用备用计算并显示原因。明确但格式错误的值会拒绝同步；正数上限若使压缩空间不足，也会拒绝，不会悄悄换成其他值。UI 显示“Strata Server 默认值／手动覆盖／自动计算”。摘要上限仍是 4,096，压缩阈值与保留量按选定的普通输出上限重算。

下表为没有手动覆盖或固定服务器上限时的备用计算示例：

| 上下文 | 普通输出 | 摘要输出 | 压缩余量 | 压缩阈值 | 近期保留量 |
|---|---:|---:|---:|---:|---:|
| 32,768 | 9,830 | 4,096 | 4,096 | 18,842（57.50%） | 3,670 |
| 65,536 | 16,384 | 4,096 | 4,096 | 45,056（68.75%） | 7,864 |

自定义输出上限必须留下有效的正数压缩预算，且近期保留量须低于阈值。不支持小于 8,192 的上下文。推理选项仅在确认支持时同步；保留认证、其他提供方与其他模型策略；选定路由的保留量统一为 `retainRatio: 0.16`，避免沿用不兼容的绝对值。

此策略可修正 32K 路由沿用原生 `headroomTokens: 65536` 等不适当预算。动态摘要引导根据本次摘要上限计算较短的写作目标，不会提高或降低硬上限；两项功能都**不能保证模型每次都能在输出上限内完成回答或摘要**，推理也会消耗输出 tokens。不读取或修改 Strata 的 `fit_max_tokens`；服务器设为 `false` 也不会禁用 DSH 自身的输出限制。

## 备份与恢复

每次应用前，将当前 `cordis.patch.yml` 备份至 profile 旁的 `backups/strata-sync/`，UI 会显示路径。备份可能包含私人提供方设置，请保留在本机，不要公开。

ConfigEditor 负责单项原子写入与热加载；跨多项设置采用补偿回滚，并非数据库事务。如果同时有外部修改，可能需要依据备份手动恢复。关闭自动同步可取消尚未执行的启动同步，并禁用后续启动同步；移除插件**不会撤销已应用的模型与预算**。需要还原时，请先关闭 DSH 再恢复指定备份。

## 开发与版本

0.10.0 加入补充提示词编辑器、动态 `{target}` 与恢复默认功能，精简三语摘要区域，新增高级输出／原文除数与三项除数的小数支持，并沿用备份与版本冲突保护。

0.9.0 加入默认开启的摘要提示补充开关及可调整的上下文除数（默认 16），沿用偏好保存与版本冲突保护，并同步三语界面和文档。保存这两个控件不改变原生摘要指令、输出硬上限、其他预算或服务器设置。

0.5.0 移除独立语言菜单与产品声明，改为跟随 DSH 语言及启动时单次同步。0.3.0 首次加入三语 UI，0.2.0 将 UI 移入原生设置。

`src/plugin.mjs` 为宿主插件，`src/client.js` 为原生 ModuleLoader/React UI，`src/core.mjs` 负责信息读取与纯预算计算，`src/summary.mjs` 提供原生摘要请求中间件。执行 `npm test`、`npm run build`、`npm pack --dry-run` 验证。安装包只包含原创插件代码，不包含私人应用程序源码、认证或对话。

自动测试覆盖信息读取、认证与重定向安全、预算、回滚、并发修改、启动等待、别名与非文本生成模型、HMR 去重、预设启用、请求映射及三语界面。动态摘要测试覆盖目标计算与原生请求整合；UI 测试确认预览上限与每次请求实际目标的区别。测试使用模拟服务，不生成模型回答，也不代表实际截断率已验证。版本与验证范围见 [VALIDATION](https://github.com/ethan741205/dsh-strata-sync/blob/main/docs/VALIDATION.md)。参考：[DSH 压缩文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/compaction/compaction-basic/README.md)、[Strata](https://github.com/Niko1221/Strata)。

MIT 许可。
