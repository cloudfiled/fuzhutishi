# Handoff Report - explorer_m1_2

## 1. Observation
根据对根目录下相关文件的静态分析，得到以下核心数据和逻辑定义：
- **核心文件路径与行号**:
  - `PROJECT.md` 定义了 M1 (本阶段) 至 M5 的里程碑计划，明确了客户端 Setup 帧需要发送 `system_instruction` 且系统运行在浏览器端。
  - `app.js`:
    - **WebSocket 握手逻辑**: Lines 432-485 定义了 `connectToGemini()` 握手。连接 API 地址使用 `ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`。
    - **Setup 帧结构**: Lines 488-522 定义了 `sendSetupFrame()`，包含 `model: "models/gemini-2.5-flash-native-audio-latest"`, `generationConfig.responseModalities: ["AUDIO"]`, `tools: [{googleSearch: {}}]`, 以及内置的全局 `DEFAULT_SYSTEM_INSTRUCTION` (Lines 60-71)。
    - **实时语音转录与接收**: Lines 618-644 包含 `inputAudioTranscription` 和 `outputAudioTranscription` 对我方发言和 AI 回复的文本流解析，以及向 `liveCaptionText` 和 `replyText` 的渲染。
  - `index.html`:
    - Lines 16-64 定义了侧边配置栏（API 凭证、音频捕获控制、Live会话开启按钮）。
    - Lines 105-131 定义了推荐回复区域 `replyText` 和支撑要点列表 `pointsList`。
  - `prompts/gemini_live_system_instruction.md`:
    - 包含了口语化优化、联网搜索规则、会话状态感知和格式排版要求。

## 2. Logic Chain
基于以上观察，推导出以下开发架构方案：
- **WebSocket 握手与 Setup 帧注入时机**:
  - 在 WebSocket `onopen` 触发时，客户端必须立即发送 Setup 帧配置模型特性。
  - 服务器确认 `setupComplete: true` 后才能激活推流，不能随时发送 Setup 帧。
- **多场景话术热切换可行性与实现逻辑**:
  - **协议限制**: Gemini Live API 在连接建立后不响应任何二次发送的 Setup 帧，因此直接热发帧无效。
  - **秒级自动重连方案**: 当处于连接状态且用户切换场景时，开启 `isHotSwitching` 保护锁，只切断 WebSocket 链接与 `processorNode`，但不释放 `micStream` 和 `systemStream` 轨道（防止二次申请用户设备权限弹窗），在 `onclose` 事件中立即瞬间调用 `connectToGemini()` 重启连接，发送包含新场景 System Instruction 的 Setup 帧。此逻辑可在 1 秒内完成重建，不破坏用户体验。
- **通话历史纪要设计与最多 5 次存储**:
  - **存储颗粒度**: 以一次连接建立到断开为生命周期。
  - **拦截点**: 采集 `finalizeUserSpeech()` 生成的我方发言（`userSpeechBuffer`）和 `triggerTurnCompletion()` 时的最终 AI 回复（`replyText` 内容），写入当前通话日志数组。
  - **本地存储**: 在 `disconnectFromGemini()` 中触发归档，读取 LocalStorage 中的数组，使用 `unshift()` 压入当前日志，并通过 `slice(0, 5)` 截断以实现固定存储最近 5 次的滑动窗口限制。
  - **布局实现**: 通过 CSS 滑出层 `transform: translateX(100% -> 0)` 及 Accordion 手风琴折叠效果展示。
- **Markdown 导出设计**:
  - 在侧边栏的 5 次历史纪要的卡片组件上增设“导出”按钮，以 Markdown 标题 + 秒级时间戳列表的形式组装为 Blob，并通过虚拟 `<a>` 标签触发下载。

## 3. Caveats
- **联网搜索状态**: 大模型生成回复时若正处于 WebSearch，UI 界面可能会受到残余延迟帧影响，我们已经在 `app.js` 设置了 ignoreGeneratingStateUntil 防抖。但在瞬间重连期间，积压的音频推流重新发送时可能会短暂触发第二次联网搜索，这里需要对积压推流队列做静音阈值过滤（即 `hasSpeechInQueue` 为 false 则直接忽略）。
- **音频流的持久性**: 在热切换的瞬间重连期间，如果因为用户网络抖动导致重连失败，需要提供重连自愈退避机制（此部分属于 M4 范畴，但在 M3 话术切换时需保证基础连接状态还原）。

## 4. Conclusion
M1 阶段的架构探索已彻底完成。现已梳理出完整的 WebSocket 协议流程、Setup 帧细节，设计了符合协议限制的多场景话术“断连-秒级重连-配置帧重新注入”自愈热切换方案，并给出了基于 LocalStorage 滑动窗口存储 5 次通话的完整 DOM & CSS 滑动侧边栏和 Markdown 导出方案的伪代码与策略。

## 5. Verification Method
- **WebSocket 分析验证**:
  - 启动系统并打开控制台，在 Network -> WS 面板观察首次发出的文本帧，验证结构为包含 `setup` 节点的 JSON 帧。
- **话术切换验证**:
  - 部署下拉切换 UI，观察切换场景后，Network 面板应在 1 秒内发生 WS Close 和新的 WS Open。观察新的 Open 连接后发出的 Setup 帧，验证 `systemInstruction` 字段内容是否更改为所选话术。
- **历史记录与导出验证**:
  - 进行至少 6 次模拟通话，然后断开连接。在控制台运行 `JSON.parse(localStorage.getItem('copilot_history'))`，验证长度被截断并限制在 5。
  - 点击历史侧边栏中的导出按钮，检查下载的 `.md` 文件格式，时间戳是否以秒级（如 `[10:15:30]`）并且内容排版是否正确。

## 6. Remaining Work (针对后续执行阶段 M2/M3)
1. **M2 前端 UI 美学重塑**:
   - 在 `index.html` 引入折叠侧边栏 DOM 结构与 Markdown 导出/场景切换下拉菜单。
   - 在 `index.css` 实现毛玻璃滑出侧边栏定位、Accordion 折叠动画。
2. **M3 业务功能完备化**:
   - 在 `app.js` 中新增 `SCENARIO_PROMPTS` 词典与重连注入机制。
   - 编写 `currentCallLogs` 拦截器、LocalStorage 归档持久化模块与 `exportCallToMarkdown()` 方法。
