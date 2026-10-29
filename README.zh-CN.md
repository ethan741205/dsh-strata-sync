# DSH Strata Sync

[English](README.md) · **简体中文** · [繁體中文](README.zh-TW.md)

让 **DeepSeek Harness（DSH）** 对齐 **Strata Server** 实际加载的模型，并在 DSH **设置 → Strata Sync** 中提供操作界面。这是社区插件，非 DeepSeek 或 Strata 官方产品。

UI 支持 English、简体中文、繁體中文。在插件页面上方的“语言”菜单切换；默认英文，选择保存在当前浏览器的本地存储中，不修改 DSH 全局语言或模型设置。服务器返回的未知诊断消息保留原文，方便排查。

![简体中文设置界面](https://raw.githubusercontent.com/ethan741205/dsh-strata-sync/main/docs/ui-zh-CN.jpg?v=0.4.0)

0.4.1 改善差异表：数值对齐、能力标签、可展开的参数映射，以及窄窗口逐项比较。

## 功能

### 模型能力自动同步（0.4.0）

预览新增“输入类型”“推理等级”和“推理请求映射”，与 token 预算共用备份、回滚及空闲时才应用的保护。

- 输入类型按服务器明确报告的 `architecture.input_modalities` 设置为文本或文本＋图片；缺少信息或格式不支持时保留原值。
- 推理等级从 `/props?model=...` 核对 Strata 身份、模型身份及已审查的对话模板指纹，不只凭名称猜测。
- 已验证的 Qwen3.8-Flash-Next：**off／low／medium／xhigh**；DeepSeek-V4.1-Flash：**off／low／high／max**。包含已核对的 Huihui 版本，以模板而非量化名称判定。
- 使用 DSH 原生请求映射，同时设置是否思考及推理等级。模板未知或无法获取 props 时，保留原推理设置并显示原因。
- 不修改提供方默认等级或当前对话选择。提供方默认值与已验证选项冲突时，跳过推理同步并提示。同步后请开启新对话。

详见[能力验证与映射表](docs/CAPABILITIES.md)。不新增其他插件、不修改 Strata 设置。

### 已有同步功能

- 读取 `/v1/models` 和可用的 `/slots`，确认模型 ID 和引擎实际上下文，不从模型名称猜测。
- 更新选定 DSH 模型的上下文、输出上限，以及已启用 Agent 预设中的原生 `compaction-basic` 策略；预览会列出受影响的预设。
- 区分服务器报告值与插件计算的客户端预算，可自定义输出上限、选择让默认模型跟随服务器。
- 自动同步默认关闭；启用后每 60 秒检查，仅在所有 DSH 任务空闲时应用。
- 应用前重新确认服务器、拒绝过期预览、备份设置；后续写入失败时回滚已完成的更改。
- 沿用 DSH 现有认证，不在页面或诊断中显示密钥，不跟随 HTTP 重定向。

**同步后请开启新对话。** 已有对话保留原模型路由与 Agent 预设版本；插件不改写已有对话、不重启 DSH，也不向模型发送推理请求。

## 安装与使用

需要 Node.js 22 或更新版本：

```sh
git clone https://github.com/ethan741205/dsh-strata-sync.git
cd dsh-strata-sync
npm ci
npm test
npm pack
dsh plugin --profile desktop add ./ethan741205-dsh-strata-sync-0.4.1.tgz
```

执行最后一行前，先完成任务并完全退出 DSH Desktop，再使用官方 CLI 安装，完成后重新打开。在其他目录执行时，请使用安装包的绝对路径。首次安装会自动选中 bundle；已安装但禁用的 bundle 需在插件管理器重新启用。

先在 DSH 模型设置建立 Strata 提供方，再打开 **设置 → Strata Sync**：

1. 选择语言与已有 Strata 提供方，点击“保存偏好”。
2. 点击“检查差异”，预览当前加载模型与建议设置。
3. DSH 空闲时点击“备份并同步”。
4. 如需自动同步，勾选“空闲时自动同步”并保存。
5. 开启新对话，使用更新后的 Agent 预设。

无需把 API key 复制到此插件；认证问题请在 DSH 模型设置处理。

## 兼容性

基于 **DSH Desktop 0.2.1-rc.3** 开发和验证。需要标准桌面服务 `configEditor`、`connection`、`agents`、`credentials`、`llm-pi-ai`，以及包含 `compaction-basic` 的已启用 Agent 预设，或生效中的旧式全局压缩插件。仅支持 API key 或无认证的 `openai-completions` 提供方。

无法确认上下文、未加载模型、多个模型无法判定、slot 容量相互冲突时，会拒绝同步。目前 UI 跟随单个已加载模型，不提供多个同时加载模型的选择器。

轮询调度包含 DSH 0.2.1-rc.3 的 HMR `executing.exit` 兼容处理，避免计时器保留已完成的设置事务；所有写入仍通过 ConfigEditor 的正常队列。升级 DSH 后需重新验证此兼容处理。

## 预算策略

Strata 提供模型与上下文信息，**不提供 DSH 压缩策略**。以下是此插件的客户端策略，配合 DSH 0.2.1-rc.3 原生 4,096-token 上下文安全余量：

```text
普通输出 = min(16384, floor(上下文 × 0.30))，除非另行指定
压缩余量 = 4096
摘要 maxTokens = 4096
thresholdRatio = 0.8
retainRatio = 0.16
实际压缩阈值 = floor(min(上下文 × 0.8, 上下文 − 普通输出 − 4096))
近期对话保留量 = floor((上下文 − 普通输出) × 0.16)
```

| 上下文 | 普通输出 | 摘要输出 | 压缩余量 | 压缩阈值 | 近期保留量 |
|---|---:|---:|---:|---:|---:|
| 32,768 | 9,830 | 4,096 | 4,096 | 18,842（57.50%） | 3,670 |
| 65,536 | 16,384 | 4,096 | 4,096 | 45,056（68.75%） | 7,864 |

自定义输出上限必须留下有效的正数压缩预算，且近期保留量须低于阈值。不支持小于 8,192 的上下文。推理选项仅在确认支持时同步；保留认证、其他提供方与其他模型策略；选定路由的保留量统一为 `retainRatio: 0.16`，避免沿用不兼容的绝对值。

此策略可修正 32K 路由沿用原生 `headroomTokens: 65536` 等不适当预算，但**不能保证模型每次都能在输出上限内完成回答或摘要**，推理也会消耗输出 tokens。不读取或修改 Strata 的 `fit_max_tokens`；服务器设为 `false` 也不会禁用 DSH 自身的输出限制。

## 备份与恢复

每次应用前，将当前 `cordis.patch.yml` 备份至 profile 旁的 `backups/strata-sync/`，UI 会显示路径。备份可能包含私人提供方设置，请保留在本机，不要公开。

ConfigEditor 负责单项原子写入与热加载；跨多项设置采用补偿回滚，并非数据库事务。如果同时有外部修改，可能需要依据备份手动恢复。关闭自动同步可停止后续轮询应用；移除插件**不会撤销已应用的模型与预算**。需要还原时，请先关闭 DSH 再恢复指定备份。

## 开发与版本

0.3.0 新增三语 UI、语言选择记忆与中文 README；0.2.0 将 UI 移入原生设置。同步策略保持不变。

`src/plugin.mjs` 为宿主插件，`src/client.js` 为原生 ModuleLoader/React UI，`src/core.mjs` 负责信息读取与纯预算计算。执行 `npm test`、`npm run build`、`npm pack --dry-run` 验证。安装包只包含原创插件代码，不包含私人应用程序源码、认证或对话。

测试使用模拟服务，不生成模型回答。验证范围与限制见 [VALIDATION](docs/VALIDATION.md)。参考：[DSH 压缩文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/compaction/compaction-basic/README.md)、[Strata](https://github.com/Niko1221/Strata)。

MIT 许可。
