## 2026-05-28T04:30:19Z

你的身份是: worker_m234，你的专属工作目录是 `/Users/antigravity/商业语音分析提示/.agents/teamwork_preview_worker_m234`。
你必须对 `/Users/antigravity/商业语音分析提示/` 下的 `index.html`、`index.css`、`app.js` 进行修改以落地实现所有的需求 R1, R2, R3。并在根目录下附带测试代码。

### MANDATORY INTEGRITY WARNING (ZERO TOLERANCE)
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

---

### 全局工程编码规范（必选遵守）：
1. **所有函数必须有注释**说明功能和参数。
2. **出错时必须有明确的错误提示**，禁止程序直接崩溃。
3. **敏感信息（密码、密钥）禁止写定在代码里**（如 API Key 只能通过前端输入框获取，绝不能在代码中硬编码任何默认 key）。
4. **变量和函数命名必须清晰**，能够“见名知意”。
5. **对外部系统的调用**（特别是 WebSocket 握手与消息发送）**必须有超时设置**。
6. **必须处理用户输入为空或格式错误的情况**。
7. **每个新功能必须附带测试代码**，覆盖正常和出错情况。你可以编写一个 `test_suite.html` / `test_suite.js` 或是直接在 `app.js` 附带测试控制模块，使得这些自愈逻辑、滑动窗口切断、导出文件格式等能够通过自动或手动触发的测试代码执行并验证（在 `test_suite.html` 中提供一键运行单元测试与模拟测试的功能）。

---

### 详细实施要求与方案：

#### 1. R1: 前端 UI 极致视觉美学重塑 (Premium Dark Mode UI)
- **暗黑毛玻璃风格（Glassmorphism）**:
  - 重构 `index.css` 中的按钮类 `.source-btn`、`.action-btn`、`.btn-copy`。配合 `backdrop-filter: blur(12px) saturate(180%)`，并用极高透明度的边框（如 `rgba(255, 255, 255, 0.08)`）以及细微的顶部白色内阴影（`inset 0 1px 1px rgba(255, 255, 255, 0.05)`）来模拟高档磨砂质感。
  - **微光流动（Shimmer Effect）**: 控制按钮（如 `.connect-btn`）在 hover 时有流光掠过动效。使用 `::before` 扫光层加上 `linear-gradient`，并在 hover 时配合平移动画（如 `left: -150% -> 150%`）。悬停时配合平滑的 3D 缩放微交互（`transform: translateY(-2px) scale(1.02)`）和霓虹发光阴影（靛蓝与亮粉的 `box-shadow` 漫反射）。
- **声波 Canvas 可视化改进**:
  - **防拉伸模糊**: 重新计算 Canvas 实际物理分辨率与设备像素比（DPR），通过监听窗口 `resize` 以及在 `drawVisualizer` 内动态更新 `canvas.width` 和 `canvas.height`，确保在高分屏（Retina）上渲染清晰。
  - **霓虹渐变音柱**: 使用 `canvasCtx.createLinearGradient` 实现至少两种霓虹渐变色彩（如亮粉色 `#ec4899`、靛蓝色 `#6366f1`、亮青色 `#06b6d4` 等），并使用现代 Canvas 2D API 的 `roundRect()` 绘制具有圆角倒角的音柱。
  - **镜像对称式绘制**: 音柱应该从 Canvas 中心向左右两端镜像展开（低频在中心，高频在两侧）。
  - **声压联动发光**: 实时计算当前 `dataArray` 均方根值（RMS）或平均值，得到当前的归一化声压级，将其与 `canvasCtx.shadowBlur` 绑定，使得声音大时阴影发光范围变大、颜色变得更明亮，声音小时发光变弱。
- **右侧提词自适应缩放**:
  - 将 `.reply-card` 的父级网格设为容器，声明 `.reply-card { container-type: size; container-name: replyContainer; }`。
  - 将回复文本 `.reply-text` 的字号使用容器高度查询单位 `cqh`：`font-size: clamp(1.1rem, 5cqh, 2.2rem)`，行高为 `line-height: clamp(1.4, 6cqh, 1.8)`，确保随窗口高度自适应缩放。
  - 在 `.reply-content-wrapper` 上叠加流式渐隐遮罩 `mask-image` 实现上下滚动边缘淡出消隐效果。

#### 2. R2: 业务功能完备化 (Enterprise Call Copilot Features)
- **多场景话术热切换**:
  - 在左侧控制区增加场景话术下拉菜单（销售推广、商务谈判、客户支持、技术支持），各场景对应不同的 `System Instruction` 提示词模板。
  - **秒级自动重连话术注入**: 由于 Gemini Live API 在握手后无法通过发送第二个 Setup 帧热切换话术，因此当用户在连接状态下切换话术时，需启动话术切换状态（如 `isHotSwitching = true`），切断当前 WebSocket 链接并重新发起，但在断开时不清理设备音频采集（保留 `micStream` 和 `systemStream` 轨道不予关闭），实现 1 秒内瞬间重连并自动重新发送包含新话术配置帧（Setup）的自愈流程，全程无弹窗再次向用户请求权限。
- **通话纪要历史导出**:
  - 界面右侧或底部增加隐藏折叠的历史记录侧边栏，支持点击滑出，并在里面显示最近 5 次的完整通话记录对话日志（包含 `[我方发言]` 与 `[推荐回复]`）。
  - **LocalStorage 滑动窗口**: 每次会话断开（`disconnectFromGemini`）时，读取内存中本次通话的内容，归档并使用 LocalStorage 滑动窗口存储最新 5 次记录（多于 5 次则将最老的一次截断丢弃）。
  - **一键下载 Markdown**: 在侧边栏通话记录卡片上提供“导出”按钮。点击后组装带有时分秒级时间戳的 Markdown 内容（例如：`[10:15:30] 我方发言: ...`），通过 Blob 转换为本地下载。

#### 3. R3: 指数级退避重连自愈 (Auto-Reconnect Resilience)
- **网络异常监听**: 监控 `onerror` 和 `onclose` 事件。如果不是用户主动断开（引入 `isUserInitiatedDisconnect` 来区分），则触发自愈重连。
- **指示灯状态变化**:
  - 新增黄色呼吸灯效果 CSS `.state-dot.reconnecting`（黄色 `#f59e0b` 搭配呼吸动效）。
  - 异常断连后指示灯变黄呼吸，状态文本显示：`网络断开，正在尝试第 X 次自动重连...`。
- **指数级退避自愈**:
  - 重试间隔遵循指数级增长（如 1s, 2s, 4s, 8s, 16s），上限设为 5 次。在第 5 次重连失败后彻底安全退回未连接状态并发出 Toast 错误警告。
- **握手超时保护**:
  - 新设 10 秒握手超时器，如果在调用连接后 10 秒内未收到服务端的 `setupComplete` 确认，强制 `ws.close()` 触发异常自愈。
- **静默空转流恢复**:
  - 在重连期间，物理音频输入正常捕获，但 ` Onaudioprocess` 检测到连接未建立则直接丢弃音频帧（清空队列，防止网络通后补发引起大模型混乱）。重连成功并握手（`setupComplete`）后，`isConnected` 置为 `true`，音频推流静默空转恢复，全程免人工干预。

---

### 测试代码要求：
在项目根目录下创建一个 `test_suite.html` 和 `test_suite.js`。
这个测试页面应该包含：
1. **指数退避时间计算单元测试**：验证输入重连次数 1-5 返回的毫秒数是否正确（1000, 2000, 4000, 8000, 16000）。
2. **历史记录滑动窗口单元测试**：往 localStorage 中写超过 5 个会话记录，测试是否被滑动截断保留最新的 5 个。
3. **Markdown 导出格式验证测试**：传入测试对话日志，测试其导出的 Markdown 字符串是否带有 `[HH:MM:SS]` 格式的时间戳。
4. **模拟网络连接自愈测试（Mock 测试）**：
   - 提供一个 MockWebSocket，可以模拟异常断连。
   - 触发模拟断连后，验证重连次数递增，指示灯变为 reconnecting 黄色，并在一段时间后重连成功的流程。
确保打开 `test_suite.html` 可以直接运行这些测试，并直观输出 PASS/FAIL 结果。
