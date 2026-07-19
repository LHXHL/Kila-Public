/**
 * useStreamQueue — Block 级四态状态机
 *
 * 对标 LobeHub lobe-ui：
 * https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/useStreamQueue.ts
 *
 * 管理 block 的渲染生命周期：queued → streaming/animating → revealed
 *
 * 关键机制：
 * - 同步提升：新 block 到来时，前 streaming block 瞬间提升为 revealed（不经过 animating）
 * - charDelay 动态加速：队列压力大时加速淡入
 * - animating block 通过 setTimeout 计时后提升为 revealed
 */

import { useCallback, useEffect, useRef, useState } from 'react'

// ===== Types =====

export interface BlockInfo {
  content: string
  startOffset: number
}

export type BlockState = 'revealed' | 'animating' | 'streaming' | 'queued'

// ===== Constants =====

const BASE_DELAY = 18
const ACCELERATION_FACTOR = 0.3
const MAX_BLOCK_DURATION = 3000
const FADE_DURATION = 280

// ===== Utilities =====

function countChars(text: string): number {
  return [...text].length
}

function computeCharDelay(queueLength: number, charCount: number): number {
  const acceleration = 1 + queueLength * ACCELERATION_FACTOR
  let delay = BASE_DELAY / acceleration
  delay = Math.min(delay, MAX_BLOCK_DURATION / Math.max(charCount, 1))
  return delay
}

// ===== Hook =====

export interface UseStreamQueueReturn {
  charDelay: number
  getBlockState: (index: number) => BlockState
  queueLength: number
}

export function useStreamQueue(blocks: BlockInfo[]): UseStreamQueueReturn {
  const [revealedCount, setRevealedCount] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevBlocksLenRef = useRef(0)
  const minRevealedRef = useRef(0)

  // 初始挂载检测：组件重挂载时（如切换对话后切回），已有 block 直接标记 revealed
  // 避免已显示的文字重新走 fade-in 动画
  const initializedRef = useRef(false)
  if (!initializedRef.current && blocks.length > 0) {
    initializedRef.current = true
    // 所有已有 block 除尾部外直接 revealed
    minRevealedRef.current = Math.max(0, blocks.length - 1)
  }

  // 同步自动提升（render 阶段执行，非 effect）
  // 当 blocks 增长时，前 streaming block 瞬间提升为 revealed
  // 其字符已通过 stream-mode 动画可见，无需重新 stagger
  if (blocks.length === 0 && prevBlocksLenRef.current !== 0) {
    minRevealedRef.current = 0
    initializedRef.current = false
  }
  if (blocks.length > prevBlocksLenRef.current && prevBlocksLenRef.current > 0) {
    const prevTail = prevBlocksLenRef.current - 1
    minRevealedRef.current = Math.max(minRevealedRef.current, prevTail + 1)
  }
  prevBlocksLenRef.current = blocks.length

  // 流重启时重置状态
  useEffect(() => {
    if (blocks.length === 0) {
      setRevealedCount(0)
      minRevealedRef.current = 0
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [blocks.length])

  const effectiveRevealedCount = Math.max(revealedCount, minRevealedRef.current)
  const tailIndex = blocks.length - 1

  const getBlockState = useCallback(
    (index: number): BlockState => {
      if (index < effectiveRevealedCount) return 'revealed'
      if (index === effectiveRevealedCount && index < tailIndex) return 'animating'
      if (index === effectiveRevealedCount && index === tailIndex) return 'streaming'
      return 'queued'
    },
    [effectiveRevealedCount, tailIndex],
  )

  const queueLength = Math.max(0, tailIndex - effectiveRevealedCount - 1)

  // animating block 索引和字符数
  const animatingIndex = effectiveRevealedCount < tailIndex ? effectiveRevealedCount : -1
  const animatingCharCount =
    animatingIndex >= 0 ? countChars(blocks[animatingIndex]?.content ?? '') : 0

  // streaming block 索引（仅当没有 animating block 时生效）
  const streamingIndex = animatingIndex < 0 && tailIndex >= effectiveRevealedCount ? tailIndex : -1
  const activeIndex = animatingIndex >= 0 ? animatingIndex : streamingIndex
  const activeCharCount = activeIndex >= 0 ? countChars(blocks[activeIndex]?.content ?? '') : 0

  // 冻结 charDelay：进入新 active block 时计算一次，之后不变
  const frozenRef = useRef({ delay: BASE_DELAY, index: -1 })
  if (activeIndex >= 0 && activeIndex !== frozenRef.current.index) {
    frozenRef.current = {
      delay: computeCharDelay(queueLength, activeCharCount),
      index: activeIndex,
    }
  }
  const charDelay = activeIndex >= 0 ? frozenRef.current.delay : BASE_DELAY

  const onAnimationDone = useCallback(() => {
    setRevealedCount(effectiveRevealedCount + 1)
  }, [effectiveRevealedCount])

  // animating block 动画计时
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (animatingIndex < 0) return

    const totalTime = Math.max(0, (animatingCharCount - 1) * charDelay) + FADE_DURATION
    timerRef.current = setTimeout(onAnimationDone, totalTime)

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [animatingIndex, animatingCharCount, charDelay, onAnimationDone])

  return { charDelay, getBlockState, queueLength }
}
