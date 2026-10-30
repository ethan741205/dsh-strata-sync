# dsh-strata-sync

[English](https://github.com/ethan741205/dsh-strata-sync/blob/main/README.md) · **简体中文** · [繁體中文](https://github.com/ethan741205/dsh-strata-sync/blob/main/docs/README.zh-TW.md)

让 **DeepSeek Harness（DSH）** 连接 **Strata Server** 当前加载的模型，在同一个 DSH 设置页管理模型配置与摘要控制。

插件读取 Strata 的模型信息，预览差异，再更新 DSH 自定义模型与上下文压缩预算。它还会为支持的摘要请求补充可编辑的长度指令，帮助模型生成精简的摘要。

## 可以做什么

- **同步模型设置：**上下文窗口、回复输出上限，以及已确认的输入类型和推理等级。
- **对齐压缩预算：**更新已启用的 DSH Agent 预设中，对应模型的压缩策略。
- **控制摘要长度：**编辑补充提示词，调整两项目标长度比例。
- **启动时同步：**可选择在 DSH 启动后同步一次。
- **预览与恢复：**检查差异、备份设置，并查看最近一次同步结果。

插件只读访问 Strata Server。同步不会切换或加载服务器模型、修改服务器设置，也不会发送测试推理请求。无法确认的模型能力会保留 DSH 原有值。

## 开始使用

### 1. 准备连接

先在 Strata Server 加载模型，再到 **DSH → 设置 → 模型**，配置兼容 OpenAI 的提供方、API 地址与认证，并明确添加自定义模型条目。

插件直接复用这个连接，无需另外复制 API key。

### 2. 安装插件

在 DSH 插件管理器选择**添加插件**，输入：

```text
dsh-strata-sync
```

也可以先完成当前任务、完全退出 DSH Desktop，再使用官方 CLI：

```sh
dsh plugin --profile desktop add dsh-strata-sync --registry=https://registry.npmjs.org/
```

如设置页尚未出现，请重新打开 DSH。若插件处于禁用状态，请在插件管理器启用。

### 3. 预览并同步

打开**设置 → dsh-strata-sync**：

页面上方是主要流程：**检查差异 → 预览更改 → 备份并同步**。下方的**同步偏好**与可选的**动态摘要目标**默认折叠；展开后即可调整选项或编辑摘要补充提示词。

1. 选择 Strata 提供方，点击**保存偏好**。
2. 点击**检查差异**，查看已加载模型与拟修改的设置。
3. 点击**备份并同步**。
4. **开启新对话**，使用更新后的模型与 Agent 预设。

已有对话会保留原先选定的模型路由和预设版本。如需自动设置，可勾选**启动 DSH 时自动同步**并保存。此选项默认关闭，下次启动才生效；可在任务执行中同步，不会持续轮询。

## 模型与输出设置

| 设置 | 如何决定 |
|---|---|
| 模型与上下文 | 采用 Strata 已加载的文本模型及已确认的上下文容量。 |
| 回复输出上限 | 优先使用手动覆盖值；否则采用已确认的 Strata 输出默认值。无法取得或未限制时，使用 Strata 官方公式：上下文的 30%，最低 4,096、最高 32,768 tokens。 |
| 输入类型 | 采用服务器已确认的能力，例如文本或文本＋图片。 |
| 推理等级 | 根据已验证的模型模板确定；未知模板保留原有设置。 |
| 默认模型 | 启用**默认模型跟随 Strata 已加载的模型**时，跟随服务器当前模型。 |

保持**输出上限跟随 Strata**开启，即可自动选择。关闭后可在**高级设置**输入手动覆盖值。预览会分别显示服务器默认值、实际应用值及其来源。

量化版本不改变已验证模型家族的选项：Qwen3.8 Flash Next 提供 `off / low / medium / xhigh`；当前 DeepSeek Flash 模板提供 `off / low / medium / high / max`，原生默认是 `high`。旧模板仍采用其实际支持的选项；同步只更新可选等级，不改变当前选择。详见[已验证的能力](https://github.com/ethan741205/dsh-strata-sync/blob/main/docs/CAPABILITIES.md)。

自动计算采用 [Strata 官方输出公式](https://github.com/Niko1221/Strata/blob/main/apps/host/server/agent/profile.mjs)：`max(4096, min(32768, floor(context × 0.3)))`。

同步时，摘要输出上限和压缩余量通常均为 4,096 tokens。小窗口使用自动计算输出时，两者最多为剩余对话预算的一半，向下取整；因此 8K 窗口使用 2,048。实际压缩阈值取**上下文的 80%**与**上下文 − 回复输出预算 − 压缩余量**中的较小值，近期内容保留量为 **（上下文 − 回复输出预算）× 16%**，向下取整。这些压缩预算由插件计算，并非 Strata 提供的设置。

例如，采用自动输出计算时，32K 上下文的回复预算为 9,830 tokens，压缩阈值为 18,842 tokens，**不一定在 80% 时压缩**。

## 摘要提示词与目标长度

**动态摘要目标**默认关闭。启用后会在 DSH 原生摘要指令后补充要求；关闭时使用 DSH 原生摘要与压缩行为。

可编辑的**摘要补充提示词**默认内容为：

```text
Keep the entire checkpoint, including all required headings, within a target of {target} tokens by retaining only information essential to continue the remaining work, consolidating prior summaries, and removing redundant or obsolete details.
```

请保留 `{target}`，每次支持的摘要请求前，它会替换成计算出的 token 目标。模板最多 2,048 个字符。点击**恢复默认提示词**可重置内容，再点击**保存偏好**应用修改。

两个除数控制目标，默认均为 **2（各取 50%）**：

| 除数 | 默认值 | 将目标限制为 |
|---|---:|---|
| 摘要输出（O） | 2 | 估算有效摘要输出预算 ÷ O |
| 原文长度（S） | 2 | 待摘要内容的估算长度 ÷ S |

目标取两项结果的较小值，再向下取整。除数支持大于或等于 1 的小数。已有输出／原文除数及明确的启用选择会保留，新安装或未指定时仍**默认关闭**。

有效输出预算是**估算值**，不是直接把请求的 `maxTokens` 当作服务器确认的上限。它取本次摘要输出上限与估算上下文剩余空间中的较小值；后者使用已确认的服务器／客户端窗口较小值，扣除完整提示内容（包含系统提示、工具定义和补充句），再预留支持的 pi-ai 适配器所用的 4,096 tokens 安全空间。文本以每 token 约 3.5 字符并加上格式成本估算。原文长度另采用 DSH 的每 token 约 4 字符估算，不含系统提示、工具和摘要指令。两者都不是精确 tokenizer 计数。

例如，有效输出预算为 4,096 tokens 且原文足够长时，32K 与 64K 上下文的目标都是 **2,048 tokens**；原文只有约 2,000 tokens 时，目标为 **1,000 tokens**。上下文剩余空间不足时，目标会进一步降低。界面仅以提议的摘要上限预览目标上界，尚未扣除个别请求的成本。

这是写作指令，**不是输出硬上限，也不能保证不截断**。思考可能共用输出预算；插件不会修改思考设置、`maxTokens`、`fit_max_tokens` 或压缩时机。服务器实际 tokenizer、后续中间层或不同适配器版本仍可能产生更低的上限。

保存摘要偏好不会改变模型预算，也不会替换原生提示词或增加额外推理、重试循环。无法验证请求、无法安全估算内容，或目标小于 256 tokens 时，会沿用原本的摘要请求。

## 备份与兼容性

写入设置前，会将 `cordis.patch.yml` 备份到配置目录下的 `backups/strata-sync/`。同步会检查是否有并发修改，并在后续步骤失败时尝试回滚已完成的更改。备份可能包含私人配置，请保存在本机。

移除插件不会撤销已经同步的设置。如需恢复备份，请先完全退出 DSH。

已在 **DSH Desktop 0.2.1-rc.3** 上验证。请使用 API key 或无需认证的 OpenAI 兼容提供方，明确配置自定义模型列表，并启用包含 `compaction-basic` 的 Agent 预设。不支持小于 8,192 tokens 的上下文、仅使用模型目录的提供方、非空的 `modelOverrides`，或无法明确判断已加载模型的信息。

技术细节与测试范围请见[已验证能力与推理映射](https://github.com/ethan741205/dsh-strata-sync/blob/main/docs/CAPABILITIES.md)及[验证记录](https://github.com/ethan741205/dsh-strata-sync/blob/main/docs/VALIDATION.md)。

## 开发

需要 Node.js 22 或更新版本。

```sh
git clone https://github.com/ethan741205/dsh-strata-sync.git
cd dsh-strata-sync
npm ci
npm test
npm run build
npm pack
```

安装自行构建的版本前，请完全退出 DSH，再执行 `dsh plugin --profile desktop add <path-to-generated.tgz>`。

源码：`src/plugin.mjs`（宿主整合）、`src/core.mjs`（信息读取与预算）、`src/summary.mjs`（摘要引导）、`src/client.js`（设置界面）。

[npm](https://www.npmjs.com/package/dsh-strata-sync) · [反馈问题](https://github.com/ethan741205/dsh-strata-sync/issues) · [MIT 许可证](https://github.com/ethan741205/dsh-strata-sync/blob/main/LICENSE)
