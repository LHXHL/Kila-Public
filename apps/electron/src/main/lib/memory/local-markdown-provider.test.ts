import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalMarkdownMemoryProvider } from './local-markdown-provider'

let rootDir = ''

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'kila-local-memory-'))
})

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true })
})

function createProvider(): LocalMarkdownMemoryProvider {
  return new LocalMarkdownMemoryProvider({
    globalRoot: join(rootDir, 'memory'),
    projectRoot: (projectPath) => join(rootDir, 'project-memory', Buffer.from(projectPath).toString('hex').slice(0, 16)),
  })
}

describe('LocalMarkdownMemoryProvider', () => {
  test('Given 无外部服务，When 写入长期记忆，Then 生成可读 Markdown 并可重新读取', async () => {
    const provider = createProvider()
    await provider.initialize()

    const created = await provider.write({
      title: '认证决策',
      content: '认证统一使用 httpOnly Cookie。',
      category: 'decision',
      tags: ['auth'],
      sourceSessionId: 'session-1',
    })

    expect(created.uri).toStartWith('memory://global/')
    expect(await provider.read(created.uri)).toEqual(created)
    const path = join(rootDir, 'memory', 'entries', `${created.id}.md`)
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf-8')).toContain('# 认证决策')
    expect(readFileSync(path, 'utf-8')).toContain('httpOnly Cookie')
  })

  test('Given 中英文记忆，When 使用相关查询，Then 本地词法检索返回正确条目', async () => {
    const provider = createProvider()
    await provider.write({ title: '状态管理', content: '所有 renderer 状态统一使用 Jotai。', category: 'decision' })
    await provider.write({ title: 'Auth cookies', content: 'Use secure httpOnly cookies for authentication.', category: 'decision' })

    const chinese = await provider.search({ query: '状态管理使用什么', limit: 2 })
    const english = await provider.search({ query: 'authentication cookie', limit: 2 })

    expect(chinese[0]?.entry.title).toBe('状态管理')
    expect(english[0]?.entry.title).toBe('Auth cookies')
  })

  test('Given 同一毫秒写入全局和项目记忆，When 列出记忆，Then 保持真实写入顺序且不污染项目目录', async () => {
    const provider = new LocalMarkdownMemoryProvider({
      globalRoot: join(rootDir, 'memory'),
      projectRoot: (projectPath) => join(rootDir, 'project-memory', Buffer.from(projectPath).toString('hex').slice(-16)),
      now: () => 1_000,
    })
    const projectPath = join(rootDir, 'project')
    await provider.write({ title: '全局偏好', content: '回复使用中文。', category: 'preference' })
    await provider.write({ title: '项目约束', content: '本项目使用 Bun。', category: 'decision', projectPath })

    const entries = await provider.list({ projectPath, limit: 10 })
    expect(entries.map((entry) => entry.title)).toEqual(['项目约束', '全局偏好'])
    expect(existsSync(join(projectPath, '.kila'))).toBe(false)
  })

  test('Given 多个项目都写入长期记忆，When 设置页请求全部记忆，Then 返回全局与所有项目条目', async () => {
    const provider = createProvider()
    await provider.write({ title: '全局偏好', content: '回复使用中文。', category: 'preference' })
    await provider.write({ title: '项目 A', content: '项目 A 使用 Bun。', category: 'decision', projectPath: join(rootDir, 'project-a') })
    await provider.write({ title: '项目 B', content: '项目 B 使用 React。', category: 'decision', projectPath: join(rootDir, 'project-b') })

    const entries = await provider.list({ limit: 10 })
    expect(new Set(entries.map((entry) => entry.title))).toEqual(new Set(['全局偏好', '项目 A', '项目 B']))
  })

  test('Given notebook 与 working memory，When 写入，Then 均保存为本地 Markdown', async () => {
    const provider = createProvider()
    const note = await provider.writeNotebookEntry({ title: '发布清单', content: '先跑 typecheck。' })
    const working = await provider.setWorkingMemory({ scope: 'global', content: '# Focus\n完成记忆重构。' })

    expect((await provider.readNotebookEntry(note.uri))?.content).toBe('先跑 typecheck。')
    expect(working.content).toContain('完成记忆重构')
    expect(readFileSync(join(rootDir, 'memory', 'WORKING.md'), 'utf-8')).toContain('完成记忆重构')
  })
})
