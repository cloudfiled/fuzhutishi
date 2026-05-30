/**
 * 对 app.js 中的网络自愈与断连机制进行压力测试与对抗性验证
 * 验证点：
 * (1) 高频并发模拟触发异常断连，验证指数级退避算法的重连请求是否有防抖动或防并发，重连次数是否在 5 次内；
 * (2) 5次失败后是否安全回退并清理定时器；
 * (3) 重连期间音频 onaudioprocess 丢帧和队列清空是否正常工作，防止内存积压。
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// ==========================================================================
// 1. 模拟浏览器环境
// ==========================================================================
class MockDOMElement {
    constructor(id = '') {
        this.id = id;
        this.classList = {
            add: (cls) => this.classes.add(cls),
            remove: (cls) => this.classes.delete(cls),
            contains: (cls) => this.classes.has(cls)
        };
        this.classes = new Set();
        this.style = { display: '' };
        this.value = 'dummy-api-key';
        this.textContent = '';
        this.innerHTML = '';
        this.listeners = {};
        this.disabled = false;
    }
    addEventListener(event, callback) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(callback);
    }
    dispatchEvent(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(cb => cb(data || {}));
        }
    }
    appendChild(child) {
        // Mock append
    }
    focus() {
        // Mock focus
    }
    getContext(type) {
        return {
            clearRect: () => {},
            beginPath: () => {},
            moveTo: () => {},
            lineTo: () => {},
            stroke: () => {}
        };
    }
}

const elements = {};
global.document = {
    getElementById: (id) => {
        if (!elements[id]) {
            elements[id] = new MockDOMElement(id);
        }
        return elements[id];
    },
    createElement: (tagName) => {
        return new MockDOMElement();
    },
    body: new MockDOMElement('body')
};

// 模拟全局 window
global.window = {
    addEventListener: (event, callback) => {},
    removeEventListener: (event, callback) => {},
    AudioContext: class MockAudioContext {
        constructor() {
            this.sampleRate = 24000;
        }
        createAnalyser() {
            return { fftSize: 256 };
        }
        createGain() {
            return { gain: { value: 1.0 } };
        }
        createScriptProcessor() {
            const node = {
                connect: () => {},
                disconnect: () => {},
                onaudioprocess: null
            };
            MockAudioContext.processorNodeInstance = node;
            return node;
        }
        destination = {};
    },
    btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
    localStorage: {
        getItem: () => null,
        setItem: () => {}
    }
};

global.navigator = {
    mediaDevices: {
        getUserMedia: async () => ({
            getTracks: () => [{ stop: () => {} }]
        }),
        getDisplayMedia: async () => ({
            getTracks: () => [{ stop: () => {} }],
            getAudioTracks: () => [{ stop: () => {} }]
        })
    }
};

global.localStorage = global.window.localStorage;
global.Blob = class MockBlob {
    constructor(parts, options) {
        this.parts = parts;
        this.options = options;
    }
};
global.URL = {
    createObjectURL: () => 'mock-url',
    revokeObjectURL: () => {}
};

// 模拟 WebSocket 构造函数与其静态变量
global.WebSocket = class MockWebSocket {
    constructor(url) {
        MockWebSocket.instances.push(this);
        this.url = url;
        this.readyState = 0; // CONNECTING
        
        // 自动建立连接或失败的模拟
        setTimeout(() => {
            if (MockWebSocket.shouldConnectSucceed) {
                this.readyState = 1; // OPEN
                if (this.onopen) this.onopen();
            } else {
                this.readyState = 3; // CLOSED
                if (this.onerror) this.onerror(new Error('Connection failed'));
                if (this.onclose) this.onclose({ code: 1006, reason: 'Failed to establish connection' });
            }
        }, 10);
    }
    
    send(data) {
        MockWebSocket.sentMessages.push(data);
    }
    
    close() {
        this.readyState = 3; // CLOSED
        if (this.onclose) this.onclose({ code: 1000, reason: 'Normal closure' });
    }
};
global.WebSocket.instances = [];
global.WebSocket.sentMessages = [];
global.WebSocket.shouldConnectSucceed = true;

// ==========================================================================
// 2. 编译并加载测试专用的 app.js 代码（不直接修改原文件）
// ==========================================================================
const appJsPath = path.join(__dirname, 'app.js');
let appJsContent = fs.readFileSync(appJsPath, 'utf8');

// 追加用于获取内部状态的 getter/setter
appJsContent += `
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ...module.exports,
        getReconnectAttempts: () => reconnectAttempts,
        setReconnectAttempts: (v) => reconnectAttempts = v,
        getIsReconnecting: () => isReconnecting,
        setIsReconnecting: (v) => isReconnecting = v,
        getReconnectTimeoutId: () => reconnectTimeoutId,
        setReconnectTimeoutId: (v) => reconnectTimeoutId = v,
        getWs: () => ws,
        setWs: (v) => ws = v,
        getIsConnected: () => isConnected,
        setIsConnected: (v) => isConnected = v,
        getPendingAudioQueue: () => pendingAudioQueue,
        setPendingAudioQueue: (v) => pendingAudioQueue = v,
        getHasSpeechInQueue: () => hasSpeechInQueue,
        setHasSpeechInQueue: (v) => hasSpeechInQueue = v,
        getProcessorNode: () => processorNode,
        setProcessorNode: (v) => processorNode = v,
        getAudioCtx: () => audioCtx,
        setAudioCtx: (v) => audioCtx = v,
        getIsUserInitiatedDisconnect: () => isUserInitiatedDisconnect,
        setIsUserInitiatedDisconnect: (v) => isUserInitiatedDisconnect = v,
        getHandshakeTimeoutId: () => handshakeTimeoutId,
        performConnect,
        attemptReconnect,
        connectToGemini,
        disconnectFromGemini,
        startAudioStreaming
    };
}
`;

const tempFilePath = path.join(__dirname, 'app.test.tmp.js');
fs.writeFileSync(tempFilePath, appJsContent, 'utf8');

// 加载经过修改的临时模块
const app = require(tempFilePath);

// ==========================================================================
// 3. 测试用例运行
// ==========================================================================
async function runTests() {
    console.log('🤖 开始执行 app.js 网络自愈与断连机制对抗性与压力测试...');
    
    // 初始化测试状态
    app.setIsConnected(false);
    app.setIsReconnecting(false);
    app.setReconnectAttempts(0);
    if (app.getReconnectTimeoutId()) {
        clearTimeout(app.getReconnectTimeoutId());
        app.setReconnectTimeoutId(null);
    }
    
    // ----------------------------------------------------------------------
    // 验证点 1：高频并发模拟触发异常断连，测试防并发与重连计数
    // ----------------------------------------------------------------------
    console.log('\n--- 🧪 测试用例 1: 高频并发模拟触发异常断连 ---');
    
    // 场景：在极短的时间内（或在同一个事件循环内）触发了多次断连关闭事件（模拟快速抖动）。
    // 重置状态为正常连接
    app.setIsConnected(true);
    app.setIsReconnecting(false);
    app.setReconnectAttempts(0);
    app.setIsUserInitiatedDisconnect(false);
    
    // 模拟多次并发触发 attemptReconnect
    app.attemptReconnect();
    app.attemptReconnect();
    app.attemptReconnect();
    app.attemptReconnect();
    
    let attempts = app.getReconnectAttempts();
    console.log(`[并发调用后] 重试计数器 reconnectAttempts = ${attempts}`);
    
    // 理论上如果防并发机制完美，重试计数器应该为 1，因为重试只属于一次逻辑连贯的重连流程
    // 如果没有防并发，重试计数器会直接累加到 4
    try {
        assert.strictEqual(attempts, 1, 'Bug Found: 缺少防抖或防并发，多次并发断连调用导致 reconnectAttempts 被错误累加！');
        console.log('✅ 测试用例 1 通过: 成功实现重连请求的防抖动/防并发，计数器未被错误累加。');
    } catch (e) {
        console.warn(`❌ 测试用例 1 失败: ${e.message}`);
    }

    // ----------------------------------------------------------------------
    // 验证点 2：5次失败后是否安全回退并清理定时器
    // ----------------------------------------------------------------------
    console.log('\n--- 🧪 测试用例 2: 5次重连失败后安全回退与清理定时器 ---');
    
    // 重置状态，模拟第 5 次重连彻底失败（第6次尝试触发）
    app.setIsConnected(false);
    app.setIsReconnecting(true);
    app.setReconnectAttempts(5); // 模拟已经尝试了5次重连，现在第5次重连彻底失败，准备触发第6次
    app.setIsUserInitiatedDisconnect(false);
    
    // 触发下一次 attemptReconnect()
    app.attemptReconnect();
    
    const finalAttempts = app.getReconnectAttempts();
    const finalTimeoutId = app.getReconnectTimeoutId();
    const isConnectedState = app.getIsConnected();
    const isReconnectingState = app.getIsReconnecting();
    
    console.log(`[重连失败5次后再次触发 attemptReconnect]`);
    console.log(`- 重试计数器 reconnectAttempts = ${finalAttempts}`);
    console.log(`- 重连定时器 ID reconnectTimeoutId = ${finalTimeoutId}`);
    console.log(`- 是否已连接 isConnected = ${isConnectedState}`);
    console.log(`- 是否重连中 isReconnecting = ${isReconnectingState}`);
    
    try {
        assert.strictEqual(finalAttempts, 0, '重置后，重试计数器应该被清零');
        assert.strictEqual(finalTimeoutId, null, '重连定时器必须被清理置为 null');
        assert.strictEqual(isConnectedState, false, '连接状态必须置为 false');
        assert.strictEqual(isReconnectingState, false, '重连状态必须置为 false');
        console.log('✅ 测试用例 2 通过: 5次失败后安全回退，并正确清理了重连定时器。');
    } catch (e) {
        console.error(`❌ 测试用例 2 失败: ${e.message}`);
    }

    // ----------------------------------------------------------------------
    // 验证点 3：重连期间音频 onaudioprocess 丢帧和队列清空是否正常工作
    // ----------------------------------------------------------------------
    console.log('\n--- 🧪 测试用例 3: 重连期间音频丢帧和队列清空，防止内存积压 ---');
    
    // 注入 MockAudioContext 避免崩溃
    app.setAudioCtx(new global.window.AudioContext());
    
    // 启用音频采集模拟
    app.startAudioStreaming();
    const processor = global.window.AudioContext.processorNodeInstance;
    
    if (!processor || !processor.onaudioprocess) {
        console.error('无法获取 processor.onaudioprocess，请检查 audioCtx 模拟。');
        process.exit(1);
    }
    
    // 模拟重连期间 isReconnecting = true, isConnected = false
    app.setIsReconnecting(true);
    app.setIsConnected(false);
    
    // 先往队列里填入几个假数据包模拟积压
    app.setPendingAudioQueue([{ dummy: 1 }, { dummy: 2 }]);
    app.setHasSpeechInQueue(true);
    
    console.log(`[模拟重连期前] 缓存队列长度 = ${app.getPendingAudioQueue().length}`);
    
    // 模拟 onaudioprocess 触发
    const mockAudioEvent = {
        inputBuffer: {
            getChannelData: () => new Float32Array(2048)
        }
    };
    processor.onaudioprocess(mockAudioEvent);
    
    const queueAfterProcess = app.getPendingAudioQueue();
    const hasSpeechAfterProcess = app.getHasSpeechInQueue();
    
    console.log(`[模拟 onaudioprocess 运行后] 缓存队列长度 = ${queueAfterProcess.length}`);
    console.log(`[模拟 onaudioprocess 运行后] hasSpeechInQueue = ${hasSpeechAfterProcess}`);
    
    try {
        assert.strictEqual(queueAfterProcess.length, 0, '重连期间队列未被清空，可能导致内存积压！');
        assert.strictEqual(hasSpeechAfterProcess, false, 'hasSpeechInQueue 应该被重置为 false');
        console.log('✅ 测试用例 3 通过: 重连期间音频正常捕获但直接丢弃，并且队列已清空，无内存积压风险。');
    } catch (e) {
        console.error(`❌ 测试用例 3 失败: ${e.message}`);
    }
}

// 运行测试并清理临时文件
runTests().finally(() => {
    try {
        if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
            console.log('\n🧹 临时测试文件已成功清理。');
        }
    } catch (err) {
        console.error('清理临时测试文件失败:', err);
    }
});
