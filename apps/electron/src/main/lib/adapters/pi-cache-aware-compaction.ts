/**
 * Cache-aware Pi compaction request projection.
 *
 * Pi 0.82 serializes the selected conversation into one new user message and
 * deliberately sends the summarization request with `cacheRetention: "none"`
 * and a random session id.  Both choices make a long, otherwise warm session a
 * cold request.
 *
 * Kila keeps Pi's compaction selection, persistence and lifecycle, but replaces
 * the request envelope at the stream seam.  The last routed system prompt,
 * tools and selected message prefix are replayed verbatim; only Pi's existing
 * summarization instruction is appended as a new final user message.  This is
 * the same prefix-preserving shape used by deepseek-harness.
 *
 * 匹配失败时必须原样放行 Pi 的请求（含其自带的 cacheRetention/sessionId），
 * 不能只覆写参数：Pi 对 standalone 摘要请求隔离缓存路由是刻意设计，
 * 强行写入无法复用的缓存只会浪费配额并污染 session affinity。
 */

import type { StreamFn } from '@earendil-works/pi-agent-core'
import type {
  CacheRetention,
  Context,
  Message,
} from '@earendil-works/pi-ai'

export type PromptCacheRetention = Exclude<CacheRetention, 'none'>

/**
 * Pi 会话消息序列化器（`@earendil-works/pi-coding-agent` 公开导出的
 * `serializeConversation`）。Pi 包是 ESM-only，主进程 CJS bundle 无法静态
 * import，由 adapter 经 external-esm-loader 动态加载后注入，保证与 Pi
 * 压缩协议字节级一致——升级 Pi 时不需要同步维护本地复刻版本。
 */
export type PiConversationSerializer = (messages: Message[]) => string

interface ParsedSummarizationPrompt {
  conversation: string
  instruction: string
  message: Extract<Message, { role: 'user' }>
}

export interface CacheAwareStreamOptions {
  streamFn: StreamFn
  sessionId: string
  cacheRetention: PromptCacheRetention
  /** Pi 公开导出的 serializeConversation，经 external ESM loader 加载后注入。 */
  serializeConversation: PiConversationSerializer
  /**
   * Initial active context for a restored session.  It is a correctness
   * fallback for manual compaction before the first request in this process;
   * the first real routed request replaces it.
   */
  initialContext?: Context
}

const CONVERSATION_OPEN = '<conversation>\n'
const CONVERSATION_CLOSE = '\n</conversation>\n\n'

// Pi's standalone SUMMARIZATION_SYSTEM_PROMPT is intentionally not replayed:
// the original Kila system prompt must remain the cached prefix.  Keep the
// equivalent safety boundary in the novel trailing instruction instead.
const CACHE_AWARE_COMPACTION_GUARD = [
  'Act only as the context compaction engine for this coding assistant.',
  'Do not continue the conversation, answer the user, call tools, or take any action.',
  'Output only the structured checkpoint requested below.',
].join(' ')

function textContent(message: Message): string {
  if (message.role !== 'user') return ''
  if (typeof message.content === 'string') return message.content
  return message.content
    .map((part) => part.type === 'text' ? part.text : '')
    .join('')
}

/** Recognize Pi's generated summarization call without relying on its private system-prompt constant. */
function parseSummarizationPrompt(context: Context): ParsedSummarizationPrompt | undefined {
  if (context.messages.length !== 1) return undefined
  const message = context.messages[0]
  if (!message || message.role !== 'user') return undefined

  const text = textContent(message)
  if (!text.startsWith(CONVERSATION_OPEN)) return undefined
  const closeIndex = text.indexOf(CONVERSATION_CLOSE, CONVERSATION_OPEN.length)
  if (closeIndex < 0) return undefined

  const conversation = text.slice(CONVERSATION_OPEN.length, closeIndex)
  const instruction = text.slice(closeIndex + CONVERSATION_CLOSE.length).trim()
  if (!conversation || !instruction) return undefined
  return { conversation, instruction, message }
}

interface SerializedFragment {
  text: string
  messageIndex: number
}

/**
 * Find the selected Pi compaction region inside the last provider request and
 * return the last message index of that region.  Pi's serializer is applied to
 * each message independently and joins non-empty fragments with two newlines,
 * so this comparison stays byte-for-byte aligned with Pi without parsing its
 * human-readable serialization.
 */
function findSelectedRegionEnd(
  messages: readonly Message[],
  serializedRegion: string,
  serializeConversation: PiConversationSerializer,
): number | undefined {
  const fragments: SerializedFragment[] = []
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex]
    if (!message) continue
    const text = serializeConversation([message])
    if (text) fragments.push({ text, messageIndex })
  }

  for (let start = 0; start < fragments.length; start += 1) {
    if (!serializedRegion.startsWith(fragments[start]!.text)) continue
    let candidate = ''
    for (let end = start; end < fragments.length; end += 1) {
      candidate += `${end === start ? '' : '\n\n'}${fragments[end]!.text}`
      if (candidate === serializedRegion) return fragments[end]!.messageIndex
      if (candidate.length >= serializedRegion.length || !serializedRegion.startsWith(candidate)) break
    }
  }
  return undefined
}

/**
 * Project a Pi standalone summarization request into a prefix-preserving one.
 * Exported for focused regression tests and provider-payload diagnostics.
 */
export function projectCacheAwareCompactionContext(
  summarizationContext: Context,
  lastRoutedContext: Context,
  serializeConversation: PiConversationSerializer,
): Context | undefined {
  const parsed = parseSummarizationPrompt(summarizationContext)
  if (!parsed) return undefined

  const selectedRegionEnd = findSelectedRegionEnd(
    lastRoutedContext.messages,
    parsed.conversation,
    serializeConversation,
  )
  if (selectedRegionEnd === undefined) return undefined

  const instructionMessage: Message = {
    ...parsed.message,
    content: [{ type: 'text', text: `${CACHE_AWARE_COMPACTION_GUARD}\n\n${parsed.instruction}` }],
  }
  return {
    systemPrompt: lastRoutedContext.systemPrompt,
    messages: [
      ...lastRoutedContext.messages.slice(0, selectedRegionEnd + 1),
      instructionMessage,
    ],
    ...(lastRoutedContext.tools ? { tools: lastRoutedContext.tools } : {}),
  }
}

/**
 * Wrap the Pi SDK stream function at its single provider boundary.
 *
 * Normal calls establish the warm-prefix reference untouched.  Pi summarization
 * calls are detected structurally and projected when possible; only successful
 * projections inherit the stable Kila session id plus the configured
 * non-`none` cache retention.  Failed projections pass through verbatim so
 * Pi's own `cacheRetention: "none"` isolation stays in effect.
 */
export function createCacheAwareCompactionStreamFn(options: CacheAwareStreamOptions): StreamFn {
  let lastRoutedContext = options.initialContext

  return async (model, context, requestOptions) => {
    const projected = lastRoutedContext
      ? projectCacheAwareCompactionContext(context, lastRoutedContext, options.serializeConversation)
      : undefined

    if (projected) {
      return options.streamFn(model, projected, {
        ...requestOptions,
        cacheRetention: options.cacheRetention,
        sessionId: options.sessionId,
      })
    }

    if (parseSummarizationPrompt(context) === undefined) {
      lastRoutedContext = context
    }
    return options.streamFn(model, context, requestOptions)
  }
}
