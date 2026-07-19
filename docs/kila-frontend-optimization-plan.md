# Kila 前端体验优化方案

> 基于 LobeHub 的交互方向对标，但按 Kila 当前 unified session + Pi runtime 约束重新收敛。
> 本版方案已移除不可落地的 `React.startTransition` correctness 假设、`motion/react` 依赖假设和不存在的 `generateObject` 后端链路。

---

## 一、P0-Bug：中断回复后的过程气泡保留

### 问题

点击停止后，主进程会持久化当前 attempt buffer 并发送 `STREAM_COMPLETE`。渲染层随后把 `agentStreamingStatesAtom[sessionId].running` 置为 `false` 并触发消息重载。

风险点不在持久化，而在 UI 过渡：`running=false` 和异步 `getSessionMessages()` hydrate 之间存在短窗口。如果此时流式内容或 process timeline 被清空，用户会看到思考/工具过程短暂消失。

### 修正后的方案

新增显式 hydrate 标记：

- `agentMessageHydratingAtom: Set<string>` 记录哪些 session 正在从持久化消息水合。
- `useSessionMetaListener.bumpAgentRefresh()` 在 bump `agentMessageRefreshAtom` 前加入 sessionId。
- `AgentView` 的消息加载 effect 完成 `setMessages()`、team cache rebuild 和 stale stream cleanup 后移除 sessionId。
- `AgentMessages.hasLiveAssistantTurn` 把 `hydratingMessages` 纳入条件，直到持久化消息真正落屏前保留 live turn。

不使用 `React.startTransition` 作为修复手段。它只改变调度优先级，不提供“消息更新和流式状态删除原子提交”的语义保证。

### 涉及文件

- `apps/electron/src/renderer/atoms/agent-ui-atoms.ts`
- `apps/electron/src/renderer/hooks/session-listeners/useSessionMetaListener.ts`
- `apps/electron/src/renderer/components/agent/AgentView.tsx`
- `apps/electron/src/renderer/components/agent/AgentMessages.tsx`

---

## 二、P0-Feature：动态 Streaming Headline

### 目标

把 `TurnActivitySummary` 从静态 chip 改为运行中可扫描的状态标题：

- thinking 未完成：显示 thinking 摘要或 `Kila 思考中…`
- tool 未完成：显示当前工具 display name
- prose 生成中：从流式正文提取短句
- retry 中：保留 `重试中` chip
- 非流式完成态：回落到工具事件计数

### 修正后的方案

- 纯函数 `getStreamingHeadline()` 放在 `agent-messages-utils.ts`。
- React hook `useDebouncedHeadline()` 放在 `AgentMessages.tsx`，保持 utils 文件“无 React 依赖”的约定。
- 不引入 `motion/react`。当前项目没有该依赖，切换动画使用全局 CSS class `kila-headline-pop`。
- headline 防抖 180ms，避免工具/文本事件高频切换时抖动。

### 涉及文件

- `apps/electron/src/renderer/components/agent/agent-messages-utils.ts`
- `apps/electron/src/renderer/components/agent/AgentMessages.tsx`
- `apps/electron/src/renderer/styles/globals.css`

---

## 三、P1：FollowUp 推荐追问（轻量版）

### 约束修正

原方案假设 `agentRuntime.generateObject()` 可用，但当前 `AgentProviderAdapter` 只有 `query/abort/dispose/steer/followUp/waitForIdle`。`session-service.queueFollowUp()` 的含义也是运行中追加用户输入，不是 sidecar 推荐生成。

因此本阶段不新增后端 LLM 结构化生成链路，也不新增 IPC。

### 当前落地方案

复用已有 `prompt_suggestion` 事件和 `agentPromptSuggestionsAtom`：

- runtime 若推送 `prompt_suggestion`，renderer 已按 sessionId 缓存。
- `AgentMessages` 只在最后一条 assistant 消息下显示 chip。
- 生成中隐藏。
- 点击 chip 只填入 composer 并聚焦，不直接发送，避免误触。
- 用户发送新消息、排队消息或编辑重发时沿用现有清空 suggestion 逻辑。

后续如需 LLM sidecar FollowUp，再单独设计：

- 结构化 JSON completion 服务
- provider/model 选择策略
- 成本开关
- 超时、取消、去重
- prompt 注入隔离和结果 schema 校验

### 涉及文件

- `apps/electron/src/renderer/components/agent/FollowUpChips.tsx`
- `apps/electron/src/renderer/components/agent/AgentMessageItem.tsx`
- `apps/electron/src/renderer/components/agent/AgentMessages.tsx`
- `apps/electron/src/renderer/components/agent/AgentView.tsx`

---

## 四、P2：Thinking 卡片增强

### 目标

让折叠态 thinking 卡片在运行中更有信息密度：

- running 时优先显示 thinking 首句/摘要，不只显示 `Kila 思考中…`
- running 图标从 `Brain + animate-pulse` 改成 `Loader2 + animate-spin`
- done 图标使用 `Sparkles`
- running 标题使用轻量 shiny text
- 遵守 reduced motion

### 涉及文件

- `apps/electron/src/renderer/components/agent/agent-messages-utils.ts`
- `apps/electron/src/renderer/components/agent/process-cards.tsx`
- `apps/electron/src/renderer/styles/globals.css`

---

## 执行顺序

1. P0 hydrate guard，先修过渡正确性。
2. P2 thinking 卡片，低风险提升信息密度。
3. P0 streaming headline，复用已有 timeline 数据。
4. P1 FollowUp 轻量版，先复用已有 suggestion 事件，不改后端。

---

## 不做的事

- 不换虚拟化方案。
- 不改 Markdown/Shiki 渲染管线。
- 不新增 `motion/react`。
- 不新增 FollowUp 后端结构化生成链路。
- 不把 `queueFollowUp` 误用为推荐追问生成能力。
