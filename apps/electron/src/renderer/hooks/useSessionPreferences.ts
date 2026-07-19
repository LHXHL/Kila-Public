/**
 * useSessionPreferences — per-session 设置读写 hooks
 *
 * 需要持久化到 session metadata 的设置直接读写 `sessionsAtom`，
 * 其他 UI 偏好仍保留在 renderer map atoms 中。
 * 通过 SessionContext 获取 sessionId，避免 props 透传。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useSessionId, useSessionIdOptional } from '@/contexts/session-context'
import {
  selectedModelAtom,
  sessionModelPreferencesAtom,
  sessionParallelModePreferencesAtom,
} from '@/atoms/session-preference-atoms'
import type { SelectedModel, ContextLengthValue } from '@/atoms/session-preference-atoms'
import type { ThinkingLevel } from '@kila/shared'
import { sessionsAtom } from '@/atoms/session-atoms'

// ===== 通用 Map 读写辅助 =====

function resolveContextLengthValue(value: number | 'infinite' | undefined): ContextLengthValue {
  if (value === 'infinite') return value
  if (value === 0 || value === 5 || value === 10 || value === 15 || value === 20) {
    return value
  }
  return 20
}

type MapAtom<T> = ReturnType<typeof import('jotai').atom<Map<string, T>>>

function useMapValue<T>(mapAtom: MapAtom<T>, key: string, defaultValue: T): T {
  const map = useAtomValue(mapAtom)
  return map.get(key) ?? defaultValue
}

function useMapSetter<T>(
  mapAtom: MapAtom<T>,
  key: string,
): (value: T | ((prev: T) => T)) => void {
  const setMap = useSetAtom(mapAtom)
  return React.useCallback(
    (value: T | ((prev: T) => T)) => {
      setMap((prev) => {
        const map = new Map(prev)
        if (typeof value === 'function') {
          const current = map.get(key)
          map.set(key, (value as (prev: T) => T)(current as T))
        } else {
          map.set(key, value)
        }
        return map
      })
    },
    [key, setMap],
  )
}

// ===== Per-session Hooks =====

/** 每个 session独立的模型选择 */
export function useSessionModelPreference(): [SelectedModel | null, (m: SelectedModel | null) => void] {
  const sessionId = useSessionId()
  const defaultModel = useAtomValue(selectedModelAtom)
  const value = useMapValue(sessionModelPreferencesAtom, sessionId, defaultModel)
  const setter = useMapSetter(sessionModelPreferencesAtom, sessionId)
  return [value, setter]
}

/** 可选版本：在 Provider 外返回 null（ModelSelector 双模式用） */
export function useSessionModelPreferenceOptional(): [SelectedModel | null, ((m: SelectedModel | null) => void) | null] {
  const sessionId = useSessionIdOptional()
  const defaultModel = useAtomValue(selectedModelAtom)
  const map = useAtomValue(sessionModelPreferencesAtom)
  const setMap = useSetAtom(sessionModelPreferencesAtom)

  const value = sessionId ? (map.get(sessionId) ?? defaultModel) : null

  const setter = React.useCallback(
    (model: SelectedModel | null) => {
      if (!sessionId) return
      setMap((prev) => {
        const m = new Map(prev)
        m.set(sessionId, model)
        return m
      })
    },
    [sessionId, setMap],
  )

  return [value, sessionId ? setter : null]
}

/** 每个 session独立的上下文长度 */
export function useSessionContextLengthPreference(): [ContextLengthValue, (v: ContextLengthValue) => void] {
  const sessionId = useSessionId()
  const sessions = useAtomValue(sessionsAtom)
  const setSessions = useSetAtom(sessionsAtom)
  const session = sessions.find((item) => item.id === sessionId) ?? null
  const value = resolveContextLengthValue(session?.historyTurns)

  const setter = React.useCallback((nextValue: ContextLengthValue) => {
    setSessions((prev) => prev.map((item) => (
      item.id === sessionId
        ? { ...item, historyTurns: nextValue, updatedAt: Date.now() }
        : item
    )))

    window.electronAPI.updateSessionMeta(sessionId, {
      historyTurns: nextValue,
    }).then((updated) => {
      setSessions((prev) => prev.map((item) => (
        item.id === updated.id ? updated : item
      )))
    }).catch((error) => {
      console.error('[useSessionContextLengthPreference] 更新会话上下文长度失败:', error)
      window.electronAPI.listSessions().then(setSessions).catch(console.error)
    })
  }, [sessionId, setSessions])

  return [value, setter]
}

/** 每个 session独立的思考等级 */
export function useSessionThinkingLevelPreference(): [ThinkingLevel, (v: ThinkingLevel) => void] {
  const sessionId = useSessionId()
  const sessions = useAtomValue(sessionsAtom)
  const setSessions = useSetAtom(sessionsAtom)
  const session = sessions.find((item) => item.id === sessionId) ?? null
  const value = session?.thinkingLevel ?? 'none'

  const setter = React.useCallback((nextValue: ThinkingLevel) => {
    setSessions((prev) => prev.map((item) => (
      item.id === sessionId
        ? { ...item, thinkingLevel: nextValue, updatedAt: Date.now() }
        : item
    )))

    window.electronAPI.updateSessionMeta(sessionId, {
      thinkingLevel: nextValue,
    }).then((updated) => {
      setSessions((prev) => prev.map((item) => (
        item.id === updated.id ? updated : item
      )))
    }).catch((error) => {
      console.error('[useSessionThinkingLevelPreference] 更新会话思考强度失败:', error)
      window.electronAPI.listSessions().then(setSessions).catch(console.error)
    })
  }, [sessionId, setSessions])

  return [value, setter]
}

/** 每个 session独立的思考模式（旧布尔接口，兼容保留） */
export function useSessionThinkingEnabledPreference(): [boolean, (v: boolean) => void] {
  const [thinkingLevel, setThinkingLevel] = useSessionThinkingLevelPreference()
  return [
    thinkingLevel !== 'none',
    React.useCallback((enabled: boolean) => {
      setThinkingLevel(enabled ? 'medium' : 'none')
    }, [setThinkingLevel]),
  ]
}

/** 每个 session独立的并排模式 */
export function useSessionParallelModePreference(): [boolean, (v: boolean) => void] {
  const sessionId = useSessionId()
  const value = useMapValue(sessionParallelModePreferencesAtom, sessionId, false)
  const setter = useMapSetter(sessionParallelModePreferencesAtom, sessionId)
  return [value, setter]
}

/** 每个 session独立的系统提示词覆盖 */
export function useSessionSystemPromptPreference(): [string | null | undefined, (v: string | null | undefined) => void] {
  const sessionId = useSessionId()
  const sessions = useAtomValue(sessionsAtom)
  const setSessions = useSetAtom(sessionsAtom)
  const session = sessions.find((item) => item.id === sessionId) ?? null
  const value = session?.systemPromptId

  const setter = React.useCallback((nextValue: string | null | undefined) => {
    setSessions((prev) => prev.map((item) => (
      item.id === sessionId
        ? { ...item, systemPromptId: nextValue, updatedAt: Date.now() }
        : item
    )))

    window.electronAPI.updateSessionMeta(sessionId, {
      systemPromptId: nextValue,
    }).then((updated) => {
      setSessions((prev) => prev.map((item) => (
        item.id === updated.id ? updated : item
      )))
    }).catch((error) => {
      console.error('[useSessionSystemPromptPreference] 更新会话提示词失败:', error)
      window.electronAPI.listSessions().then(setSessions).catch(console.error)
    })
  }, [sessionId, setSessions])

  return [value, setter]
}
