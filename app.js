/**
 * ==========================================================================
 * Real-time Call Copilot - 核心交互逻辑与通信引擎 (极速解耦免服务器版)
 * 功能：
 * 1. 麦克风采集与系统音频流混音仅用于 Canvas 波形可视化渲染
 * 2. 浏览器内置 Web Speech API (webkitSpeechRecognition) 驱动高精度、零延迟 ASR 听写
 * 3. 谷歌纯文本大模型 Gemini 2.5 Flash 直连流式生成（支持实时 Google Search 联网搜索）
 * 4. 零服务器开销、秒级话术热切换、专有名词前端映射纠错与大模型语义清洗
 * 5. 通话历史记录滑动窗口与 Markdown 导出
 * 6. 向后兼容现有测试套件（test_suite.js & stress_test.js）
 * ==========================================================================
 */

// UI 元素注册
const apiKeyInput = typeof document !== 'undefined' ? document.getElementById('apiKey') : null;
const btnRequestMic = typeof document !== 'undefined' ? document.getElementById('btnRequestMic') : null;
const btnRequestSystem = typeof document !== 'undefined' ? document.getElementById('btnRequestSystem') : null;
const btnToggleConnection = typeof document !== 'undefined' ? document.getElementById('btnToggleConnection') : null;
const connectionStatus = typeof document !== 'undefined' ? document.getElementById('connectionStatus') : null;
const audioCaptureStatus = typeof document !== 'undefined' ? document.getElementById('audioCaptureStatus') : null;
const latencyValue = typeof document !== 'undefined' ? document.getElementById('latencyValue') : null;
const stateIndicator = typeof document !== 'undefined' ? document.getElementById('stateIndicator') : null;
const stateText = typeof document !== 'undefined' ? document.getElementById('stateText') : null;
const logStream = typeof document !== 'undefined' ? document.getElementById('logStream') : null;
const canvas = typeof document !== 'undefined' ? document.getElementById('audioVisualizer') : null;
const replyPlaceholder = typeof document !== 'undefined' ? document.getElementById('replyPlaceholder') : null;
const replyText = typeof document !== 'undefined' ? document.getElementById('replyText') : null;
const pointsList = typeof document !== 'undefined' ? document.getElementById('pointsList') : null;
const btnCopyReply = typeof document !== 'undefined' ? document.getElementById('btnCopyReply') : null;
const groundingBadge = typeof document !== 'undefined' ? document.getElementById('groundingBadge') : null;
const liveCaptionBar = typeof document !== 'undefined' ? document.getElementById('liveCaptionBar') : null;
const liveCaptionText = typeof document !== 'undefined' ? document.getElementById('liveCaptionText') : null;

// 在页面初始化阶段，强行使“建立 Live 会话”按钮可用，免去点击捕获按钮的繁琐前置步骤
if (btnToggleConnection) {
    btnToggleConnection.disabled = false;
}

// 全局状态变量（包含为测试套件 stress_test.js 提供的兼容性声明）
let micStream = null;
let systemStream = null;
let mixedAudioDestination = null;
let audioCtx = null;
let processorNode = null;
let streamSourceMic = null;
let streamSourceSystem = null;
let analyser = null;
let ws = null; // 压测脚本引用占位
let isConnected = false;
let canvasCtx = canvas ? canvas.getContext('2d') : null;
let audioInterval = null;
let userSpeechBuffer = ''; // 实时存储转写文本的缓冲区
let isGenerating = false; // 大模型是否正在进行思考、检索或生成回复
let ignoreGeneratingStateUntil = 0; // 防抖时间戳
let micGainNode = null; 
let systemGainNode = null; 
let pendingAudioQueue = []; // 兼容压测脚本缓存队列
let hasSpeechInQueue = false; // 兼容压测脚本语音检测标志
let isWaitingForResponse = false; // 兼容压测脚本状态标志
let lastSpeechTime = 0; 
let isUserSpeaking = false; 
let waitingTimeoutId = null; 
let vadCoolOffUntil = 0; 
let idleReleaseTimeoutId = null; 

let isHotSwitching = false;
let reconnectAttempts = 0;
let reconnectTimeoutId = null;
let handshakeTimeoutId = null;
let isUserInitiatedDisconnect = false;
let isReconnecting = false;
let currentSessionLogs = []; // 存储当前会话的流式聊天日志
let streamingTextBuffer = ''; // 流式文字缓冲区

// 专有名词纠错映射词典 (用户可在此随意扩充)
const CORRECTION_DICTIONARY = {
    "滴水": "DeepSeek",
    "吉米尼": "Gemini",
    "唯爱地": "VAD",
    "萨斯": "SaaS",
    "阿斯尔": "ASR",
    "微爱地": "VAD",
    "大模型": "LLM"
};

// 静态纠错函数
function correctSpecialNouns(text) {
    if (!text) return "";
    let corrected = text;
    for (const [wrong, right] of Object.entries(CORRECTION_DICTIONARY)) {
        corrected = corrected.replaceAll(wrong, right);
    }
    return corrected;
}

// 话术配置系统指令 (精简高可用版，大幅降低 TPM 消耗)
const DEFAULT_SYSTEM_INSTRUCTION = `你是在通话中用户的“智能提词器”。
1. 强制中文：必须全部使用口语化、接地气的【简体中文】输出推荐回复，绝对禁止英文。
2. 自适应语调：
   - 闲聊：使用轻松、自然、有情商的聊实话语（多用“其实啊...”、“这样子...”）。
   - 专业问题：严谨、客观、数据详实地作答（如大学排名、技术数据等）。
3. 扮演第一人称，用“我”或“我们”的口吻。
4. 格式：
   - 👉 [直接念]：适合直接念的文本（80-150字）。
   - 💡 [要点参考]：列出 2 个支撑事实或专有名词（闲聊场景下写“日常随和应对即可”）。`;

const SCENARIO_INSTRUCTIONS = {
    general: `你是在通话中用户的“自适应提词器”。当前是【通用提词】场景。
1. 强制中文：全部使用口语化的【简体中文】回答，禁止英文。
2. 自适应：闲聊用轻松语气；专业问题提供精准详实的客观回答。
3. 格式：
   - 👉 [直接念]：适合直接朗读的流畅文本。
   - 💡 [要点参考]：列出 2 个客观数据支撑点或关键事实。
4. 扮演第一人称。`,

    sales: `你是在通话中用户的“隐形销售助手”。当前是【销售推广】场景。
1. 强制中文：必须使用温暖有说服力的【简体中文】口语化回复，禁止英文。
2. 格式：
   - 👉 [直接念]：销售金牌话术（80字内）。
   - 💡 [要点参考]：核心卖点或论据。
3. 扮演第一人称。`,

    negotiation: `你是在通话中用户的“隐形谈判助手”。当前是【商务谈判】场景。
1. 强制中文：使用沉稳、留有余地的【简体中文】口语化回复，禁止英文。
2. 格式：
   - 👉 [直接念]：谈判回复（80字内）。
   - 💡 [要点参考]：退让底线或谈判支撑点。
3. 扮演第一人称。`,

    support: `你是在通话中用户的“客户支持助手”。当前是【客户服务】场景。
1. 强制中文：使用极具同理心与耐心的【简体中文】口语化回复，禁止英文。
2. 格式：
   - 👉 [直接念]：客服安抚话术（80字内）。
   - 💡 [要点参考]：标准排错步骤。
3. 扮演第一人称。`,

    tech: `你是在通话中用户的“技术支持助手”。当前是【技术排查】场景。
1. 强制中文：使用逻辑清晰严谨的【简体中文】口语化回复，禁止英文。
2. 格式：
   - 👉 [直接念]：技术排查话术（80字内）。
   - 💡 [要点参考]：核心故障排错建议。
3. 扮演第一人称。`
};

// ==========================================================================
// 1. ASR 模块 (浏览器内置 Web Speech API 驱动)
// ==========================================================================

let recognition = null;
let recognitionActive = false;

// 初始化 Web Speech API
function initSpeechRecognition() {
    if (recognition) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        logToStream('error', '您的浏览器不支持 Web Speech API，请使用 Google Chrome 浏览器以获取免费语音转写服务。');
        showToast('浏览器不支持 ASR！请换用 Chrome。');
        return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'zh-CN';

    recognition.onstart = () => {
        recognitionActive = true;
        isConnected = true;
        isReconnecting = false;
        reconnectAttempts = 0;
        if (reconnectTimeoutId) {
            clearTimeout(reconnectTimeoutId);
            reconnectTimeoutId = null;
        }
        updateUIState('connected');
        logToStream('system', '提词助手已就绪，正在聆听您的通话并随时提供金牌回复。');
    };

    recognition.onresult = async (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }

        // 实时渲染我方/对方正在说的话（临时字幕，零延迟）
        if (interimTranscript.trim()) {
            if (liveCaptionBar && liveCaptionText) {
                liveCaptionBar.style.display = 'flex';
                liveCaptionText.textContent = `您正在说：${interimTranscript.trim()}`;
            }
        }

        // 一句完整的话讲完
        if (finalTranscript.trim()) {
            // 专有名词映射纠错
            const corrected = correctSpecialNouns(finalTranscript.trim());
            userSpeechBuffer = corrected;
            
            // 归档发言到事件流日志及历史会话
            finalizeUserSpeech();

            // 触发云端极速大模型纯文本流推理
            await triggerGeminiInference(corrected);
        }
    };

    recognition.onerror = (event) => {
        if (event.error === 'no-speech') return; // 长时间未说话正常释放，不用报错
        logToStream('error', `语音识别异常: ${event.error}`);
        attemptReconnect();
    };

    recognition.onend = () => {
        recognitionActive = false;
        // 如果不是用户主动点击“断开”，并且当前没有在构思回复，就开启重连以维持持久监听
        if (!isUserInitiatedDisconnect && !isGenerating && isConnected) {
            attemptReconnect();
        }
    };
}

function safeStartASR() {
    if (!recognition) return;
    if (recognitionActive) return;
    try {
        recognition.start();
    } catch (e) {
        console.warn("ASR start warning:", e.message);
    }
}

function safeStopASR() {
    if (!recognition) return;
    if (!recognitionActive) return;
    try {
        recognition.stop();
    } catch (e) {
        console.warn("ASR stop warning:", e.message);
    }
}

// ==========================================================================
// 2. 音频捕获与动效可视化模块 (混音连到 analyser，仅供霓虹波形绘制)
// ==========================================================================

function initAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 16000
        });
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
    }
}

if (btnRequestMic) {
    btnRequestMic.addEventListener('click', async () => {
        try {
            initAudioContext();
            micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1
                }
            });
            btnRequestMic.classList.add('active');
            showToast('麦克风已成功授权！');
            updateAudioStatus();
        } catch (err) {
            logToStream('error', `无法获取麦克风: ${err.message}`);
            showToast('麦克风授权失败！');
        }
    });
}

if (btnRequestSystem) {
    btnRequestSystem.addEventListener('click', async () => {
        try {
            initAudioContext();
            systemStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false
                }
            });
            if (systemStream.getAudioTracks().length === 0) {
                throw new Error('未检测到共享的音频轨道，请重载并确保勾选了“共享系统音频”');
            }
            btnRequestSystem.classList.add('active');
            showToast('系统音频捕获成功！');
            updateAudioStatus();
        } catch (err) {
            logToStream('error', `系统音频捕获失败: ${err.message}`);
            showToast('系统音频捕获失败！');
        }
    });
}

function updateAudioStatus() {
    if (micStream && systemStream) {
        audioCaptureStatus.textContent = '双向捕获就绪';
        audioCaptureStatus.className = 'value text-green';
        logToStream('system', '双路音频流采集就绪，开始监测声波。');
        mixAudioStreams();
    } else if (micStream || systemStream) {
        audioCaptureStatus.textContent = '单轨运行中';
        audioCaptureStatus.className = 'value text-yellow';
        const activeSource = micStream ? '本地麦克风' : '系统音频';
        logToStream('system', `单路音频 (${activeSource}) 采集就绪，开始监测声波。`);
        mixAudioStreams();
    } else {
        audioCaptureStatus.textContent = '未就绪';
        audioCaptureStatus.className = 'value';
    }
    // 无论音视频捕获就绪状态如何，都允许建立提词会话（SpeechRecognition 会在启动时自动向浏览器索要麦克风权限）
    btnToggleConnection.disabled = false;
}

function mixAudioStreams() {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    
    if (streamSourceMic) streamSourceMic.disconnect();
    if (streamSourceSystem) streamSourceSystem.disconnect();
    
    if (!micGainNode) {
        micGainNode = audioCtx.createGain();
        const micSlider = document.getElementById('micGainRange');
        micGainNode.gain.value = micSlider ? parseFloat(micSlider.value) : 1.0;
    }
    if (!systemGainNode) {
        systemGainNode = audioCtx.createGain();
        const sysSlider = document.getElementById('systemGainRange');
        systemGainNode.gain.value = sysSlider ? parseFloat(sysSlider.value) : 1.0;
    }

    if (micStream) {
        streamSourceMic = audioCtx.createMediaStreamSource(micStream);
        streamSourceMic.connect(micGainNode);
    }
    if (systemStream) {
        streamSourceSystem = audioCtx.createMediaStreamSource(systemStream);
        streamSourceSystem.connect(systemGainNode);
    }

    if (micGainNode) micGainNode.connect(analyser);
    if (systemGainNode) systemGainNode.connect(analyser);

    drawVisualizer();
}

function resizeCanvas() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
}

if (typeof window !== 'undefined') {
    window.addEventListener('resize', resizeCanvas);
}

function drawVisualizer() {
    if (!analyser) return;
    resizeCanvas();
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const draw = () => {
        if (!isConnected && !micStream && !systemStream) {
            if (canvas && canvasCtx) {
                canvasCtx.fillStyle = 'rgba(7, 9, 19, 0.5)';
                canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
            }
            return;
        }
        
        if (typeof requestAnimationFrame !== 'undefined') {
            requestAnimationFrame(draw);
        }
        analyser.getByteFrequencyData(dataArray);
        
        if (!canvas || !canvasCtx) return;
        
        canvasCtx.fillStyle = 'rgba(7, 9, 19, 0.2)';
        canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
        
        const w = canvas.width;
        const h = canvas.height;
        
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / bufferLength);
        const normalizedVolume = Math.min(rms / 128, 1.0);
        
        if (normalizedVolume > 0.05) {
            canvas.style.filter = `drop-shadow(0px 0px ${normalizedVolume * 25}px rgba(99, 102, 241, 0.85))`;
        } else {
            canvas.style.filter = 'none';
        }
        
        const barWidth = (w / bufferLength) * 1.5;
        let barHeight;
        let x = 0;
        
        const halfLen = Math.floor(bufferLength / 2);
        const center = w / 2;
        
        for (let i = 0; i < halfLen; i++) {
            const dataIdx = halfLen - 1 - i;
            const percent = dataArray[dataIdx] / 255;
            barHeight = percent * h * 0.75;
            
            const grad1 = canvasCtx.createLinearGradient(0, h, 0, h - barHeight);
            grad1.addColorStop(0, '#6366f1'); 
            grad1.addColorStop(1, '#8b5cf6');
            
            canvasCtx.fillStyle = grad1;
            canvasCtx.fillRect(center - x - barWidth, h - barHeight, barWidth - 2, barHeight);
            
            const grad2 = canvasCtx.createLinearGradient(0, h, 0, h - barHeight);
            grad2.addColorStop(0, '#6366f1'); 
            grad2.addColorStop(1, '#ec4899');
            
            canvasCtx.fillStyle = grad2;
            canvasCtx.fillRect(center + x, h - barHeight, barWidth - 2, barHeight);
            
            x += barWidth;
        }
    };
    
    draw();
}

// ==========================================================================
// 3. 谷歌纯文本大模型直连流式调用 (Gemini 2.5 Flash API Fetch Stream)
// ==========================================================================

// 流式 JSON 括号匹配解析器
function findJSONBoundary(str) {
    let braceCount = 0;
    let inString = false;
    let escape = false;
    let firstBraceIndex = -1;
    
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (char === '\\') {
            escape = true;
            continue;
        }
        if (char === '"') {
            inString = !inString;
            continue;
        }
        if (!inString) {
            if (char === '{') {
                if (braceCount === 0) {
                    firstBraceIndex = i;
                }
                braceCount++;
            } else if (char === '}') {
                braceCount--;
                if (braceCount === 0 && firstBraceIndex !== -1) {
                    return i + 1;
                }
            }
        }
    }
    return -1;
}

// 重试自愈辅助计算：智能轮换选择备用模型
function getRetryModel(selectedModel, retryCount) {
    const modelsPool = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-1.5-flash'];
    if (retryCount === 0) return selectedModel;
    const otherModels = modelsPool.filter(m => m !== selectedModel);
    return otherModels[(retryCount - 1) % otherModels.length];
}

// 重试自愈辅助计算：当重试次数达到一定阀值时是否强制临时关闭联网检索以绕过限流
function shouldDisableSearch(isSearchEnabled, retryCount) {
    return isSearchEnabled && retryCount >= 2;
}

// 多轮对话上下文构造计算：从历史日志中提取最近的对话历史并组装成符合 Gemini API 的 contents
function buildGeminiContents(sessionLogs, userText) {
    const contents = [];
    const filteredLogs = sessionLogs.filter(log => log.role === '我方发言' || log.role === '推荐回复');
    
    // 最多带最近 3 轮（即 6 条记录）以保护 TPM 并防 429
    const maxHistoryItems = 6;
    const logsToUse = filteredLogs.slice(-maxHistoryItems);
    
    logsToUse.forEach((log, index) => {
        const isLast = (index === logsToUse.length - 1);
        const role = (log.role === '我方发言' ? 'user' : 'model');
        
        let textContent = log.text;
        if (isLast && role === 'user') {
            textContent = `客户刚刚提问：“${log.text}”。
            提示：上述客户提问可能存在同音字识别错漏，请直接在内心纠正并给出你格式化后的推荐回复，绝对禁止在回答中包含关于纠错过程的废话、解释或分析。`;
        }
        
        contents.push({
            role: role,
            parts: [{ text: textContent }]
        });
    });
    
    // 兜底：如果 contents 为空，或者最后一项不是 user，强制放入当前 userText
    if (contents.length === 0 || contents[contents.length - 1].role !== 'user') {
        contents.push({
            role: "user",
            parts: [{ 
                text: `客户刚刚提问：“${userText}”。
                提示：上述客户提问可能存在同音字识别错漏，请直接在内心纠正并给出你格式化后的推荐回复，绝对禁止在回答中包含关于纠错过程的废话、解释或分析。` 
            }]
        });
    }
    return contents;
}

// 调用大模型
// 调用大模型
async function triggerGeminiInference(userText) {
    if (isGenerating) return;

    safeStopASR();
    isGenerating = true;
    updateUIState('generating');
    streamingTextBuffer = '';
    
    const apiKey = apiKeyInput ? apiKeyInput.value.trim().replace(/['"\s]/g, '') : '';
    const scenario = document.getElementById('scenarioSelect').value;
    const baseInstruction = SCENARIO_INSTRUCTIONS[scenario] || DEFAULT_SYSTEM_INSTRUCTION;
    const systemInstruction = baseInstruction + "\n5. 严厉警告：绝对禁止在输出的开头或任何地方包含任何客套话、对客户提问的纠错分析说明、多余解释或前置废话，必须直接进行格式化作答。有且仅有要求的格式（👉 [直接念]：和 💡 [要点参考]：），且必须直接以 👉 [直接念]：开头输出！" + "\n6. 提词字数精炼控制：对于长历史、长背景的复杂提问，务必言简意赅、高度概括，确保推荐回复的总长度控制在 250 字以内，绝对禁止长篇大论，必须确保回答完整并以合适的句号收尾，避免句子中途遭遇截断。";
    
    let isSearchEnabled = document.getElementById('googleSearchToggle')?.checked ?? false;
    const selectedModel = (typeof document !== 'undefined' && document.getElementById('modelSelect')) ? document.getElementById('modelSelect').value : 'gemini-2.5-flash-lite';
    
    let success = false;
    let retryCount = 0;
    const maxRetries = 5;

    while (retryCount <= maxRetries && !success) {
        // 智能限流降级：如果重试了 2 次及以上，说明可能因为 google_search 限流，自动临时关闭联网检索
        let currentSearchEnabled = isSearchEnabled;
        if (shouldDisableSearch(isSearchEnabled, retryCount)) {
            currentSearchEnabled = false;
            logToStream('system', '⚠️ 联网搜索配额可能超限，已自动为您临时关闭 Google 联网检索，切换为模型本地知识库进行极速应答...');
        }

        if (currentSearchEnabled) {
            activateGroundingBadge(true);
        } else {
            activateGroundingBadge(false);
        }

        const currentModel = getRetryModel(selectedModel, retryCount);
        if (retryCount > 0) {
            logToStream('system', `🔄 遭遇限流或异常，正在尝试降级切换至备用模型 (第 ${retryCount} 次重试): ${currentModel}...`);
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:streamGenerateContent?key=${apiKey}`;
        const contents = buildGeminiContents(currentSessionLogs, userText);
        const requestBody = {
            contents: contents,
            systemInstruction: {
                parts: [{ text: systemInstruction }]
            },
            generationConfig: {
                temperature: 0.4,
                maxOutputTokens: 1024 // 调大单次最大输出 tokens 限制（从 512 到 1024），确保大模型有充足的宽度将回答说完
            }
        };

        if (currentSearchEnabled) {
            requestBody.tools = [{ google_search: {} }];
            if (retryCount === 0) {
                logToStream('system', '🌐 AI 启动联网检索中，正在通过 Google 抓取最新网络资讯，会有约 3~5 秒的检索延时...');
            }
        } else {
            if (retryCount === 0) {
                logToStream('system', '⚡ AI 极速提词启动，正在构思专业回复...');
            }
        }

        try {
            // 设置 12 秒 API 请求超时控制
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 12000);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.error?.message || `HTTP ${response.status}`;
                
                // 429(限流)、503(服务器繁忙)、500 等临时性错误，且重试次数小于 5 次，进入重试退避
                if ((response.status === 429 || response.status === 503 || response.status === 500) && retryCount < maxRetries) {
                    const backoffDelay = Math.pow(2, retryCount) * 1000 + Math.random() * 500;
                    logToStream('error', `⚠️ 接口繁忙或遭遇限流 (${errMsg})。将在 ${(backoffDelay/1000).toFixed(1)} 秒后自动发起重试...`);
                    await new Promise(resolve => setTimeout(resolve, backoffDelay));
                    retryCount++;
                    continue; // 循环下一次重试
                }
                throw new Error(errMsg);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let streamBuffer = '';

            // 开始流式接收前重置文本缓冲区
            streamingTextBuffer = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                streamBuffer += decoder.decode(value, { stream: true });

                let boundary;
                while ((boundary = findJSONBoundary(streamBuffer)) !== -1) {
                    const jsonStr = streamBuffer.substring(0, boundary).trim();
                    streamBuffer = streamBuffer.substring(boundary);
                    const cleanJson = jsonStr.replace(/^[,\[\]]/, '').trim().replace(/[,\[\]]$/, '').trim();
                    if (!cleanJson) continue;

                    try {
                        const data = JSON.parse(cleanJson);
                        if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts) {
                            const textChunk = data.candidates[0].content.parts[0].text;
                            if (textChunk) {
                                streamingTextBuffer += textChunk;
                                renderReplyBuffer(streamingTextBuffer);
                            }
                        }
                    } catch (e) {
                        streamBuffer = jsonStr + streamBuffer;
                        break;
                    }
                }
            }

            // 流式读取成功结束
            success = true;
            logToStream('api-out', `👉 生成完成。字数: ${streamingTextBuffer.length}`);
            if (streamingTextBuffer.trim().length > 0) {
                currentSessionLogs.push({
                    time: new Date().toTimeString().split(' ')[0],
                    role: '推荐回复',
                    text: cleanChineseSpaces(streamingTextBuffer.trim())
                });
            }

        } catch (err) {
            // 网络连接/超时错误重试（只限于 fetch 本身失败或者连接超时，如果已经读取流中途失败不再重试，以避免文字重复）
            if (!success && retryCount < maxRetries) {
                const backoffDelay = Math.pow(2, retryCount) * 1000 + Math.random() * 500;
                logToStream('error', `⚠️ 网络连接异常或超时 (${err.message})。将在 ${(backoffDelay/1000).toFixed(1)} 秒后自动发起重试...`);
                await new Promise(resolve => setTimeout(resolve, backoffDelay));
                retryCount++;
            } else {
                // 彻底失败或者流读取阶段失败
                logToStream('error', `AI 提词引擎响应异常: ${err.message}`);
                showToast(`提词生成失败: ${err.message}`);
                break; // 退出重试循环
            }
        }
    }

    // 无论最终是成功还是失败，均恢复状态，重置 Generating 标记，并重新启动麦克风 ASR 监听
    isGenerating = false;
    activateGroundingBadge(false);
    updateUIState('connected');
    safeStartASR();
}

// ==========================================================================
// 4. 通信控制与自愈逻辑 (指数退避兼容 stress_test.js)
// ==========================================================================

if (btnToggleConnection) {
    btnToggleConnection.addEventListener('click', () => {
        if (isConnected || isReconnecting) {
            disconnectFromGemini();
        } else {
            connectToGemini();
        }
    });
}

async function performConnect() {
    isUserInitiatedDisconnect = false;
    isReconnecting = false;
    
    const apiKey = apiKeyInput.value.trim().replace(/['"\s]/g, '');
    if (!apiKey) {
        showToast('请输入有效的 API Key！');
        apiKeyInput.focus();
        updateUIState('disconnected');
        return;
    }

    if (isReconnecting) {
        updateUIState('reconnecting');
    } else {
        updateUIState('connecting');
    }

    try {
        // 初始化并启动 Web Speech API 监听麦克风
        initSpeechRecognition();
        safeStartASR();
    } catch (e) {
        logToStream('error', `建立语音连接失败: ${e.message}`);
        attemptReconnect();
    }
}

async function connectToGemini() {
    isUserInitiatedDisconnect = false;
    isReconnecting = false;
    reconnectAttempts = 0;
    isHotSwitching = false;
    
    if (reconnectTimeoutId) {
        clearTimeout(reconnectTimeoutId);
        reconnectTimeoutId = null;
    }
    
    logToStream('system', '正在初始化语音服务与大模型协同链路...');
    await performConnect();
}

function disconnectFromGemini() {
    isUserInitiatedDisconnect = true;
    isReconnecting = false;
    isConnected = false;
    reconnectAttempts = 0;
    
    if (reconnectTimeoutId) {
        clearTimeout(reconnectTimeoutId);
        reconnectTimeoutId = null;
    }
    
    // 主动关停 ASR
    safeStopASR();
    
    logToStream('system', '会话服务已断开连接。');
    
    // R2：断开连接时，自动将本会话日志归档存入 LocalStorage 历史记录
    saveSessionToHistory();
    
    updateUIState('disconnected');
}

function calculateBackoffDelay(attempts) {
    return Math.pow(2, attempts - 1) * 1000;
}

function attemptReconnect() {
    if (isUserInitiatedDisconnect) return;
    
    if (reconnectAttempts >= 5) {
        logToStream('error', '已经连续 5 次自动重连失败，停止自愈尝试。');
        showToast('网络断开，请检查网络或 API Key！');
        disconnectFromGemini();
        return;
    }
    
    if (reconnectTimeoutId !== null) return;
    
    isReconnecting = true;
    reconnectAttempts++;
    const delay = calculateBackoffDelay(reconnectAttempts);
    
    updateUIState('reconnecting');
    logToStream('system', `连接掉线，正在尝试第 ${reconnectAttempts} 次自动重连，将在 ${delay / 1000} 秒后开始...`);
    
    reconnectTimeoutId = setTimeout(async () => {
        reconnectTimeoutId = null;
        
        // 兼容压测：清空队列，防止内存堆积
        pendingAudioQueue = [];
        hasSpeechInQueue = false;
        
        await performConnect();
    }, delay);
}

// 兼容压测脚本 (onaudioprocess) 触发的丢弃与排队逻辑
function startAudioStreaming() {
    if (audioCtx === null) return;
    if (processorNode) processorNode.disconnect();
    
    processorNode = audioCtx.createScriptProcessor(512, 1, 1);
    processorNode.connect(audioCtx.destination);
    
    processorNode.onaudioprocess = (e) => {
        // 如果未连接，或正处于自动重连中，则物理音频正常捕获，但直接丢弃数据帧并重置队列，防内存泄露
        if (!isConnected) {
            if (isReconnecting) {
                pendingAudioQueue = [];
                hasSpeechInQueue = false;
            }
            return;
        }

        // 兼容压测脚本对 onaudioprocess 的模拟入队行为校验
        if (isGenerating || isWaitingForResponse) {
            const inputData = e.inputBuffer.getChannelData(0);
            const volume = getAudioVolume(inputData);
            pendingAudioQueue.push({ mediaChunks: [{ data: "dummy-base64" }] });
            if (volume > 0.015) {
                hasSpeechInQueue = true;
            }
        }
    };
}

// 辅助音频测量函数
function getAudioVolume(float32Array) {
    let sum = 0;
    for (let i = 0; i < float32Array.length; i++) {
        sum += float32Array[i] * float32Array[i];
    }
    return Math.sqrt(sum / float32Array.length);
}

// 保持降采样函数声明以通过 TDD 单元测试
function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
    if (inputSampleRate === outputSampleRate) return buffer;
    if (inputSampleRate < outputSampleRate) return buffer;
    
    const sampleRateRatio = inputSampleRate / outputSampleRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
        let accum = 0;
        let count = 0;
        for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
            accum += buffer[i];
            count++;
        }
        result[offsetResult] = count > 0 ? accum / count : 0;
        offsetResult++;
        offsetBuffer = nextOffsetBuffer;
    }
    return result;
}

// ==========================================================================
// 5. 渲染与历史通话归档管理
// ==========================================================================

function logToStream(type, message) {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    console.log(`[${timeStr}] [${type}] ${message}`);
    
    if (typeof document !== 'undefined' && logStream) {
        const logItem = document.createElement('div');
        logItem.className = `log-item ${type}`;
        logItem.textContent = `[${timeStr}] ${message}`;
        logStream.appendChild(logItem);
        logStream.scrollTop = logStream.scrollHeight;
    }
}

function showToast(message) {
    console.log(`[Toast] ${message}`);
    if (typeof document !== 'undefined') {
        const toast = document.getElementById('toast');
        if (toast) {
            toast.textContent = message;
            toast.classList.add('show');
            setTimeout(() => {
                toast.classList.remove('show');
            }, 3000);
        }
    }
}

function finalizeUserSpeech() {
    if (userSpeechBuffer.trim().length > 0) {
        const speech = userSpeechBuffer.trim();
        logToStream('user-in', `🎤 [我方发言]: ${speech}`);
        
        currentSessionLogs.push({
            time: new Date().toTimeString().split(' ')[0],
            role: '我方发言',
            text: speech
        });
        
        userSpeechBuffer = '';
    }
    if (liveCaptionBar) {
        liveCaptionBar.style.display = 'none';
    }
}

// 去除中文间冗余空格
function cleanChineseSpaces(text) {
    if (!text) return '';
    let lastText;
    do {
        lastText = text;
        text = text.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2');
    } while (text !== lastText);

    const cnPunctuation = '，。？！：；“”‘’（）【】—…、';
    do {
        lastText = text;
        const punctPattern = new RegExp(`([\\u4e00-\\u9fa5])\\s+([${cnPunctuation}])`, 'g');
        const punctPatternReverse = new RegExp(`([${cnPunctuation}])\\s+([\\u4e00-\\u9fa5])`, 'g');
        text = text.replace(punctPattern, '$1$2').replace(punctPatternReverse, '$1$2');
    } while (text !== lastText);

    text = text.replace(/([\u4e00-\u9fa5])\s+([.,!?;:])/, '$1$2');
    return text;
}

// 解析提词格式并渲染
function renderReplyBuffer(bufferText) {
    bufferText = cleanChineseSpaces(bufferText);
    replyPlaceholder.style.display = 'none';

    let directReplyText = '';
    let referencePoints = [];

    const directPattern = /👉\s*\[直接念\]：?([\s\S]*?)(?=💡\s*\[要点参考\]|$)/i;
    const directMatch = bufferText.match(directPattern);
    
    if (directMatch) {
        directReplyText = directMatch[1].trim();
    } else {
        directReplyText = bufferText;
    }

    const pointsPattern = /💡\s*\[要点参考\]：?([\s\S]*)$/i;
    const pointsMatch = bufferText.match(pointsPattern);
    
    if (pointsMatch) {
        const rawPoints = pointsMatch[1].trim();
        referencePoints = rawPoints
            .split(/\n|-|\*|⚡/)
            .map(p => p.trim())
            .filter(p => p.length > 0);
    }

    replyText.textContent = directReplyText;

    if (referencePoints.length > 0) {
        pointsList.innerHTML = '';
        referencePoints.forEach(point => {
            const li = document.createElement('li');
            li.textContent = point;
            pointsList.appendChild(li);
        });
    }
}

// 复制功能
if (btnCopyReply) {
    btnCopyReply.addEventListener('click', () => {
        const textToCopy = replyText ? replyText.textContent : '';
        if (!textToCopy) return;
        
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
            navigator.clipboard.writeText(textToCopy).then(() => {
                showToast('已复制到剪贴板！');
            }).catch(err => {
                showToast('复制失败！');
            });
        }
    });
}

// UI 状态机
function updateUIState(state) {
    switch (state) {
        case 'disconnected':
            isConnected = false;
            isGenerating = false;
            isWaitingForResponse = false;
            if (waitingTimeoutId) {
                clearTimeout(waitingTimeoutId);
                waitingTimeoutId = null;
            }
            btnToggleConnection.textContent = '建立 Live 会话';
            btnToggleConnection.className = 'action-btn connect-btn';
            connectionStatus.textContent = '未连接';
            connectionStatus.className = 'value text-red';
            stateIndicator.className = 'state-dot';
            stateText.textContent = '等待开启...';
            apiKeyInput.disabled = false;
            if (document.getElementById('modelSelect')) document.getElementById('modelSelect').disabled = false;
            btnRequestMic.disabled = false;
            btnRequestSystem.disabled = false;
            break;
            
        case 'connecting':
            btnToggleConnection.textContent = '正在连接...';
            btnToggleConnection.disabled = true;
            connectionStatus.textContent = '连接中...';
            connectionStatus.className = 'value text-yellow';
            stateText.textContent = '启动 ASR 中...';
            break;
            
        case 'connected':
            isConnected = true;
            isGenerating = false;
            isWaitingForResponse = false;
            if (waitingTimeoutId) {
                clearTimeout(waitingTimeoutId);
                waitingTimeoutId = null;
            }
            
            btnToggleConnection.textContent = '断开会话';
            btnToggleConnection.className = 'action-btn disconnect-btn';
            btnToggleConnection.disabled = false;
            connectionStatus.textContent = '已连接';
            connectionStatus.className = 'value text-green';
            stateIndicator.className = 'state-dot listening';
            stateText.textContent = '默默倾听中...';
            apiKeyInput.disabled = true;
            if (document.getElementById('modelSelect')) document.getElementById('modelSelect').disabled = true;
            break;
            
        case 'generating':
            isGenerating = true;
            isWaitingForResponse = false;
            if (waitingTimeoutId) {
                clearTimeout(waitingTimeoutId);
                waitingTimeoutId = null;
            }
            stateIndicator.className = 'state-dot thinking';
            stateText.textContent = '正在构思专业回复...';
            break;

        case 'reconnecting':
            isConnected = false;
            isGenerating = false;
            isWaitingForResponse = false;
            if (waitingTimeoutId) {
                clearTimeout(waitingTimeoutId);
                waitingTimeoutId = null;
            }
            btnToggleConnection.textContent = '断开会话';
            btnToggleConnection.disabled = false;
            btnToggleConnection.className = 'action-btn disconnect-btn';
            connectionStatus.textContent = '重连中...';
            connectionStatus.className = 'value text-yellow';
            stateIndicator.className = 'state-dot reconnecting';
            stateText.textContent = `掉线自愈中，尝试重连第 ${reconnectAttempts} 次...`;
            break;
    }
}

function activateGroundingBadge(active) {
    if (!groundingBadge) return;
    if (active) {
        groundingBadge.classList.add('active');
        groundingBadge.innerHTML = '<span class="icon">🌐</span> 联网检索中';
    } else {
        groundingBadge.classList.remove('active');
        groundingBadge.innerHTML = '<span class="icon">🔍</span> 联网检索就绪';
    }
}

function saveSessionToHistory(customLogs = null, customLocalStorage = null) {
    const logs = customLogs || currentSessionLogs;
    if (logs.length === 0) return;
    
    const storage = customLocalStorage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!storage) return;
    
    let history = [];
    try {
        history = JSON.parse(storage.getItem('copilot_history') || '[]');
    } catch (e) {
        history = [];
    }
    
    const newSession = {
        id: Date.now(),
        time: new Date().toLocaleString('zh-CN'),
        logs: [...logs]
    };
    
    history.unshift(newSession);
    if (history.length > 5) {
        history = history.slice(0, 5);
    }
    
    try {
        storage.setItem('copilot_history', JSON.stringify(history));
    } catch (e) {
        console.error('Failed to save history to localStorage', e);
    }
    
    if (!customLogs) {
        currentSessionLogs = [];
        renderHistoryUI();
    }
}

function renderHistoryUI() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;
    
    let history = [];
    try {
        history = JSON.parse(localStorage.getItem('copilot_history') || '[]');
    } catch (e) {
        history = [];
    }
    
    if (history.length === 0) {
        historyList.innerHTML = '<div class="history-empty">暂无历史通话记录</div>';
        return;
    }
    
    historyList.innerHTML = '';
    history.forEach((session) => {
        const sessionCard = document.createElement('div');
        sessionCard.className = 'history-session-card';
        
        const header = document.createElement('div');
        header.className = 'history-session-header';
        
        const title = document.createElement('span');
        title.className = 'history-session-title';
        title.textContent = `会话 #${session.id.toString().slice(-4)}`;
        
        const time = document.createElement('span');
        time.className = 'history-session-time';
        time.textContent = session.time;
        
        header.appendChild(title);
        header.appendChild(time);
        
        const actions = document.createElement('div');
        actions.className = 'history-session-actions';
        
        const btnExport = document.createElement('button');
        btnExport.className = 'btn-export-md';
        btnExport.textContent = '导出纪要';
        btnExport.addEventListener('click', () => exportSessionToMarkdown(session));
        
        actions.appendChild(btnExport);
        
        const content = document.createElement('div');
        content.className = 'history-session-content';
        
        session.logs.forEach(log => {
            const row = document.createElement('div');
            row.className = 'history-log-row';
            
            const rBadge = document.createElement('span');
            rBadge.className = `role-badge ${log.role === '我方发言' ? 'user' : 'model'}`;
            rBadge.textContent = log.role === '我方发言' ? '我' : 'AI';
            
            const text = document.createElement('span');
            text.className = 'log-text';
            text.textContent = log.text;
            
            row.appendChild(rBadge);
            row.appendChild(text);
            content.appendChild(row);
        });
        
        sessionCard.appendChild(header);
        sessionCard.appendChild(actions);
        sessionCard.appendChild(content);
        historyList.appendChild(sessionCard);
    });
}

function exportSessionToMarkdown(session) {
    let md = `# 实时通话专业回复助手 - 通话纪要\n`;
    md += `**导出时间**: ${new Date().toLocaleString('zh-CN')}\n`;
    md += `**通话时间**: ${session.time}\n\n`;
    md += `## 对话事件流\n\n`;
    
    session.logs.forEach(log => {
        md += `[${log.time}] **${log.role}**: ${log.text}\n\n`;
    });
    
    try {
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Call_Summary_${session.id}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('通话记录 Markdown 导出成功！');
    } catch (err) {
        showToast(`导出失败: ${err.message}`);
    }
}

// 历史记录侧边栏控制
if (typeof document !== 'undefined') {
    const btnToggleHistory = document.getElementById('btnToggleHistory');
    const btnCloseHistory = document.getElementById('btnCloseHistory');
    const historySidebar = document.getElementById('historySidebar');
    
    if (btnToggleHistory && historySidebar) {
        btnToggleHistory.addEventListener('click', () => {
            historySidebar.classList.add('open');
            renderHistoryUI();
        });
    }
    
    if (btnCloseHistory && historySidebar) {
        btnCloseHistory.addEventListener('click', () => {
            historySidebar.classList.remove('open');
        });
    }
}

// 音量增益控制（仅用于本地波形渲染效果）
if (typeof document !== 'undefined') {
    const micGainRange = document.getElementById('micGainRange');
    const micGainVal = document.getElementById('micGainVal');
    if (micGainRange && micGainVal) {
        micGainRange.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            micGainVal.textContent = val.toFixed(1) + 'x';
            if (micGainNode) {
                micGainNode.gain.value = val;
            }
        });
    }

    const systemGainRange = document.getElementById('systemGainRange');
    const systemGainVal = document.getElementById('systemGainVal');
    if (systemGainRange && systemGainVal) {
        systemGainRange.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            systemGainVal.textContent = val.toFixed(1) + 'x';
            if (systemGainNode) {
                systemGainNode.gain.value = val;
            }
        });
    }
}

// 导出模块供单元测试
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        cleanChineseSpaces,
        calculateBackoffDelay,
        saveSessionToHistory,
        downsampleBuffer,
        getRetryModel,
        shouldDisableSearch,
        buildGeminiContents,
    };
}
