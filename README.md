# What2Do

用对话安排待办，在桌面上到期行动。面向 **Windows / macOS** 的本地桌面应用。

> “明天下午三点交周报，提前半小时桌面提醒，到点通过工作群钉钉机器人提醒，@所有人。”

AI 会在信息完整时直接创建一个待办，附带两个提醒时间和各自的动作；缺少时间或渠道时会继续追问。创建后可以手动编辑、完成或删除。无需让大模型一直在线运行：**AI 只负责理解，提醒由本地持久化调度器执行。**

## 当前功能

- **待办为主体**：标题、说明、可选截止时间；一个待办支持 1～30 个具体提醒时间，每个时间支持多个动作。
- **对话创建**：多轮补全事项、时间、通知方式；信息完整后自动创建。明确的时间与动作会在列表中显示，建议创建后核对。
- **模型配置和切换**：多个兼容 OpenAI Chat Completions 的 API 配置；自定义 Base URL、模型标识、API Key。支持本机兼容接口。
- **桌面通知**：系统通知。应用接收不到系统通知确认时显示失败或重试。
- **钉钉自定义机器人**：多个渠道、Markdown、加签、关键词、@所有人或指定手机号/用户 ID。每次提醒可以覆盖渠道默认 @ 设置。
- **网页动作**：到期调用系统默认浏览器打开明确指定的 HTTP / HTTPS 链接。
- **桌面常驻**：托盘、单实例、安装版开机启动设置；关闭窗口后继续运行。
- **执行可靠性**：原子落盘、执行前持久化、恢复检查、明确失败自动退避重试、送达未知需人工核对。
- **本地数据**：系统密钥存储加密凭据、无凭据的待办和执行记录 JSON 导出。

## 运行

需要 Node.js **24**、npm，以及 Windows 或 macOS 桌面环境。

```bash
git clone https://github.com/ByteLeee/what2do.git
cd what2do
npm ci
npm run setup
npm start
```

`npm ci` 安装 npm 依赖，`npm run setup` 显式下载/验证 Electron 桌面运行时，首次需要能访问 GitHub Releases。启动失败时先运行 `npm run doctor`，再保留 `npm start` 的完整终端输出。诊断不会读取密钥或发送网络请求。使用 Node.js 24 LTS（最低 22.12）；仓库包含 `.nvmrc`。

源码启动需要本机图形桌面，不能在纯 SSH / 无头容器中显示窗口；Linux 不要使用 `sudo npm start`。启动器会清除外部 Electron 开发工具遗留的 `ELECTRON_RUN_AS_NODE`，避免把应用误当成普通 Node.js 脚本运行。应用启动日志写入用户数据目录的 `logs/startup.log`，不会清空已有待办或模型配置。

第一次使用：

1. 进入 **模型与通知 → 添加模型**，填写服务提供方的 Base URL、准确的模型标识与 API Key，保存并测试连接。Base URL 填到 `/v1` 等接口根路径，应用自动追加 `/chat/completions`。不接入模型时仍可手动建待办。
2. 如需钉钉提醒，添加群自定义机器人 Webhook；若机器人开启加签，填写 Secret；如果要求关键词，也需要填写同样的关键词。保存后点击“发送测试消息”。**测试不会 @ 群成员。**
3. 在首页描述待办。可以描述多个提醒时间，也可以在手动编辑器中组合桌面通知、钉钉和打开网页动作。
4. 核对生成的提醒时间。Windows/macOS 的系统通知权限、专注模式可能影响提醒的展示。
5. 关闭窗口后留在托盘；从托盘选择“退出”才会停止提醒。安装版可开启登录电脑时启动。

更完整的使用示例与验收步骤见 [使用与验收手册](docs/USER_GUIDE.md)。

## 构建安装包

```bash
npm run check
npm test
npm run dist -- --publish never
```

- Windows：在 Windows 上构建 NSIS `.exe`（x64）。
- macOS：在 macOS 上构建 `.dmg`（Apple Silicon / Intel）。
- 产物位于 `release/`。当前未配置开发者证书和 macOS 公证，不能把 CI 产物视为已签名的正式发行版。
- [GitHub Actions](https://github.com/ByteLeee/what2do/actions) 会在开发分支推送、PR 和 `main` 更新时检查代码并构建两平台安装包。在成功的 workflow 的 **Artifacts** 中下载，保留 14 天。也支持手动运行 workflow。
- CI 产物不会自动发布为 GitHub Release，不会自动合并 PR。

## 提醒规则与边界

**电脑必须开机，应用必须运行。** 这是本地桌面调度器；休眠、关机或退出时不会在云端执行任务。恢复运行后会检查尚未执行的提醒：

| 场景 | 处理 |
| --- | --- |
| 正常到期 | 按约 1 秒轮询精度依次执行动作；系统/网络负载可能增加延迟 |
| 休眠或关闭后恢复 | 补发桌面/钉钉通知，显示原定时间；迟到超过 15 分钟的网页动作跳过，可手动重试 |
| 明确失败 | 最多尝试 5 次，按 30、60、120、240 秒退避；各动作独立 |
| 钉钉请求超时、5xx 或应用在外部动作中途退出 | 标记“状态未知”，不自动重复发送；核对后手动重试 |
| 完成或删除待办 | 停止其后续未开始执行的提醒；执行中的动作需要等待结束 |
| 编辑已执行的提醒 | 记录不可改写；可追加新时间 |
| 时区发生变化 | 使用创建时确定的绝对时间执行，界面使用当前系统时区显示 |

“已提交”表示系统/渠道接受请求，不表示人已经看到或阅读。网络外部动作无法提供严格 exactly-once 语义；本应用用未知状态避免无声重复。历史日志保留最近 1000 条。第一版支持具体日期的单次提醒，**暂不支持无限循环/周期提醒、跨设备同步、后台云端提醒、自动更新**。

## 开发与架构

```text
app/main.cjs          Electron 生命周期、IPC、系统通知与浏览器动作
app/preload.cjs       显式白名单桥接；渲染层无 Node.js 权限
app/core/domain.cjs   数据验证、协议与时间边界
app/core/store.cjs    原子 JSON 存储与脱敏快照
app/core/service.cjs  待办、模型与渠道操作
app/core/ai.cjs       多轮消息 → 结构化待办；无工具调用权限
app/core/dingtalk.cjs Markdown、@成员、HMAC-SHA256 加签
app/core/scheduler.cjs 持久化执行状态与恢复、重试
app/ui/               本地 HTML / CSS / JavaScript 界面
```

无业务服务器、无原生 Node 扩展、无第三方运行时依赖；开发时使用 Electron、electron-builder 和 Playwright。详细设计与后续边界见 [架构说明](docs/ARCHITECTURE.md)。

```bash
npm run check
npm test
npm run test:desktop
# Linux CI 桌面测试：xvfb-run --auto-servernum npm run test:desktop
```

核心测试验证多提醒、恢复、防重复、失败重试、协议加签、凭据脱敏、AI 验证。桌面测试启动真实 Electron，使用本机模拟的兼容模型 HTTP 服务，走真实 preload/IPC/文件持久化。不会调用真实付费模型或向真实钉钉群发消息。

许可证：[GPL-3.0](LICENSE)。
