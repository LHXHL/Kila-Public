import * as React from 'react'
import { DiffViewer, getLanguageDisplayName, resolveCodeLanguage } from '@/components/code-workbench'
import { Button } from '@/components/ui/button'
import type { GitDiffResult } from '@kila/shared'

interface GitDiffViewProps {
  diff: GitDiffResult
  source: 'staged' | 'unstaged'
  busy: boolean
  onMutateHunk: (hunkIndex: number, action: 'stage' | 'unstage' | 'discard') => void
}

/** Git Diff 工作台主体：按 hunk 分组，同时保留统一的源码高亮和双侧行号。 */
export function GitDiffView({
  diff,
  source,
  busy,
  onMutateHunk,
}: GitDiffViewProps): React.ReactElement {
  const language = resolveCodeLanguage(diff.filePath)

  if (diff.hunks.length === 0) {
    if (!diff.diff) {
      return (
        <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
          此文件没有可显示的文本 Diff。
        </div>
      )
    }

    return (
      <div className="min-h-full min-w-max bg-code-surface py-1">
        <DiffViewer patch={diff.diff} language={language} />
        {diff.truncated && (
          <div className="mx-3 my-3 rounded-lg bg-status-warning-soft px-3 py-2 text-xs text-status-warning-foreground">
            Diff 内容过大，当前仅展示前一部分。
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-full bg-code-surface">
      {diff.hunks.map((hunk) => (
        <section key={`${diff.staged}:${hunk.index}`} className="pb-2 last:pb-0">
          <div className="sticky top-0 z-10 flex min-h-9 items-center justify-between gap-3 bg-[hsl(var(--kila-panel-surface-raised)/0.94)] px-3 py-1.5 shadow-[0_1px_0_hsl(var(--foreground)/0.04),0_8px_20px_hsl(var(--kila-shadow-low)/0.05)] backdrop-blur-xl">
            <div className="min-w-0">
              <div className="truncate font-mono text-[10px] text-muted-foreground/80">{hunk.header}</div>
              <div className="mt-0.5 flex items-center gap-2 text-[9px] font-medium uppercase tracking-wide text-muted-foreground/55">
                <span>{getLanguageDisplayName(language)}</span>
                <span className="text-status-success-foreground">+{hunk.additions}</span>
                <span className="text-status-danger-foreground">−{hunk.deletions}</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {source === 'unstaged' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 rounded-md px-2 text-[10px] text-foreground/70"
                  disabled={busy}
                  onClick={() => onMutateHunk(hunk.index, 'stage')}
                >
                  暂存
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 rounded-md px-2 text-[10px] text-foreground/70"
                  disabled={busy}
                  onClick={() => onMutateHunk(hunk.index, 'unstage')}
                >
                  取消暂存
                </Button>
              )}
              {source === 'unstaged' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 rounded-md px-2 text-[10px] text-destructive/85 hover:bg-destructive/10 hover:text-destructive"
                  disabled={busy}
                  onClick={() => onMutateHunk(hunk.index, 'discard')}
                >
                  丢弃
                </Button>
              )}
            </div>
          </div>
          <DiffViewer patch={hunk.patch} language={language} contentOnly />
        </section>
      ))}
    </div>
  )
}
