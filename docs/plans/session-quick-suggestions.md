# Session Quick Suggestions — 会话快捷提示方案

## 目标

主面板空会话**欢迎界面**（`AgentWelcomeState`）的静态 STARTER_PROMPTS 卡片替换为 LLM 生成的个性化建议，基于用户最近会话记忆推测当前意图，点击后填入输入框。

## 竞品调研结论

| 产品 | 生成方式 | 数据源 |
|------|----------|--------|
| ChatGPT | LLM 生成 | 当前对话上下文 |
| Claude.ai | LLM 生成 | 当前对话 + 用户记忆 |
| Copilot | LLM 生成 | 最近文件/编辑器上下文 |
| Google AI Mode | LLM 生成 | 搜索历史 + 上下文 |

**结论**：所有主流产品均采用 LLM 生成，无一使用静态模板。

## 设计决策

1. **LLM 生成** — 唯一生成方式，不搞静态模板 + LLM 混合双轨
2. **展示位置** — 主面板 `AgentWelcomeState`（替换现有 3 张静态 STARTER_PROMPTS 卡片）
3. **基于最近会话记忆** — 取最近 5 条 session 的标题 + 最近 2 条用户消息摘要，构建 prompt 发给 LLM
4. **使用 utility 渠道/模型** — 复用 `utilityChannelId` / `utilityModelId`（标题生成同款），不占用用户主模型配额
5. **主进程生成** — 新增 `session-suggestion-service.ts`，模式对标 `session-title-service.ts`
6. **只展示空会话** — `AgentMessages` 已有条件渲染 `AgentWelcomeState`（`messages.length === 0 && !hasLiveAssistantTurn`），有消息后自然消失
7. **复用现有交互** — 点击卡片 → `onUsePrompt` → `setInputContent` → focus 输入框

## 现有欢迎界面结构

```
AgentMessages (AgentMessages.tsx:243)
  → messages.length === 0 && !hasLiveAssistantTurn
    → <AgentWelcomeState sessionPath={...} onUsePrompt={handleUseStarterPrompt} />

AgentWelcomeState (AgentWelcomeState.tsx)
  → 头像 + 问候语 + 打字机行
  → 项目/时间/上下文 信息卡片
  → STARTER_PROMPTS[3] — 静态卡片，点击 → onUsePrompt → setInputContent → focus

AgentView (AgentView.tsx:1295)
  → handleUseStarterPrompt: setInputContent(prompt) + requestAnimationFrame(focus)
```

## 生成流程

```
渲染进程                                    主进程
────────                                   ──────
AgentWelcomeState 挂载
  → sessionQuickSuggestionsAtom 为空？
    → IPC: generate-suggestions
                                            → session-suggestion-service
                                              1. listSessions() → 取最近 5 条有标题的 session
                                              2. 对每条 getRecentSessionMessages(id, 2) → 用户消息摘要
                                              3. resolveSessionTitleModelTargets → utility / session 渠道
                                              4. adapter.chat() 直接调用 LLM（不复用 fetchTitle）
                                              5. validateSuggestions() 校验 JSON 结构 → QuickSuggestion[]
  ← IPC 返回 QuickSuggestion[]
  → set(sessionQuickSuggestionsAtom, result)
  → AgentWelcomeState 重新渲染
    → LLM 建议非空 → 替换 STARTER_PROMPTS
    → LLM 建议为空 → 保持原有静态 STARTER_PROMPTS
```

## 数据源

### 输入数据（主进程已有）

| 数据 | 来源 | 用途 |
|------|------|------|
| 最近 5 条 session 标题 | `listSessions()` | 提取用户最近在做什么 |
| 最近 2 条用户消息 | `getRecentSessionMessages(id, 2)` | 补充上下文粒度 |
| utility 渠道/模型 | `settings.utilityChannelId` / `utilityModelId` | 调用 LLM |
| 会话渠道/模型（fallback） | `session.channelId` / `session.modelId` | utility 未配置时降级 |

### 示例 LLM 输入 prompt

```
根据用户最近的会话活动，生成 3~5 个简短的建议提示。每个建议包含 title（≤10字标题）、detail（≤15字说明）和 prompt（完整提示词）。

要求：
- 建议应基于用户最近在做什么来推测当前可能需要什么帮助
- title 要口语化、简洁
- detail 是一行副标题，补充说明
- prompt 必须是可以直接发给助手的完整指令，用户不需要补充任何信息
- 不要重复已有的标题，而是基于上下文推测下一步
- 必须严格返回 JSON 数组，不要包含任何额外文本、markdown 标记或解释

最近会话：
1. "Widget 双层 Bug 调试" — 最近消息：解析 XML 闭合标签时 JSON 控制字符导致失败
2. "IM Bridge 微信渠道修复" — 最近消息：DNS 不稳定 + 重试机制
3. "UI 重构 SidePanel" — 最近消息：TabBar 和 FileBrowser 组件拆分

返回 JSON 数组，格式：
[{"title": "...", "detail": "...", "prompt": "..."}]
```

### 示例 LLM 输出

```json
[
  {"title": "继续 Widget 调试", "detail": "JSON 解析、控制字符清理", "prompt": "继续上次「Widget 双层 Bug 调试」的工作，告诉我当前进展和下一步"},
  {"title": "设计微信重试方案", "detail": "DNS 降级、自动重试", "prompt": "帮我设计 IM Bridge 微信渠道的自动重试方案"},
  {"title": "整理今天工作计划", "detail": "按优先级排列待办", "prompt": "帮我梳理今天的工作，按优先级排列待推进事项"},
  {"title": "审查 SidePanel 重构", "detail": "组件拆分、可读性", "prompt": "帮我 review SidePanel/TabBar 的重构代码"}
]
```

## 后端实现

### 新增 IPC 通道（`packages/shared/src/types/session.ts`）

```ts
// SESSION_IPC_CHANNELS 新增
GENERATE_SUGGESTIONS: 'session:generate-suggestions',
```

### 新增请求/响应类型（`packages/shared/src/types/session.ts`）

```ts
export interface QuickSuggestion {
  /** 卡片标题（≤10 字） */
  title: string
  /** 卡片副标题（≤15 字） */
  detail: string
  /** 完整提示词 */
  prompt: string
}

export interface GenerateSuggestionsResult {
  suggestions: QuickSuggestion[]
}
```

### 新增服务（`apps/electron/src/main/lib/session-suggestion-service.ts`）

复用 `session-title-model-resolver.ts` 的 utility/session 渠道降级链，但**不复用 `fetchTitle`** —— 建议生成需要返回结构化 JSON 数组，语义和单行标题完全不同，直接用 adapter 底层 chat 接口 + 自有解析逻辑：

```ts
import { getAdapter } from '@kila/core'
import { decryptApiKey, listChannels } from './channel-manager'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import { getSettings } from './settings-service'
import { listSessions, getRecentSessionMessages } from './session-manager'
import { resolveSessionTitleModelTargets } from './session-title-model-resolver'

const SUGGESTION_PROMPT = `...`

const FALLBACK_SUGGESTIONS: QuickSuggestion[] = [
  { title: '梳理今天要推进的事', detail: '目标、约束、第一步', prompt: '...' },
  { title: '审查当前项目风险', detail: '入口、变更点、验证路径', prompt: '...' },
  { title: '把想法拆成计划', detail: '范围、取舍、落地顺序', prompt: '...' },
]

/** 校验 LLM 返回的 JSON 结构完整性 */
function validateSuggestions(raw: unknown): QuickSuggestion[] | null {
  if (!Array.isArray(raw)) return null
  const valid = raw.filter(
    (item): item is QuickSuggestion =>
      typeof item === 'object' &&
      typeof item.title === 'string' && item.title.length > 0 && item.title.length <= 20 &&
      typeof item.detail === 'string' && item.detail.length > 0 && item.detail.length <= 30 &&
      typeof item.prompt === 'string' && item.prompt.length > 0
  )
  return valid.length >= 1 ? valid.slice(0, 5) : null
}

export async function generateSuggestions(): Promise<QuickSuggestion[]> {
  // 1. 取最近 5 条有标题的 session
  const sessions = listSessions()
    .filter(s => s.title && s.title !== '新会话')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5)

  if (sessions.length === 0) return FALLBACK_SUGGESTIONS

  // 2. 构建上下文（标题 + 最近消息摘要）
  const context = await buildSuggestionContext(sessions)

  // 3. resolveSessionTitleModelTargets → utility / session 渠道降级
  const targets = resolveSessionTitleModelTargets()
  const { channelId, modelId } = targets.utility ?? targets.session ?? null
  if (!channelId || !modelId) return FALLBACK_SUGGESTIONS

  // 4. adapter.chat() 直接调用 LLM（不走 fetchTitle）
  const adapter = getAdapter(channelId, modelId)
  const raw = await adapter.chat({
    messages: [{ role: 'user', content: SUGGESTION_PROMPT + context }],
    signal: AbortSignal.timeout(5_000),
  })

  // 5. 解析 + 校验 JSON 结构
  try {
    const parsed = JSON.parse(raw)
    const validated = validateSuggestions(parsed)
    return validated ?? FALLBACK_SUGGESTIONS
  } catch {
    return FALLBACK_SUGGESTIONS
  }
}
```

### IPC 注册（`apps/electron/src/main/ipc/session-ipc.ts`）

```ts
handle(
  SESSION_IPC_CHANNELS.GENERATE_SUGGESTIONS,
  async (): Promise<GenerateSuggestionsResult> => {
    const suggestions = await generateSuggestions()
    return { suggestions }
  }
)
```

### Preload 暴露（`apps/electron/src/preload/index.ts`）

```ts
generateSuggestions: () => typedInvoke(SESSION_IPC_CHANNELS.GENERATE_SUGGESTIONS),
```

## 前端实现

### 新增 atom（`atoms/agent-ui-atoms.ts`）

```ts
export interface QuickSuggestion {
  title: string
  detail: string
  prompt: string
}

/** 欢迎界面快捷建议 — LLM 生成的全局建议（所有空会话共享） */
export const sessionQuickSuggestionsAtom = atom<QuickSuggestion[]>([])
/** 建议加载状态 */
export const sessionQuickSuggestionsLoadingAtom = atom<boolean>(false)
```

### `AgentWelcomeState` 改造（`components/agent/AgentWelcomeState.tsx`）

将现有 3 张静态 `STARTER_PROMPTS` 卡片替换为 LLM 生成的建议：

```tsx
function AgentWelcomeState({ sessionPath, onUsePrompt }: AgentWelcomeStateProps) {
  const suggestions = useAtomValue(sessionQuickSuggestionsAtom)
  const loading = useAtomValue(sessionQuickSuggestionsLoadingAtom)
  const setSuggestions = useSetAtom(sessionQuickSuggestionsAtom)
  const setLoading = useSetAtom(sessionQuickSuggestionsLoadingAtom)

  // 请求触发逻辑：首次挂载且 suggestions 为空时请求
  React.useEffect(() => {
    if (suggestions.length > 0 || loading) return
    let cancelled = false
    setLoading(true)
    window.electronAPI.generateSuggestions()
      .then(result => {
        if (!cancelled) setSuggestions(result.suggestions)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  // 展示优先级：LLM 建议 > 静态 fallback
  const displaySuggestions = suggestions.length > 0
    ? suggestions.map(s => ({ ...s, icon: Sparkles }))
    : STARTER_PROMPTS

  // ... 头像、问候语部分不变

  // 卡片区域：保持现有 card 样式，数据源从 STARTER_PROMPTS 切换为 LLM 建议
  return (
    // ... 上半部分不变
    <div className="grid gap-2.5">
      {loading ? (
        // loading skeleton：3 张 pulse 占位卡片
        <>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[68px] animate-pulse rounded-2xl bg-muted/30" />
          ))}
        </>
      ) : (
        displaySuggestions.map((item) => (
          <button key={item.title} onClick={() => onUsePrompt?.(item.prompt)} ...>
            {/* 保持现有 card 布局 */}
          </button>
        ))
      )}
    </div>
  )
}
```

### 不涉及的文件（原方案侧边栏部分已移除）

- ~~`LeftSidebar.tsx`~~ — 无需改动
- ~~`SessionSuggestionChips.tsx`~~ — 不再需要独立 chip 组件
- ~~`SessionItem`~~ — 无需改动

## 降级策略

| 场景 | 降级行为 |
|------|----------|
| utility 渠道未配置 | 使用会话渠道/模型（复用 `resolveSessionTitleModelTargets`） |
| 所有渠道不可用 | 显示 `FALLBACK_SUGGESTIONS`（即现有 3 条静态 STARTER_PROMPTS） |
| LLM 返回非 JSON | 捕获解析错误，显示 fallback |
| LLM 返回 JSON 但字段缺失/类型错误 | `validateSuggestions` 校验不通过，显示 fallback |
| 网络超时 | 5s 超时，显示 fallback |
| 无最近会话 | 显示 fallback |

## 缓存策略

- 建议全局缓存，所有空会话共享同一份建议
- 首次挂载时请求，结果存入 `sessionQuickSuggestionsAtom`
- **缓存失效条件**（双重判断，满足任一则刷新）：
  1. 时间窗口：距上次请求超过 5 分钟（`Date.now() - lastFetchTime > 300_000`）
  2. 活动驱动：`lastKnownLatestUpdatedAt` 变化 —— 记录上次请求时最近 session 的 `updatedAt`，若当前最近 session 的 `updatedAt` 已更新（说明用户有新交互），则触发刷新
- 刷新 debounce 30s，避免频繁请求
- 设计理由：纯时间窗口无法反映用户活跃度 —— 用户在 5 分钟内密集交互时缓存已过时但不会刷新，而长时间不活动时时间窗口过期但上下文未变（此时刷新无害但浪费）

## 涉及文件清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `packages/shared/src/types/session.ts` | 修改 | 新增 `QuickSuggestion` / `GenerateSuggestionsResult` + IPC 通道常量 |
| `apps/electron/src/main/lib/session-suggestion-service.ts` | 新建 | 建议生成服务（对标 session-title-service） |
| `apps/electron/src/main/ipc/session-ipc.ts` | 修改 | 注册 GENERATE_SUGGESTIONS handler |
| `apps/electron/src/preload/index.ts` | 修改 | 暴露 `generateSuggestions` API |
| `apps/electron/src/renderer/atoms/agent-ui-atoms.ts` | 修改 | 新增 `sessionQuickSuggestionsAtom` + loading atom |
| `apps/electron/src/renderer/components/agent/AgentWelcomeState.tsx` | 修改 | 替换静态 STARTER_PROMPTS 为 LLM 建议 + loading skeleton |

## 验证步骤

1. `bun run typecheck` — 类型检查通过
2. `bun run electron:build` — 构建通过
3. `bun run dev` — 手动验证：
   - 新建空会话 → 欢迎界面先显示 loading skeleton → 然后 LLM 建议卡片替换静态卡片
   - 点击建议卡片 → prompt 填入输入框 + focus
   - 发送消息后 → 欢迎界面消失，消息列表出现
   - 切换到另一个空会话 → 显示已缓存的建议（不重复请求）
   - 用户有新交互后切换空会话 → 重新请求（活动驱动刷新）
   - 5 分钟内无新交互 → 复用缓存
   - utility 模型未配置 → 降级到会话模型
   - 所有模型不可用 / 网络超时 → 显示原有 3 条静态建议
   - 无最近会话 → 显示原有 3 条静态建议
