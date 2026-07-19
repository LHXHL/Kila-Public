import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionProject } from '@kila/shared'
import { ensureSessionProjectReady } from './session-project-manager'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'kila-session-project-test-'))
  tempDirs.push(root)
  return root
}

function createProject(path: string, source: SessionProject['source']): SessionProject {
  return {
    path,
    name: 'test-project',
    source,
    profileId: 'profile-test',
  }
}

describe('session project availability', () => {
  test('Given 系统已清理临时项目，When Session 恢复，Then 重建原目录供 Pi runtime 继续使用', () => {
    const root = createRoot()
    const projectPath = join(root, 'missing-temp-project')

    const result = ensureSessionProjectReady(createProject(projectPath, 'temp'))

    expect(result).toEqual({ restored: true })
    expect(existsSync(projectPath)).toBe(true)
  })

  test('Given 用户项目目录丢失，When runtime 启动前校验，Then 明确报错且不创建空目录', () => {
    const root = createRoot()
    const projectPath = join(root, 'missing-user-project')

    expect(() => ensureSessionProjectReady(createProject(projectPath, 'user')))
      .toThrow('会话项目目录不存在，请重新选择项目目录')
    expect(existsSync(projectPath)).toBe(false)
  })

  test('Given 项目路径被普通文件占用，When runtime 启动前校验，Then 拒绝把文件当作工作目录', () => {
    const root = createRoot()
    const projectPath = join(root, 'not-a-directory')
    writeFileSync(projectPath, 'occupied', 'utf-8')

    expect(() => ensureSessionProjectReady(createProject(projectPath, 'temp')))
      .toThrow('会话项目路径不是目录')
  })

  test('Given 项目目录仍存在，When runtime 启动前校验，Then 保持目录且不报告恢复', () => {
    const root = createRoot()
    const projectPath = join(root, 'existing-temp')
    mkdirSync(projectPath, { recursive: true })

    const result = ensureSessionProjectReady(createProject(projectPath, 'temp'))

    expect(result).toEqual({ restored: false })
    expect(existsSync(projectPath)).toBe(true)
  })
})
