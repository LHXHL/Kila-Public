import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import {
  agentSessionStreamStateAtomFamily,
  agentStreamingStatesAtom,
  isSessionVisibleInPanes,
  releaseAgentSessionStreamStateAtom,
  settleAgentStreamStateAtom,
  type AgentStreamState,
} from './agent-stream-atoms'
import { splitLayoutAtom, type SplitLayoutState } from './tab-atoms'

function streamState(content: string): AgentStreamState {
  return {
    running: true,
    content,
    toolActivities: [],
    processEvents: [],
    startedAt: 1,
  }
}

/** 构造只含指定会话的单面板布局；传 null 表示面板为空 */
function layoutWith(activeTabId: string | null): SplitLayoutState {
  return {
    mode: 'single',
    panels: [{ index: 0, activeTabId }],
    focusedPanelIndex: 0,
  }
}

/** 模拟流式监听器：每个事件都整表替换 Map，只更新目标会话的值 */
function pushDelta(
  store: ReturnType<typeof createStore>,
  sessionId: string,
  content: string,
): void {
  store.set(agentStreamingStatesAtom, (prev) => {
    const map = new Map(prev)
    map.set(sessionId, streamState(content))
    return map
  })
}

describe('单会话流式状态订阅粒度', () => {
  test('Given 会话 A 已有流式状态 When 会话 B 持续产生 token Then 会话 A 的 family atom 引用不变', () => {
    const store = createStore()
    pushDelta(store, 'session-a', 'A-1')

    const atomA = agentSessionStreamStateAtomFamily('session-a')
    const before = store.get(atomA)

    const notified: Array<AgentStreamState | undefined> = []
    const unsubscribe = store.sub(atomA, () => { notified.push(store.get(atomA)) })

    pushDelta(store, 'session-b', 'B-1')
    pushDelta(store, 'session-b', 'B-2')
    pushDelta(store, 'session-b', 'B-3')

    expect(notified).toHaveLength(0)
    expect(store.get(atomA)).toBe(before!)
    unsubscribe()
  })

  test('Given 订阅本会话 family atom When 本会话产生 token Then 收到新引用并携带最新内容', () => {
    const store = createStore()
    pushDelta(store, 'session-a', 'A-1')

    const atomA = agentSessionStreamStateAtomFamily('session-a')
    const before = store.get(atomA)

    let notifyCount = 0
    const unsubscribe = store.sub(atomA, () => { notifyCount += 1 })

    pushDelta(store, 'session-a', 'A-2')

    expect(notifyCount).toBe(1)
    expect(store.get(atomA)).not.toBe(before!)
    expect(store.get(atomA)?.content).toBe('A-2')
    unsubscribe()
  })

  test('Given 同一 sessionId 多次取用 When 未释放缓存 Then 复用同一个 atom 实例', () => {
    expect(agentSessionStreamStateAtomFamily('session-c')).toBe(
      agentSessionStreamStateAtomFamily('session-c'),
    )
  })

  test('Given Session 已删除 When 释放 family 缓存 Then 不再持有旧 atom 实例', () => {
    const first = agentSessionStreamStateAtomFamily('session-d')
    releaseAgentSessionStreamStateAtom('session-d')

    expect(agentSessionStreamStateAtomFamily('session-d')).not.toBe(first)
  })
})

describe('后台会话流式终态回收', () => {
  test('Given 会话不在任何可见 Pane 中 When 流式收敛 Then Map 条目被删除', () => {
    const store = createStore()
    store.set(splitLayoutAtom, layoutWith(null))
    pushDelta(store, 'bg-session', '一大段后台正文')

    store.set(settleAgentStreamStateAtom, 'bg-session')

    expect(store.get(agentStreamingStatesAtom).has('bg-session')).toBe(false)
  })

  test('Given 会话不在任何可见 Pane 中 When 流式收敛 Then 派生 atom 缓存一并释放', () => {
    const store = createStore()
    store.set(splitLayoutAtom, layoutWith(null))
    pushDelta(store, 'bg-session-2', '正文')
    const before = agentSessionStreamStateAtomFamily('bg-session-2')

    store.set(settleAgentStreamStateAtom, 'bg-session-2')

    expect(agentSessionStreamStateAtomFamily('bg-session-2')).not.toBe(before)
  })

  test('Given 会话正显示在某个 Pane 中 When 流式收敛 Then 条目保留且只置 running=false', () => {
    const store = createStore()
    store.set(splitLayoutAtom, layoutWith('visible-session'))
    pushDelta(store, 'visible-session', '前台正文')

    store.set(settleAgentStreamStateAtom, 'visible-session')

    const state = store.get(agentStreamingStatesAtom).get('visible-session')
    expect(state).toBeDefined()
    expect(state?.running).toBe(false)
    expect(state?.content).toBe('前台正文')
  })

  test('Given 分屏中另一个面板显示该会话 When 流式收敛 Then 仍然判定为可见并保留条目', () => {
    const store = createStore()
    store.set(splitLayoutAtom, {
      mode: 'horizontal-2',
      panels: [
        { index: 0, activeTabId: 'other-session' },
        { index: 1, activeTabId: 'split-session' },
      ],
      focusedPanelIndex: 0,
    })
    pushDelta(store, 'split-session', '分屏正文')

    store.set(settleAgentStreamStateAtom, 'split-session')

    expect(store.get(agentStreamingStatesAtom).has('split-session')).toBe(true)
  })

  test('Given 会话没有流式状态 When 流式收敛 Then Map 引用保持不变', () => {
    const store = createStore()
    store.set(splitLayoutAtom, layoutWith(null))
    pushDelta(store, 'kept-session', '保留')
    const before = store.get(agentStreamingStatesAtom)

    store.set(settleAgentStreamStateAtom, 'missing-session')

    expect(store.get(agentStreamingStatesAtom)).toBe(before)
  })

  test('Given 布局面板列表 When 判断会话可见性 Then 只认 activeTabId 命中', () => {
    expect(isSessionVisibleInPanes(layoutWith('a'), 'a')).toBe(true)
    expect(isSessionVisibleInPanes(layoutWith('a'), 'b')).toBe(false)
    expect(isSessionVisibleInPanes(layoutWith(null), 'a')).toBe(false)
  })
})
