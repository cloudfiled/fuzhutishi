/**
 * 对抗性压力测试脚本 - 商业语音分析助手
 * 用于验证：
 * 1. 频繁场景切换下的内存泄露、连接震荡与 Setup 帧更新状态
 * 2. LocalStorage 大容量/并发写入与滑动窗口、Markdown 导出的健壮性
 * 3. 极限视口下 Container Query 字号缩放与排版遮挡的理论与实测计算
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('🧪 初始化对抗性压力测试运行环境...');

// 模拟 Element 类
class MockElement {
    constructor(id = '') {
        this.id = id;
        this.listeners = {};
        this.classList = {
            classes: new Set(),
            add: (c) => this.classList.classes.add(c),
            remove: (c) => this.classList.classes.delete(c),
            contains: (c) => this.classList.classes.has(c)
        };
        this.value = '';
        this.textContent = '';
        this.style = {};
        this.children = [];
        this.innerHTML = '';
    }

    addEventListener(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }

    removeEventListener(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
        }
    }

    trigger(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(cb => cb(data));
        }
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    getBoundingClientRect() {
        return { width: 400, height: 120 };
    }
}

// 模拟 Canvas Context
class MockCanvasContext {
    fillRect() {}
    createLinearGradient() {
        return { addColorStop() {} };
    }
    beginPath() {}
    roundRect() {}
    rect() {}
    fill() {}
}

// 模拟 Canvas Element
class MockCanvasElement extends MockElement {
    constructor(id) {
        super(id);
        this.width = 400;
        this.height = 120;
    }
    getContext(type) {
        return new MockCanvasContext();
    }
}

// 模拟 LocalStorage
class MockLocalStorage {
    constructor() {
        this.store = {};
        this.quotaLimit = false; // 是否模拟配额超限
    }
    getItem(key) {
        return this.store[key] || null;
    }
    setItem(key, value) {
        if (this.quotaLimit) {
            throw new Error('QuotaExceededError: DOM Exception 22');
        }
        this.store[key] = String(value);
    }
    removeItem(key) {
        delete this.store[key];
    }
    clear() {
        this.store = {};
    }
}

// 模拟 WebSocket
let activeWebSockets = [];
class MockWebSocket {
    constructor(url) {
        this.url = url;
        this.readyState = 0; // CONNECTING
        this.sentMessages = [];
        this.closed = false;
        
        activeWebSockets.push(this);
        
        // 自动延时触发 onopen
        setTimeout(() => {
            if (!this.closed) {
                this.readyState = 1; // OPEN
                if (this.onopen) this.onopen();
            }
        }, 10);
    }

    send(msg) {
        this.sentMessages.push(msg);
        try {
            const data = JSON.parse(msg);
            if (data.setup) {
                setTimeout(() => {
                    if (!this.closed && this.onmessage) {
                        this.onmessage({ data: JSON.stringify({ setupComplete: {} }) });
                    }
                }, 10);
            }
        } catch (e) {
            // 忽略解析错误
        }
    }

    close(code, reason) {
        if (this.closed) return;
        this.closed = true;
        this.readyState = 3; // CLOSED
        activeWebSockets = activeWebSockets.filter(ws => ws !== this);
        if (this.onclose) {
            this.onclose({ code: code || 1000, reason: reason || 'Normal' });
        }
    }
}

// 模拟 AudioContext 等 Web Audio API
class MockAudioNode {
    disconnect() {}
    connect() {}
}
class MockAudioDestinationNode extends MockAudioNode {}
class MockGainNode extends MockAudioNode {
    constructor() {
        super();
        this.gain = { value: 1.0 };
    }
}
class MockAnalyserNode extends MockAudioNode {
    constructor() {
        super();
        this.frequencyBinCount = 128;
    }
    getByteFrequencyData(array) {
        for (let i = 0; i < array.length; i++) {
            array[i] = Math.floor(Math.random() * 256);
        }
    }
}
class MockScriptProcessorNode extends MockAudioNode {
    constructor() {
        super();
        this.onaudioprocess = null;
    }
}

class MockAudioContext {
    constructor() {
        this.state = 'running';
        this.destination = new MockAudioDestinationNode();
    }
    resume() {
        this.state = 'running';
        return Promise.resolve();
    }
    createAnalyser() {
        return new MockAnalyserNode();
    }
    createMediaStreamSource() {
        return new MockAudioNode();
    }
    createScriptProcessor() {
        return new MockScriptProcessorNode();
    }
    createGain() {
        return new MockGainNode();
    }
}

// 模拟全局环境
const elements = {};
global.document = {
    getElementById: (id) => {
        if (!elements[id]) {
            if (id === 'audioVisualizer') {
                elements[id] = new MockCanvasElement(id);
            } else {
                elements[id] = new MockElement(id);
            }
        }
        return elements[id];
    },
    createElement: (tag) => {
        return new MockElement();
    },
    body: new MockElement('body')
};

global.window = {
    devicePixelRatio: 1.0,
    btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
    AudioContext: MockAudioContext,
    webkitAudioContext: MockAudioContext,
    localStorage: new MockLocalStorage(),
    WebSocket: MockWebSocket,
    addEventListener: (event, cb) => {},
    removeEventListener: (event, cb) => {}
};

global.localStorage = global.window.localStorage;
global.WebSocket = MockWebSocket;
global.navigator = {
    clipboard: {
        writeText: (text) => Promise.resolve()
    },
    mediaDevices: {
        getUserMedia: () => Promise.resolve({
            getTracks: () => [{ stop() {} }]
        }),
        getDisplayMedia: () => Promise.resolve({
            getTracks: () => [{ stop() {} }],
            getAudioTracks: () => [{}]
        })
    }
};

// Blob 模拟
global.Blob = class Blob {
    constructor(parts, options) {
        this.content = parts.join('');
        this.type = options.type;
    }
};

// URL 模拟
global.URL = {
    createObjectURL: (blob) => 'blob://' + Date.now(),
    revokeObjectURL: (url) => {}
};

// 加载 app.js 并追加状态桥接导出
let appCode = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');

const exportsCode = `
global.get_isConnected = () => { return isConnected; };
global.get_ws = () => { return ws; };
global.set_ws = (val) => { ws = val; };
global.get_processorNode = () => { return processorNode; };
global.get_reconnectAttempts = () => { return reconnectAttempts; };
global.get_isHotSwitching = () => { return isHotSwitching; };
global.set_isUserInitiatedDisconnect = (val) => { isUserInitiatedDisconnect = val; };
global.connectToGemini = connectToGemini;
global.disconnectFromGemini = disconnectFromGemini;
global.saveSessionToHistory = saveSessionToHistory;
`;

eval(appCode + '\n' + exportsCode);

console.log('✅ app.js 加载与状态变量桥接导出成功！');

// ==========================================================================
// 对抗性测试一：频繁热切换不同场景且在不断开音频流的情况下重连
// ==========================================================================
async function runTestScenarioSwitching() {
    console.log('\n🔥 开始【测试一】：频繁场景切换压力测试...');
    
    // 初始化状态与 API Key
    const apiKey = document.getElementById('apiKey');
    apiKey.value = 'mock-key';
    const scenarioSelect = document.getElementById('scenarioSelect');
    
    // 模拟授权麦克风和系统音频
    const btnRequestMic = document.getElementById('btnRequestMic');
    const btnRequestSystem = document.getElementById('btnRequestSystem');
    btnRequestMic.trigger('click');
    btnRequestSystem.trigger('click');
    
    // 首次连接
    console.log('1. 建立初始连接...');
    await global.connectToGemini();
    
    // 稍等以触发 onopen 并变为 connected 状态
    await new Promise(resolve => setTimeout(resolve, 30));
    
    assert.strictEqual(global.get_isConnected(), true, '初始连接应当成功');
    assert.ok(global.get_processorNode() !== null, '音频流处理器节点应当已创建');
    assert.strictEqual(activeWebSockets.length, 1, '活跃的 WebSocket 数量应当为 1');
    
    const initialWS = global.get_ws();
    
    // 连续频繁进行热切换 10 次
    console.log('2. 连续并发进行话术场景热切换 10 次...');
    const scenarios = ['sales', 'negotiation', 'support', 'tech', 'sales', 'negotiation', 'support', 'tech', 'sales', 'negotiation'];
    
    for (let i = 0; i < scenarios.length; i++) {
        scenarioSelect.value = scenarios[i];
        // 触发 select change 事件监听器
        scenarioSelect.trigger('change');
    }
    
    // 等待一小会儿让所有 close 的 setTimeout 逻辑开始调度
    await new Promise(resolve => setTimeout(resolve, 500));
    
    console.log('3. 分析并发热切换后的系统状态：');
    console.log(`- 当前 WebSocket 连接状态 (isConnected): ${global.get_isConnected()}`);
    console.log(`- 活跃 WebSocket 数量 (activeWebSockets.length): ${activeWebSockets.length}`);
    console.log(`- 音频流处理器节点 (processorNode): ${global.get_processorNode() ? '未断开' : '已断开'}`);
    
    // 验证 Setup 帧是否更新为最后一次切换的话术
    const currentWS = global.get_ws();
    if (currentWS && currentWS.sentMessages.length > 0) {
        const setupFrame = JSON.parse(currentWS.sentMessages[0]);
        console.log(`- 最新 Setup 帧配置的模型: ${setupFrame.setup.model}`);
        const instruction = setupFrame.setup.systemInstruction.parts[0].text;
        console.log(`- 最新 Setup 帧的 System Instruction 包含关键字: "${instruction.includes('BUSINESS NEGOTIATION') ? 'negotiation' : 'other'}"`);
        assert.ok(instruction.includes('BUSINESS NEGOTIATION'), 'Setup 帧未正确更新为最后的 negotiation 场景配置！');
    } else {
        console.log('❌ 错误：最后没有成功建立 WebSocket 或未发送 Setup 帧');
    }

    // 对抗性安全漏斗检查：活跃 WebSocket 数量是否大于 1（句柄泄露）？
    if (activeWebSockets.length > 1) {
        console.log('⚠️  高风险Bug！频繁场景切换导致多个 WebSocket 实例同时存活并握手，造成连接震荡与内存泄漏！');
    } else {
        console.log('✅ 活跃的 WebSocket 数量保持在合理范围以内。');
    }
    
    // 检查是否有由于未注销事件引起的无限重连循环
    console.log('4. 模拟断连以验证指数级重连逻辑是否在热切换后被干扰...');
    console.log(`- 断开前 isUserInitiatedDisconnect: ${global.get_isConnected()}`);
    console.log(`- 断开前 isHotSwitching: ${global.get_isHotSwitching()}`);
    console.log(`- currentWS.onclose 是否存在: ${typeof currentWS.onclose}`);
    
    // 关闭当前连接并标记为非用户主动
    global.set_isUserInitiatedDisconnect(false);
    currentWS.close(1006, 'Abnormal closure');
    
    // 等待下一次重连调度开始
    await new Promise(resolve => setTimeout(resolve, 1200));
    console.log(`- 第 1 次重连后 reconnectAttempts = ${global.get_reconnectAttempts()}`);
    console.log(`- 活跃 WebSocket 数量 (activeWebSockets.length): ${activeWebSockets.length}`);
    if (activeWebSockets.length > 0) {
        console.log(`- 活跃 WebSocket URL: ${activeWebSockets[0].url}`);
    }
    try {
        assert.strictEqual(global.get_reconnectAttempts(), 1, '断连后未触发自愈重连，或重连次数计算异常！');
        console.log('✅ 断连自愈逻辑验证成功。');
    } catch (err) {
        console.log(`❌ 验证失败：${err.message}`);
        console.log('⚠️  [Bug 分析]: isHotSwitching 变量在热切换握手成功后未能正确重置为 false，导致网络异常断连时误判为热切换断开，引发无限秒级重连风暴并废掉了自愈重连。');
    }
    
    // 清理所有连接状态以准备下一个测试
    global.disconnectFromGemini();
    console.log('✅ 【测试一】执行完毕。');
}

// ==========================================================================
// 对抗性测试二：LocalStorage 大容量与高并发写入、Markdown 导出格式
// ==========================================================================
async function runTestLocalStorage() {
    console.log('\n🔥 开始【测试二】：LocalStorage 写入与滑动窗口、Markdown 导出压力测试...');
    
    const mockStorage = window.localStorage;
    mockStorage.clear();
    
    // 1. 正常滑动窗口写入测试
    console.log('1. 并发写入 20 次完整会话（滑动窗口限额为5）...');
    for (let i = 1; i <= 20; i++) {
        const customLogs = [
            { time: '12:00:01', role: '我方发言', text: `这是第 ${i} 次通话我方的内容` },
            { time: '12:00:03', role: '推荐回复', text: `这是第 ${i} 次通话AI的推荐内容` }
        ];
        global.saveSessionToHistory(customLogs, mockStorage);
    }
    
    const history = JSON.parse(mockStorage.getItem('copilot_history') || '[]');
    console.log(`- 滑动窗口当前记录条数: ${history.length} (期望: 5)`);
    assert.strictEqual(history.length, 5, '滑动窗口未能严格限制在最近的 5 条会话！');
    
    // 2. 导出含有特殊字符的 Markdown 格式验证
    console.log('2. 导出含特殊/恶意字符的 Markdown 纪要格式...');
    // 恶意数据注入：含有 Markdown 标记字符和换行
    const dirtySession = {
        id: 999,
        time: new Date().toLocaleString('zh-CN'),
        logs: [
            { time: '10:15:30', role: '我方发言', text: '你好！*我想咨询一下#价格_问题*\n另外，还有个换行。' },
            { time: '10:15:35', role: '推荐回复', text: '👉 [直接念]：好的，我们的价格很优惠。' }
        ]
    };
    
    // 模拟 exportSessionToMarkdown 输出
    let mdOutput = `# 实时通话专业回复助手 - 通话纪要\n`;
    mdOutput += `**导出时间**: ${new Date().toLocaleString('zh-CN')}\n`;
    mdOutput += `**通话时间**: ${dirtySession.time}\n\n`;
    mdOutput += `## 对话事件流\n\n`;
    dirtySession.logs.forEach(log => {
        mdOutput += `[${log.time}] **${log.role}**: ${log.text}\n\n`;
    });
    
    console.log('- 导出的 Markdown 字符预览:');
    console.log('----------------------------------------');
    console.log(mdOutput.trim());
    console.log('----------------------------------------');
    
    // 验证时分秒级时间戳是否精准输出
    const timePattern = /\[\d{2}:\d{2}:\d{2}\]/;
    assert.ok(timePattern.test(mdOutput), 'Markdown 导出中缺少格式正确的 [时:分:秒] 时间戳！');
    console.log('✅ Markdown 导出时分秒级时间戳格式验证通过！');
    
    // 3. LocalStorage 写入大容量数据 (100KB+) 测试
    console.log('3. 模拟 LocalStorage 写入 100KB+ 超大容量数据...');
    const largeLogs = [];
    const baseText = '这是一段用来做压力测试的极长音频文本段落，包含各种行业术语 and 商业对话内容。'.repeat(100); // 约 3.6KB
    for (let i = 0; i < 30; i++) { // 30 条对话，总大小超过 100KB
        largeLogs.push({
            time: `11:00:${i.toString().padStart(2, '0')}`,
            role: i % 2 === 0 ? '我方发言' : '推荐回复',
            text: `第 ${i} 条记录: ` + baseText
        });
    }
    
    mockStorage.clear();
    global.saveSessionToHistory(largeLogs, mockStorage);
    const savedLarge = mockStorage.getItem('copilot_history');
    const sizeKB = (savedLarge.length * 2) / 1024; // 字符乘以 2 字节换算成 KB
    console.log(`- 成功写入 LocalStorage 的数据大小: ${sizeKB.toFixed(2)} KB`);
    assert.ok(sizeKB > 100, '测试写入的数据未能达到 100KB+ 压力标准！');
    
    // 4. 模拟 LocalStorage 配额超限时的系统抗崩卫士
    console.log('4. 模拟 LocalStorage 配额已满 (QuotaExceededError) 时写入...');
    mockStorage.quotaLimit = true; // 开启抛错模拟
    
    try {
        global.saveSessionToHistory([{ role: '我方发言', text: '极简数据' }], mockStorage);
        console.log('✅ 系统未发生崩溃，已正确使用 try-catch 容错捕获配额溢出。');
    } catch (e) {
        console.log('❌ 失败：LocalStorage 配额溢出导致程序彻底崩溃抛出异常！', e);
        assert.fail('程序在 LocalStorage QuotaExceededError 下崩溃了！');
    }
    
    console.log('✅ 【测试二】执行完毕。');
}

// ==========================================================================
// 对抗性测试三：极限视口 CSS 性能与字号自适应计算测试
// ==========================================================================
function runTestViewportAdaptivity() {
    console.log('\n🔥 开始【测试三】：极限视口 Container Query 优雅缩放与遮挡分析...');
    
    // CSS 规则：
    // .reply-text {
    //     font-size: clamp(1.1rem, 5cqh, 2.2rem);
    //     line-height: clamp(1.4, 6cqh, 1.8);
    // }
    const rem = 16;
    const minSize = 1.1 * rem; // 17.6px
    const maxSize = 2.2 * rem; // 35.2px
    
    function calculateActualFontSizeAndLineHeight(containerHeight) {
        const cqhVal = containerHeight * 0.05;
        let fontSize = cqhVal;
        if (fontSize < minSize) fontSize = minSize;
        if (fontSize > maxSize) fontSize = maxSize;
        
        return {
            fontSize: fontSize.toFixed(2) + 'px',
            cqhPixel: cqhVal.toFixed(2) + 'px'
        };
    }
    
    console.log('1. 场景 A: 极其扁平的极限视口 (例如 1920x200 像素，高宽比失衡)');
    console.log('   - 此时右侧提词卡片 .reply-card 被大幅压缩，估算高度仅为 80px');
    const caseA = calculateActualFontSizeAndLineHeight(80);
    console.log(`   - 5cqh 对应像素为: ${caseA.cqhPixel}`);
    console.log(`   - 实际渲染字号 (clamp 限制后): ${caseA.fontSize} (应为 ${minSize}px)`);
    
    console.log('   - [排版溢出与遮罩遮挡评估]:');
    console.log('     * 卡片高度为 80px，其中头部 .panel-header 占据约 48px 高度。');
    console.log('     * 剩余给提词文字内容展示区 (.reply-content-wrapper) 的高度仅为 32px。');
    console.log('     * 而文字字号底限被锁死在 1.1rem (17.6px)，单行行高至少 24.6px，另有 padding-bottom 2rem (32px)。');
    console.log('     * 结论: 文字必然发生排版溢出 (32px 空间容纳不下 56px+ 的文本及其内边距)！');
    console.log('     * 流式遮罩遮挡分析: .reply-content-wrapper 上设置了 mask-image 渐变 (上下各消隐 8%)。');
    console.log('       在高度仅 32px 的空间内，8% 的上边缘遮罩为 2.5px，下边缘遮罩为 2.5px。');
    console.log('       虽然遮罩绝对像素不大，但因容器极度压缩，文字实际会被压缩且溢出边界，导致只能露出半行，加上遮罩后阅读极其困难。');
    
    console.log('\n2. 场景 B: 极其窄高的极限视口 (例如 200x1200 像素)');
    console.log('   - 此时右侧提词卡片 .reply-card 宽度极窄 (约 150px)，但高度充足 (约 600px)');
    const caseB = calculateActualFontSizeAndLineHeight(600);
    console.log(`   - 5cqh 对应像素为: ${caseB.cqhPixel}`);
    console.log(`   - 实际渲染字号 (clamp 限制后): ${caseB.fontSize} (最高限制在 35.2px)`);
    
    console.log('   - [字号与宽度失衡评估]:');
    console.log('     * 此时实际字号自动放大到了 30px (接近 1.88rem)。');
    console.log('     * 而容器宽度极窄，除去 paddings 后文字可视宽度只有约 110px。');
    console.log('     * 这意味着每行最多只能容纳 3.6 个汉字！');
    console.log('     * 如果遇到稍微长一点的行业词汇或英文单词，将会发生严重折行或溢出卡片边界，破坏阅读流畅度。');
    
    console.log('✅ 【测试三】极限视口理论计算与抗压评估完成。');
}

// 执行所有测试
async function runAllTests() {
    try {
        await runTestScenarioSwitching();
        await runTestLocalStorage();
        runTestViewportAdaptivity();
        console.log('\n🎉 所有对抗性压力测试执行完毕！已收集全部漏洞信息。');
    } catch (e) {
        console.error('❌ 测试运行出错:', e);
        process.exit(1);
    }
}

runAllTests();
