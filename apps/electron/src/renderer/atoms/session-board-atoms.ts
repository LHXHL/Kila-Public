import { atom } from 'jotai'
import type { SessionPinnedWidget } from '@kila/shared'

export const sessionPinnedWidgetsMapAtom = atom<Map<string, SessionPinnedWidget[]>>(new Map())

export const setSessionPinnedWidgetsAtom = atom(
  null,
  (_get, set, input: { sessionId: string; widgets: SessionPinnedWidget[] }) => {
    set(sessionPinnedWidgetsMapAtom, (prev) => {
      const map = new Map(prev)
      if (input.widgets.length === 0) {
        map.delete(input.sessionId)
      } else {
        map.set(input.sessionId, [...input.widgets].sort((a, b) => b.createdAt - a.createdAt))
      }
      return map
    })
  },
)

export const upsertSessionPinnedWidgetAtom = atom(
  null,
  (get, set, widget: SessionPinnedWidget) => {
    const existing = get(sessionPinnedWidgetsMapAtom).get(widget.sessionId) ?? []
    const next = [widget, ...existing.filter((item) => item.id !== widget.id)]
      .sort((a, b) => b.createdAt - a.createdAt)
    set(sessionPinnedWidgetsMapAtom, (prev) => {
      const map = new Map(prev)
      map.set(widget.sessionId, next)
      return map
    })
  },
)

export const removeSessionPinnedWidgetAtom = atom(
  null,
  (get, set, input: { sessionId: string; pinId: string }) => {
    const existing = get(sessionPinnedWidgetsMapAtom).get(input.sessionId) ?? []
    const next = existing.filter((widget) => widget.id !== input.pinId)
    set(sessionPinnedWidgetsMapAtom, (prev) => {
      const map = new Map(prev)
      if (next.length === 0) {
        map.delete(input.sessionId)
      } else {
        map.set(input.sessionId, next)
      }
      return map
    })
  },
)

export const cleanupSessionPinnedWidgetsAtom = atom(
  null,
  (_get, set, sessionId: string) => {
    set(sessionPinnedWidgetsMapAtom, (prev) => {
      if (!prev.has(sessionId)) return prev
      const map = new Map(prev)
      map.delete(sessionId)
      return map
    })
  },
)
