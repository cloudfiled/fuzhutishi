# Project: Call Copilot Professional Optimization

## Architecture
本系统是一个运行在浏览器端的“商业通话悬浮提词助手”。其核心组件包括：
1. **Frontend UI (index.html, index.css)**: 负责展示提词器、声波 Canvas 可视化、服务控制以及通话历史等。
2. **Core controller (app.js)**: 负责 WebSocket 实时语音流的建立、音频输入（麦克风和系统音频）采集、发送 Setup 话术配置帧、接收并播放 AI 音频、实时渲染字幕和提词要点。

数据流如下：
```
[User Mic / System Audio] -> [AudioWorklet/ScriptProcessor] -> [app.js WebSocket] -> [Gemini Live API]
[Gemini Live API] -> [app.js WebSocket (AI Text/Audio)] -> [UI Renderer & Audio Playback]
```

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|---|---|---|---|
| M1 | 架构探索与设计 | 探索现有代码逻辑、API 使用细节与 WebSocket 协议 | None | IN_PROGRESS (1dbbfaf0, 10af7e02, e3be04b6) |
| M2 | 前端 UI 极致视觉美学重塑 (R1) | 暗黑毛玻璃风格、霓虹渐变音柱、提词区域自适应缩放 | M1 | PLANNED |
| M3 | 业务功能完备化 (R2) | 多场景话术热切换（包含下拉菜单和配置帧热注入逻辑）、通话纪要导出 | M2 | PLANNED |
| M4 | 指数级退避重连自愈 (R3) | 监听断连、呼吸指示灯、指数退避自愈、配置帧自动重发与流恢复 | M3 | PLANNED |
| M5 | 综合测试与审计验证 | 进行端到端测试、Challenger 验证和 Forensic Audit 审计 | M4 | PLANNED |

## Interface Contracts
### app.js ↔ Gemini Live API (WebSocket)
- **Setup Frame (客户端 -> 服务端)**: 包含 `system_instruction` 等初始化配置。当热切换话术或重连成功后，需重新发送此帧。
- **Realtime Audio Stream (客户端 -> 服务端)**: 以 base64 编码发送音频二进制 PCM 数据。
- **Server Content Frame (服务端 -> 客户端)**: 包含 AI 推荐文本回复（推荐大字号朗读）及其他结构化要点。

## Code Layout
- `index.html` - 前端 HTML 页面结构
- `index.css` - UI 样式定义
- `app.js` - 前端逻辑与 WebSocket 客户端实现
