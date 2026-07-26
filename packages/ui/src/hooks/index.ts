/**
 * 共享 React Hooks
 */

// Layer 1: 自适应 CPS 平滑引擎
export { useSmoothStreamContent } from './useSmoothStreamContent.ts'
export type { StreamSmoothingPreset, UseSmoothStreamContentOptions } from './useSmoothStreamContent.ts'

// Layer 2: Block 状态机
export { useStreamQueue } from './useStreamQueue.ts'
export type { BlockInfo, BlockState, UseStreamQueueReturn } from './useStreamQueue.ts'

// Layer 2: 动画元信息
export { resolveBlockAnimationMeta } from './streamAnimationMeta.ts'
export type { BlockAnimationMeta, ResolveBlockAnimationMetaOptions } from './streamAnimationMeta.ts'

// Layer 3: rehype 插件
export { rehypeStreamAnimated } from './rehypeStreamAnimated.ts'
export type { StreamAnimatedOptions } from './rehypeStreamAnimated.ts'

// Layer 3: 插件稳定化
export { useStablePlugins, isSamePlugins } from './useStablePlugins.ts'
