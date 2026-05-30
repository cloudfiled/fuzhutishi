# Handoff Report - WebSocket Reconnection & Self-Healing Design

本项目已完成对 `app.js` WebSocket 通信链路与状态机的深入探索。本报告详细描述了针对 **M4（指数级退避重连自愈）** 阶段的修改策略与设计方案。

---

## 1. Observation (直接观察)

通过阅读项目源码，我们直接观察到以下代码现状：

1. **WebSocket 的被动关闭处理机制缺失**：
   - 在 `app.js`（行 472 - 479）中：
     ```javascript
     ws.onerror = (err) => {
         logToStream('error', `WebSocket 异常: ${err.message || '未知错误'}`);
     };

     ws.onclose = (event) => {
         logToStream('system', `会话已关闭，代码: ${event.code}, 原因: ${event.reason}`);
         disconnectFromGemini();
     };
     ```
     只要发生 `onclose` 事件，程序会无差别调用 `disconnectFromGemini()`。

2. **音频采集资源的过度释放**：
   - 在 `disconnectFromGemini()` 中（行 541 - 545）：
     ```javascript
     if (processorNode) {
         processorNode.disconnect();
         processorNode = null;
     }
     ```
     这导致即使是因网络抖动导致的短暂断开，用户的 Web Audio `processorNode` 也会被直接断开并销毁。重连时不得不重新请求设备授权或让用户重新进行屏幕共享。

3. **指示灯的 CSS 样式局限性**：
   - 在 `index.css`（行 287 - 311）中，状态指示灯仅有以下三种状态的类：
     - `.state-dot` (默认灰色静止)
     - `.state-dot.listening` (蓝色呼吸闪烁)
     - `.state-dot.thinking` (紫色呼吸闪烁)
     目前缺少重连状态相关的黄色呼吸闪烁 CSS 类。

4. **API Key 的内存持久化缺失**：
   - 在 `connectToGemini()` 中（行 435），API Key 是直接从 `apiKeyInput.value` 中即时获取的，并未在内存中以全局变量形式持久留存。如果在重连时该输入框已被用户清除或修改，将导致重连失败。

---

## 2. Logic Chain (推理链条)

根据上述直接观察，我们推导出以下重连与状态自愈的改动逻辑：

1. **区分主动与被动断开（基于 Observation 1 和 2）**：
   - 必须引入 `isUserInitiatedDisconnect` 全局标识。
   - 当用户点击断开按钮时设为 `true`；异常断线时保持为 `false`。
   - 在 `ws.onclose` 中，若 `isUserInitiatedDisconnect === false`，我们执行重连逻辑而**不要**调用 `disconnectFromGemini()` 以避免销毁 `processorNode`，以此保证用户无需重新配置或重新授权音频源。

2. **保留音频流采集并实现“静默空转”（基于 Observation 2）**：
   - 在重连期间，`micStream` 和 `systemStream` 依然保持捕获状态，`processorNode` 亦保留不予 `disconnect`。
   - 通过在 `processorNode.onaudioprocess` 中加入 `isConnected` 防护判定，重连期间音频包在客户端直接抛弃（不积压，避免断网重连后大模型收到巨量非实时音频产生混乱）。网络重连成功且 Setup 帧握手完成后，`isConnected` 恢复为 `true`，音频推流自然、无缝恢复。

3. **引入指数退避重连算法（基于 Observation 1）**：
   - 引入重试计数器 `reconnectCount` 和最大重试上限 `maxReconnectAttempts = 5`。
   - 每次重试时，通过延迟公式 `delay = Math.pow(2, reconnectCount - 1) * 1000` 动态计算重试延迟时间（1s, 2s, 4s, 8s, 16s），并在达到上限后安全退回到彻底断开状态并给予用户友好提示。

4. **添加握手超时守护（基于稳定性和防假死设计）**：
   - 有些情况网络是“假在线”（TCP连接能建立，但由于鉴权或服务端内部出错，迟迟不回 `setupComplete`）。
   - 增加 10 秒的握手超时器 `handshakeTimeoutId`。在调用 `performConnection` 10s 后若仍未收到 `setupComplete`，则主动 `ws.close()` 以重新拉起下一次退避重连。

5. **设计黄色呼吸闪烁指示灯（基于 Observation 3 和 4）**：
   - 在 `index.css` 中增加 `.state-dot.reconnecting`，使用黄色背景 `#f59e0b` 并挂载已有的 `indicator-pulse` 动画。
   - 在 `updateUIState` 中新增 `'reconnecting'` 状态分支，将指示灯类名设为 `'state-dot reconnecting'`，同时将文本提示动态更新为 `网络断开，正在尝试第 X 次自动重连...`。

---

## 3. Caveats (注意事项与局限)

1. **音频帧队列清空**：在重连开始时，我们会清空积压的本地音频队列 `pendingAudioQueue`。这意味着断网期间用户所说的话将不会在重连后补发。这是一种权衡设计，因为补发长时间断网的录音会导致大模型收到的音频包严重滞后且时序错乱。
2. **话术热切换冲突防范**：重连完成发送 Setup 帧时，必须采用当前正在使用的话术配置。如果在此阶段用户正在切换下拉菜单，可能会发生指令冲突。我们在重连时应优先使用保存在全局变量中的最后一次活跃话术。
3. **假死连接的彻底关闭**：重连调用前必须显式地将旧 WebSocket 实例的 `onerror` 和 `onclose` 句柄设为 `null` 并调用 `close()`，以防销毁过程中重复触发 `onclose` 陷入无限循环。

---

## 4. Conclusion (改动方案与代码设计)

以下是具体的改动代码及样式设计方案（请不要直接应用到源文件，作为实施设计提供给 Implementer 阶段）：

### 4.1 CSS 改动 (index.css)

在 `index.css` 中，为指示灯新增黄色呼吸状态类，位于 `.state-dot.speaking` 之后（行 310）：

```css
/* 新增：网络重连状态的黄色呼吸灯 */
.state-dot.reconnecting {
    background: #f59e0b; /* 黄色 */
    box-shadow: 0 0 8px #f59e0b;
    animation: indicator-pulse 1.5s infinite;
}
```

### 4.2 JavaScript 改动 (app.js)

#### 1. 全局状态变量新增 (在 app.js 顶部的全局变量区，约第 58 行之后)：

```javascript
// ==========================================
// 自动重连与自愈状态管理
// ==========================================
let currentApiKey = '';                // 备份验证通过的 API Key
let isUserInitiatedDisconnect = false;  // 标识是否是用户主动点击的断开连接
let reconnectCount = 0;                 // 当前重连尝试次数
const maxReconnectAttempts = 5;         // 最大自动重试次数
let reconnectTimeoutId = null;          // 重连定时器 ID
let handshakeTimeoutId = null;          // 握手超时定时器 ID
```

#### 2. 修改连接控制按钮事件监听 (修改第 424 行)：

```javascript
// 监听连接控制按钮
btnToggleConnection.addEventListener('click', () => {
    if (isConnected || ws) {
        // 用户主动点击“断开”或在重连期间点击“取消重连”
        isUserInitiatedDisconnect = true;
        
        // 彻底清理重连与握手定时器
        if (reconnectTimeoutId) {
            clearTimeout(reconnectTimeoutId);
            reconnectTimeoutId = null;
        }
        if (handshakeTimeoutId) {
            clearTimeout(handshakeTimeoutId);
            handshakeTimeoutId = null;
        }
        
        disconnectFromGemini();
    } else {
        // 开启新连接，初始化状态
        isUserInitiatedDisconnect = false;
        reconnectCount = 0;
        connectToGemini();
    }
});
```

#### 3. 剥离并重构 `connectToGemini` 与 `performConnection` (修改第 433 行)：

```javascript
// 核心连接入口：仅负责抓取和验证 API Key 
async function connectToGemini() {
    const apiKey = apiKeyInput.value.trim().replace(/['"\s]/g, '');
    if (!apiKey) {
        showToast('请输入有效的 API Key！');
        apiKeyInput.focus();
        return;
    }
    
    // 将已验证过的 API Key 保存至内存全局变量，供重连过程无感使用
    currentApiKey = apiKey;
    
    performConnection();
}

// 实际建立 WebSocket 物理连接的执行者（支持重连调用）
async function performConnection() {
    // 根据状态更新 UI。如果是第一次连接，展示“正在连接...”；如果是重连，展示“正在重连...”
    if (reconnectCount > 0) {
        updateUIState('reconnecting');
    } else {
        updateUIState('connecting');
        logToStream('system', '正在建立与 Gemini Multimodal Live API 的 WebSocket 连接...');
    }

    const host = 'generativelanguage.googleapis.com';
    const path = 'ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent';
    const wsUrl = `wss://${host}/${path}?key=${currentApiKey}`;

    try {
        ws = new WebSocket(wsUrl);
        
        // 启动 10 秒握手超时保护，防止处于“假在线”状态卡死
        if (handshakeTimeoutId) clearTimeout(handshakeTimeoutId);
        handshakeTimeoutId = setTimeout(() => {
            if (!isConnected && ws) {
                logToStream('error', '【连接超时】WebSocket 握手超时，强制关闭并重新尝试重连。');
                ws.close(); // 这会自动触发 ws.onclose 进而走 handlePassiveDisconnect 逻辑
            }
        }, 10000);
        
        ws.onopen = () => {
            logToStream('system', 'WebSocket 连接成功，发送配置帧 (Setup)...');
            sendSetupFrame();
        };

        ws.onmessage = async (event) => {
            try {
                let rawData;
                if (event.data instanceof Blob) {
                    rawData = await event.data.text();
                } else {
                    rawData = event.data;
                }
                handleServerMessage(rawData);
            } catch (err) {
                logToStream('error', `读取服务器数据出错: ${err.message}`);
            }
        };

        ws.onerror = (err) => {
            logToStream('error', `WebSocket 异常: ${err.message || '网络连接错误'}`);
        };

        ws.onclose = (event) => {
            logToStream('system', `会话已关闭，代码: ${event.code}, 原因: ${event.reason}`);
            
            // 清理本次连接的握手超时器
            if (handshakeTimeoutId) {
                clearTimeout(handshakeTimeoutId);
                handshakeTimeoutId = null;
            }

            if (isUserInitiatedDisconnect) {
                // 用户主动关闭，正常断开所有设备
                disconnectFromGemini();
            } else {
                // 网络异常导致被动关闭，触发退避自愈
                handlePassiveDisconnect();
            }
        };

    } catch (e) {
        logToStream('error', `建立连接失败: ${e.message}`);
        if (isUserInitiatedDisconnect) {
            disconnectFromGemini();
        } else {
            handlePassiveDisconnect();
        }
    }
}
```

#### 4. 引入异常断开处理器 `handlePassiveDisconnect` (新增函数)：

```javascript
/**
 * 处理由于网络异常导致的被动断连，执行指数级退避重连算法
 */
function handlePassiveDisconnect() {
    isConnected = false;
    
    // 安全地关闭并注销旧 WebSocket 实例的句柄，防止销毁期间二次触发 Close 事件
    if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        try {
            ws.close();
        } catch (e) {}
        ws = null;
    }
    
    // 清除可能存在的思考/生成超时限制，为下一次会话做准备
    if (idleReleaseTimeoutId) {
        clearTimeout(idleReleaseTimeoutId);
        idleReleaseTimeoutId = null;
    }
    isGenerating = false;
    isWaitingForResponse = false;
    if (waitingTimeoutId) {
        clearTimeout(waitingTimeoutId);
        waitingTimeoutId = null;
    }

    // 重置积压数据包，防止重连后大模型接收大量过期录音
    pendingAudioQueue = [];
    hasSpeechInQueue = false;

    // 检查重连次数上限
    if (reconnectCount >= maxReconnectAttempts) {
        logToStream('error', `【自动重连】已达到最大尝试次数 (${maxReconnectAttempts} 次)，放弃重连。`);
        showToast('网络连接中断，自动重连失败，请检查网络设置后重试。');
        disconnectFromGemini(); // 退回到初始的未连接状态，并彻底断开音频设备以释放硬件占用
        return;
    }
    
    reconnectCount++;
    // 指数递增计算延迟：1s, 2s, 4s, 8s, 16s
    const delay = Math.pow(2, reconnectCount - 1) * 1000;
    
    logToStream('system', `【自动重连】将在 ${delay / 1000} 秒后尝试第 ${reconnectCount} 次重连...`);
    updateUIState('reconnecting');
    
    if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);
    reconnectTimeoutId = setTimeout(() => {
        performConnection();
    }, delay);
}
```

#### 5. 修改 `disconnectFromGemini` 确保干净物理断开 (修改第 525 行)：

```javascript
// 彻底断开会话并释放所有物理硬件（用户主动触发或多次重连失败时调用）
function disconnectFromGemini() {
    isConnected = false;
    isUserInitiatedDisconnect = false;
    reconnectCount = 0;
    
    // 强制清理所有相关的定时器
    if (reconnectTimeoutId) {
        clearTimeout(reconnectTimeoutId);
        reconnectTimeoutId = null;
    }
    if (handshakeTimeoutId) {
        clearTimeout(handshakeTimeoutId);
        handshakeTimeoutId = null;
    }
    if (idleReleaseTimeoutId) {
        clearTimeout(idleReleaseTimeoutId);
        idleReleaseTimeoutId = null;
    }
    
    // 归档并清空我方剩余的发音数据
    finalizeUserSpeech();
    
    // 重置积压音频队列
    pendingAudioQueue = [];
    hasSpeechInQueue = false;
    
    // 彻底关闭音频流采集并断开物理硬件节点（仅在彻底断开时执行）
    if (processorNode) {
        processorNode.disconnect();
        processorNode = null;
    }
    
    // 彻底释放麦克风与系统音频物理占用，保证设备指示灯熄灭
    if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
        micStream = null;
    }
    if (systemStream) {
        systemStream.getTracks().forEach(track => track.stop());
        systemStream = null;
    }
    btnRequestMic.classList.remove('active');
    btnRequestSystem.classList.remove('active');
    updateAudioStatus();
    
    // 关闭 WebSocket 链接
    if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        if (ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
        ws = null;
    }

    logToStream('system', '已与 Gemini 实时会话断开。');
    updateUIState('disconnected');
    showToast('会话已断开');
}
```

#### 6. 修改 `updateUIState` 新增 reconnecting 分支 (修改第 741 行)：

在 `updateUIState` 函数内新增一个 `case 'reconnecting':` 分支，并将原本在 `'disconnected'` 中清除定时器的部分根据实际情况补充：

```javascript
        case 'reconnecting':
            // 此时并不完全重置按钮。保持控制键激活，允许用户点击“取消重连”
            btnToggleConnection.textContent = '取消重连';
            btnToggleConnection.className = 'action-btn disconnect-btn'; // 用红色警示
            btnToggleConnection.disabled = false;
            connectionStatus.textContent = '正在重连...';
            connectionStatus.className = 'value text-yellow';
            stateIndicator.className = 'state-dot reconnecting'; // 黄色呼吸闪烁
            stateText.textContent = `网络断开，正在尝试第 ${reconnectCount} 次自动重连...`;
            break;
```

#### 7. 修改 `handleServerMessage` 对 setupComplete 恢复逻辑的判断 (修改第 582 行)：

```javascript
        // 1. 判断是否是 setup 成功的确认信息
        if (message.setupComplete) {
            logToStream('system', '大模型 Setup 握手成功，实时通话第二大脑开启！');
            isConnected = true;
            reconnectCount = 0; // 握手成功，清空重连计数
            
            // 清除本次成功的握手超时器
            if (handshakeTimeoutId) {
                clearTimeout(handshakeTimeoutId);
                handshakeTimeoutId = null;
            }
            
            updateUIState('connected');
            
            // 【自愈核心】若音频节点 processorNode 依然存活（即处于被动断开恢复），
            // 则只需在 isConnected=true 后自然让其 onaudioprocess 重新推流即可，无需重新请求设备或重建节点；
            // 只有在首次连接（processorNode === null）时才需要开启音频采集。
            if (!processorNode) {
                startAudioStreaming();
            } else {
                logToStream('system', '音频流采集链路已自动恢复推流。');
            }
            return;
        }
```

---

## 5. Verification Method (验证方法)

下面提供一套基于浏览器的手动断网与异常调试的测试流程，可百分之百复现和验证此套自愈系统的有效性：

### 测试场景 1：网络暂时断开 (短断网自愈)
1. **启动服务**：输入有效的 Gemini API Key，授权麦克风与系统音频，点击“建立 Live 会话”。
2. **验证正常倾听**：对着麦克风发声，确认指示灯显示为蓝色闪烁的“默默倾听中...”，且 Canvas 波形图能正常显示电平。
3. **模拟断网**：在 Chrome 浏览器中按下 `F12` 打开 DevTools，切换到 **Network (网络)** 面板。
4. **触发 Offline**：在 Network 面板的 Throttling (节流) 选择框中，由 **No throttling** 切换为 **Offline**。
5. **观察 UI 变化**：
   - 检查右下角事件流中是否立刻显示：`会话已关闭，代码: ...` 并输出 `【自动重连】将在 1 秒后尝试第 1 次重连...`。
   - 检查顶部状态栏指示灯是否立刻变为**黄色呼吸闪烁**，且右侧文字提示为：`网络断开，正在尝试第 1 次自动重连...`。
   - 检查侧边栏按钮是否变为红色的“取消重连”。
6. **观察递增尝试**：等待 1 秒后，由于仍然处于 Offline，系统会提示第 2 次重试（延迟 2 秒），依此类推观察延迟时间是否遵循 $2^{n-1}$ 秒指数级增加。
7. **恢复网络**：在第 3 次重试倒计时结束前，迅速将 Network 切回 **No throttling**。
8. **验证流恢复**：
   - 观察在下一次连接成功并收到服务端的 `setupComplete` 后，指示灯是否在无需任何用户干预的情况下自动恢复为蓝色“默默倾听中...”。
   - 对麦克风说话，确认 Canvas 依然有声波跳动，且事件流打印 `音频流采集链路已自动恢复推流`，证明音频流已恢复且设备无需重新配置。

### 测试场景 2：连接假死校验 (握手超时防御)
1. 在 Network 面板中正常连入会话。
2. 再次切为 **Offline** 触发重连，但在下一次重连尝试瞬间（例如刚刚显示“正在重连...”），切回 **No throttling**，模拟 TCP 连接建立成功，但由于特定网关策略或服务器繁忙导致 Setup 帧无响应。
3. 保持此时的状态，静静等待 10 秒。
4. 观察事件流在 10 秒时是否会打印 `【连接超时】WebSocket 握手超时，强制关闭并重新尝试重连。`，同时自动断开并安全推进到下一次重试。

### 测试场景 3：网络彻底断开达上限 (硬断网退回)
1. 保持 Network 面板为 **Offline** 状态。
2. 观察重连重试达到第 5 次。
3. 验证在第 5 次重连失败后，页面是否会弹出 Toast 提示 `网络连接中断，自动重连失败，请检查网络设置后重试。`。
4. 验证系统是否彻底清空状态，将指示灯恢复为灰色，且 API Key 输入框和物理授权按钮重新恢复为 enabled (可用) 状态，以便用户重新检查环境。

### 测试场景 4：重连期间取消重连
1. 正常建立连接后模拟断网（Offline）。
2. 在指示灯呈现黄色重连呼吸状态时，点击侧边栏的“取消重连”。
3. 验证系统是否立刻终止定时器，并退回到彻底断开的初始状态。
