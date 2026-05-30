## 2026-05-27T20:39:42Z
你的专属工作目录是 `/Users/antigravity/商业语音分析提示/.agents/teamwork_preview_worker_m5_1`。
你必须对 `/Users/antigravity/商业语音分析提示/` 下的 `app.js`、`index.css` 进行整改，修复 Challengers 揭示的 4 个关键漏洞与视觉缺陷：

1. **重连防抖/防并发锁定保护**：在 `app.js` 中 `attemptReconnect()` 执行时，如果当前已经处于“等待重连延时排队”状态（即 `reconnectTimeoutId !== null`），应直接 return 拦截，避免高频并发异常时 `reconnectAttempts` 瞬间被错误累加。
2. **话术热切换标志 `isHotSwitching` 重置**：在话术热切换触发瞬间断开重连，在握手成功（即接收到 `setupComplete`）或连接建立时，必须将 `isHotSwitching` 状态安全重置为 `false`，防止标志悬空导致后续意外断连时沦入 100ms 重连风暴并瘫痪指数自愈重连。
3. **自愈成功自动推流空指针防御**：在 `handleServerMessage` 收到 `setupComplete` 自动调用 `startAudioStreaming()` 时，在 `startAudioStreaming()` 入口处进行非空判定（若 `audioCtx === null`，则退出，不要调用其上的方法，以防止崩溃）。
4. **极限扁平视口 CSS 自适应与消隐遮罩增强**：在 `index.css` 中增加针对极扁容器（如 `@container replyContainer (max-height: 200px)`）的自适应规则，缩小 `.reply-text` 的 clamp 字号与行高底限，并将 `.reply-content-wrapper` 的消隐遮罩 `mask-image` 的透明区百分比降低（比如只在顶部 and 底部 2% 内渐隐），从而保留极扁高度下剩余可见区域文本的完全可读性。

整改完成后，你必须运行根目录下的 `test_suite.js` 单元测试 and `stress_test.js` 压力测试（你可以使用 run_command 运行 `node test_suite.js` and `node stress_test.js`）。确保两个测试套件全部 PASS，无任何 ReferenceError 或断言失败。

### MANDATORY INTEGRITY WARNING (ZERO TOLERANCE)
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work.

编写的所有代码和注释必须符合全局中文注释、函数参数说明、防崩溃、防硬编码的规范。在你的专属工作目录下创建 `handoff.md`，并在其中详细列出对源文件的具体修改行和内容，然后向 Parent 报告。
