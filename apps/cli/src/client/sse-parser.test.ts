import { describe, expect, test } from 'bun:test'
import { TextEncoder } from 'node:util'
import { parseSseStream } from './sse-parser'

describe('cli sse parser', () => {
  test('parses multiple events across chunk boundaries', async () => {
    const encoder = new TextEncoder()
    const chunks = [
      encoder.encode('event: session_created\ndata: {"session":{"id":"s1","title":"t","projectPath":"/tmp","createdAt":1,"updatedAt":1,"messageCount":0}}\n\n'),
      encoder.encode('event: session_complete\ndata: {"sessionId":"s1","reason":"completed"}\n\n'),
    ]

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk)
        }
        controller.close()
      },
    })

    const events = []
    for await (const event of parseSseStream(stream)) {
      events.push(event)
    }

    expect(events.map((event) => event.event)).toEqual([
      'session_created',
      'session_complete',
    ])
    expect(events[1]).toEqual({
      event: 'session_complete',
      data: { sessionId: 's1', reason: 'completed' },
    })
  })
})
