# 个性化建议 + 隐身模式实施计划

## 背景

两个功能需求：
1. **个性化建议**：新对话初始界面基于用户记忆数据生成个性化建议（替代现有纯会话标题方案）
2. **隐身模式**：输入框发送按钮旁新增隐身切换，开启后本条消息不进入记忆系统

### 记忆控制的两层架构

记忆系统存在两个层级的控制开关，实施时需明确两者关系：

| 层级 | 载体 | 粒度 | 状态 | 说明 |
|------|------|------|------|------|
| Session 级 | `SessionMeta.memoryEnabled` | 整个会话 | 设计完成，待实现 | 关闭后整个会话不触发记忆提取/写入 |
| Message 级 | `SessionSendInput.incognito` | 单条消息 | 本计划实现 | 本条消息不写入记忆（但 Agent 仍可读取已有记忆） |

**优先级规则**：session 级 `memoryEnabled=false` 优先于 message 级 `incognito`。即：如果整个会话已关闭记忆，单条消息的 incognito 标记无意义（已经不记了）。

---

## 功能一：基于记忆的个性化建议

### 现状问题

现有 [session-suggestion-service.ts](file:///Users/qiuuus/Documents/Kila/apps/electron/src/main/lib/session-suggestion-service.ts) 仅从 `listSessions()` + `getRecentSessionMessages()` 抓取最近 5 条会话标题和消息摘要来生成建议。这个数据源太浅：
- 只看会话标题和最近 2 条消息，缺乏语义深度
- 完全不利用已有的 Memory 系统（recalled memories、working memory、notebook、threads）
- 无法感知用户长期偏好、进行中的任务、决策历史

### 方案：用 Memory 系统构建建议上下文

**核心变更**：`generateSuggestions()` 从 Memory Provider Manager 拉取结构化记忆数据，替代原始会话消息扫描。

#### 数据源升级

| 数据源 | 来源 API | 用途 |
|--------|----------|------|
| Global Working Memory | `memoryProviderManager.getWorkingMemory({ scope: 'global' })` | 用户全局状态、偏好 |
| 最近记忆条目 | `memoryProviderManager.list({ limit: 8 })` | 最近的决策、事实、任务 |
| Notebook 条目 | `memoryProviderManager.listNotebookEntries({ limit: 3 })` | 用户主动记录的笔记 |
| 用户印象 | `memory:get-impression` IPC | 用户画像概要 |
| 最近会话标题 | `listSessions()` → 取最近 5 条 | 补充近期活动方向 |

> [!IMPORTANT]
> **不再从每条 session 读取消息内容**（避免 N+1 IO）。Memory 系统已经对会话内容做了 distill 提炼，直接用提炼后的记忆条目更精准。

> [!WARNING]
> **API 验证前置**：实施前需确认 `memoryProviderManager` 的实际方法签名 —— `getWorkingMemory()`、`list()`、`listNotebookEntries()` 是否存在，`getImpressionContent()` 是 IPC 调用还是本地函数。若 API 不匹配，需先补齐 adapter 层。

#### 新 Prompt 模板

```
根据用户的记忆档案和最近活动，生成 3~5 个个性化的建议。每个建议应该是用户当前可能需要帮助的事情。

要求：
- 建议应基于记忆中用户的实际上下文（进行中的项目/任务/决策/偏好），而非泛化模板
- title（≤10字）：口语化简洁标题
- detail（≤15字）：一行副标题补充说明
- prompt：可直接发给助手的完整指令，用户不需要补充任何信息
- 优先级：进行中/未完成的任务 > 可优化的已有方案 > 基于偏好的新建议
- 必须严格返回 JSON 数组，无额外文本

用户记忆档案：
{memoryContext}

最近活动方向：
{recentSessionTitles}

返回 JSON 数组，格式：
[{"title": "...", "detail": "...", "prompt": "..."}]
```

### 涉及文件

---

#### [MODIFY] [session-suggestion-service.ts](file:///Users/qiuuus/Documents/Kila/apps/electron/src/main/lib/session-suggestion-service.ts)

重写 `buildSuggestionContext()` 函数，改为从 Memory 系统获取数据：

```diff
-import { listSessions, getRecentSessionMessages } from './session-manager'
+import { listSessions } from './session-manager'
+import { memoryProviderManager } from './memory/provider-manager'

-async function buildSuggestionContext(): Promise<string> {
-  const sessions = listSessions()...
-  // 逐条读取 session 消息
-  for (const s of sessions) {
-    const recent = await getRecentSessionMessages(s.id, 2)
-    ...
-  }
-}
+async function buildSuggestionContext(): Promise<string> {
+  // 1. 从 Memory 系统并行获取结构化数据
+  const [globalWM, memories, notebooks, impression] = await Promise.all([
+    memoryProviderManager.getWorkingMemory({ scope: 'global' }),
+    memoryProviderManager.list({ limit: 8 }),
+    memoryProviderManager.listNotebookEntries({ limit: 3 }),
+    getImpressionContent(),
+  ])
+
+  // 2. 补充最近会话标题
+  const sessions = listSessions()
+    .filter(s => s.title && s.title !== '新会话')
+    .sort((a, b) => b.updatedAt - a.updatedAt)
+    .slice(0, 5)
+
+  // 3. 组装 memory context
+  return renderSuggestionContext({
+    globalWorkingMemory: globalWM,
+    memories,
+    notebooks,
+    impression,
+    sessionTitles: sessions.map(s => s.title),
+  })
+}
```

**关键点**：
- 用 `memoryProviderManager` 替代 `getRecentSessionMessages`（后者需要逐条 IO）
- Memory 条目已包含 category（general/decision/preference/fact/task/insight）和 tags，在渲染时保留这些元数据供 LLM 参考
- 新增 `renderSuggestionContext()` 函数将记忆数据格式化为紧凑文本
- `renderSuggestionContext()` 内置 token budget 截断（≤1500 tokens），防止拼接后 prompt 过长超出 utility 模型上下文窗口
- `validateSuggestions()` 校验 LLM 返回的 JSON 结构完整性（title/detail/prompt 类型、长度），校验不通过则降级到 FALLBACK

#### 渲染进程无需改动

[AgentWelcomeState.tsx](file:///Users/qiuuus/Documents/Kila/apps/electron/src/renderer/components/agent/AgentWelcomeState.tsx) 和 [main.tsx](file:///Users/qiuuus/Documents/Kila/apps/electron/src/renderer/main.tsx) 中的 `SuggestionInitializer` 的数据消费逻辑完全不变 — 只是后端数据源升级，接口契约不变。

### 缓存策略保持不变

应用启动时一次性生成，结果缓存在 `sessionQuickSuggestionsAtom` 中，所有空会话共享。

### 降级策略保持不变

Memory 系统无数据 → 回退到会话标题 → 全部失败 → FALLBACK_SUGGESTIONS

---

## 功能二：隐身模式

### 设计概览

在对话输入框发送按钮旁边添加一个「隐身模式」按钮。开启后：
- 本条消息发送后，Agent 正常执行
- Agent 仍然**读取**已有记忆上下文（保持回答质量）
- 但 Agent 结束时**跳过** `memoryLifecycleManager.onAgentEnd()`（不写入新记忆）
- 视觉反馈：按钮图标切换 + Tooltip 提示（不使用独立 Banner 避免布局跳动）

**设计决策 — 方案 B（只跳过写入，仍然读取记忆）**：
用户"隐身"的预期是"这条消息不留痕迹"，不是"这条消息我失忆了"。Agent 仍需读取记忆才能保持回答质量（了解用户偏好、项目上下文、历史决策）。

### 数据流追踪

```
用户点击隐身按钮
  → incognitoAtom = true
  → handleSend() 读取 incognitoAtom，快照为 messageIncognito = true
  → handleSend() 立即重置 incognitoAtom = false（防竞态）
  → SessionSendInput.incognito = messageIncognito
  → IPC: session:send-message
  → sendSessionMessage(input)
  → defaultRunAgentRuntime()
  → agentRuntime.runAgent(payload)  // payload.incognito = true（已快照，不依赖 atom）
  → runAgentStream() 正常执行
  → completeWithPostRun()
    → 检查 payload.incognito flag（来自消息元数据，非 atom）
    → if (incognito) 跳过 memoryLifecycleManager.onAgentEnd()（不写入）
    → getPromptContext() 正常执行（仍然读取记忆上下文）
```

> [!IMPORTANT]
> **竞态防护**：`incognito` 在 `handleSend` 时快照到消息元数据中，不依赖 streaming 结束时的 atom 值。发送后立即重置 atom，防止连续快速操作时状态错乱。

### 涉及文件

---

#### [MODIFY] [session.ts](file:///Users/qiuuus/Documents/Kila/packages/shared/src/types/session.ts) — 类型

在 `SessionSendInput` 接口新增 `incognito` 字段：

```diff
 export interface SessionSendInput {
   sessionId: string
   userMessage: string
+  /** 隐身模式：本条消息不加入记忆 */
+  incognito?: boolean
   systemMessage?: string
   ...
 }
```

---

#### [MODIFY] [agent.ts types](file:///Users/qiuuus/Documents/Kila/packages/shared/src/types/agent.ts) — AgentSendInput 类型

同样在 `AgentSendInput` 中新增 `incognito`：

```diff
 export interface AgentSendInput {
+  /** 隐身模式：跳过记忆提取/存储 */
+  incognito?: boolean
   ...
 }
```

---

#### [MODIFY] [session-service.ts](file:///Users/qiuuus/Documents/Kila/apps/electron/src/main/lib/session-service.ts) — 传递 incognito

在 `defaultRunAgentRuntime()` 中将 `input.incognito` 透传到 `AgentSendInput.incognito`：

```diff
 const payload: AgentSendInput = {
   sessionId: session.id,
   userMessage: input.userMessage,
+  incognito: input.incognito,
   ...
 }
```

---

#### [MODIFY] agent-orchestrator-stream.ts — 跳过记忆写入

> [!NOTE]
> **文件名需验证**：实际文件名可能是 `agent-orchestrator-stream.ts` 或类似名称，实施前确认 agent 执行链路的实际文件路径。

在 `completeWithPostRun()` 中根据 `payload.incognito` 决定是否触发记忆写入（注意：从 `payload` 读取，不是从 atom）：

```diff
 const completeWithPostRun = (): AgentMessage[] => {
   const messages = getAgentMessages(sessionId)
-  memoryLifecycleManager.onAgentEnd({
-    sessionId,
-    projectPath: input.projectPath,
-    messages,
-  })
+  if (!input.incognito) {
+    memoryLifecycleManager.onAgentEnd({
+      sessionId,
+      projectPath: input.projectPath,
+      messages,
+    })
+  }
   return messages
 }
```

> [!IMPORTANT]
> 也需要在同文件中 `onAfterCompaction` 调用处添加 `incognito` 保护，防止压缩时写入记忆。

---

#### ~~[MODIFY] [agent-orchestrator-context.ts](file:///Users/qiuuus/Documents/Kila/apps/electron/src/main/lib/agent-orchestrator-context.ts)~~ — 不再需要改动

~~原计划在隐身模式下跳过记忆上下文注入，但最终决策为方案 B：仍然读取记忆上下文，只跳过写入。`getPromptContext()` 调用保持不变。~~

---

#### [MODIFY] [agent-ui-atoms.ts](file:///Users/qiuuus/Documents/Kila/apps/electron/src/renderer/atoms/agent-ui-atoms.ts) — 新增 atom

```ts
/** 隐身模式 — 开启后本条消息不加入记忆 */
export const incognitoModeAtom = atom<boolean>(false)
```

---

#### [MODIFY] [AgentView.tsx](file:///Users/qiuuus/Documents/Kila/apps/electron/src/renderer/components/agent/AgentView.tsx) — UI 集成

1. **读取 incognito atom**：

```ts
const [incognitoMode, setIncognitoMode] = useAtom(incognitoModeAtom)
```

2. **handleSend 中快照 + 立即重置（防竞态）**：

```diff
 const handleSend = () => {
+  // 快照当前隐身状态到消息元数据
+  const messageIncognito = incognitoMode || undefined
+  // 立即重置 atom，防止 streaming 期间用户再发消息时状态错乱
+  if (incognitoMode) setIncognitoMode(false)
   // ...
   return {
     sessionId,
     userMessage: finalMessage,
+    incognito: messageIncognito,
     ...
   }
 }
```

3. **隐身按钮 UI**：在发送按钮旁（`gap-1.5` 区域）添加隐身切换按钮：

```tsx
{/* 隐身模式按钮 — 紧贴发送按钮左侧 */}
<Tooltip>
  <TooltipTrigger asChild>
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        'size-[30px] rounded-full transition-colors',
        incognitoMode
          ? 'text-primary bg-primary/10 hover:bg-primary/15'
          : 'text-foreground/30 hover:text-foreground/60'
      )}
      onClick={() => setIncognitoMode((prev) => !prev)}
    >
      {incognitoMode ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
    </Button>
  </TooltipTrigger>
  <TooltipContent side="top">
    <p>{incognitoMode ? '隐身模式已开启 — 本条消息不加入记忆' : '点击开启隐身模式'}</p>
  </TooltipContent>
</Tooltip>
```

4. **~~隐身模式提示 Banner~~** → **改为 Tooltip 提示**：

~~原计划在输入框上方显示独立 Banner，但会导致布局跳动（撑开再收起）。改为仅依赖按钮自身的 Tooltip 提示，视觉更稳定。~~

5. **发送后无需手动重置**：已在 `handleSend` 入口处快照后立即重置（见第 2 点），无需在 `sent` 回调中再处理。

> [!WARNING]
> 隐身模式是 **per-message** 的，不是 per-session。每次发送后自动关闭，用户需要每次主动开启。这避免用户忘记关闭导致整个会话都不记忆的问题。

---

## 完整涉及文件清单

| 文件 | 功能 | 变更 |
|------|------|------|
| `session-suggestion-service.ts` | 建议 | 重写上下文构建，使用 Memory API + token budget + validateSuggestions |
| `session.ts` (shared types) | 隐身 | `SessionSendInput` 新增 `incognito` 字段 |
| `agent.ts` (shared types) | 隐身 | `AgentSendInput` 新增 `incognito` 字段 |
| `session-service.ts` | 隐身 | 透传 `incognito` 到 AgentSendInput |
| agent-orchestrator-stream.ts（文件名待验证） | 隐身 | `completeWithPostRun` 根据 `payload.incognito` 跳过记忆写入 |
| ~~agent-orchestrator-context.ts~~ | ~~隐身~~ | ~~不再需要改动（方案 B：仍然读取记忆上下文）~~ |
| `agent-ui-atoms.ts` | 隐身 | 新增 `incognitoModeAtom` |
| `AgentView.tsx` | 隐身 | 隐身按钮 UI + Tooltip + handleSend 快照竞态防护 |

## 设计决策记录

| 决策项 | 选项 | 结论 | 理由 |
|--------|------|------|------|
| 隐身模式记忆读取 | A: 完全不读不写 / B: 只跳过写入 | **方案 B** | 隐身 = 不留痕迹，不是失忆；Agent 需要读取记忆才能保持回答质量 |
| 隐身提示 UI | Banner / Tooltip | **Tooltip** | Banner 会导致布局跳动，Tooltip 更轻量稳定 |
| 隐身状态绑定 | 全局 atom / 消息元数据 | **消息元数据** | 防竞态：handleSend 时快照到消息，不依赖 streaming 结束时的 atom 值 |
| per-message vs per-session | 两种粒度 | **per-message** | 与 session 级 `memoryEnabled` 分层，避免用户忘记关闭 |
| 与 session 级 memoryEnabled 的关系 | 并列 / 优先级 | **session 级优先** | `memoryEnabled=false` 时 incognito 标记无意义 |

## 验证计划

### 功能一验证
1. `bun run typecheck` — 类型检查通过
2. `bun run dev` — 手动验证：
   - 已有记忆数据时：建议内容应反映用户实际项目/任务/偏好
   - 无记忆数据时：降级到会话标题 → FALLBACK
   - Memory 系统不可用时：降级到 FALLBACK

### 功能二验证
1. `bun run typecheck` — 类型检查通过
2. `bun run dev` — 手动验证：
   - 隐身按钮 toggle 视觉反馈正常
   - 开启隐身 → 发送消息 → Agent 正常执行（仍能引用已有记忆） → 检查 Memory 面板无新记忆写入
   - 发送后隐身模式自动关闭（atom 已重置）
   - 关闭隐身 → 发送消息 → Memory 面板正常写入记忆
   - Tooltip 提示正确显示/隐藏
   - 连续快速操作：开启隐身 → 发送 A → 关闭隐身 → 发送 B → A 不记忆 B 记忆（竞态测试）
