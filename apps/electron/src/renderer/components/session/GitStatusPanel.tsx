import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
  FolderGit2,
  Plus,
  Trash2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Undo2,
} from 'lucide-react'
import { sessionsAtom } from '@/atoms/session-atoms'
import { agentSessionDraftsAtom } from '@/atoms/agent-atoms'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { EntityMetadataChip } from '@/components/ui/entity-metadata-chip'
import { cn } from '@/lib/utils'
import { formatGitPanelError } from './git-status-panel-state'
import { GitDiffView } from './GitDiffView'
import type { GitChangedFile, GitChangesSnapshot, GitDiffResult, GitWorktreeEntry, ProjectRunChanges } from '@kila/shared'

interface GitStatusPanelProps {
  sessionId: string
}

function statusLabel(file: GitChangedFile): string {
  if (file.conflicted) return '冲突'
  if (file.untracked) return '新增'
  if (file.indexStatus === 'D' || file.worktreeStatus === 'D') return '删除'
  if (file.indexStatus === 'R' || file.worktreeStatus === 'R') return '重命名'
  return '修改'
}

function FileRow({
  file,
  selected,
  busy,
  onSelect,
  onStage,
  onUnstage,
  onDiscard,
}: {
  file: GitChangedFile
  selected: boolean
  busy: boolean
  onSelect: () => void
  onStage: () => void
  onUnstage: () => void
  onDiscard: () => void
}): React.ReactElement {
  return (
    <div className={cn('group flex items-center gap-1 rounded-lg px-2 py-1.5 transition-colors', selected ? 'bg-accent shadow-sm' : 'hover:bg-muted/55')}>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onSelect}>
        {selected ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate text-xs text-foreground" title={file.path}>{file.path}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground">{statusLabel(file)}</span>
      </button>
      <div className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {file.staged ? (
          <Button variant="ghost" size="icon-sm" title="取消暂存" disabled={busy} onClick={onUnstage}>
            <Undo2 className="size-3.5" />
          </Button>
        ) : (
          <Button variant="ghost" size="icon-sm" title="暂存" disabled={busy} onClick={onStage}>
            <Check className="size-3.5" />
          </Button>
        )}
        {(file.unstaged || file.untracked) && (
          <Button variant="ghost" size="icon-sm" title="丢弃工作区变更" disabled={busy} onClick={onDiscard}>
            <RotateCcw className="size-3.5 text-destructive" />
          </Button>
        )}
      </div>
    </div>
  )
}

export function GitStatusPanel({ sessionId }: GitStatusPanelProps): React.ReactElement {
  const sessions = useAtomValue(sessionsAtom)
  const setDraftsMap = useSetAtom(agentSessionDraftsAtom)
  const session = sessions.find((candidate) => candidate.id === sessionId) ?? null
  const projectPath = session?.project.path
  const [snapshot, setSnapshot] = React.useState<GitChangesSnapshot | null>(null)
  const [runChanges, setRunChanges] = React.useState<ProjectRunChanges | null>(null)
  const [onlyRunChanges, setOnlyRunChanges] = React.useState(false)
  const [worktrees, setWorktrees] = React.useState<GitWorktreeEntry[]>([])
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null)
  const [diffSource, setDiffSource] = React.useState<'staged' | 'unstaged'>('unstaged')
  const [diff, setDiff] = React.useState<GitDiffResult | null>(null)
  const [diffLoading, setDiffLoading] = React.useState(false)
  const [diffError, setDiffError] = React.useState<string | null>(null)
  const [diffRetryVersion, setDiffRetryVersion] = React.useState(0)
  const [commitMessage, setCommitMessage] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [busyPath, setBusyPath] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [worktreeOpen, setWorktreeOpen] = React.useState(false)
  const [worktreePath, setWorktreePath] = React.useState('')
  const [worktreeBranch, setWorktreeBranch] = React.useState('')

  const refresh = React.useCallback(async () => {
    if (!projectPath) return
    setLoading(true)
    setError(null)
    try {
      const [next, nextRunChanges] = await Promise.all([
        window.electronAPI.getGitChanges(projectPath),
        window.electronAPI.getProjectRunChanges(sessionId).catch(() => null),
      ])
      setSnapshot(next)
      setRunChanges(nextRunChanges)
      setSelectedPath((current) => current && next.files.some((file) => file.path === current) ? current : null)

      if (!next.isRepo) {
        setWorktrees([])
        return
      }

      try {
        setWorktrees(await window.electronAPI.listGitWorktrees(projectPath))
      } catch (caught) {
        setWorktrees([])
        setError(formatGitPanelError(caught))
      }
    } catch (caught) {
      setSnapshot(null)
      setWorktrees([])
      setError(formatGitPanelError(caught))
    } finally {
      setLoading(false)
    }
  }, [projectPath, sessionId])

  React.useEffect(() => { void refresh() }, [refresh])

  const initializeRepository = React.useCallback(async () => {
    if (!projectPath) return
    setBusyPath('*')
    setError(null)
    try {
      const next = await window.electronAPI.initGitRepository(projectPath)
      setSnapshot(next)
      setWorktrees(await window.electronAPI.listGitWorktrees(projectPath))
    } catch (caught) {
      setError(formatGitPanelError(caught))
    } finally {
      setBusyPath(null)
    }
  }, [projectPath])

  const insertPathIntoComposer = React.useCallback((path: string) => {
    setDraftsMap((previous) => {
      const current = previous.get(sessionId) ?? ''
      const separator = current.length > 0 && !/\s$/.test(current) ? ' ' : ''
      const next = new Map(previous)
      next.set(sessionId, `${current}${separator}@${path} `)
      return next
    })
  }, [sessionId, setDraftsMap])

  const prepareRunReview = React.useCallback((): void => {
    const paths = runChanges?.changedPaths ?? []
    if (paths.length === 0) return
    const reviewPrompt = [
      '请审查本次 Agent 运行产生的修改，重点检查正确性、回归风险和缺失测试：',
      ...paths.map((path) => `- @${path}`),
      '审查后给出可执行的修复项，并说明验证结果。',
    ].join('\n')
    setDraftsMap((previous) => {
      const current = previous.get(sessionId)?.trim() ?? ''
      const next = new Map(previous)
      next.set(sessionId, current ? `${current}\n\n${reviewPrompt}` : reviewPrompt)
      return next
    })
  }, [runChanges?.changedPaths, sessionId, setDraftsMap])

  const runPaths = new Set(runChanges?.changedPaths ?? [])

  const selectFile = React.useCallback((file: GitChangedFile, source: 'staged' | 'unstaged') => {
    setSelectedPath(file.path)
    setDiffSource(source)
  }, [])

  const selectedFile = snapshot?.files.find((file) => file.path === selectedPath) ?? null
  React.useEffect(() => {
    if (!projectPath || !selectedFile) {
      setDiff(null)
      setDiffLoading(false)
      setDiffError(null)
      return
    }
    let cancelled = false
    setDiff(null)
    setDiffLoading(true)
    setDiffError(null)
    window.electronAPI.getGitDiff({ projectPath, filePath: selectedFile.path, staged: diffSource === 'staged' })
      .then((result) => { if (!cancelled) setDiff(result) })
      .catch((caught) => {
        if (!cancelled) setDiffError(formatGitPanelError(caught))
      })
      .finally(() => { if (!cancelled) setDiffLoading(false) })
    return () => { cancelled = true }
  }, [diffRetryVersion, diffSource, projectPath, selectedFile])

  const mutateFiles = React.useCallback(async (
    action: 'stage' | 'unstage' | 'discard',
    filePaths: string[],
  ) => {
    if (!projectPath) return
    if (action === 'discard' && !window.confirm(`确认丢弃 ${filePaths.length} 个文件的工作区变更？此操作不可撤销。`)) return
    setBusyPath(filePaths.length === 1 ? filePaths[0]! : '*')
    setError(null)
    try {
      const input = { projectPath, filePaths }
      const next = action === 'stage'
        ? await window.electronAPI.stageGitFiles(input)
        : action === 'unstage'
          ? await window.electronAPI.unstageGitFiles(input)
          : await window.electronAPI.discardGitFiles(input)
      setSnapshot(next)
      if (selectedPath && !next.files.some((file) => file.path === selectedPath)) setSelectedPath(null)
    } catch (caught) {
      setError(formatGitPanelError(caught))
    } finally {
      setBusyPath(null)
    }
  }, [projectPath, selectedPath])

  const mutateHunk = React.useCallback(async (hunkIndex: number, action: 'stage' | 'unstage' | 'discard') => {
    if (!projectPath || !selectedFile) return
    if (action === 'discard' && !window.confirm('确认丢弃这个 Hunk？此操作不可撤销。')) return
    setBusyPath(selectedFile.path)
    setError(null)
    try {
      const next = await window.electronAPI.applyGitHunk({
        projectPath,
        filePath: selectedFile.path,
        hunkIndex,
        source: diffSource,
        action,
      })
      setSnapshot(next)
      if (!next.files.some((file) => file.path === selectedFile.path)) setSelectedPath(null)
    } catch (caught) {
      setError(formatGitPanelError(caught))
    } finally {
      setBusyPath(null)
    }
  }, [diffSource, projectPath, selectedFile])

  const createWorktree = React.useCallback(async () => {
    if (!projectPath || !worktreePath.trim() || !worktreeBranch.trim()) return
    setBusyPath('*')
    setError(null)
    try {
      const next = await window.electronAPI.createGitWorktree({
        projectPath,
        worktreePath: worktreePath.trim(),
        branch: worktreeBranch.trim(),
        createBranch: true,
      })
      setWorktrees(next)
      setWorktreePath('')
      setWorktreeBranch('')
      setWorktreeOpen(false)
    } catch (caught) {
      setError(formatGitPanelError(caught))
    } finally {
      setBusyPath(null)
    }
  }, [projectPath, worktreeBranch, worktreePath])

  const removeWorktree = React.useCallback(async (path: string) => {
    if (!projectPath || !window.confirm(`确认移除 Worktree？\n${path}`)) return
    setBusyPath('*')
    setError(null)
    try {
      setWorktrees(await window.electronAPI.removeGitWorktree({ projectPath, worktreePath: path }))
    } catch (caught) {
      setError(formatGitPanelError(caught))
    } finally {
      setBusyPath(null)
    }
  }, [projectPath])

  const handleCommit = React.useCallback(async () => {
    if (!projectPath || !commitMessage.trim()) return
    setBusyPath('*')
    setError(null)
    try {
      await window.electronAPI.commitGitChanges({ projectPath, message: commitMessage })
      setCommitMessage('')
      await refresh()
    } catch (caught) {
      setError(formatGitPanelError(caught))
    } finally {
      setBusyPath(null)
    }
  }, [commitMessage, projectPath, refresh])

  if (!projectPath) return <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">当前会话没有项目目录。</div>
  if (loading && !snapshot) {
    return <div role="status" className="flex h-full items-center justify-center gap-2 px-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />正在读取 Git 状态…</div>
  }
  if (!loading && !snapshot) {
    return (
      <div className="flex h-full items-center justify-center px-6 py-8">
        <div role="alert" className="flex w-full max-w-md flex-col items-center gap-3 px-6 py-7 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive"><GitBranch className="size-6" /></div>
          <div className="text-sm font-medium text-foreground">无法读取 Git 状态</div>
          <div className="text-xs leading-5 text-muted-foreground">{error || '读取 Git 状态失败，请稍后重试。'}</div>
          <Button variant="outline" size="sm" onClick={() => void refresh()}><RefreshCw className="mr-1.5 size-3.5" />重试</Button>
        </div>
      </div>
    )
  }
  if (snapshot && !snapshot.isRepo) {
    return (
      <div className="flex h-full min-h-0 flex-col px-4 py-5 text-sm">
        <div className="px-1 py-6 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-muted/45 text-muted-foreground"><FolderGit2 className="size-6" /></div>
          <div className="mt-3 font-medium text-foreground">此目录尚未启用 Git</div>
          <div className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">你仍可正常对话和编辑文件。初始化 Git 仓库后，这里将展示 Diff、暂存区、提交和 Worktree。</div>
          <div className="mx-auto mt-3 max-w-sm truncate rounded-md bg-muted/40 px-3 py-2 font-mono text-[10px] text-muted-foreground" title={projectPath}>{projectPath}</div>
          <div className="mt-4 flex justify-center gap-2">
            <Button size="sm" onClick={() => void initializeRepository()} disabled={busyPath !== null}>
              {busyPath === '*' ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <GitBranch className="mr-1.5 size-3.5" />}
              初始化 Git 仓库
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading || busyPath !== null}>
              <RefreshCw className={cn('mr-1.5 size-3.5', loading && 'animate-spin')} />重新检测
            </Button>
          </div>
          {error && <div role="alert" className="mx-auto mt-3 max-w-sm rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
        </div>
        {runChanges?.mode === 'filesystem' && (
          <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-lg border border-border/55 p-2 text-left">
            <div className="flex items-center justify-between px-2 py-1 text-xs">
              <span className="font-medium text-foreground">本次 Agent 修改</span>
              <EntityMetadataChip tone="neutral">文件快照 · {runChanges.changedPaths.length}</EntityMetadataChip>
            </div>
            {runChanges.changedPaths.length > 0 ? runChanges.changedPaths.map((path) => (
              <div key={path} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/45">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={path}>{path}</span>
                <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" title="插入到输入框" aria-label={`插入 ${path} 到输入框`} onClick={() => insertPathIntoComposer(path)}>
                  <Clipboard className="size-3.5" />
                </Button>
              </div>
            )) : <div className="px-2 py-4 text-center text-xs text-muted-foreground">本次运行未检测到文件变化。</div>}
          </div>
        )}
      </div>
    )
  }

  const visibleFiles = onlyRunChanges && runChanges
    ? (snapshot?.files.filter((file) => runPaths.has(file.path)) ?? [])
    : (snapshot?.files ?? [])
  const staged = visibleFiles.filter((file) => file.staged)
  const unstaged = visibleFiles.filter((file) => file.unstaged || file.untracked)

  return (
    <div className="flex h-full min-h-0 flex-col bg-workspace p-2">
      <div className="flex items-center justify-between gap-3 border-b border-border/55 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium"><GitBranch className="size-4" />{snapshot?.branch ?? 'detached'}</div>
          <div className="truncate text-[11px] text-muted-foreground">{snapshot?.rootPath ?? projectPath}</div>
        </div>
        <div className="flex items-center gap-1">
          {(snapshot?.ahead || snapshot?.behind) ? <EntityMetadataChip tone="neutral">↑{snapshot?.ahead} ↓{snapshot?.behind}</EntityMetadataChip> : null}
          {runChanges && (
            <>
              <Button
                variant={onlyRunChanges ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2 text-[10px]"
                aria-pressed={onlyRunChanges}
                onClick={() => setOnlyRunChanges((value) => !value)}
              >
                本次修改 {runChanges.changedPaths.length}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[10px]"
                disabled={runChanges.changedPaths.length === 0}
                onClick={prepareRunReview}
              >
                生成审查任务
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon-sm" onClick={() => void refresh()} disabled={loading} title="刷新">
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {error && <div className="mx-3 mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}

      <div className="mt-2 grid min-h-0 flex-1 grid-rows-[minmax(160px,40%)_minmax(0,1fr)] gap-2">
        <div className="min-h-0 overflow-y-auto px-1 py-2">
          <div className="mb-2 px-2 py-2 text-[11px] text-muted-foreground">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5"><GitFork className="size-3.5" />Worktrees · {worktrees.length}</span>
              <Button variant="ghost" size="icon-sm" title="创建 Worktree" onClick={() => setWorktreeOpen((open) => !open)}><Plus className="size-3.5" /></Button>
            </div>
            {worktreeOpen && (
              <div className="mt-2 space-y-1.5">
                <Input value={worktreePath} onChange={(event) => setWorktreePath(event.target.value)} placeholder="绝对目录路径" className="h-7 text-[11px]" />
                <div className="flex gap-1.5">
                  <Input value={worktreeBranch} onChange={(event) => setWorktreeBranch(event.target.value)} placeholder="新分支名称" className="h-7 text-[11px]" />
                  <Button size="sm" className="h-7" disabled={!worktreePath.trim() || !worktreeBranch.trim() || busyPath !== null} onClick={() => void createWorktree()}>创建</Button>
                </div>
              </div>
            )}
            {worktrees.length > 1 && <div className="mt-1.5 space-y-1">{worktrees.map((entry, index) => (
              <div key={entry.path} className="flex items-center gap-1 rounded-md px-2 py-1">
                <span className="min-w-0 flex-1 truncate" title={entry.path}>{entry.branch || 'detached'} · {entry.path}</span>
                {index > 0 && <Button variant="ghost" size="icon-sm" title="移除 Worktree" disabled={busyPath !== null || entry.locked} onClick={() => void removeWorktree(entry.path)}><Trash2 className="size-3" /></Button>}
              </div>
            ))}</div>}
          </div>
          {staged.length > 0 && (
            <section className="mb-3">
              <div className="mb-1 flex items-center justify-between px-2 text-[11px] font-medium text-muted-foreground">
                <span>已暂存 · {staged.length}</span>
                <button type="button" onClick={() => void mutateFiles('unstage', staged.map((file) => file.path))}>全部取消</button>
              </div>
              {staged.map((file) => <FileRow key={`staged:${file.path}`} file={file} selected={selectedPath === file.path} busy={busyPath !== null} onSelect={() => selectFile(file, 'staged')} onStage={() => {} } onUnstage={() => void mutateFiles('unstage', [file.path])} onDiscard={() => void mutateFiles('discard', [file.path])} />)}
            </section>
          )}
          {unstaged.length > 0 && (
            <section>
              <div className="mb-1 flex items-center justify-between px-2 text-[11px] font-medium text-muted-foreground">
                <span>更改 · {unstaged.length}</span>
                <button type="button" onClick={() => void mutateFiles('stage', unstaged.map((file) => file.path))}>全部暂存</button>
              </div>
              {unstaged.map((file) => <FileRow key={`unstaged:${file.path}`} file={file} selected={selectedPath === file.path} busy={busyPath !== null} onSelect={() => selectFile(file, 'unstaged')} onStage={() => void mutateFiles('stage', [file.path])} onUnstage={() => void mutateFiles('unstage', [file.path])} onDiscard={() => void mutateFiles('discard', [file.path])} />)}
            </section>
          )}
          {!loading && snapshot && snapshot.files.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground"><Check className="size-6 text-emerald-500" />工作区干净</div>
          )}
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border/55 bg-code-surface">
          {selectedFile ? (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-border/55 px-3 py-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-medium">{selectedFile.path}</span>
                {selectedFile.staged && (selectedFile.unstaged || selectedFile.untracked) && (
                  <div className="flex rounded-md bg-muted p-0.5 text-[10px]">
                    <button type="button" className={cn('rounded px-2 py-1', diffSource === 'unstaged' && 'bg-background shadow-sm')} onClick={() => setDiffSource('unstaged')}>工作区</button>
                    <button type="button" className={cn('rounded px-2 py-1', diffSource === 'staged' && 'bg-background shadow-sm')} onClick={() => setDiffSource('staged')}>暂存区</button>
                  </div>
                )}
                <Button variant="ghost" size="icon-sm" title="插入到输入框" onClick={() => {
                  insertPathIntoComposer(selectedFile.path)
                }}><Clipboard className="size-3.5" /></Button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {diffLoading ? (
                  <div role="status" className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />正在加载 Diff…</div>
                ) : diffError ? (
                  <div role="alert" className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-xs text-destructive">
                    <FileDiff className="size-5" />
                    <span>{diffError}</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => setDiffRetryVersion((value) => value + 1)}>重试</Button>
                  </div>
                ) : diff ? (
                  <GitDiffView
                    diff={diff}
                    source={diffSource}
                    busy={busyPath !== null}
                    onMutateHunk={(hunkIndex, action) => { void mutateHunk(hunkIndex, action) }}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
                    此文件没有可显示的文本 Diff。
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-xs text-muted-foreground"><FileDiff className="size-4" />选择文件查看 Diff</div>
          )}
          <div className="space-y-2 border-t border-border/55 p-3">
            <Textarea value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="提交信息" className="min-h-[58px] resize-none text-xs" />
            <Button className="w-full" size="sm" disabled={!commitMessage.trim() || staged.length === 0 || busyPath !== null} onClick={() => void handleCommit()}>
              {busyPath === '*' ? <Loader2 className="animate-spin" /> : <GitCommitHorizontal />}
              提交 {staged.length > 0 ? `${staged.length} 个文件` : ''}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
