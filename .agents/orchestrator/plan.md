# 实施计划 (plan.md)

本项目旨在对“商业通话悬浮提词助手”进行全方位的生产级优化与体验重塑。以下为整体实施路径和规划：

## 1. 任务分析与分类
- **任务分类**：SWE (Software Engineering) + UI/UX 优化。
- **复杂度评估**：中等偏高。需要重构 CSS（毛玻璃效果、渐变 Canvas）、修改 JavaScript 的 WebSocket 连接和重试逻辑（指数退避）、以及增加状态和日志的历史记录。
- **协作模式**：Project Pattern (Orchestrator 协调 + Explorer 探索 + Worker 编写 + Reviewer 审查 + Challenger 验证 + Auditor 审计)。

## 2. 实施路径 (Milestones)

| 阶段 | 里程碑名称 | 核心目标 | 涉及文件 | 负责人 |
|---|---|---|---|---|
| M1 | 架构探索与设计 | 探明当前 WebSocket 协议、提词实现细节与 Canvas 可视化逻辑 | `app.js`, `index.html`, `index.css` | Explorer |
| M2 | 前端 UI 极致视觉美学重塑 (R1) | 引入高端暗黑毛玻璃风格，重构 Canvas 音柱霓虹渐变与自适应缩放 | `index.html`, `index.css` | Worker, Reviewer, Challenger |
| M3 | 业务功能完备化 (R2) | 多场景话术热切换下拉菜单设计，通话纪要历史导出功能 | `index.html`, `app.js`, `index.css` | Worker, Reviewer, Challenger |
| M4 | 指数级退避重连自愈 (R3) | WebSocket 状态流与异常监听，指示灯状态变更，指数退避自愈 | `app.js`, `index.html`, `index.css` | Worker, Reviewer, Challenger |
| M5 | 综合 E2E 测试与审计 | E2E 自动化测试覆盖，Forensic Audit 完整验证 | 所有文件 | Auditor, Challenger |

## 3. 子代理调度策略
- 决不直接编写、修改代码或直接运行测试。
- 每次修改均派发给 `teamwork_preview_worker` 角色，并明确标注“禁止作弊”的警告。
- 每次交付均通过 `teamwork_preview_reviewer` 和 `teamwork_preview_challenger` 进行测试验证。
- 在所有开发完成后，调用 `teamwork_preview_auditor` 验证代码完整性。
- 当 Spawn 计数达到 16 时，执行 Succession 继承协议。
