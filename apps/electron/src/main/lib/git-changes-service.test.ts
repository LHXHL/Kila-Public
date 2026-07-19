import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  applyGitHunk,
  commitGitChanges,
  createGitWorktree,
  discardGitFiles,
  getGitChanges,
  getGitFileDiff,
  listGitWorktrees,
  removeGitWorktree,
  stageGitFiles,
  unstageGitFiles,
} from './git-changes-service'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8' })
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

function createRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kila-git-changes-test-'))
  tempDirs.push(dir)
  git(dir, ['init'])
  git(dir, ['config', 'user.name', 'Kila Test'])
  git(dir, ['config', 'user.email', 'kila@example.test'])
  writeFileSync(join(dir, 'tracked.txt'), 'first\n', 'utf-8')
  git(dir, ['add', 'tracked.txt'])
  git(dir, ['commit', '-m', 'initial'])
  return dir
}

describe('git changes service', () => {
  test('Given tracked 与 untracked 变更，When 获取快照，Then 解析状态并返回仓库根目录', () => {
    const repo = createRepo()
    writeFileSync(join(repo, 'tracked.txt'), 'first\nsecond\n', 'utf-8')
    writeFileSync(join(repo, 'new.txt'), 'new\n', 'utf-8')

    const snapshot = getGitChanges(repo)

    expect(snapshot.isRepo).toBe(true)
    expect(snapshot.rootPath).toBe(realpathSync(repo))
    expect(snapshot.hasChanges).toBe(true)
    expect(snapshot.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'tracked.txt', unstaged: true, untracked: false }),
      expect.objectContaining({ path: 'new.txt', untracked: true }),
    ]))
  })

  test('Given 修改文件，When 获取工作区和暂存区 Diff，Then 返回对应 patch', () => {
    const repo = createRepo()
    writeFileSync(join(repo, 'tracked.txt'), 'changed\n', 'utf-8')
    const working = getGitFileDiff(repo, 'tracked.txt')
    expect(working.diff).toContain('-first')
    expect(working.diff).toContain('+changed')
    expect(working.hunks).toHaveLength(1)
    expect(working.hunks[0]).toMatchObject({ index: 0, additions: 1, deletions: 1 })

    stageGitFiles(repo, ['tracked.txt'])
    const staged = getGitFileDiff(repo, 'tracked.txt', true)
    expect(staged.diff).toContain('+changed')
  })

  test('Given 文件变更，When 暂存、取消暂存与丢弃，Then 状态机正确转换', () => {
    const repo = createRepo()
    writeFileSync(join(repo, 'tracked.txt'), 'changed\n', 'utf-8')
    writeFileSync(join(repo, 'new.txt'), 'new\n', 'utf-8')

    expect(stageGitFiles(repo, ['tracked.txt', 'new.txt']).files.every((file) => file.staged)).toBe(true)
    const unstaged = unstageGitFiles(repo, ['tracked.txt', 'new.txt'])
    expect(unstaged.files.find((file) => file.path === 'tracked.txt')?.unstaged).toBe(true)
    expect(unstaged.files.find((file) => file.path === 'new.txt')?.untracked).toBe(true)

    const clean = discardGitFiles(repo, ['tracked.txt', 'new.txt'])
    expect(clean.hasChanges).toBe(false)
    expect(readFileSync(join(repo, 'tracked.txt'), 'utf-8')).toBe('first\n')
  })

  test('Given 已暂存变更，When 提交，Then 返回 commit hash 并清空 Changes', () => {
    const repo = createRepo()
    writeFileSync(join(repo, 'tracked.txt'), 'committed\n', 'utf-8')
    stageGitFiles(repo, ['tracked.txt'])

    const result = commitGitChanges(repo, 'test: commit change')

    expect(result.commitHash).toMatch(/^[0-9a-f]{40}$/)
    expect(git(repo, ['log', '-1', '--pretty=%s'])).toBe('test: commit change')
    expect(getGitChanges(repo).hasChanges).toBe(false)
  })

  test('Given 路径穿越，When 执行 Diff 或变更操作，Then 在 Git 前拒绝', () => {
    const repo = createRepo()
    expect(() => getGitFileDiff(repo, '../secret.txt')).toThrow('超出 Git 仓库范围')
    expect(() => stageGitFiles(repo, ['/tmp/secret.txt'])).toThrow('超出 Git 仓库范围')
  })


  test('Given 文件包含两个独立 Hunk，When 暂存并取消其中一个，Then 仅目标 Hunk 状态转换', () => {
    const repo = createRepo()
    writeFileSync(join(repo, 'tracked.txt'), Array.from({ length: 30 }, (_, index) => `line-${index + 1}`).join('\n') + '\n', 'utf-8')
    git(repo, ['add', 'tracked.txt'])
    git(repo, ['commit', '-m', 'add lines'])
    const lines = readFileSync(join(repo, 'tracked.txt'), 'utf-8').split('\n')
    lines[1] = 'changed-near-start'
    lines[25] = 'changed-near-end'
    writeFileSync(join(repo, 'tracked.txt'), lines.join('\n'), 'utf-8')

    const diff = getGitFileDiff(repo, 'tracked.txt')
    expect(diff.hunks).toHaveLength(2)
    applyGitHunk({ projectPath: repo, filePath: 'tracked.txt', hunkIndex: 0, source: 'unstaged', action: 'stage' })
    expect(getGitFileDiff(repo, 'tracked.txt', true).hunks).toHaveLength(1)
    expect(getGitFileDiff(repo, 'tracked.txt').hunks).toHaveLength(1)

    applyGitHunk({ projectPath: repo, filePath: 'tracked.txt', hunkIndex: 0, source: 'staged', action: 'unstage' })
    expect(getGitFileDiff(repo, 'tracked.txt', true).hunks).toHaveLength(0)
    expect(getGitFileDiff(repo, 'tracked.txt').hunks).toHaveLength(2)
  })

  test('Given 次级 worktree，When 创建并移除，Then 列表同步更新且主 worktree 受保护', () => {
    const repo = createRepo()
    const target = join(tmpdir(), `kila-worktree-${crypto.randomUUID()}`)
    tempDirs.push(target)
    const created = createGitWorktree({ projectPath: repo, worktreePath: target, branch: 'test-worktree', createBranch: true })
    expect(created.some((entry) => entry.path === realpathSync(target) && entry.branch === 'test-worktree')).toBe(true)
    const removed = removeGitWorktree(repo, target)
    expect(removed.some((entry) => entry.path === target)).toBe(false)
    expect(() => removeGitWorktree(repo, repo)).toThrow('不能移除主 Worktree')
  })

  test('Given 普通仓库，When 枚举 worktree，Then 至少返回当前工作树和分支', () => {
    const repo = createRepo()
    const worktrees = listGitWorktrees(repo)
    expect(worktrees).toHaveLength(1)
    expect(worktrees[0]).toMatchObject({ path: realpathSync(repo), bare: false })
    expect(worktrees[0]?.branch).toEqual(expect.any(String))
  })
})
