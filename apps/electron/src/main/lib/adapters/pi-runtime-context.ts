/**
 * 稳定 runtime context snapshot 的注入状态机。
 *
 * 从 pi-agent-adapter 拆出：MCP/Skills/工作目录等稳定配置不再每轮进 prompt
 * （会破坏 append-only 缓存前缀），而是作为带 fingerprint 的 snapshot 在
 * 「首次 / 内容变化 / 压缩重写历史后」注入一次。注入的 marker 会随消息持久化
 * 在 Pi sidecar 中，进程重启后通过扫描 marker 恢复指纹，避免重复注入。
 */

import type { SessionManager } from '@earendil-works/pi-coding-agent'

/** runtime 中维护的 snapshot 注入状态（PiRuntime 的一个切片）。 */
export interface RuntimeContextInjectionState {
  /** 上次注入（或从持久化历史恢复）的 snapshot 指纹。 */
  runtimeContextFingerprint?: string
  /** 压缩重写请求历史后置 true，强制下一轮重建 snapshot。 */
  runtimeContextNeedsRefresh: boolean
}

/** 判断是否需要注入本轮 snapshot，并推进注入状态。 */
export interface RuntimeContextInjectionInput {
  prompt: string
  runtimeContext?: string
  runtimeContextFingerprint?: string
}

export function canonicalizeRuntimeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalizeRuntimeValue(item))
  if (!value || typeof value !== 'object') return value
  const input = value as Record<string, unknown>
  const output: Record<string, unknown> = {}
  for (const key of Object.keys(input).sort()) {
    output[key] = canonicalizeRuntimeValue(input[key])
  }
  return output
}

export function safeStableStringify(value: unknown): string {
  try {
    return JSON.stringify(canonicalizeRuntimeValue(value))
  } catch {
    return '[unserializable]'
  }
}

const RUNTIME_CONTEXT_MARKER = 'kila_runtime_context_snapshot'

function textFromPiContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part): part is { type: 'text'; text: string } => (
      Boolean(part)
      && typeof part === 'object'
      && (part as { type?: unknown }).type === 'text'
      && typeof (part as { text?: unknown }).text === 'string'
    ))
    .map((part) => part.text)
    .join('')
}

export function findPersistedRuntimeContextFingerprint(sessionManager: SessionManager): string | undefined {
  // 只从当前 compaction-aware context 查找；getEntries() 还包含已被压缩移除的旧消息，
  // 若从那里恢复 marker 会错误地跳过下一轮 snapshot 注入。
  const messages = sessionManager.buildSessionContext().messages
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || !('content' in message)) continue
    const content = (message as { content?: unknown }).content
    const text = textFromPiContent(content)
    const markerIndex = text.indexOf(`<${RUNTIME_CONTEXT_MARKER}`)
    if (markerIndex < 0) continue
    const marker = text.slice(markerIndex).match(
      new RegExp(`<${RUNTIME_CONTEXT_MARKER}\\s+fingerprint="([^"]+)"`),
    )
    if (marker?.[1]) return marker[1]
  }
  return undefined
}

function formatRuntimeContextPrompt(snapshot: string, fingerprint: string): string {
  return `<${RUNTIME_CONTEXT_MARKER} fingerprint="${fingerprint}">\n${snapshot}\n</${RUNTIME_CONTEXT_MARKER}>`
}

/**
 * 需要注入时把 snapshot 前置到本轮 prompt；否则原样返回，保证缓存前缀稳定。
 * 注入成功后推进 state（记指纹、清 refresh 标记）。
 */
export function materializeRuntimeContextPrompt(
  state: RuntimeContextInjectionState,
  input: RuntimeContextInjectionInput,
): string {
  const snapshot = input.runtimeContext?.trim()
  const fingerprint = input.runtimeContextFingerprint?.trim()
  if (!snapshot || !fingerprint) return input.prompt

  const shouldInject = state.runtimeContextNeedsRefresh
    || state.runtimeContextFingerprint !== fingerprint
  if (!shouldInject) return input.prompt

  state.runtimeContextFingerprint = fingerprint
  state.runtimeContextNeedsRefresh = false
  return `${formatRuntimeContextPrompt(snapshot, fingerprint)}\n\n${input.prompt}`
}
