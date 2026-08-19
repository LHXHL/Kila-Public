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
 */

import type { StreamFn } from '@earendil-works/pi-agent-core'
import type {
  CacheRetention,
  Context,
  Message,
} from '@earendil-works/pi-ai'

export type PromptCacheRetention = Exclude<CacheRetention, 'none'>

interface ParsedSummarizationPrompt {
  conversation: string
  instruction: string
  message: Extract<Message, { role: 'user' }>
}

// `@earendil-works/pi-coding-agent` is ESM-only.  This file runs in the
// CommonJS Electron main bundle, so a static import would become a top-level
// `require()` and crash before the external ESM loader can run.  Keep the
// small, stable serializer used by Pi's compaction protocol local instead.
// It mirrors `packages/coding-agent/src/core/compaction/utils.ts` from the
// pinned Pi 0.82.1 dependency.
const TOOL_RESULT_MAX_CHARS = 2000

function serializationContentText(content: unknown, separator = '\n'): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is { type: 'text', text: string } => (
      !!block
      && typeof block === 'object'
      && (block as { type?: unknown }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string'
    ))
    .map((block) => block.text)
    .join(separator)
}

function truncateForSerialization(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const truncatedChars = text.length - maxChars
  return `${text.slice(0, maxChars)}\n\n[... ${truncatedChars} more characters truncated]`
}

function serializeConversation(messages: readonly Message[]): string {
  const parts: string[] = []

  for (const message of messages) {
    const msg = message as Message & { content?: unknown }
    if (msg.role === 'user') {
      const content = serializationContentText(msg.content, '')
      if (content) parts.push(`[User]: ${content}`)
      continue
    }

    if (msg.role === 'assistant') {
      const thinkingParts: string[] = []
      const toolCalls: string[] = []
      const content = Array.isArray(msg.content) ? msg.content : []
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const typedBlock = block as {
          type?: unknown
          thinking?: unknown
          name?: unknown
          arguments?: Record<string, unknown>
        }
        if (typedBlock.type === 'thinking' && typeof typedBlock.thinking === 'string') {
          thinkingParts.push(typedBlock.thinking)
        } else if (typedBlock.type === 'toolCall' && typedBlock.arguments) {
          const argsStr = Object.entries(typedBlock.arguments)
            .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
            .join(', ')
          toolCalls.push(`${String(typedBlock.name ?? '')}(${argsStr})`)
        }
      }
      if (thinkingParts.length > 0) {
        parts.push(`[Assistant thinking]: ${thinkingParts.join('\n')}`)
      }
      if (content.some((block) => (
        !!block && typeof block === 'object' && (block as { type?: unknown }).type === 'text'
      ))) {
        parts.push(`[Assistant]: ${serializationContentText(msg.content)}`)
      }
      if (toolCalls.length > 0) {
        parts.push(`[Assistant tool calls]: ${toolCalls.join('; ')}`)
      }
      continue
    }

    if (msg.role === 'toolResult') {
      const content = serializationContentText(msg.content, '')
      if (content) parts.push(`[Tool result]: ${truncateForSerialization(content, TOOL_RESULT_MAX_CHARS)}`)
    }
  }

  return parts.join('\n\n')
}

export interface CacheAwareStreamOptions {
  streamFn: StreamFn
  sessionId: string
  cacheRetention: PromptCacheRetention
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
function findSelectedRegionEnd(messages: readonly Message[], serializedRegion: string): number | undefined {
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
): Context | undefined {
  const parsed = parseSummarizationPrompt(summarizationContext)
  if (!parsed) return undefined

  const selectedRegionEnd = findSelectedRegionEnd(
    lastRoutedContext.messages,
    parsed.conversation,
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
 * Normal calls establish the warm-prefix reference.  Pi summarization calls
 * are detected structurally, projected when possible, and always inherit the
 * stable Kila session id plus the configured non-`none` cache retention.
 */
export function createCacheAwareCompactionStreamFn(options: CacheAwareStreamOptions): StreamFn {
  let lastRoutedContext = options.initialContext

  return async (model, context, requestOptions) => {
    const projected = lastRoutedContext
      ? projectCacheAwareCompactionContext(context, lastRoutedContext)
      : undefined
    const isSummarization = parseSummarizationPrompt(context) !== undefined

    if (!isSummarization) lastRoutedContext = context

    return options.streamFn(model, projected ?? context, {
      ...requestOptions,
      cacheRetention: options.cacheRetention,
      sessionId: options.sessionId,
    })
  }
}
