/**
 * 飞书流式卡片的运行时状态机。
 *
 * 把 AgentEvent 累积成一个结构化的 RunState，
 * 便于 card-renderer 无时序地把状态转成 CardKit 2.0 JSON。
 *
 * 所有 reducer 是纯函数：reduce(state, event) → state。
 */

import type { AgentEvent } from '@kila/shared'

export type ToolStatus = 'running' | 'done' | 'error'

export interface ToolEntry {
  id: string
  name: string
  input: unknown
  status: ToolStatus
  output?: string
}

export type Block =
  | { kind: 'text'; content: string; streaming: boolean }
  | { kind: 'tool'; tool: ToolEntry }

export type FooterStatus = 'thinking' | 'tool_running' | 'streaming' | null

export type Terminal = 'running' | 'done' | 'interrupted' | 'error' | 'idle_timeout'

export interface RunState {
  blocks: Block[]
  reasoning: { content: string; active: boolean }
  footer: FooterStatus
  terminal: Terminal
  errorMsg?: string
  idleTimeoutMinutes?: number
  startedAt: number
  meta: {
    durationMs?: number
    inputTokens?: number
    outputTokens?: number
    model?: string
  }
}

export function createInitialState(modelName?: string): RunState {
  return {
    blocks: [],
    reasoning: { content: '', active: false },
    footer: 'thinking',
    terminal: 'running',
    startedAt: Date.now(),
    meta: modelName ? { model: modelName } : {},
  }
}

function closeStreamingText(blocks: Block[]): Block[] {
  return blocks.map((b) =>
    b.kind === 'text' && b.streaming ? { ...b, streaming: false } : b,
  )
}

function appendText(state: RunState, delta: string): RunState {
  const last = state.blocks[state.blocks.length - 1]
  if (last && last.kind === 'text' && last.streaming) {
    const next: Block = { ...last, content: last.content + delta }
    return {
      ...state,
      blocks: [...state.blocks.slice(0, -1), next],
      reasoning: { ...state.reasoning, active: false },
      footer: 'streaming',
    }
  }
  return {
    ...state,
    blocks: [...state.blocks, { kind: 'text', content: delta, streaming: true }],
    reasoning: { ...state.reasoning, active: false },
    footer: 'streaming',
  }
}

function startTool(state: RunState, id: string, name: string, input: unknown): RunState {
  const tool: ToolEntry = { id, name, input, status: 'running' }
  return {
    ...state,
    blocks: [...closeStreamingText(state.blocks), { kind: 'tool', tool }],
    reasoning: { ...state.reasoning, active: false },
    footer: 'tool_running',
  }
}

function completeTool(state: RunState, id: string, output: string, isError: boolean): RunState {
  const blocks = state.blocks.map((b) => {
    if (b.kind !== 'tool' || b.tool.id !== id) return b
    return {
      ...b,
      tool: { ...b.tool, status: isError ? ('error' as const) : ('done' as const), output },
    }
  })
  return { ...state, blocks }
}

/** 从 AgentEvent 折叠进 RunState */
export function reduce(state: RunState, event: AgentEvent): RunState {
  switch (event.type) {
    case 'text_delta': {
      const delta = event.text
      if (typeof delta === 'string' && delta) {
        return appendText(state, delta)
      }
      return state
    }

    case 'tool_start': {
      const id = event.toolUseId
      const name = event.toolName
      if (typeof id === 'string' && typeof name === 'string') {
        return startTool(state, id, name, event.input)
      }
      return state
    }

    case 'tool_result': {
      const id = event.toolUseId
      if (typeof id === 'string') {
        const output = typeof event.result === 'string'
          ? event.result
          : event.result != null
            ? stringifyToolResult(event.result)
            : ''
        const isError = event.isError === true
        return completeTool(state, id, output, isError)
      }
      return state
    }

    case 'complete': {
      const meta = {
        ...state.meta,
        durationMs: Date.now() - state.startedAt,
        ...(event.usage?.inputTokens != null ? { inputTokens: event.usage.inputTokens } : {}),
        ...(event.usage?.outputTokens != null ? { outputTokens: event.usage.outputTokens } : {}),
      }
      return {
        ...state,
        blocks: closeStreamingText(state.blocks),
        reasoning: { ...state.reasoning, active: false },
        terminal: 'done',
        footer: null,
        meta,
      }
    }

    case 'error': {
      const msg = typeof event.message === 'string' ? event.message : 'Agent 运行出错'
      return {
        ...state,
        blocks: closeStreamingText(state.blocks),
        reasoning: { ...state.reasoning, active: false },
        terminal: 'error',
        footer: null,
        errorMsg: msg,
      }
    }

    case 'model_resolved': {
      return { ...state, meta: { ...state.meta, model: event.model } }
    }

    default:
      return state
  }
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c
        if (c && typeof c === 'object' && 'text' in c && typeof (c as { text: string }).text === 'string') {
          return (c as { text: string }).text
        }
        try {
          return JSON.stringify(c)
        } catch {
          return String(c)
        }
      })
      .join('\n')
  }
  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

export function markInterrupted(state: RunState): RunState {
  return {
    ...state,
    blocks: closeStreamingText(state.blocks),
    reasoning: { ...state.reasoning, active: false },
    terminal: 'interrupted',
    footer: null,
  }
}

export function markIdleTimeout(state: RunState, minutes: number): RunState {
  return {
    ...state,
    blocks: closeStreamingText(state.blocks),
    reasoning: { ...state.reasoning, active: false },
    terminal: 'idle_timeout',
    footer: null,
    idleTimeoutMinutes: minutes,
  }
}

export function markError(state: RunState, message: string): RunState {
  return {
    ...state,
    blocks: closeStreamingText(state.blocks),
    reasoning: { ...state.reasoning, active: false },
    terminal: 'error',
    footer: null,
    errorMsg: message,
  }
}

export function finalizeIfRunning(state: RunState): RunState {
  if (state.terminal !== 'running') return state
  return {
    ...state,
    blocks: closeStreamingText(state.blocks),
    reasoning: { ...state.reasoning, active: false },
    terminal: 'done',
    footer: null,
  }
}
