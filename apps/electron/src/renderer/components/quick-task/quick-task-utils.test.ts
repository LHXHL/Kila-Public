import { describe, expect, test } from 'bun:test'
import type { SessionMeta } from '@kila/shared'
import { collectRecentProjects } from './quick-task-utils'

function session(path: string, updatedAt: number, source: 'temp' | 'user' = 'user'): SessionMeta {
  return {
    id: `${path}-${updatedAt}`,
    title: '任务',
    project: { path, name: path.split('/').at(-1)!, source, profileId: 'profile' },
    createdAt: updatedAt,
    updatedAt,
  }
}

describe('Quick Task 最近项目', () => {
  test('按最近使用去重并忽略临时项目', () => {
    expect(collectRecentProjects([
      session('/repo/a', 1),
      session('/repo/b', 2),
      session('/repo/a', 3),
      session('/tmp/kila', 4, 'temp'),
    ])).toEqual([
      { path: '/repo/a', name: 'a' },
      { path: '/repo/b', name: 'b' },
    ])
  })
})
