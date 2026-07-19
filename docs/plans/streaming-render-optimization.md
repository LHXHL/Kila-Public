# 流式渲染零卡顿优化方案

> 基于 Lobe UI Streamdown 架构分析，对标 Kila 当前实现，消除流式 Markdown 渲染过程中的 Render Stall。
>
> 创建日期：2026-05-08

## 现状问题诊断

Kila 当前 `useSmoothStream`（`packages/ui/src/hooks/useSmoothStream.ts`）存在以下结构性瓶颈：

| 问题 | Kila 现状 | Lobe UI 解法 |
|---|---|---|
| **每帧 setState** | rAF 循环每帧 `setDisplayedContent(displayedRef.current += chars.join(''))`，触发完整 Markdown 重解析 | `useSmoothStreamContent` 按 CPS 调度字符输出，配合 `useStreamQueue` 按 block 分段渲染 |
| **整篇 Markdown 重渲染** | 每次 `displayedContent` 变化 → `MessageResponse` 整个 react-markdown 重新 parse | `marked.lexer` 先拆成独立 block，每个 block 用 `<StreamdownBlock>` memo 隔离，只重渲染变化的 block |
| **无 backlog 压力感知** | 固定 `queue.length / divisor`（8 或 4），不感知上游 chunk 频率和大小 | EMA 跟踪 arrival CPS + chunk size，动态调整输出 CPS，带 `targetBufferMs` 缓冲 |
| **无逐字 fade 动画** | 字符直接出现（无过渡），视觉跳跃 | `rehypeStreamAnimated` 给每个字符包 `<span>` + CSS `animation-delay`，实现 280ms 逐字淡入 |
| **Markdown parse 在渲染线程无优化** | react-markdown 内部 remark/rehype 全量执行 | `marked.lexer` 拆 block 后 per-block memo，parse 开销隔离到单个 block |

## 目标效果

对标 Lobe UI Streamdown Profiler Demo 展示的效果：

1. **逐字淡入动画** — 280ms `cubic-bezier(0.33, 0, 0.67, 1)` fade，每个字符带 `animation-delay` 错开
2. **代码块/表格/公式不卡** — 这些 block 直接 `revealed`，不走逐字动画（跳过 `pre/code/table/katex`）
3. **流式过程中 0 stall** — block 级 memo 只重渲染尾部活跃 block，已完成的 block 不动
4. **上游 burst 自适应** — 输入突然加速时输出 CPS 跟着涨，上游停了后自动排空缓冲
5. **已出现内容不闪烁** — revealed block 跳过动画插件，直接 `stream-char-revealed`

## 架构设计（3 层）

```
Layer 1: Input Smoothing (useSmoothStreamContent)
         EMA 自适应 CPS 调度，三档 preset (realtime/balanced/silky)
              ↓ smoothedContent（字符级，按 CPS 输出）
Layer 2: Block Queue (useStreamQueue)
         marked.lexer 拆 block → revealed/animating/streaming/queued 四态
              ↓ blocks + blockState
Layer 3: Per-Block Render (StreamdownBlock + rehypeStreamAnimated)
         每个 block 独立 memo'd Markdown，字符级 CSS fade 动画
```

### Layer 1: useSmoothStreamContent

替代当前 `useSmoothStream` 的自适应 CPS 引擎。

**核心机制：**

- 三档 preset 配置：

| 参数 | balanced | realtime | silky |
|---|---|---|---|
| defaultCps | 38 | 50 | 28 |
| maxCps | 72 | 96 | 56 |
| maxActiveCps | 132 | 180 | 102 |
| targetBufferMs | 120 | 40 | 170 |
| settleDrainMinMs | 180 | 140 | 240 |
| settleDrainMaxMs | 520 | 360 | 680 |

- EMA 跟踪到达速率（`emaCpsRef`），动态调整输出 CPS
- `targetBufferMs`：保持一定延迟缓冲，避免输出追平输入后空转
- `settleDrain`：上游停止后加速排空，但限制最大排空时间（min-max 范围）
- rAF 帧循环里按 `currentCps * dtSeconds` 算本帧揭示字符数
- 大段追加（> `largeAppendChars`）直接同步输出，不走平滑
- 非追加（内容重置）直接同步

**调度逻辑伪代码：**

```
每帧 tick:
  backlog = targetCount - displayedCount
  if backlog <= 0 → 停帧，scheduleWake(剩余窗口时间)

  idleMs = now - lastInputTs
  inputActive = idleMs <= activeInputWindowMs
  settling = !inputActive && idleMs >= settleAfterMs

  if inputActive:
    // 有输入压力 → 自适应 CPS
    backlogPressure * 0.6 + chunkPressure * 0.25 + arrivalPressure * 0.15
    currentCps = clamp(baseCps * combinedPressure, minCps, activeCap)
  elif settling:
    // 上游可能已停 → 限时排空
    drainTargetMs = clamp(backlog * 8, settleDrainMinMs, settleDrainMaxMs)
    currentCps = clamp(backlog * 1000 / drainTargetMs, flushCps, maxFlushCps)
  else:
    // 空闲排空
    currentCps = clamp(max(flushCps, baseCps * 1.8), flushCps, maxFlushCps)

  revealChars = max(minReveal, round(currentCps * dtSeconds))
  displayedContent += targetChars[displayedCount .. displayedCount + revealChars]
```

### Layer 2: useStreamQueue

将 smoothed content 拆为独立 block 并管理渲染状态机。

**Block 拆分：**

```typescript
const tokens = marked.lexer(smoothedContent)
const blocks = tokens.map((token, i) => ({
  content: token.raw,
  startOffset: offset  // 累计偏移，用于稳定 key
}))
```

**四态状态机：**

```
queued → animating → revealed
              ↑
           streaming（尾部活跃 block）
```

- `revealed`：动画完成，跳过 fade 插件，直接 `stream-char-revealed`
- `animating`：正在逐字淡入，带 `charDelay` 间隔的 `animation-delay`
- `streaming`：尾部活跃 block，新字符实时加入
- `queued`：等待中，不渲染（DOM 中不存在）

**自动推进逻辑：**

- blocks 增长时，前一个 streaming block 瞬间 promoted → revealed（同步，无中间帧）
- animating block 动画结束后 setTimeout → promoted → revealed
- `charDelay` 随队列压力加速：`charDelay = BASE_DELAY / (1 + queueLength * 0.3)`

### Layer 3: rehypeStreamAnimated + Per-Block Memo

**rehypeStreamAnimated 插件：**

- 遍历 HAST 树，给 `p/h1-h6/li` 中的文本字符包 `<span class="stream-char">`
- 跳过 `pre/code/table/svg` 和 `.katex` 元素
- 每个字符根据 `births[]` 数组计算 `animation-delay`：
  - 已完成 fade 的 → `stream-char-revealed`（`animation: none`）
  - 尚未开始的 → 正 delay
  - 正在 fade 中的 → 负 delay（利用 CSS animation 的负 delay 机制跳到动画中间）
- 280ms `cubic-bezier(0.33, 0, 0.67, 1)` 淡入

**CSS：**

```css
.stream-char {
  opacity: 0;
  animation: fadeIn 280ms cubic-bezier(0.33, 0, 0.67, 1) forwards;
}
.stream-char-revealed {
  opacity: 1;
  animation: none;
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

**Per-Block Memo：**

```tsx
const StreamdownBlock = memo<Options>(
  ({ children, ...rest }) => <Markdown {...rest}>{children}</Markdown>,
  (prev, next) =>
    prev.children === next.children &&
    prev.components === next.components &&
    isSamePlugins(prev.rehypePlugins, next.rehypePlugins) &&
    isSamePlugins(prev.remarkPlugins, next.remarkPlugins),
)
```

每个 block 用 `useId() + startOffset` 组合为稳定 key，content 不变时不重渲染。

## 改动清单

### 新增文件

| 文件 | 行数 | 说明 |
|---|---|---|
| `packages/ui/src/hooks/useSmoothStreamContent.ts` | ~220 | Layer 1：自适应 CPS 引擎 |
| `packages/ui/src/hooks/useStreamQueue.ts` | ~100 | Layer 2：block 状态机 |
| `packages/ui/src/hooks/rehypeStreamAnimated.ts` | ~90 | Layer 3：字符级 fade rehype 插件 |

### 修改文件

| 文件 | 行数 | 说明 |
|---|---|---|
| `packages/ui/src/hooks/useSmoothStream.ts` | ~10 | 标记 deprecated，内部转发到 `useSmoothStreamContent` |
| `packages/ui/src/hooks/index.ts` | ~5 | 导出新 hook |
| `apps/electron/src/renderer/components/ai-elements/message.tsx` | ~120 | `MessageResponse` 增加 block 级渲染路径 + streaming CSS |
| `apps/electron/src/renderer/components/agent/AgentMessages.tsx` | ~30 | 替换 hook 调用 |
| `apps/electron/src/renderer/components/agent/AgentMessageItem.tsx` | ~40 | 流式渲染路径适配 |

**总计：~620 行新增/修改，3 个新文件，5 个改动文件。**

不涉及 `packages/core`、`packages/shared`、主进程，纯 renderer + UI 层改动。

### 依赖变更

- 新增 `marked`（仅用于 `marked.lexer` 拆 block，不影响现有 react-markdown 管线）
- 无需其他新依赖

## 优先级排序

| 优先级 | 改动 | 预期收益 |
|---|---|---|
| **P0** | `useSmoothStreamContent` 替代 `useSmoothStream` | 消除上游 chunk burst 导致的渲染卡顿 |
| **P0** | `useStreamQueue` + per-block memo | 消除整篇 Markdown 重 parse，大幅减少 React reconciliation 开销 |
| **P1** | `rehypeStreamAnimated` 逐字淡入 | 视觉体验提升，消除字符跳跃感 |
| **P2** | Dev Profiler（可选） | 开发调试工具，不影响用户体验 |

## 不改的部分

- `agent-stream-utils.ts` 的 `applyAgentEvent` 纯函数 — 上游事件处理逻辑不变
- `AgentMessageItem.tsx` 的历史消息渲染 — 只影响流式中的 live turn
- Widget / SchemaWidget 解析管线 — 独立于 Markdown 渲染
- `MessageResponse` 的非流式路径 — 历史 message 仍走整篇 react-markdown

## 参考来源

- [Lobe UI Streamdown Profiler Demo](https://ui.lobehub.com/~demos/src-markdown-demo-streamingprofiler)
- [lobehub/lobe-ui GitHub](https://github.com/lobehub/lobe-ui)
  - `src/Markdown/SyntaxMarkdown/StreamdownRender.tsx` — 核心渲染组件
  - `src/Markdown/SyntaxMarkdown/useSmoothStreamContent.ts` — CPS 引擎
  - `src/Markdown/SyntaxMarkdown/useStreamQueue.ts` — block 状态机
  - `src/Markdown/plugins/rehypeStreamAnimated.ts` — 字符级 fade 插件
  - `src/Markdown/streamProfiler/` — 性能计量工具（可选参考）
