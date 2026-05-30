# 实时通话专业回复助手系统设计与操作指南

本系统名为 **Real-time Call Copilot**（实时通话助手），是专为职场人士、技术专家和商务人员设计的“通话第二大脑”。它通过捕获通话中双方的实时音频，利用 **Gemini 2.0 Multimodal Live API** 的原生多模态流式处理能力，在屏幕上实时输出专业、口语化、可直接照读的回复话术。

---

## 1. 核心工作流与架构设计

```
[ 用户麦克风 (我说话) ]  ───┐
                          ├─► [ 浏览器 WebRTC 音频采集 ] ──► [ WebSocket 流式发送 (PCM 24kHz) ]
[ 电脑扬声器 (对方说话) ]  ───┘                                                 │
                                                                                ▼
[ 悬浮提示窗 (照着念) ] ◄─── [ 渲染纯文本 Text Stream ] ◄── [ Gemini 2.0 Multimodal Live API ]
                                                                 │ (集成 Google Search)
                                                                 ▼
                                                       [ 实时检索最新行业事实/数据 ]
```

1. **音频采集**：系统通过 HTML5 WebRTC API，同时采集用户的麦克风输入与通话软件（如微信、Zoom、Teams、电话网页端）的输出音频。
2. **实时流传输**：将采集到的原始音频数据（PCM 24kHz，单声道，16-bit）封装进 WebSocket 帧，实时发送给 Gemini Live 服务器。
3. **多模态理解与决策**：Gemini Live 服务端实时解码音频流，理解对话上下文。如果对方提到需要联网查询的复杂项目或最新政策，Gemini 会自动触发官方集成的 **Google Search Tool** 进行实时 Grounding 检索。
4. **静音文本输出 (TEXT Modality)**：通过在 Session 初始化中配置回复模态为仅 `TEXT`，Gemini Live 会**保持静默，不发出合成声音**，而是以极低延迟（约 300ms）在 WebSocket 链接中吐出流式文本（TEXT Delta）。
5. **UI 悬浮呈现**：前端将接收到的流式文本，以高亮卡片的形式实时呈现在悬浮窗中，并自动适配阅读节奏，用户只需“看着屏幕照念”即可。

---

## 2. Gemini Multimodal Live API 关键配置

在使用 WebSocket 连接 Gemini Live 服务时，必须正确设置初始化的 `setup` 帧。以下是实现“**只出文字不发声**”以及“**自动联网搜索**”的核心配置 JSON 结构：

```json
{
  "setup": {
    "model": "models/gemini-2.0-flash-exp",
    "generationConfig": {
      "responseModalities": ["TEXT"],
      "candidateCount": 1
    },
    "tools": [
      {
        "googleSearch": {}
      }
    ],
    "systemInstruction": {
      "parts": [
        {
          "text": "[此处填入优化后的系统提示词，详见 prompts/gemini_live_system_instruction.md]"
        }
      ]
    }
  }
}
```

### 关键配置解析：
*   `responseModalities: ["TEXT"]`：**极其重要**。默认情况下，Live API 会同时返回 `AUDIO` 和 `TEXT`。设置此项后，大模型将关闭语音合成（TTS）输出，仅通过 WebSocket 返回文本块，从而避免在耳机中干扰用户的正常通话。
*   `tools: [{"googleSearch": {}}]`：**开启联网 Grounding**。当大模型判定对话中出现未知的专有名词、最新政策、财报数据时，会自动在后台使用 Google 进行实时搜索并无缝融合进回复中。

---

## 3. 实时音频捕获方案 (如何同时录下对方和我的声音)

在浏览器中，默认的 `navigator.mediaDevices.getUserMedia({ audio: true })` 只能采集到用户本地麦克风的声音，无法听到通话软件中对方的声音。为了实现双向监听，推荐以下两种方案：

### 方案 A：屏幕音频共享捕获 (免安装，最简便)
在前端页面中调用 `navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })` 启动屏幕共享。
*   **操作方法**：用户在弹出的浏览器共享窗口中，选择共享“整个屏幕”或“特定标签页”（如微信网页版、会议网页端），并**务必勾选“同时共享系统音频 (Share system audio)”**。
*   **原理**：系统会捕获屏幕音频流（对方的声音），我们再通过 Web Audio API 将其与本地麦克风音频流进行混音（Mixer），然后发送给 Gemini。

### 方案 B：虚拟声卡重定向 (适合客户端/桌面端)
*   **Mac 用户**：安装开源的 [BlackHole (2ch/16ch)](https://github.com/ExistentialAudio/BlackHole)。将系统的音频输出设备设为 `Multi-Output Device`（同时输出到耳机和 BlackHole），然后让我们的系统去监听 `BlackHole` 虚拟输入设备。
*   **Windows 用户**：使用 `Virtual Audio Cable` 或开启系统自带的“立体声混音 (Stereo Mix)”。

---

## 4. 如何本地运行与测试原型

工作区中包含了一个无需后端、开箱即用的前端网页原型：
1.  **文件结构**：
    - [index.html](file:///Users/antigravity/商业语音分析提示/index.html)：精致的悬浮助手 UI。
    - [index.css](file:///Users/antigravity/商业语音分析提示/index.css)：现代暗黑毛玻璃样式。
    - [app.js](file:///Users/antigravity/商业语音分析提示/app.js)：WebRTC 音频混音与 Gemini Live 连接逻辑。
2.  **启动步骤**：
    - 由于浏览器安全限制，获取麦克风和屏幕音频必须在 `localhost` 或 `https` 下运行。
    - 您可以直接在当前工作区目录下启动一个本地静态服务器，例如使用 Python：
      ```bash
      python3 -m http.server 8000
      ```
    - 在浏览器中打开 `http://localhost:8000`。
3.  **配置 API 密钥**：
    - 在打开的网页左上角填入您的 **Gemini API Key**，点击连接即可开始体验。
