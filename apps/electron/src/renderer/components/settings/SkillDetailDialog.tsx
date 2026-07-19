import * as React from 'react'
import { Blocks, FolderOpen, RefreshCw, Trash2, Wand2 } from 'lucide-react'
import type { GlobalSkillDetail, GlobalSkillEntryKind } from '@kila/shared'
import { MessageResponse } from '@/components/ai-elements/message'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EntityMetadataChip } from '@/components/ui/entity-metadata-chip'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

function stripSkillFrontmatter(content: string): string {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '')
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/')
}

function resolveRelativePath(path: string, rootDir?: string): string {
  if (!rootDir) return normalizePath(path)

  const normalizedPath = normalizePath(path)
  const normalizedRoot = normalizePath(rootDir)

  if (normalizedRoot && normalizedPath.startsWith(normalizedRoot)) {
    const relative = normalizedPath.slice(normalizedRoot.length).replace(/^\/+/, '')
    return relative || normalizedPath
  }

  return normalizedPath
}

function getEntryTypeLabel(kind: GlobalSkillEntryKind): string {
  return kind === 'plugin' ? 'Plugin' : 'Skill'
}

function formatContentPreview(detail: GlobalSkillDetail | null): string {
  if (!detail) return ''
  if (detail.contentType === 'json') {
    try {
      return JSON.stringify(JSON.parse(detail.content), null, 2)
    } catch {
      return detail.content
    }
  }

  return stripSkillFrontmatter(detail.content)
}

interface MetadataRowProps {
  label: string
  value: React.ReactNode
  mono?: boolean
}

function MetadataRow({ label, value, mono = false }: MetadataRowProps): React.ReactElement {
  return (
    <div className="grid gap-2 border-b border-border/45 px-4 py-3 last:border-b-0 sm:grid-cols-[104px_minmax(0,1fr)] sm:gap-4">
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className={cn('min-w-0 text-[14px] leading-6 text-foreground', mono && 'font-mono text-[13px]')}>
        {value}
      </div>
    </div>
  )
}

interface SkillDetailDialogProps {
  open: boolean
  detail: GlobalSkillDetail | null
  loading: boolean
  installing: boolean
  skillsDir: string
  onOpenChange: (open: boolean) => void
  onUpdate: (detail: GlobalSkillDetail) => void
  onDelete: (detail: GlobalSkillDetail) => void
  onToggle: (detail: GlobalSkillDetail, enabled: boolean) => void
}

export function SkillDetailDialog({
  open,
  detail,
  loading,
  installing,
  skillsDir,
  onOpenChange,
  onUpdate,
  onDelete,
  onToggle,
}: SkillDetailDialogProps): React.ReactElement {
  const canManage = detail?.managementMode === 'managed' && detail.kind === 'skill'
  const contentPreview = React.useMemo(() => formatContentPreview(detail), [detail])
  const detailLocation = React.useMemo(() => (
    detail ? resolveRelativePath(detail.path, detail.sourceRoot ?? skillsDir) : ''
  ), [detail, skillsDir])
  const detailContentFile = React.useMemo(() => (
    detail ? resolveRelativePath(detail.contentPath, detail.sourceRoot ?? skillsDir) : ''
  ), [detail, skillsDir])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100vh-32px)] w-[calc(100vw-32px)] max-w-5xl flex-col gap-0 overflow-hidden border-border/60 bg-background p-0 shadow-2xl">
        <DialogHeader className="shrink-0 border-b border-border/50 bg-card/82 px-5 py-4 pr-14 text-left sm:px-6 sm:py-5 sm:pr-14">
          <DialogTitle className="sr-only">{detail?.name ?? '技能详情'}</DialogTitle>
          <DialogDescription className="sr-only">
            查看技能或插件的元数据、原始内容和可用操作。
          </DialogDescription>

          {detail ? (
            <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border/55 bg-[hsl(var(--kila-accent-muted))] text-primary">
                  {detail.kind === 'plugin'
                    ? <Blocks className="size-5" />
                    : <Wand2 className="size-5" />}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 break-words text-[22px] font-medium leading-tight tracking-tight text-foreground sm:text-[26px]">
                      {detail.name}
                    </div>
                    <EntityMetadataChip>{detail.sourceLabel}</EntityMetadataChip>
                    <EntityMetadataChip tone="accent">{getEntryTypeLabel(detail.kind)}</EntityMetadataChip>
                    {canManage ? (
                      <EntityMetadataChip tone={detail.enabled ? 'accent' : 'neutral'}>
                        {detail.enabled ? '已启用' : '已停用'}
                      </EntityMetadataChip>
                    ) : (
                      <EntityMetadataChip>只读</EntityMetadataChip>
                    )}
                  </div>

                  <div className="mt-2 inline-flex max-w-full rounded-md border border-border/55 bg-background/72 px-2.5 py-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground/78">
                    <span className="truncate">{detail.slug}</span>
                  </div>

                  <div className="mt-2 max-w-3xl break-words text-[13px] leading-5 text-muted-foreground">
                    {detail.description ?? '该条目未提供简介，可在下方查看原始内容。'}
                  </div>
                </div>
              </div>

              <div className="flex min-w-0 flex-wrap items-center gap-2 xl:shrink-0 xl:justify-end">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="打开所在目录"
                      onClick={() => { void window.electronAPI.openGlobalAgentPath(detail.path) }}
                      className="rounded-xl border border-border/60 bg-background/80 p-3 text-muted-foreground transition-colors hover:border-primary/25 hover:bg-[hsl(var(--kila-accent-muted))] hover:text-foreground"
                    >
                      <FolderOpen className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>打开所在目录</TooltipContent>
                </Tooltip>

                {canManage && (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label="更新 Skill"
                          onClick={() => onUpdate(detail)}
                          disabled={installing}
                          className="rounded-xl border border-border/60 bg-background/80 p-3 text-muted-foreground transition-colors hover:border-primary/25 hover:bg-[hsl(var(--kila-accent-muted))] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <RefreshCw className={cn('size-4', installing && 'animate-spin')} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>根据来源锁更新 Skill</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label="删除 Skill"
                          onClick={() => onDelete(detail)}
                          className="rounded-xl border border-border/60 bg-background/80 p-3 text-muted-foreground transition-colors hover:border-destructive/25 hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>删除 Skill</TooltipContent>
                    </Tooltip>

                    <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/80 px-3 py-2">
                      <span className="text-[12px] text-muted-foreground">启用</span>
                      <Switch
                        checked={detail.enabled}
                        onCheckedChange={(enabled) => onToggle(detail, enabled)}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="min-w-0 space-y-6 p-4 sm:p-6">
            {loading ? (
              <div className="flex min-h-[360px] items-center justify-center text-sm text-muted-foreground">
                正在加载详情...
              </div>
            ) : detail ? (
              <>
                <section className="space-y-3">
                  <div className="px-1 text-[13px] font-semibold text-foreground">元数据</div>
                  <div className="overflow-hidden rounded-[18px] border border-border/55 bg-card/65">
                    <MetadataRow label="标识符" value={detail.id} mono />
                    <MetadataRow label="名称" value={detail.name} />
                    <MetadataRow label="来源" value={detail.sourceLabel} />
                    <MetadataRow label="类型" value={getEntryTypeLabel(detail.kind)} />
                    <MetadataRow label="模式" value={detail.managementMode === 'managed' ? 'Kila 管理' : '只读浏览'} />
                    <MetadataRow label="位置" value={<span className="break-all">{detailLocation}</span>} mono />
                    <MetadataRow label="目录" value={<span className="break-all">{detail.path}</span>} mono />
                    <MetadataRow label="内容文件" value={<span className="break-all">{detailContentFile}</span>} mono />
                  </div>
                </section>

                <section className="space-y-3">
                  <div className="px-1 text-[13px] font-semibold text-foreground">内容</div>
                  <div className="overflow-hidden rounded-[18px] border border-border/55 bg-card/65">
                    <div className="border-b border-border/45 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
                      {detail.contentType === 'json' ? 'plugin.json' : 'SKILL.md'}
                    </div>
                    <div className="min-w-0 px-4 py-4 sm:px-5 sm:py-5">
                      {detail.contentType === 'json' ? (
                        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-[16px] border border-border/45 bg-[hsl(var(--code-surface))] p-4 font-mono text-[12px] leading-6 text-foreground">
                          {contentPreview}
                        </pre>
                      ) : (
                        <MessageResponse
                          basePath={detail.path}
                          className={cn(
                            '[&_h1]:font-sans [&_h2]:font-sans [&_h3]:font-sans',
                            '[&_h1]:break-words [&_h2]:break-words [&_h3]:break-words',
                            '[&_h1]:text-[24px] [&_h2]:text-[20px] [&_h3]:text-[17px] sm:[&_h1]:text-[28px] sm:[&_h2]:text-[22px]',
                            '[&_a]:break-all [&_li]:break-words [&_p]:break-words [&_p]:text-[14px]',
                            '[&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:bg-[hsl(var(--code-surface))]',
                          )}
                          compact
                        >
                          {contentPreview}
                        </MessageResponse>
                      )}
                    </div>
                  </div>
                </section>
              </>
            ) : (
              <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
                详情加载失败，请关闭后重试。
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
