# 流式渲染零卡顿优化方案 v2

> 基于 Lobe UI Streamdown 源码深度审查后的修订方案。
> 修订日期：2026-05-08
> 前版：[streaming-render-optimization.md](./streaming-render-optimization.md)

## v1 → v2 主要变更

| 变更 | 说明 |
|---|---|
| **新增 `remend` 内容修复层** | 流式截断 Markdown 碎片在喂 `marked.lexer` 前必须修复，否则 block 拆分不稳定 |
| **新增 Widget fence 整合策略** | Kila 独有的 `show-widget` fence 会被 `marked.lexer` 错误拆分，需要先剥离 |
| **补充 `births[]` 构建逻辑** | v1 只提了名字，未设计增量追加 + cap + 跨帧持久化机制 |
| **新增 `streamAnimationMeta` 模块** | 控制 revealed block 在 fade 完成后才切 `animation: none`，避免闪烁 |
| **新增 `useStablePlugins`** | 基础 rehype/remark 插件列表引用稳定化，防止不必要的 block 重渲染 |
| **修正状态机流转** | streaming → revealed 同步提升，不经过 animating |
| **补充 CSS `contain` 优化** | revealed block 加 `contain: content` 减少帧开销 |

## 架构设计（4 层）

```
Layer 0: Content Normalization
         Widget fence 剥离 + remend 修复
              ↓ normalizedMarkdown + widgetBlocks

Layer 1: Input Smoothing (useSmoothStreamContent)
         EMA 自适应 CPS 调度，三档 preset
              ↓ smoothedContent

Layer 2: Block Queue (useStreamQueue + births 管理)
         marked.lexer 拆 block → 四态状态机 + births[] 时间戳
              ↓ blocks + blockState + births

Layer 3: Per-Block Render (StreamdownBlock + rehypeStreamAnimated)
         每个 block 独立 memo'd Markdown，字符级 CSS fade 动画
```

### Layer 0: Content Normalization（新增）

v1 缺失了内容预处理层。LobeHub 在 `StreamdownRender.tsx` 中用 [`remend`](https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/StreamdownRender.tsx#L139) 修复流式中间态 Markdown。

**LobeHub 原始代码：**
```typescript
// https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/StreamdownRender.tsx#L137-L145
const processedContentResult = useMemo(() => {
  const value = remend(smoothedContent);
  return { durationMs: ..., value };
}, [smoothedContent]);
```

**Kila 适配设计：**

Kila 有 Widget fence (`show-widget`) 系统，需要在 `remend` 之前先剥离 Widget 区域，避免修复逻辑破坏 Widget JSON：

```typescript
// packages/ui/src/hooks/useNormalizedStreamContent.ts
export function useNormalizedStreamContent(smoothedContent: string): {
  markdownForLexer: string        // 修复后的纯 Markdown（Widget 占位符已替换）
  widgetBlocks: WidgetBlockRef[]  // 剥离出的 Widget fence 列表
} {
  return useMemo(() => {
    // 1. 用现有 parseStreamingAssistantBlocks 剥离 Widget fence
    const { completedBlocks, partialWidget } = parseStreamingAssistantBlocks(smoothedContent)

    // 2. 将 Widget 位置替换为占位符 <!--widget:N-->
    const widgetBlocks: WidgetBlockRef[] = []
    let markdownOnly = ''
    for (const block of completedBlocks) {
      if (block.kind === 'markdown') {
        markdownOnly += block.markdown
      } else {
        widgetBlocks.push(block)
        markdownOnly += `\n<!--widget:${widgetBlocks.length - 1}-->\n`
      }
    }

    // 3. remend 修复截断的 Markdown 语法
    const fixed = remend(markdownOnly)

    return { markdownForLexer: fixed, widgetBlocks }
  }, [smoothedContent])
}
```

**依赖：** 新增 `remend` 包（~3KB minified）。

### Layer 1: useSmoothStreamContent

与 v1 方案一致，直接对标 LobeHub [useSmoothStreamContent.ts](https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/useSmoothStreamContent.ts)。

**三档 preset 配置（与 LobeHub 一致）：**

```typescript
// https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/useSmoothStreamContent.ts#L26-L72
const PRESET_CONFIG = {
  balanced: {
    activeInputWindowMs: 220, defaultCps: 38, emaAlpha: 0.2,
    flushCps: 120, largeAppendChars: 120,
    maxActiveCps: 132, maxCps: 72, maxFlushCps: 280,
    minCps: 18, settleAfterMs: 360,
    settleDrainMaxMs: 520, settleDrainMinMs: 180, targetBufferMs: 120,
  },
  realtime: { /* ... */ },
  silky:    { /* ... */ },
}
```

**关键差异点（vs v1）：**

1. **字符计数**：LobeHub 用 `[...text].length`（[源码](https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/useSmoothStreamContent.ts#L82-L84)），不用 `Intl.Segmenter`。CPS 引擎只需粗略计数，性能更好。
2. **`scheduleFrameWake`**：LobeHub 在 input 安静但 backlog 未排空时不空转 rAF，而是用 setTimeout 延迟唤醒（[源码](https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/useSmoothStreamContent.ts#L138-L151)），节省 CPU。
3. **无 `isStreaming` 参数**：LobeHub 的 hook 不接收 `isStreaming`，完全靠 content 变化和 settle 逻辑自动管理。Kila 需确认上游停止后 settle drain 能可靠排空。

**调度逻辑（与 LobeHub 一致）：**

```
每帧 tick:
  backlog = targetCount - displayedCount
  if backlog <= 0 → stopFrameLoop() + return

  idleMs = now - lastInputTs
  inputActive = idleMs <= activeInputWindowMs
  settling = !inputActive && idleMs >= settleAfterMs

  if inputActive:
    // 自适应 CPS（含 shortfall 截断）
    backlogPressure * 0.6 + chunkPressure * 0.25 + arrivalPressure * 0.15
    currentCps = clamp(baseCps * combinedPressure, minCps, activeCap)
    shortfall = desiredDisplayed - displayedCount
    if shortfall <= 0 → stopFrameLoop() + scheduleFrameWake(剩余窗口)
    revealChars = min(revealChars, shortfall, backlog)

  elif settling:
    drainTargetMs = clamp(backlog * 8, settleDrainMinMs, settleDrainMaxMs)
    currentCps = clamp(backlog * 1000 / drainTargetMs, flushCps, maxFlushCps)

  else:  // idle flush
    currentCps = clamp(max(flushCps, baseCps*1.8, arrivalEma*0.8), flushCps, maxFlushCps)

  segment = targetChars[displayedCount .. displayedCount + revealChars].join('')
  displayedContent += segment
```

> 详见 [useSmoothStreamContent.ts#L178-L317](https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/useSmoothStreamContent.ts#L178-L317)

### Layer 2: useStreamQueue + births 管理

#### Block 拆分

与 v1 一致，使用 `marked.lexer`（[源码](https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/StreamdownRender.tsx#L148-L163)）。但输入为 Layer 0 修复后的 `markdownForLexer`。

#### 四态状态机（修正）

v1 的状态流转图有误。根据 [useStreamQueue.ts](https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/useStreamQueue.ts) 实际逻辑：

```
                    ┌─────────────────────────────┐
                    │  新 block 到来时:              │
                    │  前 streaming → revealed      │
                    │  (同步提升, minRevealedRef)    │
                    └─────────────────────────────┘

queued ──→ streaming (当 index == tailIndex)
       ──→ animating (当 index == effectiveRevealedCount < tailIndex)
                 │
                 ↓ setTimeout(totalTime) 计时结束
              revealed
```

**关键逻辑**（[源码](https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/useStreamQueue.ts#L48-L55)）：

```typescript
// 同步提升：blocks 增长时，前 streaming block 瞬间变 revealed
if (blocks.length > prevBlocksLenRef.current && prevBlocksLenRef.current > 0) {
  const prevTail = prevBlocksLenRef.current - 1;
  minRevealedRef.current = Math.max(minRevealedRef.current, prevTail + 1);
}
```

这意味着：
- 尾部 block 始终是 `streaming`
- 新 block 到来时，**前一个 streaming 不经过 animating，直接同步提升为 revealed**
- `animating` 只发生在 revealed 和 tail 之间有间隔的情况（罕见）

#### `charDelay` 动态加速

```typescript
// https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/useStreamQueue.ts#L23-L28
function computeCharDelay(queueLength: number, charCount: number): number {
  const acceleration = 1 + queueLength * ACCELERATION_FACTOR;  // 0.3
  let delay = BASE_DELAY / acceleration;  // BASE_DELAY = 18
  delay = Math.min(delay, MAX_BLOCK_DURATION / Math.max(charCount, 1));  // 3000ms cap
  return delay;
}
```

#### births[] 构建逻辑（v1 缺失，本版补充）

这是 v1 最大的遗漏。LobeHub 在 [StreamdownRender.tsx#L172-L216](https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/StreamdownRender.tsx#L172-L216) 中实现了完整的 births 时间戳增量管理：

```typescript
// 实现为 useStreamBirths hook 或内联在渲染组件中
function buildBirths(
  blocks: BlockInfo[],
  getBlockState: (i: number) => BlockState,
  charDelay: number,
  prevBirths: Map<number, number[]>,
  renderNow: number,
): Map<number, number[]> {
  const nextBirths = new Map<number, number[]>();
  const cap = renderNow + STREAM_FADE_DURATION;  // 280ms

  for (const [index, block] of blocks.entries()) {
    const state = getBlockState(index);
    if (state === 'queued') continue;  // queued 不分配 birth，延迟到可见时

    const charCount = [...block.content].length;
    const prev = prevBirths.get(block.startOffset);
    let arr: number[];

    if (prev && prev.length === charCount) {
      arr = prev;  // 内容不变 → 直接复用
    } else if (prev && prev.length > charCount) {
      arr = prev.slice(0, charCount);  // 内容缩短 → 截取
    } else {
      // 新字符追加 → 增量分配 birth 时间戳
      arr = prev ? prev.slice() : [];
      for (let i = arr.length; i < charCount; i++) {
        const prevBirth = i > 0 ? arr[i - 1]! : renderNow - charDelay;
        const chained = prevBirth + charDelay;  // 链式递增，保证顺序淡入
        arr.push(Math.min(cap, Math.max(chained, renderNow)));
        //        ^^^^^^^^ cap 防止 stream 快于 fade 时 birth 无限前推
      }
    }

    nextBirths.set(block.startOffset, arr);
  }

  return nextBirths;
}
```

**必须跨帧持久化**（[源码](https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/StreamdownRender.tsx#L279-L282)）：

```typescript
useEffect(() => {
  blockCharDelayRef.current = blockAnimationMetaResult.blockCharDelay;
  blockBirthsRef.current = birthsForRender;
}, [birthsForRender, blockAnimationMetaResult.blockCharDelay]);
```

### Layer 3: Per-Block Render

#### streamAnimationMeta（v1 缺失）

[streamAnimationMeta.ts](https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/streamAnimationMeta.ts) 决定每个 block 用哪种 rehype 插件：

```typescript
export const resolveBlockAnimationMeta = ({
  currentCharDelay, fadeDuration, lastElapsedMs, previousCharDelay, state,
}): BlockAnimationMeta => {
  // active block 用当前 charDelay，revealed block 冻结旧 delay
  const charDelay = isActiveBlock(state)
    ? currentCharDelay
    : (previousCharDelay ?? currentCharDelay);
  // 只有 revealed 且最后一个字符 fade 完成后才标记 settled
  const settled = state === 'revealed' && lastElapsedMs >= fadeDuration;
  return { charDelay, settled };
};
```

`settled` 决定插件选择（[源码](https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/StreamdownRender.tsx#L331-L343)）：

```typescript
const plugins = animationMeta.settled
  ? [...baseRehypePlugins, REVEALED_STREAM_PLUGIN]       // animation: none
  : [...baseRehypePlugins, [rehypeStreamAnimated, {       // 带 births fade
      births, fadeDuration: 280, nowMs: renderNow,
    }]];
```

#### useStablePlugins（v1 缺失）

防止基础插件列表引用变化触发不必要的 block 重渲染（[源码](https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/StreamdownRender.tsx#L101-L109)）：

```typescript
const useStablePlugins = (plugins: PluggableList): PluggableList => {
  const stableRef = useRef<PluggableList>(plugins);
  if (!isSamePlugins(stableRef.current, plugins)) {
    stableRef.current = plugins;
  }
  return stableRef.current;
};
```

Kila 的 `REMARK_PLUGINS` / `REHYPE_PLUGINS` 已是模块级常量（[message.tsx#L225-L226](../../apps/electron/src/renderer/components/ai-elements/message.tsx#L225)），但新增的动态 `rehypeStreamAnimated` 参数会导致引用不稳定，必须做稳定化。

#### rehypeStreamAnimated

与 v1 一致，对标 [rehypeStreamAnimated.ts](https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/plugins/rehypeStreamAnimated.ts)。

**注意 fadeDuration 默认值**：源码默认 150ms（[L27](https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/plugins/rehypeStreamAnimated.ts#L27)），但 StreamdownRender 调用时传入 280ms。Kila 实现时统一用 280ms 即可。

#### CSS

```css
/* 对标 https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/style.ts */
.stream-char {
  opacity: 0;
  animation: streamFadeIn 280ms cubic-bezier(0.33, 0, 0.67, 1) forwards;
}
.stream-char-revealed {
  opacity: 1;
  animation: none;
}
@keyframes streamFadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* v2 新增：revealed block layout 优化 */
.streamdown-block-revealed {
  contain: content;
}

/* KaTeX 保护（与 LobeHub 一致） */
.katex-display .katex-html span {
  mask: none !important;
  animation: none !important;
}
```

#### StreamdownBlock Memo

```tsx
// 对标 https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/StreamdownRender.tsx#L111-L122
const StreamdownBlock = memo<Options>(
  ({ children, ...rest }) => <Markdown {...rest}>{children}</Markdown>,
  (prev, next) =>
    prev.children === next.children &&
    prev.components === next.components &&
    isSamePlugins(prev.rehypePlugins, next.rehypePlugins) &&
    isSamePlugins(prev.remarkPlugins, next.remarkPlugins),
)
```

## 改动清单

### 新增文件

| 文件 | ~行数 | 说明 |
|---|---|---|
| `packages/ui/src/hooks/useSmoothStreamContent.ts` | 220 | Layer 1：自适应 CPS 引擎 |
| `packages/ui/src/hooks/useStreamQueue.ts` | 110 | Layer 2：block 四态状态机 |
| `packages/ui/src/hooks/useStreamBirths.ts` | 80 | Layer 2：births[] 增量构建 + 跨帧持久化 |
| `packages/ui/src/hooks/streamAnimationMeta.ts` | 30 | Layer 3：per-block settled 判定 |
| `packages/ui/src/hooks/rehypeStreamAnimated.ts` | 90 | Layer 3：字符级 fade rehype 插件 |
| `packages/ui/src/hooks/useStablePlugins.ts` | 20 | Layer 3：插件列表引用稳定化 |

### 修改文件

| 文件 | ~行数 | 说明 |
|---|---|---|
| `packages/ui/src/hooks/useSmoothStream.ts` | 10 | 标记 deprecated，转发到新 hook |
| `packages/ui/src/hooks/index.ts` | 10 | 导出新 hooks |
| `apps/.../ai-elements/message.tsx` | 140 | `MessageResponse` 增加 StreamdownBlock 渲染路径 + CSS |
| `apps/.../agent/AgentMessages.tsx` | 40 | 替换 hook 调用，增加 Widget 整合逻辑 |
| `apps/.../agent/AgentMessageItem.tsx` | 50 | 流式渲染路径适配，Widget block 插入 |

### 依赖变更

| 包 | 用途 |
|---|---|
| `marked` | `marked.lexer` 拆 block |
| `remend` | 流式 Markdown 碎片修复（未闭合 fence/链接/表格） |

**总计：~800 行新增/修改，6 个新文件，5 个改动文件。**

## 优先级

| 阶段 | 内容 | 预期收益 |
|---|---|---|
| **P0-a** | `useSmoothStreamContent` 替代 `useSmoothStream` | 消除 chunk burst 卡顿 |
| **P0-b** | Widget fence 剥离 + `remend` + `marked.lexer` 拆 block | 稳定的 block 粒度，不破坏 Widget |
| **P0-c** | `useStreamQueue` + `useStreamBirths` + per-block memo | 消除整篇重 parse，React reconciliation O(1) |
| **P1** | `rehypeStreamAnimated` + `streamAnimationMeta` + CSS | 逐字淡入动画 + settled 防闪烁 |
| **P2** | CSS `contain: content` + Dev Profiler | 帧预算优化 + 调试工具 |

## 不改的部分

- `agent-stream-utils.ts` 的 `applyAgentEvent` — 上游事件处理不变
- `AgentMessageItem.tsx` 的历史消息渲染 — 只影响 live turn
- Widget / SchemaWidget 解析管线（`parse-show-widget.ts`）— 复用现有，不重写
- `MessageResponse` 的非流式路径 — 历史 message 仍走整篇 react-markdown

## 参考来源

| 文件 | 链接 |
|---|---|
| StreamdownRender.tsx | [源码](https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/StreamdownRender.tsx) |
| useSmoothStreamContent.ts | [源码](https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/useSmoothStreamContent.ts) |
| useStreamQueue.ts | [源码](https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/useStreamQueue.ts) |
| rehypeStreamAnimated.ts | [源码](https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/plugins/rehypeStreamAnimated.ts) |
| streamAnimationMeta.ts | [源码](https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/streamAnimationMeta.ts) |
| style.ts | [源码](https://github.com/lobehub/lobe-ui/blob/master/src/Markdown/SyntaxMarkdown/style.ts) |
| Profiler Demo | [在线演示](https://ui.lobehub.com/~demos/src-markdown-demo-streamingprofiler) |
