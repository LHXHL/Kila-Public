import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CliBridgePersonalityUpdateRequest } from '@kila/shared'
import { readJsonBody, sendJson } from '../http'
import { getPersonalityState, updatePersonality } from '../../personality-manager'

export function handleCliBridgePersonality(
  response: ServerResponse,
  kind: 'soul' | 'user',
): void {
  const state = getPersonalityState()
  sendJson(response, 200, {
    document: kind === 'soul' ? state.soul : state.user,
  })
}

export async function handleCliBridgeUpdatePersonality(
  request: IncomingMessage,
  response: ServerResponse,
  kind: 'soul' | 'user',
): Promise<void> {
  const body = await readJsonBody<CliBridgePersonalityUpdateRequest>(request)
  if (typeof body.content !== 'string') {
    throw new Error('content 必须是字符串')
  }

  sendJson(response, 200, {
    document: updatePersonality({
      kind,
      content: body.content,
    }),
  })
}
