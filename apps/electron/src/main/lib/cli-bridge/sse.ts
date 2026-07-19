import type { ServerResponse } from 'node:http'
import type { CliRunSseEvent } from '@kila/shared'

export function initSse(response: ServerResponse): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  })
  response.flushHeaders()
}

export function writeSseEvent<T extends CliRunSseEvent['event']>(
  response: ServerResponse,
  event: T,
  data: Extract<CliRunSseEvent, { event: T }>['data'],
): void {
  if (response.writableEnded || response.destroyed) return
  response.write(`event: ${event}\n`)
  response.write(`data: ${JSON.stringify(data)}\n\n`)
}

export function closeSse(response: ServerResponse): void {
  if (!response.writableEnded) {
    response.end()
  }
}
