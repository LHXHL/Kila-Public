import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { computePredictiveCaretMotion, type CaretSample } from './predictive-caret-motion'

const PREDICTIVE_CARET_ENABLED = true

export interface CaretVisualState {
  visible: boolean
  x: number
  y: number
  height: number
  durationMs: number
  tailScale: number
  tailOpacity: number
  tailDirection: -1 | 0 | 1
  useNativeCaret: boolean
}

interface UsePredictiveCaretOptions {
  editor: Editor | null
  hostElement: HTMLElement | null
  scrollElement: HTMLElement | null
  isComposing: boolean
  disabled?: boolean
}

const HIDDEN_CARET_STATE: CaretVisualState = {
  visible: false,
  x: 0,
  y: 0,
  height: 0,
  durationMs: 0,
  tailScale: 0.2,
  tailOpacity: 0.08,
  tailDirection: 0,
  useNativeCaret: true,
}

function hasChanged(a: CaretVisualState, b: CaretVisualState): boolean {
  return (
    a.visible !== b.visible ||
    a.x !== b.x ||
    a.y !== b.y ||
    a.height !== b.height ||
    a.durationMs !== b.durationMs ||
    a.tailScale !== b.tailScale ||
    a.tailOpacity !== b.tailOpacity ||
    a.tailDirection !== b.tailDirection ||
    a.useNativeCaret !== b.useNativeCaret
  )
}

export function usePredictiveCaret({
  editor,
  hostElement,
  scrollElement,
  isComposing,
  disabled = false,
}: UsePredictiveCaretOptions): CaretVisualState {
  const [visualState, setVisualState] = useState<CaretVisualState>(HIDDEN_CARET_STATE)
  const previousSampleRef = useRef<CaretSample | null>(null)
  const rafRef = useRef<number | null>(null)
  const settleTimerRef = useRef<number | null>(null)
  const syncVersionRef = useRef(0)

  const clearScheduled = useCallback(() => {
    if (rafRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (settleTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(settleTimerRef.current)
      settleTimerRef.current = null
    }
  }, [])

  const updateVisualState = useCallback((nextState: CaretVisualState) => {
    setVisualState((currentState) => (hasChanged(currentState, nextState) ? nextState : currentState))
  }, [])

  const hideCaret = useCallback(() => {
    clearScheduled()
    previousSampleRef.current = null
    syncVersionRef.current += 1
    updateVisualState(HIDDEN_CARET_STATE)
  }, [clearScheduled, updateVisualState])

  const readSample = useCallback((): CaretSample | null => {
    if (!PREDICTIVE_CARET_ENABLED || !editor || !hostElement || disabled || isComposing) {
      return null
    }

    if (!editor.isEditable || !editor.isFocused) {
      return null
    }

    const { selection } = editor.state
    if (!selection.empty) {
      return null
    }

    try {
      const caretRect = editor.view.coordsAtPos(selection.from)
      const hostRect = hostElement.getBoundingClientRect()
      const x = caretRect.left - hostRect.left
      const y = caretRect.top - hostRect.top
      const height = Math.max(1, caretRect.bottom - caretRect.top)

      if (![x, y, height].every(Number.isFinite)) {
        return null
      }

      return {
        x,
        y,
        height,
        ts: performance.now(),
      }
    } catch {
      return null
    }
  }, [disabled, editor, hostElement, isComposing])

  const syncCaret = useCallback((forceSnap = false) => {
    clearScheduled()

    const sample = readSample()
    if (!sample) {
      hideCaret()
      return
    }

    if (typeof window === 'undefined') {
      hideCaret()
      return
    }

    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null

      const motion = computePredictiveCaretMotion({
        previousSample: previousSampleRef.current,
        currentSample: sample,
        forceSnap,
      })

      previousSampleRef.current = sample
      const syncVersion = ++syncVersionRef.current

      updateVisualState({
        visible: true,
        x: motion.predictedTarget.x,
        y: motion.predictedTarget.y,
        height: motion.predictedTarget.height,
        durationMs: motion.durationMs,
        tailScale: motion.tailScale,
        tailOpacity: motion.tailOpacity,
        tailDirection: motion.tailDirection,
        useNativeCaret: false,
      })

      const needsSettle =
        !motion.shouldSnap &&
        (motion.predictedTarget.x !== motion.currentTarget.x || motion.predictedTarget.y !== motion.currentTarget.y)

      if (!needsSettle) {
        return
      }

      const settleDelay = Math.min(32, Math.max(16, Math.round(motion.durationMs / 2)))
      settleTimerRef.current = window.setTimeout(() => {
        if (syncVersionRef.current !== syncVersion) {
          return
        }

        setVisualState((currentState) => ({
          ...currentState,
          x: motion.currentTarget.x,
          y: motion.currentTarget.y,
          height: motion.currentTarget.height,
          durationMs: 56,
          tailScale: Math.min(currentState.tailScale, 0.4),
          tailOpacity: Math.min(currentState.tailOpacity, 0.12),
          tailDirection: 0,
        }))
      }, settleDelay)
    })
  }, [clearScheduled, hideCaret, readSample, updateVisualState])

  useEffect(() => {
    if (isComposing) {
      hideCaret()
      return
    }

    syncCaret(true)
  }, [hideCaret, isComposing, syncCaret])

  useEffect(() => {
    if (!editor) {
      hideCaret()
      return
    }

    const handleFocus = () => syncCaret(true)
    const handleBlur = () => hideCaret()
    const handleSelectionUpdate = () => syncCaret()
    const handleTransaction = () => syncCaret()
    const handleResize = () => syncCaret(true)
    const handleScroll = () => syncCaret(true)

    editor.on('focus', handleFocus)
    editor.on('blur', handleBlur)
    editor.on('selectionUpdate', handleSelectionUpdate)
    editor.on('transaction', handleTransaction)

    window.addEventListener('resize', handleResize)
    scrollElement?.addEventListener('scroll', handleScroll, { passive: true })

    let resizeObserver: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && hostElement) {
      resizeObserver = new ResizeObserver(() => syncCaret(true))
      resizeObserver.observe(hostElement)
    }

    syncCaret(true)

    return () => {
      clearScheduled()
      editor.off('focus', handleFocus)
      editor.off('blur', handleBlur)
      editor.off('selectionUpdate', handleSelectionUpdate)
      editor.off('transaction', handleTransaction)
      window.removeEventListener('resize', handleResize)
      scrollElement?.removeEventListener('scroll', handleScroll)
      resizeObserver?.disconnect()
    }
  }, [clearScheduled, editor, hideCaret, hostElement, scrollElement, syncCaret])

  useEffect(() => {
    if (disabled) {
      hideCaret()
    }
  }, [disabled, hideCaret])

  return visualState
}
