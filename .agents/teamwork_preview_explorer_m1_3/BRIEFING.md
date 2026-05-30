# BRIEFING — 2026-05-27T20:29:13Z

## Mission
分析现有的 app.js WebSocket 通信链路与状态机，设计网络异常处理、状态指示灯、指数级退避重连算法、重连后 Setup 帧重发及音频流恢复逻辑，并提供测试方案。

## 🔒 My Identity
- Archetype: explorer
- Roles: Read-only investigator
- Working directory: /Users/antigravity/商业语音分析提示/.agents/teamwork_preview_explorer_m1_3
- Original parent: 00f34366-2e7a-4563-ab2a-7ce1cdaec54c
- Milestone: WebSocket reconnection and self-healing analysis

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- 简体中文思考与回答

## Current Parent
- Conversation ID: 00f34366-2e7a-4563-ab2a-7ce1cdaec54c
- Updated: not yet

## Investigation State
- **Explored paths**:
  - `app.js`: 核心交互逻辑与 WebSocket 通信模块分析完毕。
  - `index.html`: 状态指示灯（stateIndicator）与提示文本（stateText）DOM 节点及 UI 关联分析完毕。
  - `index.css`: 原生三种状态（监听中、正在构思、未连接）的 CSS 样式及 `indicator-pulse` 关键帧动画分析完毕。
- **Key findings**:
  - 现有的 WebSocket 关闭处理（`ws.onclose`）不区分主动与被动关闭，一旦断开就彻底销毁 `processorNode` 音频处理节点，迫使用户必须重新建立整个音频链路。
  - `apiKeyInput` 仅在首次连接时从 input 读取，无法在自动重连时持久化提取；我们需要在内存中通过 `currentApiKey` 保存已校验的密钥。
  - 可以通过保留 `processorNode` 在异常重连期间的“空转”来避免重新授权麦克风与重新捕获系统音频，重连成功后只要 `isConnected = true` 并换上新 `ws` 即可自动恢复推流。
- **Unexplored areas**: None. 全部探索完毕，正在进行方案整合。

## Key Decisions Made
- 设定重连上限为 5 次，以 1s, 2s, 4s, 8s, 16s 指数退避重试。
- 引入 `isUserInitiatedDisconnect` 全局标识来区分用户主动关闭和被动网络断连。
- 设计“握手超时守护”机制，在 `performConnection` 后 10s 内未收到 `setupComplete` 则判定为假在线，强制关闭并进入下一次重连尝试。
- 在重连期间，页面按钮变为“取消重连”，让用户可以随时退出。

## Artifact Index
- /Users/antigravity/商业语音分析提示/.agents/teamwork_preview_explorer_m1_3/original_prompt.md — 存储原始Prompt任务
- /Users/antigravity/商业语音分析提示/.agents/teamwork_preview_explorer_m1_3/BRIEFING.md — 团队当前备忘和上下文状态
- /Users/antigravity/商业语音分析提示/.agents/teamwork_preview_explorer_m1_3/progress.md — 任务进度 heartbeat
