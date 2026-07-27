import { atom } from 'jotai'
import type { AskUserRequest, PermissionRequest } from '@kila/shared'

function upsertSessionQueue<T extends { requestId: string }>(
  prev: Map<string, readonly T[]>,
  sessionId: string,
  item: T,
): Map<string, readonly T[]> {
  const map = new Map(prev)
  const current = map.get(sessionId) ?? []
  if (current.some((entry) => entry.requestId === item.requestId)) {
    return prev
  }
  map.set(sessionId, [...current, item])
  return map
}

function removeRequestFromQueueMap<T extends { requestId: string }>(
  prev: Map<string, readonly T[]>,
  requestId: string,
): Map<string, readonly T[]> {
  let changed = false
  const map = new Map(prev)

  for (const [sessionId, queue] of map) {
    const nextQueue = queue.filter((item) => item.requestId !== requestId)
    if (nextQueue.length === queue.length) continue
    changed = true
    if (nextQueue.length === 0) {
      map.delete(sessionId)
    } else {
      map.set(sessionId, nextQueue)
    }
  }

  return changed ? map : prev
}

export function enqueuePendingPermissionRequestMap(
  prev: Map<string, readonly PermissionRequest[]>,
  request: PermissionRequest,
): Map<string, readonly PermissionRequest[]> {
  return upsertSessionQueue(prev, request.sessionId, request)
}

export function resolvePendingPermissionRequestMap(
  prev: Map<string, readonly PermissionRequest[]>,
  requestId: string,
): Map<string, readonly PermissionRequest[]> {
  return removeRequestFromQueueMap(prev, requestId)
}

export function enqueuePendingAskUserRequestMap(
  prev: Map<string, readonly AskUserRequest[]>,
  request: AskUserRequest,
): Map<string, readonly AskUserRequest[]> {
  return upsertSessionQueue(prev, request.sessionId, request)
}

export function resolvePendingAskUserRequestMap(
  prev: Map<string, readonly AskUserRequest[]>,
  requestId: string,
): Map<string, readonly AskUserRequest[]> {
  return removeRequestFromQueueMap(prev, requestId)
}

export function countPendingRequests(
  permissionMap: Map<string, readonly PermissionRequest[]>,
  askUserMap: Map<string, readonly AskUserRequest[]>,
): number {
  let total = 0
  for (const requests of permissionMap.values()) total += requests.length
  for (const requests of askUserMap.values()) total += requests.length
  return total
}

/** 待处理的权限请求 Map — 以 sessionId 为 key，切换会话时保留状态 */
export const allPendingPermissionRequestsAtom = atom<Map<string, readonly PermissionRequest[]>>(new Map())

/** 待处理的 AskUser 请求 Map — 以 sessionId 为 key，切换会话时保留状态 */
export const allPendingAskUserRequestsAtom = atom<Map<string, readonly AskUserRequest[]>>(new Map())

export const totalPendingRequestsAtom = atom<number>((get) => {
  return countPendingRequests(
    get(allPendingPermissionRequestsAtom),
    get(allPendingAskUserRequestsAtom),
  )
})
