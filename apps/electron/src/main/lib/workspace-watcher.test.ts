import { describe, expect, test } from 'bun:test'
import type { SessionProject } from '@kila/shared'
import { createSessionProjectWatchRegistry } from './workspace-watcher'

interface FakeWatcher {
  path: string
  closed: boolean
  close(): void
}

function project(path: string): SessionProject {
  return { path, name: path.split('/').pop() || 'project', source: 'user', profileId: 'profile-test' }
}

function createHarness(existingPaths: string[]) {
  const watchers: FakeWatcher[] = []
  const registry = createSessionProjectWatchRegistry({
    directoryExists: (path) => existingPaths.includes(path),
    watchDirectory: (path) => {
      const watcher: FakeWatcher = {
        path,
        closed: false,
        close() {
          this.closed = true
        },
      }
      watchers.push(watcher)
      return watcher
    },
    onFilesChanged: () => undefined,
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  })
  return { registry, watchers }
}

describe('visible session project watches', () => {
  test('Given 两个可见 Session，When 切换为另一个 Pane 集合，Then 释放不可见项目 watcher', () => {
    const { registry, watchers } = createHarness(['/project/a', '/project/b', '/project/c'])

    registry.restoreSessionProjectWatches([
      { id: 'session-a', project: project('/project/a') },
      { id: 'session-b', project: project('/project/b') },
    ])
    registry.restoreSessionProjectWatches([
      { id: 'session-b', project: project('/project/b') },
      { id: 'session-c', project: project('/project/c') },
    ])

    expect(registry.getSnapshot()).toEqual({
      sessionProjectPaths: [
        ['session-b', '/project/b'],
        ['session-c', '/project/c'],
      ],
      watchedProjectPaths: [
        { path: '/project/b', refCount: 1 },
        { path: '/project/c', refCount: 1 },
      ],
    })
    expect(watchers.find((watcher) => watcher.path === '/project/a')?.closed).toBe(true)
    expect(watchers.find((watcher) => watcher.path === '/project/b')?.closed).toBe(false)
  })

  test('Given 多个 Session 共享同一项目，When 同步可见集合，Then 只创建一个底层 watcher 并正确引用计数', () => {
    const { registry, watchers } = createHarness(['/project/shared'])

    registry.restoreSessionProjectWatches([
      { id: 'session-a', project: project('/project/shared') },
      { id: 'session-b', project: project('/project/shared') },
    ])

    expect(watchers).toHaveLength(1)
    expect(registry.getSnapshot().watchedProjectPaths).toEqual([
      { path: '/project/shared', refCount: 2 },
    ])
  })

  test('Given headless 会话显式监听项目，When 可见 Pane reconcile 不含它，Then 不误拆其监听', () => {
    const { registry, watchers } = createHarness(['/project/headless', '/project/a'])

    // headless（bridge/scheduled/cli）直接监听，不经可见 Pane 预算。
    registry.watchSessionProject('session-headless', '/project/headless')
    // 可见 Pane reconcile 只含另一个会话。
    registry.restoreSessionProjectWatches([
      { id: 'session-a', project: project('/project/a') },
    ])

    // headless 会话的监听必须保留（不被 reconcile 误拆）。
    expect(watchers.find((watcher) => watcher.path === '/project/headless')?.closed).toBe(false)
    expect(registry.getSnapshot().sessionProjectPaths).toEqual([
      ['session-a', '/project/a'],
      ['session-headless', '/project/headless'],
    ])

    // headless 结束显式释放后，才真正停止监听。
    registry.unwatchSessionProject('session-headless')
    expect(watchers.find((watcher) => watcher.path === '/project/headless')?.closed).toBe(true)
  })

  test('Given 会话同时被可见与 headless 持有，When 仅移出可见集合，Then 监听保留至 headless 也释放', () => {
    const { registry, watchers } = createHarness(['/project/dual'])

    registry.watchSessionProject('session-dual', '/project/dual')
    registry.restoreSessionProjectWatches([
      { id: 'session-dual', project: project('/project/dual') },
    ])
    // 移出可见集合，但 headless 仍持有。
    registry.restoreSessionProjectWatches([])
    expect(watchers.find((watcher) => watcher.path === '/project/dual')?.closed).toBe(false)

    // headless 也释放后，监听停止。
    registry.unwatchSessionProject('session-dual')
    expect(watchers.find((watcher) => watcher.path === '/project/dual')?.closed).toBe(true)
  })
})
