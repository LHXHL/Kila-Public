/**
 * @kila/ui - 共享 UI 组件和 Hooks
 */

export { CodeBlock } from './code-block/index.ts'
export { MermaidBlock } from './mermaid-block/index.ts'

// Streaming render hooks
export {
  useSmoothStream,
  useSmoothStreamContent,
  useStreamQueue,
  resolveBlockAnimationMeta,
  rehypeStreamAnimated,
  useStablePlugins,
  isSamePlugins,
} from './hooks/index.ts'
export type {
  StreamSmoothingPreset,
  UseSmoothStreamContentOptions,
  BlockInfo,
  BlockState,
  UseStreamQueueReturn,
  BlockAnimationMeta,
  ResolveBlockAnimationMetaOptions,
  StreamAnimatedOptions,
} from './hooks/index.ts'
