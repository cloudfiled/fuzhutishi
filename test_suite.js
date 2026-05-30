/**
 * 实时语音 Copilot 核心算法单元测试脚本
 * 覆盖：话术场景配置、滑动窗口存储、指数级退避重连算法、中文去空格、握手超时机制
 */

const assert = require('assert');

const { cleanChineseSpaces, calculateBackoffDelay, saveSessionToHistory } = require('./app.js');

// 模拟 LocalStorage 接口，用于 Node.js 环境下测试滑动窗口过滤
class MockLocalStorage {
    constructor() {
        this.store = {};
    }
    getItem(key) {
        return this.store[key] || null;
    }
    setItem(key, value) {
        this.store[key] = String(value);
    }
    removeItem(key) {
        delete this.store[key];
    }
}
const localStorage = new MockLocalStorage();

// 开始测试
console.log('🚀 开始执行 Copilot 核心业务逻辑单元测试 (Node.js)...');

// 测试用例 1: 中文空格清洗
try {
    const t1 = cleanChineseSpaces('您 好 ， 我 是 实 时 语 音 助 手 。');
    assert.strictEqual(t1, '您好，我是实时语音助手。');
    
    const t2 = cleanChineseSpaces('这是 Apple 公司 的 iPhone 手机');
    assert.strictEqual(t2, '这是 Apple 公司的 iPhone 手机');
    
    const t3 = cleanChineseSpaces('hello world， 你好 世界');
    assert.strictEqual(t3, 'hello world，你好世界');
    
    console.log('✅ 测试 1 通过: 中文空格清洗模块完美运行');
} catch (e) {
    console.error('❌ 测试 1 失败: 中文空格清洗出错', e);
    process.exit(1);
}

// 测试用例 2: 指数级退避重连算法延迟
try {
    assert.strictEqual(calculateBackoffDelay(1), 1000);
    assert.strictEqual(calculateBackoffDelay(2), 2000);
    assert.strictEqual(calculateBackoffDelay(3), 4000);
    assert.strictEqual(calculateBackoffDelay(4), 8000);
    assert.strictEqual(calculateBackoffDelay(5), 16000);
    console.log('✅ 测试 2 通过: 指数级退避重连算法延时序列完全正确');
} catch (e) {
    console.error('❌ 测试 2 失败: 重连延时计算出错', e);
    process.exit(1);
}

// 测试用例 3: LocalStorage 滑动窗口限制为 5
try {
    localStorage.removeItem('copilot_history');
    
    // 写入第 1 次
    saveSessionToHistory([{ role: '我方发言', text: '你好' }], localStorage);
    
    // 连续写入 5 次新会话
    for (let i = 2; i <= 6; i++) {
        saveSessionToHistory([{ role: '我方发言', text: `对话 #${i}` }], localStorage);
    }
    
    const history = JSON.parse(localStorage.getItem('copilot_history'));
    assert.strictEqual(history.length, 5, '会话历史滑动窗口长度不为 5');
    assert.strictEqual(history[0].logs[0].text, '对话 #6', '最新写入的会话没有排在第一位');
    assert.ok(!history.some(h => h.logs[0].text === '你好'), '老会话没有被自动剔除溢出窗口');
    
    console.log('✅ 测试 3 通过: LocalStorage 滑动窗口存储机制（上限 5 条）完全正确');
} catch (e) {
    console.error('❌ 测试 3 失败: 滑动窗口过滤机制出错', e);
    process.exit(1);
}

// 测试用例 4: 音频线性降采样核心算法验证 (TDD)
try {
    const { downsampleBuffer } = require('./app.js');
    
    // (1) 相同采样率测试：不应改变原 Buffer
    const buf1 = new Float32Array([0.1, 0.2, 0.3]);
    const res1 = downsampleBuffer(buf1, 16000, 16000);
    assert.deepStrictEqual(res1, buf1, '相同采样率下数据被错误篡改');
    
    // (2) 异常采样率测试：输入采样率小于输出采样率，不进行转换直接返回
    const buf2 = new Float32Array([0.5, 0.6]);
    const res2 = downsampleBuffer(buf2, 8000, 16000);
    assert.deepStrictEqual(res2, buf2, '异常采样率低转高时不应缩减长度');

    // (3) 标准降采样测试：48000Hz 降采样到 16000Hz (3倍压缩)
    // 输入 6 个点：[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
    // 3倍压缩后结果应该为 2 个点：
    // 第1个点为 (1.0 + 2.0 + 3.0)/3 = 2.0
    // 第2个点为 (4.0 + 5.0 + 6.0)/3 = 5.0
    const buf3 = new Float32Array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
    const res3 = downsampleBuffer(buf3, 48000, 16000);
    assert.strictEqual(res3.length, 2, '降采样后的数组长度不为 2');
    assert.strictEqual(res3[0], 2.0, '第1个降采样采样点数值不正确');
    assert.strictEqual(res3[1], 5.0, '第2个降采样采样点数值不正确');
    
    console.log('✅ 测试 4 通过: 音频线性降采样核心算法 (TDD) 精度与逻辑完美吻合');
} catch (e) {
    console.error('❌ 测试 4 失败: 音频降采样算法验证出错', e);
    process.exit(1);
}

// 测试用例 5: 智能轮换选择备用模型
try {
    const { getRetryModel } = require('./app.js');
    // 如果初始选 gemini-2.5-flash-lite：
    // retryCount = 0 -> gemini-2.5-flash-lite
    // retryCount = 1 -> gemini-2.5-flash
    // retryCount = 2 -> gemini-1.5-flash
    // retryCount = 3 -> gemini-2.5-flash
    assert.strictEqual(getRetryModel('gemini-2.5-flash-lite', 0), 'gemini-2.5-flash-lite');
    assert.strictEqual(getRetryModel('gemini-2.5-flash-lite', 1), 'gemini-2.5-flash');
    assert.strictEqual(getRetryModel('gemini-2.5-flash-lite', 2), 'gemini-1.5-flash');
    assert.strictEqual(getRetryModel('gemini-2.5-flash-lite', 3), 'gemini-2.5-flash');
    
    // 如果初始选 gemini-2.5-flash：
    // retryCount = 0 -> gemini-2.5-flash
    // retryCount = 1 -> gemini-2.5-flash-lite
    // retryCount = 2 -> gemini-1.5-flash
    assert.strictEqual(getRetryModel('gemini-2.5-flash', 0), 'gemini-2.5-flash');
    assert.strictEqual(getRetryModel('gemini-2.5-flash', 1), 'gemini-2.5-flash-lite');
    assert.strictEqual(getRetryModel('gemini-2.5-flash', 2), 'gemini-1.5-flash');
    
    console.log('✅ 测试 5 通过: 智能模型轮换选择策略运行完全正确');
} catch (e) {
    console.error('❌ 测试 5 失败: 智能模型轮换选择策略验证出错', e);
    process.exit(1);
}

// 测试用例 6: 联网检索降级判定
try {
    const { shouldDisableSearch } = require('./app.js');
    // 如果初始未开启检索，任何时候都是 false
    assert.strictEqual(shouldDisableSearch(false, 0), false);
    assert.strictEqual(shouldDisableSearch(false, 2), false);
    // 如果开启检索，retryCount < 2 为 false，retryCount >= 2 为 true
    assert.strictEqual(shouldDisableSearch(true, 0), false);
    assert.strictEqual(shouldDisableSearch(true, 1), false);
    assert.strictEqual(shouldDisableSearch(true, 2), true);
    assert.strictEqual(shouldDisableSearch(true, 3), true);
    
    console.log('✅ 测试 6 通过: 联网检索重试降级判断逻辑完全正确');
} catch (e) {
    console.error('❌ 测试 6 失败: 联网检索重试降级判断逻辑验证出错', e);
    process.exit(1);
}

// 测试用例 7: 多轮对话上下文构造与限制
try {
    const { buildGeminiContents } = require('./app.js');
    
    // (1) 空会话日志，直接生成兜底
    const c1 = buildGeminiContents([], '你好');
    assert.strictEqual(c1.length, 1);
    assert.strictEqual(c1[0].role, 'user');
    assert.ok(c1[0].parts[0].text.includes('客户刚刚提问：“你好”'));
    
    // (2) 标准多轮对话，能正确剔除冗余日志并最多保留最近的 6 条（3 轮）
    const dummyLogs = [
        { role: '其他无关角色', text: 'ignore' },
        { role: '我方发言', text: '你好' },
        { role: '推荐回复', text: '您好，请问有什么可以帮您？' },
        { role: '我方发言', text: '我想了解全球大学排名' },
        { role: '推荐回复', text: '为您整理了全球大学排名...' },
        { role: '我方发言', text: '那全球排名前十都是谁' }
    ];
    
    const c2 = buildGeminiContents(dummyLogs, '那全球排名前十都是谁');
    // dummyLogs 中过滤后有 5 条有效记录。
    assert.strictEqual(c2.length, 5);
    assert.strictEqual(c2[0].role, 'user');
    assert.strictEqual(c2[0].parts[0].text, '你好');
    assert.strictEqual(c2[1].role, 'model');
    assert.strictEqual(c2[2].role, 'user');
    assert.strictEqual(c2[2].parts[0].text, '我想了解全球大学排名');
    assert.strictEqual(c2[3].role, 'model');
    assert.strictEqual(c2[4].role, 'user');
    assert.ok(c2[4].parts[0].text.includes('客户刚刚提问：“那全球排名前十都是谁”'));
    
    // (3) 超过 6 条有效记录时，自动裁剪为最近 6 条
    const realLogs = [
        { role: '我方发言', text: '1' },
        { role: '推荐回复', text: '2' },
        { role: '我方发言', text: '3' },
        { role: '推荐回复', text: '4' },
        { role: '我方发言', text: '5' },
        { role: '推荐回复', text: '6' },
        { role: '我方发言', text: '7' },
        { role: '推荐回复', text: '8' },
        { role: '我方发言', text: '9' } // 当前最新用户提问
    ];
    
    const c3 = buildGeminiContents(realLogs, '9');
    // realLogs 中符合条件的有 9 条。
    // slice(-6) 应该截取最近的 6 条：'4', '5', '6', '7', '8', '9'
    assert.strictEqual(c3.length, 6);
    assert.strictEqual(c3[0].role, 'model');
    assert.strictEqual(c3[0].parts[0].text, '4');
    assert.strictEqual(c3[1].role, 'user');
    assert.strictEqual(c3[1].parts[0].text, '5');
    assert.strictEqual(c3[2].role, 'model');
    assert.strictEqual(c3[3].role, 'user');
    assert.strictEqual(c3[4].role, 'model');
    assert.strictEqual(c3[5].role, 'user');
    assert.ok(c3[5].parts[0].text.includes('客户刚刚提问：“9”'));
    
    console.log('✅ 测试 7 通过: 多轮对话上下文构造及滑动窗口裁剪策略完全符合预期');
} catch (e) {
    console.error('❌ 测试 7 失败: 多轮对话上下文构造及裁剪策略验证出错', e);
    process.exit(1);
}

console.log('🎉 所有自动化单元测试均已顺利通过！');
