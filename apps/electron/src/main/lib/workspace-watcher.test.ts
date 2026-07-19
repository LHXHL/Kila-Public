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
      log: () => undefined,
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
})
