# V0.1 架构与开发边界

## 选择 Electron

目标是 Windows/macOS 桌面常驻、系统托盘、系统通知、默认浏览器和自定义 HTTP 通知。Electron 的主进程提供这些能力，渲染层只负责本地 UI。第一版不引入业务服务器或需要跨平台编译的数据库扩展。状态采用单进程原子 JSON 文件，适合个人待办规模。大量任务、长历史或云同步可在后续迁移到 SQLite/服务端。

## 领域结构

`Task` 包含标题、说明、可选截止时间、完成状态和一组 `Reminder`。每个 Reminder 保存绝对 UTC ISO 时间、创建时区和一组 `Action`。

Action 为 desktop、dingtalk 或 open_url。每个动作独立保存 status、attempts、nextAttemptAt、error、executedAt。钉钉动作引用渠道 ID；`atMode=default` 表示执行时使用该渠道最新设置，所以修改渠道默认设置会影响后续待执行动作。需要固定 @ 范围时，在该提醒明确覆盖。

已开始执行的 Reminder 保留为记录，不能通过普通编辑改写。完成任务停止调度，不会重置已经提交的动作。手动重试创建新 Reminder，保留原执行证据。

## AI 边界

AI 通过 OpenAI-compatible `/chat/completions` 接收当前对话、当前时间、用户时区和钉钉渠道名称/ID，不接收已有全部任务或任何通知凭据。

模型输出仅为 JSON 提议。核心层校验标题、数量、未来时间、带偏移量的日期、渠道引用、成员字段和 URL 协议。网页 URL 必须能在用户消息中找到；显式 `atMode=all` 必须在用户对话中有 @所有人的意图。引用渠道默认的 @ 设置则遵循用户保存的配置。模型没有任意 IPC、shell 或文件操作权限。AI 无法直接打开链接或发送通知，只能创建经验证的未来动作。

信息完整后自动创建。等待模型期间可能跨过时间或发生配置变更，所以存储前会再次用当前时间和配置校验。已成功创建后在历史中标记为已创建，并清空该事项的链接/成员授权；后续事项不得复用历史授权。第一版不提供 AI 修改/删除已有待办，不实现无限循环提醒。

## 调度与故障语义

启动时恢复状态，随后约每秒轮询，并在系统 resume 时额外检查。进程内有互斥，Electron 持有单实例锁。执行前将动作 running 状态写盘，再调用外部 API。每个动作结束后落盘结果。

文件存储采用独立草稿、同目录临时文件、fsync 文件内容、rename 替换。写入失败不更新内存状态。损坏数据文件会阻止启动并保留原文件；不会静默重置为空。该方案不承诺断电级数据库持久性，数据导出和后续备份仍有意义。

| 故障 | 结果 |
| --- | --- |
| 本次动作明确拒绝 | 独立退避重试，最多 5 次 |
| 外部请求发送后失联 | 不知道是否送达，unknown，不自动重复 |
| 应用恢复发现 running | 桌面通知可以重试；钉钉/打开浏览器标为 unknown |
| 系统恢复时旧网页动作迟到 >15 分钟 | skipped，不自动打开 |
| 动作运行中请求完成/删除待办 | 拒绝，等待结果；防止产生不可解释的外部副作用 |

网络服务没有事务或幂等键时，无法做到 exactly-once。这里优先保证不会在不确定状态下反复发送。每轮最多处理 30 个动作，减少恢复后的突发量；钉钉仍可能受群机器人限流影响，拒绝结果会进入退避。

## 安全与数据

- 渲染层加载本地资源，CSP 禁止网络请求和内联脚本；不渲染用户 HTML。
- `contextIsolation`、沙箱开启，Node integration 关闭；显式 preload 桥，不暴露任意 ipcRenderer 或 shell。
- IPC 校验窗口、主 frame、来源 URL 和请求大小。
- 禁止渲染窗口导航和新建窗口；只在主进程执行经过协议校验的浏览器动作。
- 模型远程请求只允许 HTTPS，本机 localhost 可用 HTTP；禁止 URL 用户名密码。
- 钉钉 Webhook 限制为官方域名和路径；禁止网络重定向，避免授权头/令牌跟随跳转。
- 主进程通过 safeStorage 异步接口加密 API Key、Webhook 和 Secret；DTO 只返回是否已设置。无法解密时要求重新配置，未实现明文降级。
- OS 用户、平台加密与已签名应用身份决定密钥可用性；这不防御已控制该 OS 用户的攻击者。正式 macOS 分发需稳定代码签名。
- 网络错误只显示有限的状态/错误码，不回显完整远端响应或带令牌的请求 URL。

## 构建与验证

锁定依赖，Node 24。GitHub Actions：语法检查、核心行为测试、真实 Electron + 本机模型 HTTP stub 的桌面冒烟测试，通过后分别在 Windows/macOS 构建安装包。CI artifact 上传不等同正式发布，无自动合并，无真实密钥。

本地 Linux 验证不覆盖 Windows/macOS 的 OS 通知、真实钥匙串、安装器、签名、开机启动；这些必须由对应平台验收。真实模型理解质量和钉钉群送达也需要用户自己的服务配置。

后续建议按需要迭代：本地周期规则与夏令时策略、任务导入/自动备份、代码签名与公证、自动更新、更多通知适配器、可选云端常驻调度。云端执行需要独立部署的调度器，不能仅靠桌面端“退出后仍提醒”。

## 官方协议参考

- [Electron 安全](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Electron powerMonitor](https://www.electronjs.org/docs/latest/api/power-monitor)
- [钉钉自定义机器人接入](https://open.dingtalk.com/document/group/custom-robot-access)
- [钉钉机器人安全设置](https://open.dingtalk.com/document/robots/customize-robot-security-settings)
- [Chat Completions](https://platform.openai.com/docs/api-reference/chat/create)

## 上下文与外观更新

Conversation 由主进程持有，渲染层每次只发送新文本，不能伪造历史摘要或授权。按各模型的 contextWindow 做多语言保守估算，通常为回答预留 2048 tokens（小窗口预留四分之一），超过消息轮数或预算时压缩旧消息，保留最近若干完整问答。摘要目标长度随窗口预算调整，摘要请求也分块控制预算。失败不提交新上下文、不执行新任务；状态仅在模型结果通过校验且待办落盘成功后提交。

独立 evidence 保存当前事项的用户 URL、成员标识与 @所有人意图，避免有损摘要丢掉授权或增加授权；完成任务/开始新对话时重置授权。摘要和近期历史都不写盘。估算不是服务商精确分词器，窗口配置必须与提供方一致。

渠道 contacts 是可选的常用成员簿；旧配置无此字段仍有效。主题是 settings.theme 的白名单值，旧数据默认 forest。CSS 语义变量覆盖五套调色板，主进程保存设置，前端使用本地缓存减少启动换色闪烁，主进程快照为最终依据。
