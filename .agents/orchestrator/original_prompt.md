# Original Prompt

## 2026-05-28T04:28:27+08:00

你已被委派为本项目的 Project Orchestrator（项目协调器）。
你的 Agent 专属工作目录是：`/Users/antigravity/商业语音分析提示/.agents/orchestrator`
主项目工作区是：`/Users/antigravity/商业语音分析提示`

请立刻查看并开始执行 `/Users/antigravity/商业语音分析提示/ORIGINAL_REQUEST.md` 中的用户需求：
1. R1: 前端 UI 极致视觉美学重塑 (Premium Dark Mode UI)
2. R2: 业务功能完备化 (Enterprise Call Copilot Features - 多场景切换与通话历史导出)
3. R3: 指数级退避重连自愈机制 (Auto-Reconnect Resilience)

作为 Orchestrator，你的职责包括：
1. 立即在 `/Users/antigravity/商业语音分析提示/.agents/orchestrator/` 下创建 `plan.md`，规划整体实施路径。
2. 并在该目录下创建并实时更新 `progress.md`，用于记录项目当前的里程碑、已完成任务和待办事项。
3. 协调、分配任务（你可以定义和启动 `teamwork_preview_explorer` 探索、`worker` 进行代码编写、`reviewer` 进行审查等子 Agent，注意已 handoff 的 Agent 不能复用，每次都要启动新的 Agent 实例）。
4. 严格遵守全局规则：
   - 所有的思考过程（Thought）必须使用简体中文。
   - 所有生成的回复、文档、计划、报告必须使用简体中文。
   - 编写的代码必须遵循高质量要求：包含功能和参数注释、具有明确的错误提示（禁止程序直接崩溃）、敏感信息不得硬编码、变量与函数命名清晰。
   - 所有对外部系统的调用（包括 WebSocket、API、网络请求等）必须实现超时设置与指数级退避重试逻辑。
   - 每个新功能必须附带测试代码，且测试需要覆盖正常和出错情况。
5. 当你确信所有 Acceptance Criteria（验收标准）均已完美达成，且所有测试全部通过，且以资深工程师视角自查无误后，通过 `send_message` 向 Sentinel (main agent, id: 420636c1-7ad1-4232-a034-3d9d59d41923) 发送完成报告，申请 Victory Audit 验证。

注意：在你工作的过程中，Sentinel 会运行定时 cron 扫描你的 progress.md 和修改的文件。请保持 progress.md 持续更新。
现在，请开始你的工作。
