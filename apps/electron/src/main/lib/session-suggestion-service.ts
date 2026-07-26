/**
 * 会话快捷建议生成服务
 *
 * 应用启动时基于 Memory 系统的结构化记忆数据，通过直接 LLM HTTP 调用生成个性化建议。
 * 复用 utility 渠道降级链和 adapter 请求构建，不创建 session、不持久化。
 */

import { getAdapter } from '@kila/core'
import { decryptApiKey, listChannels } from './channel-manager'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import { getSettings } from './settings-service'
import { listSessions } from './session-manager'
import { resolveSessionTitleModelTargets } from './session-title-model-resolver'
import { memoryProviderManager } from './memory/provider-manager'
import type { QuickSuggestion, SessionMeta } from '@kila/shared'
import type { MemoryEntry, NotebookEntry, WorkingMemory } from './memory/types'

import { createLogger } from './logger'
const log = createLogger('建议生成')

const SUGGESTION_PROMPT = `根据用户的记忆档案和最近活动，生成 3~5 个个性化的建议。每个建议应该是用户当前可能需要帮助的事情。

要求：
- 建议应基于记忆中用户的实际上下文（进行中的项目/任务/决策/偏好），而非泛化模板
- title（≤10字）：口语化简洁标题
- detail（≤15字）：一行副标题补充说明
- prompt：可直接发给助手的完整指令，用户不需要补充任何信息
- 优先级：进行中/未完成的任务 > 可优化的已有方案 > 基于偏好的新建议
- 必须严格返回 JSON 数组，不要包含任何额外文本、markdown 标记或解释

用户记忆档案：
{memoryContext}

最近活动方向：
{recentSessionTitles}

返回 JSON 数组，格式：
[{"title": "...", "detail": "...", "prompt": "..."}]
`

const FALLBACK_SUGGESTIONS: QuickSuggestion[] = [
  {
    title: '梳理今天要推进的事',
    detail: '目标、约束、第一步',
    prompt: '帮我梳理今天这个会话要推进的工作：先确认目标、列出约束，再给出可执行的第一步。',
  },
  {
    title: '审查当前项目风险',
    detail: '入口、变更点、验证路径',
    prompt: '请从当前项目出发，帮我做一次快速代码审查：找入口、关键数据流、潜在风险，并给出验证步骤。',
  },
  {
    title: '把想法拆成计划',
    detail: '范围、取舍、落地顺序',
    prompt: '我有一个粗略想法，帮我把它拆成清晰计划：范围、非目标、实现顺序、验证方式都要列出来。',
  },
]

/** 建议上下文的 token budget（字符数近似，约 1500 tokens） */
const CONTEXT_CHAR_BUDGET = 4500
const TIMEOUT_MS = 30_000
/**
 * 输出 token 上限。设为 4096 以兼容推理模型（DeepSeek R1 等）——
 * 这些模型的 reasoning_content 消耗大量 token，800 远不够实际输出。
 */
const MAX_TOKENS = 4096

function truncate(str: string, maxLen: number): string {
  const trimmed = str.trim()
  return trimmed.length <= maxLen ? trimmed : trimmed.slice(0, maxLen) + '…'
}

/** 校验 LLM 返回的 JSON 结构完整性 */
function validateSuggestions(raw: unknown): QuickSuggestion[] | null {
  if (!Array.isArray(raw)) return null
  const valid = raw.filter((item): item is QuickSuggestion => {
    if (typeof item !== 'object' || item === null) return false
    const obj = item as Record<string, unknown>
    return typeof obj.title === 'string' && obj.title.length > 0 && obj.title.length <= 20
      && typeof obj.detail === 'string' && obj.detail.length > 0 && obj.detail.length <= 30
      && typeof obj.prompt === 'string' && obj.prompt.length > 0
  })
  return valid.length >= 1 ? valid.slice(0, 5) : null
}

/**
 * 从 LLM 响应 JSON 中提取文本内容（兼容不同 provider 格式）
 *
 * 特殊处理推理模型（DeepSeek R1 等）：
 * - 当 content 为空但 reasoning_content 有值时，说明模型把 token 全用在推理上了
 * - 此时 finish_reason 通常为 "length"，返回 null 让调用方尝试下一个渠道
 */
function extractTextFromResponse(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null
  const obj = data as Record<string, unknown>

  // OpenAI / 兼容格式
  const choices = obj.choices as Array<{
    message?: { content?: string; reasoning_content?: string }
    finish_reason?: string
  }> | undefined
  if (choices?.[0]?.message?.content) return choices[0].message.content

  // 推理模型兼容：content 为空但 reasoning_content 有内容 → token 耗尽
  if (choices?.[0]?.message?.reasoning_content && !choices[0].message.content) {
    log.warn('[建议生成] 推理模型 token 耗尽（content 为空，reasoning_content 有值），跳过此渠道')
    return null
  }

  // Anthropic 格式
  const content = obj.content as Array<{ type?: string; text?: string }> | undefined
  if (content) {
    const textBlock = content.find(b => b.type === 'text')
    if (textBlock?.text) return textBlock.text
  }

  // Google 格式
  const candidates = obj.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined
  if (candidates?.[0]?.content?.parts?.[0]?.text) return candidates[0].content.parts[0].text

  return null
}

/**
 * 尝试从截断的 JSON 数组中挽救已完成的条目。
 *
 * 当 LLM 输出被 max_tokens 截断时，JSON 数组可能不完整：
 * [{ "title": "完整1" }, { "title": "完整2" }, { "title": "截断...
 *
 * 策略：逐步去除末尾不完整片段直到 JSON.parse 成功。
 */
function repairTruncatedJsonArray(text: string): unknown | null {
  // 先尝试直接解析
  try {
    return JSON.parse(text)
  } catch {
    // 继续修复
  }

  // 找到最后一个完整的 } 并在其后闭合数组
  let lastCompleteObject = -1
  let braceDepth = 0
  let inString = false
  let escapeNext = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (escapeNext) {
      escapeNext = false
      continue
    }
    if (ch === '\\' && inString) {
      escapeNext = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (ch === '{') braceDepth++
    if (ch === '}') {
      braceDepth--
      if (braceDepth === 0) {
        lastCompleteObject = i
      }
    }
  }

  if (lastCompleteObject <= 0) return null

  // 截取到最后一个完整对象，闭合数组
  const repaired = text.slice(0, lastCompleteObject + 1) + ']'
  try {
    const parsed = JSON.parse(repaired)
    if (Array.isArray(parsed) && parsed.length > 0) {
      log.info('[建议生成] 从截断响应中修复了', parsed.length, '条建议')
      return parsed
    }
  } catch {
    // 修复也失败了
  }

  return null
}

/**
 * 将结构化记忆数据格式化为紧凑的建议上下文文本。
 * 内置 token budget 截断（≤ CONTEXT_CHAR_BUDGET 字符），防止拼接后 prompt 过长。
 */
function renderSuggestionContext(input: {
  globalWorkingMemory: WorkingMemory | null
  memories: MemoryEntry[]
  notebooks: NotebookEntry[]
  impression: string | undefined
  sessionTitles: string[]
}): { memoryContext: string; recentSessionTitles: string } {
  const parts: string[] = []
  let budget = CONTEXT_CHAR_BUDGET

  // 用户印象（最高优先）
  if (input.impression) {
    const block = `[用户画像]\n${truncate(input.impression, 500)}`
    parts.push(block)
    budget -= block.length
  }

  // 全局工作记忆
  const wmContent = input.globalWorkingMemory?.content?.trim()
  if (wmContent && budget > 200) {
    const block = `[全局工作记忆]\n${truncate(wmContent, Math.min(600, budget - 50))}`
    parts.push(block)
    budget -= block.length
  }

  // 最近记忆条目（带 category/tags 元数据）
  if (input.memories.length > 0 && budget > 200) {
    const memLines: string[] = []
    for (const entry of input.memories) {
      if (budget <= 100) break
      const tags = entry.tags.length > 0 ? ` [${entry.tags.join(', ')}]` : ''
      const title = entry.title ? `${entry.title}: ` : ''
      const line = `- (${entry.category}) ${title}${truncate(entry.content, 120)}${tags}`
      memLines.push(line)
      budget -= line.length
    }
    if (memLines.length > 0) {
      const block = `[最近记忆]\n${memLines.join('\n')}`
      parts.push(block)
    }
  }

  // Notebook 条目
  if (input.notebooks.length > 0 && budget > 200) {
    const noteLines: string[] = []
    for (const entry of input.notebooks) {
      if (budget <= 100) break
      const title = entry.title ? `${entry.title}: ` : ''
      const line = `- ${title}${truncate(entry.content, 100)}`
      noteLines.push(line)
      budget -= line.length
    }
    if (noteLines.length > 0) {
      const block = `[笔记]\n${noteLines.join('\n')}`
      parts.push(block)
    }
  }

  // 最近会话标题
  const titleLines = input.sessionTitles
    .map((title, i) => `${i + 1}. ${title}`)
    .join('\n')

  return {
    memoryContext: parts.length > 0 ? parts.join('\n\n') : '无记忆数据',
    recentSessionTitles: titleLines || '无最近活动',
  }
}

/**
 * 从 Memory 系统获取结构化记忆数据，构建建议上下文
 */
async function buildSuggestionContext(): Promise<{ memoryContext: string; recentSessionTitles: string } | null> {
  // 1. 从 Memory 系统并行获取结构化数据（笔记随本地存储移除，恒为空）
  const [globalWM, memories, notebooks, impressionResult] = await Promise.all([
    memoryProviderManager.getWorkingMemory({ scope: 'global' }).catch(() => null),
    memoryProviderManager.list({ limit: 8 }).catch(() => [] as MemoryEntry[]),
    Promise.resolve<NotebookEntry[]>([]),
    memoryProviderManager.getWorkingMemory({ scope: 'global' }).catch(() => null),
  ])

  // 2. 补充最近会话标题
  const sessions: SessionMeta[] = listSessions()
    .filter((s: SessionMeta) => s.title && s.title !== '新会话')
    .sort((a: SessionMeta, b: SessionMeta) => b.updatedAt - a.updatedAt)
    .slice(0, 5)

  const hasMemoryData = Boolean(
    globalWM?.content?.trim() ||
    memories.length > 0 ||
    notebooks.length > 0 ||
    impressionResult?.content?.trim()
  )

  // 无任何记忆数据也无会话历史 → 直接返回 null
  if (!hasMemoryData && sessions.length === 0) {
    return null
  }

  return renderSuggestionContext({
    globalWorkingMemory: globalWM,
    memories,
    notebooks,
    impression: impressionResult?.content?.trim() || undefined,
    sessionTitles: sessions.map((s: SessionMeta) => s.title),
  })
}

export async function generateSuggestions(): Promise<QuickSuggestion[]> {
  const context = await buildSuggestionContext()
  if (!context) {
    log.info('[建议生成] 无记忆数据和会话历史，返回 fallback')
    return FALLBACK_SUGGESTIONS
  }

  const prompt = SUGGESTION_PROMPT
    .replace('{memoryContext}', context.memoryContext)
    .replace('{recentSessionTitles}', context.recentSessionTitles)

  const settings = getSettings()
  const channels = listChannels()
  const targets = resolveSessionTitleModelTargets({ settings, channels })

  for (const target of targets) {
    const channel = channels.find(c => c.id === target.channelId && c.enabled)
    if (!channel) continue

    let apiKey: string
    try {
      apiKey = decryptApiKey(target.channelId)
    } catch {
      continue
    }

    try {
      const adapter = getAdapter(channel.provider)
      const request = adapter.buildTitleRequest({
        baseUrl: channel.baseUrl,
        apiKey,
        modelId: target.modelId,
        prompt,
      })

      // 覆盖 max_tokens（建议需要比标题更多的 token）
      const bodyObj = JSON.parse(request.body) as Record<string, unknown>
      bodyObj.max_tokens = MAX_TOKENS
      const patchedBody = JSON.stringify(bodyObj)

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

      const proxyUrl = await getEffectiveProxyUrl()
      const fetchFn = getFetchFn(proxyUrl)

      const response = await fetchFn(request.url, {
        method: 'POST',
        headers: request.headers,
        body: patchedBody,
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'unknown')
        log.warn('[建议生成] HTTP 失败:', { status: response.status, responseBytes: errorText.length })
        continue
      }

      const data: unknown = await response.json()

      // 多 provider 响应解析，不依赖 parseTitleResponse
      let text = extractTextFromResponse(data)
      if (!text) {
        // 兜底：尝试 adapter 自带解析
        text = adapter.parseTitleResponse(data)
      }

      if (!text) {
        log.warn('[建议生成] 无法提取文本:', { provider: channel.provider })
        continue
      }

      text = text.trim()
      log.info('[建议生成] LLM 回复已接收:', { chars: text.length })

      // 兼容 markdown 代码块包裹
      const jsonStr = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()

      // 先尝试直接解析，失败则尝试修复截断的 JSON
      const parsed = repairTruncatedJsonArray(jsonStr)
      if (parsed) {
        const validated = validateSuggestions(parsed)
        if (validated) {
          log.info('[建议生成] 成功生成', validated.length, '条建议')
          return validated
        }
      }

      log.warn('[建议生成] JSON 校验失败:', { chars: text.length })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        log.warn('[建议生成] 请求超时:', TIMEOUT_MS + 'ms')
      } else {
        log.warn('[建议生成] 渠道失败:', { channel: target.channelId, error: String(error) })
      }
    }
  }

  log.info('[建议生成] 所有渠道失败，返回 fallback')
  return FALLBACK_SUGGESTIONS
}
