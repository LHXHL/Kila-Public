import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  captureProjectSnapshot,
  diffProjectSnapshots,
  listProjectFilesystem,
} from './project-run-changes'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function createProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kila-run-changes-test-'))
  tempDirs.push(dir)
  return dir
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
}

describe('project run changes', () => {
  test('Given 普通目录，When 捕获快照，Then 使用 filesystem 模式', async () => {
    const project = createProject()
    writeFileSync(join(project, 'note.txt'), 'before')

    const snapshot = await captureProjectSnapshot(project)

    expect(snapshot.mode).toBe('filesystem')
    expect(snapshot.files.has('note.txt')).toBe(true)
  })

  test('Given 文件新增、修改与删除，When 比较运行前后快照，Then 返回全部变化路径', async () => {
    const project = createProject()
    writeFileSync(join(project, 'modified.txt'), 'before')
    writeFileSync(join(project, 'deleted.txt'), 'delete me')
    const before = await captureProjectSnapshot(project)

    writeFileSync(join(project, 'modified.txt'), 'after')
    unlinkSync(join(project, 'deleted.txt'))
    writeFileSync(join(project, 'added.txt'), 'new')
    const after = await captureProjectSnapshot(project)

    expect(diffProjectSnapshots(before, after)).toEqual(['added.txt', 'deleted.txt', 'modified.txt'])
  })

  test('Given 运行前已存在的 dirty 文件，When 内容继续变化，Then 仍识别为本次修改', async () => {
    const project = createProject()
    git(project, ['init'])
    writeFileSync(join(project, 'tracked.txt'), 'initial')
    git(project, ['add', 'tracked.txt'])
    git(project, ['-c', 'user.name=Kila Test', '-c', 'user.email=kila@example.test', 'commit', '-m', 'initial'])
    writeFileSync(join(project, 'tracked.txt'), 'dirty before run')
    const before = await captureProjectSnapshot(project)

    writeFileSync(join(project, 'tracked.txt'), 'dirty changed during run')
    const after = await captureProjectSnapshot(project)

    expect(before.mode).toBe('git')
    expect(diffProjectSnapshots(before, after)).toEqual(['tracked.txt'])
  })

  test('Given 依赖与构建目录，When 扫描项目，Then 忽略高噪音目录', async () => {
    const project = createProject()
    for (const name of ['.git', 'node_modules', 'dist', 'build', '.next', '.cache']) {
      mkdirSync(join(project, name), { recursive: true })
      writeFileSync(join(project, name, 'ignored.txt'), name)
    }
    mkdirSync(join(project, 'src'))
    writeFileSync(join(project, 'src', 'kept.ts'), 'export {}')

    const files = await listProjectFilesystem(project)

    expect([...files.keys()]).toEqual(['src/kept.ts'])
  })
})
