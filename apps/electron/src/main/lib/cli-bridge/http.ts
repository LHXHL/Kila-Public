import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CliBridgeErrorResponse } from '@kila/shared'

const JSON_BODY_LIMIT_BYTES = 1_000_000

export async function readJsonBody<T>(
  request: IncomingMessage,
  maxBytes = JSON_BODY_LIMIT_BYTES,
): Promise<T> {
  const chunks: Buffer[] = []
  let totalBytes = 0

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.length
    if (totalBytes > maxBytes) {
      throw new Error('请求体过大')
    }
    chunks.push(buffer)
  }

  if (chunks.length === 0) {
    throw new Error('缺少 JSON 请求体')
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as T
  } catch {
    throw new Error('JSON 请求体格式无效')
  }
}

export function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  if (response.writableEnded) return

  const body = JSON.stringify(payload)
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

export function sendError(
  response: ServerResponse,
  statusCode: number,
  error: string,
): void {
  sendJson(response, statusCode, { error } satisfies CliBridgeErrorResponse)
}

export function sendMethodNotAllowed(
  response: ServerResponse,
  allowedMethods: string[],
): void {
  if (response.writableEnded) return

  response.setHeader('allow', allowedMethods.join(', '))
  sendError(response, 405, 'Method Not Allowed')
}

export function parseLimitParam(
  rawValue: string | null,
  fallback: number,
  max = 500,
): number {
  if (!rawValue) return fallback

  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return Math.min(Math.trunc(parsed), max)
}
