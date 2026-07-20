import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import type {
  GitChangedFile,
  GitChangesSnapshot,
  GitCommitResult,
  GitDiffHunk,
  GitDiffResult,
  GitHunkActionInput,
  GitWorktreeCreateInput,
  GitWorktreeEntry,
} from '@kila/shared'

const MAX_DIFF_BYTES = 2 * 1024 * 1024
const GIT_TIMEOUT_MS = 15_000

interface GitResult {
  stdout: string
  stderr: string
}

function runGit(projectPath: string, args: string[], options?: { allowFailure?: boolean }): GitResult {
  const result = spawnSync('git', args, {
    cwd: projectPath,
    encoding: 'utf-8',
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_DIFF_BYTES + 256 * 1024,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  if (result.error) throw result.error
  if (result.status !== 0 && !options?.allowFailure) {
    throw new Error((result.stderr || result.stdout || `Git 命令失败 (${result.status})`).trim())
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function resolveProjectPath(projectPath: string): string {
  if (typeof projectPath !== 'string' || !projectPath.trim()) throw new Error('缺少项目目录')
  const resolved = resolve(projectPath)
  if (!existsSync(resolved)) throw new Error('项目目录不存在')
  return realpathSync(resolved)
}

function findRepoRoot(projectPath: string): string | null {
  const result = runGit(projectPath, ['rev-parse', '--show-toplevel'], { allowFailure: true })
  const root = result.stdout.trim()
  if (root) return realpathSync(root)
  if (/not a git repository/i.test(result.stderr)) return null
  throw new Error((result.stderr || '无法检测 Git 仓库状态').trim())
}

function getRepoRoot(projectPath: string): string {
  const root = findRepoRoot(projectPath)
  if (!root) throw new Error('当前项目不是 Git 仓库')
  return root
}

function assertRepoRelativePath(repoRoot: string, filePath: string): string {
  if (typeof filePath !== 'string' || !filePath.trim() || filePath.includes('\0')) throw new Error('文件路径无效')
  const candidate = isAbsolute(filePath) ? resolve(filePath) : resolve(repoRoot, filePath)
  const rel = relative(repoRoot, candidate)
  if (!rel || rel.startsWith('..') || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('文件路径超出 Git 仓库范围')
  }
  return rel.split(sep).join('/')
}

function parsePorcelainV1(raw: string): GitChangedFile[] {
  if (!raw) return []
  const records = raw.split('\0')
  const files: GitChangedFile[] = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record || record.length < 4) continue
    const indexStatus = record[0]!
    const worktreeStatus = record[1]!
    let path = record.slice(3)
    let originalPath: string | undefined
    if (indexStatus === 'R' || indexStatus === 'C') {
      originalPath = path
      path = records[index + 1] ?? path
      index += 1
    }
    files.push({
      path,
      originalPath,
      indexStatus,
      worktreeStatus,
      staged: indexStatus !== ' ' && indexStatus !== '?',
      unstaged: worktreeStatus !== ' ' && worktreeStatus !== '?',
      untracked: indexStatus === '?' && worktreeStatus === '?',
      conflicted: indexStatus === 'U' || worktreeStatus === 'U' || `${indexStatus}${worktreeStatus}` === 'AA' || `${indexStatus}${worktreeStatus}` === 'DD',
    })
  }
  return files
}

function parseDiffHunks(diff: string): GitDiffHunk[] {
  const lines = diff.split('\n')
  const hunks: GitDiffHunk[] = []
  let prefix: string[] = []
  let current: string[] | null = null
  for (const line of lines) {
    if (line.startsWith('@@ ')) {
      if (current) {
        const patch = [...prefix, ...current].join('\n') + '\n'
        hunks.push({
          index: hunks.length,
          header: current[0] ?? '',
          patch,
          additions: current.filter((entry) => entry.startsWith('+') && !entry.startsWith('+++')).length,
          deletions: current.filter((entry) => entry.startsWith('-') && !entry.startsWith('---')).length,
        })
      }
      current = [line]
      continue
    }
    if (current) current.push(line)
    else prefix.push(line)
  }
  if (current) {
    const patch = [...prefix, ...current].join('\n') + '\n'
    hunks.push({
      index: hunks.length,
      header: current[0] ?? '',
      patch,
      additions: current.filter((entry) => entry.startsWith('+') && !entry.startsWith('+++')).length,
      deletions: current.filter((entry) => entry.startsWith('-') && !entry.startsWith('---')).length,
    })
  }
  return hunks
}

function parseAheadBehind(raw: string): { ahead: number; behind: number } {
  const match = raw.match(/# branch\.ab \+(\d+) -(\d+)/)
  return match ? { ahead: Number(match[1]), behind: Number(match[2]) } : { ahead: 0, behind: 0 }
}

export function initGitRepository(projectPath: string): GitChangesSnapshot {
  const cwd = resolveProjectPath(projectPath)
  if (findRepoRoot(cwd)) return getGitChanges(cwd)
  runGit(cwd, ['init'])
  return getGitChanges(cwd)
}

export function getGitChanges(projectPath: string): GitChangesSnapshot {
  const cwd = resolveProjectPath(projectPath)
  const rootPath = findRepoRoot(cwd)
  if (!rootPath) {
    return {
      isRepo: false,
      rootPath: null,
      branch: null,
      hasChanges: false,
      remoteUrl: null,
      files: [],
      ahead: 0,
      behind: 0,
    }
  }
  const statusV1 = runGit(rootPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).stdout
  const statusV2 = runGit(rootPath, ['status', '--porcelain=v2', '--branch', '-z']).stdout
  const branchRaw = runGit(rootPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true }).stdout.trim()
  const remoteUrl = runGit(rootPath, ['config', '--get', 'remote.origin.url'], { allowFailure: true }).stdout.trim()
  const files = parsePorcelainV1(statusV1)
  const divergence = parseAheadBehind(statusV2.replaceAll('\0', '\n'))
  return {
    isRepo: true,
    rootPath,
    branch: branchRaw || null,
    hasChanges: files.length > 0,
    remoteUrl: remoteUrl || null,
    files,
    ...divergence,
  }
}

export function getGitFileDiff(projectPath: string, filePath: string, staged = false): GitDiffResult {
  const cwd = resolveProjectPath(projectPath)
  const rootPath = getRepoRoot(cwd)
  const safePath = assertRepoRelativePath(rootPath, filePath)
  const args = staged
    ? ['diff', '--cached', '--no-ext-diff', '--no-color', '--', safePath]
    : ['diff', '--no-ext-diff', '--no-color', '--', safePath]
  let diff = runGit(rootPath, args).stdout
  if (!diff && !staged) {
    const untracked = runGit(rootPath, ['ls-files', '--others', '--exclude-standard', '--', safePath]).stdout.trim()
    if (untracked) {
      diff = runGit(rootPath, ['diff', '--no-index', '--no-color', '--', '/dev/null', safePath], { allowFailure: true }).stdout
    }
  }
  const bytes = Buffer.byteLength(diff)
  const normalizedDiff = bytes > MAX_DIFF_BYTES ? Buffer.from(diff).subarray(0, MAX_DIFF_BYTES).toString('utf-8') : diff
  return {
    filePath: safePath,
    staged,
    diff: normalizedDiff,
    truncated: bytes > MAX_DIFF_BYTES,
    hunks: bytes > MAX_DIFF_BYTES ? [] : parseDiffHunks(normalizedDiff),
  }
}

export function applyGitHunk(input: GitHunkActionInput): GitChangesSnapshot {
  const cwd = resolveProjectPath(input.projectPath)
  const rootPath = getRepoRoot(cwd)
  const safePath = assertRepoRelativePath(rootPath, input.filePath)
  if (!Number.isInteger(input.hunkIndex) || input.hunkIndex < 0) throw new Error('Hunk 索引无效')
  if (input.source === 'staged' && input.action === 'stage') throw new Error('已暂存 Hunk 不能重复暂存')
  if (input.source === 'unstaged' && input.action === 'unstage') throw new Error('未暂存 Hunk 不能取消暂存')
  const source = getGitFileDiff(rootPath, safePath, input.source === 'staged')
  if (source.truncated) throw new Error('Diff 已截断，不能执行 Hunk 操作')
  const hunk = source.hunks[input.hunkIndex]
  if (!hunk) throw new Error('Hunk 不存在或已变化，请刷新后重试')
  const args = ['apply', '--whitespace=nowarn']
  if (input.action === 'stage') args.push('--cached')
  else if (input.action === 'unstage') args.push('--cached', '--reverse')
  else args.push('--reverse')
  const result = spawnSync('git', args, {
    cwd: rootPath,
    input: hunk.patch,
    encoding: 'utf-8',
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'Hunk 操作失败').trim())
  return getGitChanges(rootPath)
}

function normalizeFilePaths(projectPath: string, filePaths: string[]): { rootPath: string; paths: string[] } {
  const cwd = resolveProjectPath(projectPath)
  const rootPath = getRepoRoot(cwd)
  if (!Array.isArray(filePaths) || filePaths.length === 0 || filePaths.length > 500) throw new Error('请选择 1-500 个文件')
  return { rootPath, paths: [...new Set(filePaths.map((path) => assertRepoRelativePath(rootPath, path)))] }
}

export function stageGitFiles(projectPath: string, filePaths: string[]): GitChangesSnapshot {
  const { rootPath, paths } = normalizeFilePaths(projectPath, filePaths)
  runGit(rootPath, ['add', '--', ...paths])
  return getGitChanges(rootPath)
}

export function unstageGitFiles(projectPath: string, filePaths: string[]): GitChangesSnapshot {
  const { rootPath, paths } = normalizeFilePaths(projectPath, filePaths)
  const hasHead = runGit(rootPath, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true }).stdout.trim()
  if (hasHead) runGit(rootPath, ['restore', '--staged', '--', ...paths])
  else runGit(rootPath, ['rm', '--cached', '--ignore-unmatch', '--', ...paths])
  return getGitChanges(rootPath)
}

export function discardGitFiles(projectPath: string, filePaths: string[]): GitChangesSnapshot {
  const { rootPath, paths } = normalizeFilePaths(projectPath, filePaths)
  const snapshot = getGitChanges(rootPath)
  const byPath = new Map(snapshot.files.map((file) => [file.path, file]))
  const tracked = paths.filter((path) => !byPath.get(path)?.untracked)
  const untracked = paths.filter((path) => byPath.get(path)?.untracked)
  if (tracked.length > 0) runGit(rootPath, ['restore', '--worktree', '--', ...tracked])
  if (untracked.length > 0) runGit(rootPath, ['clean', '-f', '--', ...untracked])
  return getGitChanges(rootPath)
}

export function commitGitChanges(projectPath: string, message: string): GitCommitResult {
  const cwd = resolveProjectPath(projectPath)
  const rootPath = getRepoRoot(cwd)
  const normalized = typeof message === 'string' ? message.trim() : ''
  if (!normalized || normalized.length > 10_000) throw new Error('提交信息长度必须为 1-10000 字符')
  const result = runGit(rootPath, ['commit', '-m', normalized])
  const commitHash = runGit(rootPath, ['rev-parse', 'HEAD']).stdout.trim()
  return { commitHash, summary: result.stdout.trim() }
}

export function listGitWorktrees(projectPath: string): GitWorktreeEntry[] {
  const cwd = resolveProjectPath(projectPath)
  const rootPath = getRepoRoot(cwd)
  const raw = runGit(rootPath, ['worktree', 'list', '--porcelain', '-z']).stdout
  return raw.split('\0\0').map((block) => block.trim()).filter(Boolean).map((block) => {
    const lines = block.split('\0').flatMap((line) => line.split('\n')).filter(Boolean)
    const entry: GitWorktreeEntry = { path: '', head: '', branch: null, bare: false, detached: false, locked: false, prunable: false }
    for (const line of lines) {
      const [key, ...rest] = line.split(' ')
      const value = rest.join(' ')
      if (key === 'worktree') entry.path = value
      else if (key === 'HEAD') entry.head = value
      else if (key === 'branch') entry.branch = value.replace(/^refs\/heads\//, '')
      else if (key === 'bare') entry.bare = true
      else if (key === 'detached') entry.detached = true
      else if (key === 'locked') entry.locked = true
      else if (key === 'prunable') entry.prunable = true
    }
    return entry
  })
}


export function createGitWorktree(input: GitWorktreeCreateInput): GitWorktreeEntry[] {
  const cwd = resolveProjectPath(input.projectPath)
  const rootPath = getRepoRoot(cwd)
  if (typeof input.worktreePath !== 'string' || !input.worktreePath.trim() || input.worktreePath.includes('\0')) throw new Error('Worktree 路径无效')
  const target = resolve(input.worktreePath.trim())
  if (existsSync(target)) throw new Error('Worktree 目标路径已存在')
  const branch = typeof input.branch === 'string' ? input.branch.trim() : ''
  if (branch && (!/^[A-Za-z0-9._/-]{1,200}$/.test(branch) || branch.startsWith('-') || branch.includes('..'))) throw new Error('分支名称无效')
  const args = ['worktree', 'add']
  if (input.createBranch) {
    if (!branch) throw new Error('创建新分支时必须提供分支名称')
    args.push('-b', branch)
  }
  args.push(target)
  if (branch && !input.createBranch) args.push(branch)
  runGit(rootPath, args)
  return listGitWorktrees(rootPath)
}

export function removeGitWorktree(projectPath: string, worktreePath: string): GitWorktreeEntry[] {
  const cwd = resolveProjectPath(projectPath)
  const rootPath = getRepoRoot(cwd)
  if (typeof worktreePath !== 'string' || !worktreePath.trim() || worktreePath.includes('\0')) throw new Error('Worktree 路径无效')
  const target = realpathSync(resolve(worktreePath))
  if (target === rootPath) throw new Error('不能移除主 Worktree')
  const known = listGitWorktrees(rootPath).some((entry) => entry.path === target)
  if (!known) throw new Error('目标不是当前仓库的 Worktree')
  runGit(rootPath, ['worktree', 'remove', target])
  return listGitWorktrees(rootPath)
}
