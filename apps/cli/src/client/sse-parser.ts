import type { CliRunSseEvent } from '@kila/shared'
import { isCliBridgeSseEventName } from '@kila/shared'

interface RawSseEvent {
  event: string
  data: string
}

function parseEventChunk(chunk: string): RawSseEvent | null {
  const lines = chunk.split(/\r?\n/)
  let eventName = 'message'
  const dataLines: string[] = []

  for (const line of lines) {
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim()
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart())
    }
  }

  if (dataLines.length === 0) {
    return null
  }

  return {
    event: eventName,
    data: dataLines.join('\n'),
  }
}

export async function *parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<CliRunSseEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    while (true) {
      const separatorIndex = buffer.indexOf('\n\n')
      if (separatorIndex === -1) break

      const chunk = buffer.slice(0, separatorIndex)
      buffer = buffer.slice(separatorIndex + 2)
      const parsed = parseEventChunk(chunk)
      if (!parsed || !isCliBridgeSseEventName(parsed.event)) {
        continue
      }

      yield {
        event: parsed.event,
        data: JSON.parse(parsed.data),
      } as CliRunSseEvent
    }
  }

  const trailing = buffer.trim()
  if (!trailing) return

  const parsed = parseEventChunk(trailing)
  if (!parsed || !isCliBridgeSseEventName(parsed.event)) {
    return
  }

  yield {
    event: parsed.event,
    data: JSON.parse(parsed.data),
  } as CliRunSseEvent
}
