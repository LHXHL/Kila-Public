/**
 * streamAnimationMeta — Per-block 动画元信息解析
 *
 * 对标 LobeHub lobe-ui：
 * https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/streamAnimationMeta.ts
 *
 * 决定每个 block 使用的 charDelay 和是否已 settled（可切到 animation: none）。
 * - active block (animating/streaming) → 用当前 charDelay
 * - revealed block → 冻结旧 charDelay；fade 完成后标记 settled
 */

import type { BlockState } from './useStreamQueue.ts'

export interface ResolveBlockAnimationMetaOptions {
  currentCharDelay: number
  fadeDuration: number
  lastElapsedMs: number
  previousCharDelay?: number
  state: BlockState
}

export interface BlockAnimationMeta {
  charDelay: number
  settled: boolean
}

const isActiveBlock = (state: BlockState): boolean =>
  state === 'animating' || state === 'streaming'

export const resolveBlockAnimationMeta = ({
  currentCharDelay,
  fadeDuration,
  lastElapsedMs,
  previousCharDelay,
  state,
}: ResolveBlockAnimationMetaOptions): BlockAnimationMeta => {
  const charDelay = isActiveBlock(state)
    ? currentCharDelay
    : (previousCharDelay ?? currentCharDelay)
  const settled = state === 'revealed' && lastElapsedMs >= fadeDuration

  return { charDelay, settled }
}
