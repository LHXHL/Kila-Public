import type { SessionMeta, SessionSendInput } from '@kila/shared'

interface SessionRuntimeObserver {
  onRunStart?: (session: SessionMeta, input: SessionSendInput) => Promise<void> | void
  onStream?: (channel: string, payload: unknown) => void
}

const observers = new Set<SessionRuntimeObserver>()

export function registerSessionRuntimeObserver(observer: SessionRuntimeObserver): () => void {
  observers.add(observer)
  return () => {
    observers.delete(observer)
  }
}

export async function emitSessionRuntimeRunStart(session: SessionMeta, input: SessionSendInput): Promise<void> {
  await Promise.all([...observers].map(async (observer) => {
    await observer.onRunStart?.(session, input)
  }))
}

export function emitSessionRuntimeStream(channel: string, payload: unknown): void {
  for (const observer of observers) {
    observer.onStream?.(channel, payload)
  }
}
