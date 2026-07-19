import type { MemoryRunTrace, SessionMessage } from '@kila/shared'

/** 更新最后一条包含 memory_trace 的 assistant 消息，不影响其他历史消息。 */
export function patchLatestAssistantMemoryTrace(
  messages: SessionMessage[],
  trace: MemoryRunTrace,
): { messages: SessionMessage[]; patched: boolean } {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'assistant' || !message.events) continue
    const eventIndex = message.events.findIndex((event) => event.type === 'memory_trace')
    if (eventIndex < 0) continue

    const events = message.events.slice()
    events[eventIndex] = { type: 'memory_trace', trace }
    const patchedMessages = messages.slice()
    patchedMessages[index] = { ...message, events }
    return { messages: patchedMessages, patched: true }
  }

  return { messages, patched: false }
}
