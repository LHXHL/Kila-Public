import type { IncomingMessage, ServerResponse } from 'node:http'
import { sendJson } from './http'

function readBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) return null

  const match = headerValue.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

export function isAuthorizedRequest(
  request: IncomingMessage,
  expectedToken: string,
): boolean {
  const headerValue = request.headers.authorization
  const token = Array.isArray(headerValue) ? headerValue[0] : headerValue
  return readBearerToken(token) === expectedToken
}

export function ensureAuthorizedRequest(
  request: IncomingMessage,
  response: ServerResponse,
  expectedToken: string,
): boolean {
  if (isAuthorizedRequest(request, expectedToken)) {
    return true
  }

  sendJson(response, 401, { error: 'Unauthorized' })
  return false
}
