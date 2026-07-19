import * as React from 'react'
import { DEFAULT_INTRINSIC_HEIGHT } from '@/lib/pretext/config'

export interface MessageHeightSnapshot {
  predicted: number
  actual?: number
}

type HeightState = Record<string, MessageHeightSnapshot>
type HeightEntry = readonly [id: string, height: number]

export function useMessageHeightRegistry(): {
  snapshots: HeightState
  setPredictedHeights: (entries: readonly HeightEntry[]) => void
  observeMessageElement: (id: string, node: HTMLElement | null) => void
  pruneMessageIds: (ids: string[]) => void
  getHeightPx: (id: string) => number
} {
  const [snapshots, setSnapshots] = React.useState<HeightState>({})
  const observerRef = React.useRef<ResizeObserver | null>(null)
  const elementsByIdRef = React.useRef(new Map<string, HTMLElement>())
  const idsByElementRef = React.useRef(new Map<HTMLElement, string>())

  const setPredictedHeights = React.useCallback((entries: readonly HeightEntry[]) => {
    if (entries.length === 0) return
    setSnapshots((prev) => {
      let next: HeightState | null = null
      for (const [id, predicted] of entries) {
        const current = prev[id]
        const nextPredicted = Math.max(1, Math.ceil(predicted))
        if (current?.predicted === nextPredicted) continue
        next ??= { ...prev }
        next[id] = {
          predicted: nextPredicted,
          actual: current?.actual,
        }
      }
      return next ?? prev
    })
  }, [])

  const ensureObserver = React.useCallback((): ResizeObserver | null => {
    if (observerRef.current || typeof ResizeObserver === 'undefined') {
      return observerRef.current
    }

    observerRef.current = new ResizeObserver((entries) => {
      const measurements: HeightEntry[] = []
      for (const entry of entries) {
        const id = idsByElementRef.current.get(entry.target as HTMLElement)
        if (!id) continue
        const height = Math.max(
          1,
          Math.ceil(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height),
        )
        measurements.push([id, height])
      }
      if (measurements.length === 0) return

      setSnapshots((prev) => {
        let next: HeightState | null = null
        for (const [id, actual] of measurements) {
          const current = prev[id] ?? { predicted: DEFAULT_INTRINSIC_HEIGHT }
          if (current.actual === actual) continue
          next ??= { ...prev }
          next[id] = { predicted: current.predicted, actual }
        }
        return next ?? prev
      })
    })
    return observerRef.current
  }, [])

  const observeMessageElement = React.useCallback((id: string, node: HTMLElement | null) => {
    const existing = elementsByIdRef.current.get(id)
    if (existing) {
      observerRef.current?.unobserve(existing)
      idsByElementRef.current.delete(existing)
      elementsByIdRef.current.delete(id)
    }

    if (!node) return
    const observer = ensureObserver()
    if (!observer) return
    elementsByIdRef.current.set(id, node)
    idsByElementRef.current.set(node, id)
    observer.observe(node)
  }, [ensureObserver])

  const pruneMessageIds = React.useCallback((ids: string[]) => {
    const visibleIds = new Set(ids)

    setSnapshots((prev) => {
      let changed = false
      const next: HeightState = {}
      for (const [id, snapshot] of Object.entries(prev)) {
        if (visibleIds.has(id)) {
          next[id] = snapshot
          continue
        }

        changed = true
        const element = elementsByIdRef.current.get(id)
        if (element) {
          observerRef.current?.unobserve(element)
          idsByElementRef.current.delete(element)
          elementsByIdRef.current.delete(id)
        }
      }
      return changed ? next : prev
    })
  }, [])

  React.useEffect(() => () => {
    observerRef.current?.disconnect()
    observerRef.current = null
    elementsByIdRef.current.clear()
    idsByElementRef.current.clear()
  }, [])

  const getHeightPx = React.useCallback((id: string) => {
    const snapshot = snapshots[id]
    return snapshot?.actual ?? snapshot?.predicted ?? DEFAULT_INTRINSIC_HEIGHT
  }, [snapshots])

  return {
    snapshots,
    setPredictedHeights,
    observeMessageElement,
    pruneMessageIds,
    getHeightPx,
  }
}
