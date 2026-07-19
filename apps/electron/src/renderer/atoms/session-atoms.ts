/**
 * Session atoms
 *
 * 单一 Session 列表与当前会话状态。
 */

import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { SessionMeta } from '@kila/shared'
import type { SessionFileWorkbenchState, SessionWorkbenchViewMode } from '@/components/session/session-file-workbench-state'
import type { SessionWebPreviewState } from '@/components/session/session-web-preview-state'
import {
  createEmptyWorkbenchState,
  SESSION_SIDE_PANEL_WIDTH_DEFAULT,
  SESSION_WORKBENCH_EXPLORER_WIDTH_DEFAULT,
} from '@/components/session/session-file-workbench-state'
import { createEmptySessionWebPreviewState } from '@/components/session/session-web-preview-state'

export const sessionsAtom = atom<SessionMeta[]>([])

export const currentSessionIdAtom = atom<string | null>(null)

/** 当前会话右侧文件工作台状态（per-session） */
export const sessionFileWorkbenchStateMapAtom = atom<Map<string, SessionFileWorkbenchState>>(new Map())

/** 当前会话右侧网页预览状态（per-session, renderer-only） */
export const sessionWebPreviewStateMapAtom = atom<Map<string, SessionWebPreviewState>>(new Map())

/** 右侧工作面板宽度（全局持久化） */
export const sessionSidePanelWidthAtom = atomWithStorage<number>(
  'kila-session-side-panel-width',
  SESSION_SIDE_PANEL_WIDTH_DEFAULT,
)

/** 文件工作台内层 Explorer 宽度（全局持久化） */
export const sessionWorkbenchExplorerWidthAtom = atomWithStorage<number>(
  'kila-session-workbench-explorer-width',
  SESSION_WORKBENCH_EXPLORER_WIDTH_DEFAULT,
)

export type SessionFileWorkbenchStateUpdate =
  SessionFileWorkbenchState
  | ((prev: SessionFileWorkbenchState) => SessionFileWorkbenchState)

export const sessionFileWorkbenchStateAtom = atom(
  (get): SessionFileWorkbenchState => {
    const sessionId = get(currentSessionIdAtom)
    if (!sessionId) return createEmptyWorkbenchState()
    return get(sessionFileWorkbenchStateMapAtom).get(sessionId) ?? createEmptyWorkbenchState()
  },
  (get, set, update: SessionFileWorkbenchStateUpdate) => {
    const sessionId = get(currentSessionIdAtom)
    if (!sessionId) return

    set(sessionFileWorkbenchStateMapAtom, (prev) => {
      const map = new Map(prev)
      const current = map.get(sessionId) ?? createEmptyWorkbenchState()
      const next = typeof update === 'function'
        ? (update as (prev: SessionFileWorkbenchState) => SessionFileWorkbenchState)(current)
        : update

      if (!next.activeItem && next.viewMode === 'preview' && next.recentFiles.length === 0) {
        map.delete(sessionId)
      } else {
        map.set(sessionId, next)
      }
      return map
    })
  },
)

export const sessionWorkbenchViewModeAtom = atom<SessionWorkbenchViewMode>((get) => {
  return get(sessionFileWorkbenchStateAtom).viewMode
})

export const currentSessionAtom = atom<SessionMeta | null>((get) => {
  const currentId = get(currentSessionIdAtom)
  if (!currentId) return null
  return get(sessionsAtom).find((session) => session.id === currentId) ?? null
})

export const sessionWebPreviewStateAtom = atom(
  (get): SessionWebPreviewState => {
    const sessionId = get(currentSessionIdAtom)
    if (!sessionId) return createEmptySessionWebPreviewState()
    return get(sessionWebPreviewStateMapAtom).get(sessionId) ?? createEmptySessionWebPreviewState()
  },
  (get, set, update: SessionWebPreviewState | ((prev: SessionWebPreviewState) => SessionWebPreviewState)) => {
    const sessionId = get(currentSessionIdAtom)
    if (!sessionId) return

    set(sessionWebPreviewStateMapAtom, (prev) => {
      const map = new Map(prev)
      const current = map.get(sessionId) ?? createEmptySessionWebPreviewState()
      const next = typeof update === 'function'
        ? (update as (prev: SessionWebPreviewState) => SessionWebPreviewState)(current)
        : update

      if (next.currentUrl === null
        && next.draftUrl === ''
        && next.serverStatus === 'idle'
        && next.serverBaseUrl === null
        && next.lastPreviewedFilePath === null
        && next.lastError === null
      ) {
        map.delete(sessionId)
      } else {
        map.set(sessionId, next)
      }
      return map
    })
  },
)
