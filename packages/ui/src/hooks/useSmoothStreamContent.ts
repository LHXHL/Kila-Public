/**
 * useSmoothStreamContent — 自适应 CPS 流式平滑引擎
 *
 * 对标 LobeHub lobe-ui 的 useSmoothStreamContent：
 * https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/useSmoothStreamContent.ts
 *
 * 核心机制：
 * 1. EMA 跟踪上游到达速率，动态调整输出 CPS
 * 2. 三档 preset (realtime/balanced/silky) 适配不同体验偏好
 * 3. targetBufferMs 保持延迟缓冲，避免输出追平输入后空转
 * 4. settle drain 限时排空：上游停止后在 min-max 范围内渐进排空
 * 5. scheduleFrameWake：input 安静但 backlog 未排空时 setTimeout 唤醒而非空转 rAF
 * 6. 大段追加（> largeAppendChars）直接同步输出
 * 7. 非追加（内容重置）直接同步
 */

import { useCallback, useEffect, useRef, useState } from 'react'

// ===== Types =====

export type StreamSmoothingPreset = 'balanced' | 'realtime' | 'silky'

interface StreamSmoothingPresetConfig {
  activeInputWindowMs: number
  bypassFencedLanguages: readonly string[]
  defaultCps: number
  emaAlpha: number
  flushCps: number
  largeAppendChars: number
  maxActiveCps: number
  maxCps: number
  maxFlushCps: number
  minCps: number
  settleAfterMs: number
  settleDrainMaxMs: number
  settleDrainMinMs: number
  targetBufferMs: number
}

// ===== Preset Config =====

const DEFAULT_BYPASS_LANGUAGES = ['html', 'mermaid'] as const

const PRESET_CONFIG: Record<StreamSmoothingPreset, StreamSmoothingPresetConfig> = {
  balanced: {
    activeInputWindowMs: 220,
    bypassFencedLanguages: DEFAULT_BYPASS_LANGUAGES,
    defaultCps: 38,
    emaAlpha: 0.2,
    flushCps: 120,
    largeAppendChars: 120,
    maxActiveCps: 132,
    maxCps: 72,
    maxFlushCps: 280,
    minCps: 18,
    settleAfterMs: 360,
    settleDrainMaxMs: 520,
    settleDrainMinMs: 180,
    targetBufferMs: 120,
  },
  realtime: {
    activeInputWindowMs: 140,
    bypassFencedLanguages: DEFAULT_BYPASS_LANGUAGES,
    defaultCps: 50,
    emaAlpha: 0.3,
    flushCps: 170,
    largeAppendChars: 180,
    maxActiveCps: 180,
    maxCps: 96,
    maxFlushCps: 360,
    minCps: 24,
    settleAfterMs: 260,
    settleDrainMaxMs: 360,
    settleDrainMinMs: 140,
    targetBufferMs: 40,
  },
  silky: {
    activeInputWindowMs: 320,
    bypassFencedLanguages: DEFAULT_BYPASS_LANGUAGES,
    defaultCps: 28,
    emaAlpha: 0.14,
    flushCps: 96,
    largeAppendChars: 100,
    maxActiveCps: 102,
    maxCps: 56,
    maxFlushCps: 220,
    minCps: 14,
    settleAfterMs: 460,
    settleDrainMaxMs: 680,
    settleDrainMinMs: 240,
    targetBufferMs: 170,
  },
}

// ===== Utilities =====

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const getNow = (): number =>
  typeof performance === 'undefined' ? Date.now() : performance.now()

/** 字符计数（使用 spread 正确处理 surrogate pairs） */
export const countChars = (text: string): number => [...text].length

function findOpenFenceLanguage(content: string): string | null {
  let inFence = false
  let language = ''
  let index = 0
  const length = content.length

  while (index < length) {
    const newlineIndex = content.indexOf('\n', index)
    const lineEnd = newlineIndex === -1 ? length : newlineIndex
    const line = content.slice(index, lineEnd)

    if (line.startsWith('```')) {
      if (inFence) {
        inFence = false
        language = ''
      } else {
        inFence = true
        language = line.slice(3).trim().toLowerCase()
      }
    }

    if (newlineIndex === -1) break
    index = newlineIndex + 1
  }

  return inFence ? language : null
}

// ===== Hook =====

export interface UseSmoothStreamContentOptions {
  enabled?: boolean
  preset?: StreamSmoothingPreset
}

/**
 * 自适应 CPS 流式平滑 hook
 *
 * @param content 原始流式内容（每次 chunk 累积后的完整文本）
 * @param options 配置选项
 * @returns 平滑后的显示内容
 */
export const useSmoothStreamContent = (
  content: string,
  { enabled = true, preset = 'balanced' }: UseSmoothStreamContentOptions = {},
): string => {
  const config = PRESET_CONFIG[preset]
  const [displayedContent, setDisplayedContent] = useState(content)

  // 已展示状态
  const displayedContentRef = useRef(content)
  const displayedCountRef = useRef(countChars(content))

  // 目标状态
  const targetContentRef = useRef(content)
  const targetCharsRef = useRef([...content])
  const targetCountRef = useRef(targetCharsRef.current.length)

  // EMA 跟踪
  const emaCpsRef = useRef(config.defaultCps)
  const lastInputTsRef = useRef(0)
  const lastInputCountRef = useRef(targetCountRef.current)
  const chunkSizeEmaRef = useRef(1)
  const arrivalCpsEmaRef = useRef(config.defaultCps)

  // 调度状态
  const rafRef = useRef<number | null>(null)
  const lastFrameTsRef = useRef<number | null>(null)
  const wakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ===== 调度控制 =====

  const clearWakeTimer = useCallback(() => {
    if (wakeTimerRef.current !== null) {
      clearTimeout(wakeTimerRef.current)
      wakeTimerRef.current = null
    }
  }, [])

  const stopFrameLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    lastFrameTsRef.current = null
  }, [])

  const stopScheduling = useCallback(() => {
    stopFrameLoop()
    clearWakeTimer()
  }, [clearWakeTimer, stopFrameLoop])

  const startFrameLoopRef = useRef<() => void>(() => {})

  const scheduleFrameWake = useCallback(
    (delayMs: number) => {
      clearWakeTimer()
      wakeTimerRef.current = setTimeout(
        () => {
          wakeTimerRef.current = null
          startFrameLoopRef.current()
        },
        Math.max(1, Math.ceil(delayMs)),
      )
    },
    [clearWakeTimer],
  )

  // ===== 同步立即输出（重置/大段追加） =====

  const syncImmediate = useCallback(
    (nextContent: string) => {
      stopScheduling()

      const chars = [...nextContent]
      const now = getNow()

      targetContentRef.current = nextContent
      targetCharsRef.current = chars
      targetCountRef.current = chars.length

      displayedContentRef.current = nextContent
      displayedCountRef.current = chars.length
      setDisplayedContent(nextContent)

      emaCpsRef.current = config.defaultCps
      chunkSizeEmaRef.current = 1
      arrivalCpsEmaRef.current = config.defaultCps
      lastInputTsRef.current = now
      lastInputCountRef.current = chars.length
    },
    [config.defaultCps, stopScheduling],
  )

  // ===== 帧循环 =====

  const startFrameLoop = useCallback(() => {
    clearWakeTimer()
    if (rafRef.current !== null) return

    const tick = (ts: number): void => {
      if (lastFrameTsRef.current === null) {
        lastFrameTsRef.current = ts
        rafRef.current = requestAnimationFrame(tick)
        return
      }

      const frameIntervalMs = Math.max(0, ts - lastFrameTsRef.current)
      const dtSeconds = Math.max(0.001, Math.min(frameIntervalMs / 1000, 0.05))
      lastFrameTsRef.current = ts

      const targetCount = targetCountRef.current
      const displayedCount = displayedCountRef.current
      const backlog = targetCount - displayedCount

      if (backlog <= 0) {
        stopFrameLoop()
        return
      }

      const now = getNow()
      const idleMs = now - lastInputTsRef.current
      const inputActive = idleMs <= config.activeInputWindowMs
      const settling = !inputActive && idleMs >= config.settleAfterMs

      // CPS 基线
      const baseCps = clamp(emaCpsRef.current, config.minCps, config.maxCps)
      const baseLagChars = Math.max(1, Math.round((baseCps * config.targetBufferMs) / 1000))
      const lagUpperBound = Math.max(baseLagChars + 2, baseLagChars * 3)
      const targetLagChars = inputActive
        ? Math.round(
            clamp(baseLagChars + chunkSizeEmaRef.current * 0.35, baseLagChars, lagUpperBound),
          )
        : 0
      const desiredDisplayed = Math.max(0, targetCount - targetLagChars)

      let currentCps: number
      if (inputActive) {
        const backlogPressure = targetLagChars > 0 ? backlog / targetLagChars : 1
        const chunkPressure = targetLagChars > 0 ? chunkSizeEmaRef.current / targetLagChars : 1
        const arrivalPressure = arrivalCpsEmaRef.current / Math.max(baseCps, 1)
        const combinedPressure = clamp(
          backlogPressure * 0.6 + chunkPressure * 0.25 + arrivalPressure * 0.15,
          1,
          4.5,
        )
        const activeCap = clamp(
          config.maxActiveCps + chunkSizeEmaRef.current * 6,
          config.maxActiveCps,
          config.maxFlushCps,
        )
        currentCps = clamp(baseCps * combinedPressure, config.minCps, activeCap)
      } else if (settling) {
        const drainTargetMs = clamp(backlog * 8, config.settleDrainMinMs, config.settleDrainMaxMs)
        const settleCps = (backlog * 1000) / drainTargetMs
        currentCps = clamp(settleCps, config.flushCps, config.maxFlushCps)
      } else {
        const idleFlushCps = Math.max(
          config.flushCps,
          baseCps * 1.8,
          arrivalCpsEmaRef.current * 0.8,
        )
        currentCps = clamp(idleFlushCps, config.flushCps, config.maxFlushCps)
      }

      // 本帧揭示字符数
      const urgentBacklog = inputActive && targetLagChars > 0 && backlog > targetLagChars * 2.2
      const burstyInput = inputActive && chunkSizeEmaRef.current >= targetLagChars * 0.9
      const minRevealChars = inputActive ? (urgentBacklog || burstyInput ? 2 : 1) : 2
      let revealChars = Math.max(minRevealChars, Math.round(currentCps * dtSeconds))

      if (inputActive) {
        const shortfall = desiredDisplayed - displayedCount
        if (shortfall <= 0) {
          // 已追上目标延迟 → 暂停帧循环，setTimeout 唤醒
          stopFrameLoop()
          scheduleFrameWake(config.activeInputWindowMs - idleMs)
          return
        }
        revealChars = Math.min(revealChars, shortfall, backlog)
      } else {
        revealChars = Math.min(revealChars, backlog)
      }

      const nextCount = displayedCount + revealChars
      const segment = targetCharsRef.current.slice(displayedCount, nextCount).join('')

      if (segment) {
        const nextDisplayed = displayedContentRef.current + segment
        displayedContentRef.current = nextDisplayed
        displayedCountRef.current = nextCount
        setDisplayedContent(nextDisplayed)
      } else {
        displayedContentRef.current = targetContentRef.current
        displayedCountRef.current = targetCount
        setDisplayedContent(targetContentRef.current)
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
  }, [
    clearWakeTimer,
    config.activeInputWindowMs,
    config.flushCps,
    config.maxActiveCps,
    config.maxCps,
    config.maxFlushCps,
    config.minCps,
    config.settleAfterMs,
    config.settleDrainMaxMs,
    config.settleDrainMinMs,
    config.targetBufferMs,
    scheduleFrameWake,
    stopFrameLoop,
  ])
  startFrameLoopRef.current = startFrameLoop

  // ===== 内容变化检测 =====

  useEffect(() => {
    if (!enabled) {
      syncImmediate(content)
      return
    }

    const prevTargetContent = targetContentRef.current
    if (content === prevTargetContent) return

    const now = getNow()
    const appendOnly = content.startsWith(prevTargetContent)

    if (!appendOnly) {
      syncImmediate(content)
      return
    }

    const openFenceLanguage = findOpenFenceLanguage(content)
    if (openFenceLanguage !== null && config.bypassFencedLanguages.includes(openFenceLanguage)) {
      syncImmediate(content)
      return
    }

    const appended = content.slice(prevTargetContent.length)
    const appendedChars = [...appended]
    const appendedCount = appendedChars.length

    // 大段追加 → 同步输出
    if (appendedCount > config.largeAppendChars) {
      syncImmediate(content)
      return
    }

    // 追加到目标
    targetContentRef.current = content
    targetCharsRef.current = [...targetCharsRef.current, ...appendedChars]
    targetCountRef.current += appendedCount

    // 更新 EMA
    const deltaChars = targetCountRef.current - lastInputCountRef.current
    const deltaMs = Math.max(1, now - lastInputTsRef.current)

    if (deltaChars > 0) {
      const instantCps = (deltaChars * 1000) / deltaMs
      const normalizedInstantCps = clamp(instantCps, config.minCps, config.maxFlushCps * 2)
      const chunkEmaAlpha = 0.35
      chunkSizeEmaRef.current =
        chunkSizeEmaRef.current * (1 - chunkEmaAlpha) + appendedCount * chunkEmaAlpha
      arrivalCpsEmaRef.current =
        arrivalCpsEmaRef.current * (1 - chunkEmaAlpha) + normalizedInstantCps * chunkEmaAlpha

      const clampedCps = clamp(instantCps, config.minCps, config.maxActiveCps)
      emaCpsRef.current = emaCpsRef.current * (1 - config.emaAlpha) + clampedCps * config.emaAlpha
    }

    lastInputTsRef.current = now
    lastInputCountRef.current = targetCountRef.current

    startFrameLoop()
  }, [
    config.emaAlpha,
    config.largeAppendChars,
    config.maxActiveCps,
    config.maxCps,
    config.maxFlushCps,
    config.minCps,
    content,
    enabled,
    startFrameLoop,
    syncImmediate,
  ])

  // ===== 清理 =====

  useEffect(() => {
    return () => {
      stopScheduling()
    }
  }, [stopScheduling])

  return displayedContent
}
