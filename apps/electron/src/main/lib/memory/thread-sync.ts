import { memoryProviderManager } from './provider-manager'
import type { MemoryDistillThreadMessage, MemoryThreadCaptureInput } from './types'

interface MemorySourceMessage {
  role: string
  content: string
}

function toThreadMessages(messages: MemorySourceMessage[]): MemoryDistillThreadMessage[] {
  return messages
    .filter((message): message is MemorySourceMessage & { role: 'user' | 'assistant' } => (
      message.role === 'user' || message.role === 'assistant'
    ))
    .map((message) => ({ role: message.role, content: message.content.trim() }))
    .filter((message) => message.content)
}

function toThreadTitle(messages: MemorySourceMessage[]): string | undefined {
  const firstUserMessage = messages.find((message) => message.role === 'user' && message.content.trim())
  if (!firstUserMessage) return undefined
  return firstUserMessage.content.replace(/\s+/g, ' ').trim().slice(0, 120) || undefined
}

export async function syncSessionThreadTail(input: {
  sessionId: string
  projectPath?: string
  messages: MemorySourceMessage[]
}): Promise<MemoryThreadCaptureInput | null> {
  const messages = toThreadMessages(input.messages)
  if (messages.length === 0) return null
  const captureInput: MemoryThreadCaptureInput = {
    sessionId: input.sessionId,
    threadId: input.sessionId,
    threadTitle: toThreadTitle(input.messages),
    projectPath: input.projectPath,
    messages,
  }
  await memoryProviderManager.captureThread(captureInput)
  return captureInput
}
