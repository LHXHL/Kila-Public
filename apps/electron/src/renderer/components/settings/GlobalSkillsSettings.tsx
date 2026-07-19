import * as React from 'react'
import { useSetAtom } from 'jotai'
import { Blocks, Download, FolderOpen, RefreshCw, Search, Trash2, Wand2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { workspaceCapabilitiesVersionAtom } from '@/atoms/agent-atoms'
import { MessageResponse } from '@/components/ai-elements/message'
import { EntityMetadataChip } from '@/components/ui/entity-metadata-chip'
import { SettingsSection } from './primitives'
import { cn } from '@/lib/utils'
import type {
  GlobalSkillDetail,
  GlobalSkillEntry,
  GlobalSkillEntryKind,
  GlobalSkillEntrySource,
} from '@kila/shared'

const SOURCE_ORDER: GlobalSkillEntrySource[] = ['kila', 'codex', 'claude']

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

function getEntryIcon(kind: GlobalSkillEntryKind): React.ReactElement {
  return kind === 'plugin'
    ? <Blocks className="size-4" />
    : <Wand2 className="size-4" />
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

interface LibraryListItemProps {
  entry: GlobalSkillEntry
  selected: boolean
  onSelect: () => void
}

function LibraryListItem({ entry, selected, onSelect }: LibraryListItemProps): React.ReactElement {
  const preview = entry.description?.trim() || entry.slug

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'titlebar-no-drag group relative w-full rounded-[16px] border px-3.5 py-3 text-left transition-colors',
        selected
          ? 'border-border/70 bg-background/92'
          : 'border-transparent bg-transparent hover:border-border/45 hover:bg-background/58',
      )}
    >
      {selected && (
        <span className="absolute bottom-3 left-0 top-3 w-0.5 rounded-full bg-primary/75" />
      )}

      <div className="flex min-w-0 items-start gap-3">
        <div className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl border text-muted-foreground transition-colors',
          selected
            ? 'border-primary/18 bg-[hsl(var(--kila-accent-muted))] text-primary'
            : 'border-border/45 bg-background/72 group-hover:border-border/60',
        )}
        >
          {getEntryIcon(entry.kind)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">
              {entry.name}
            </div>
            {entry.managementMode === 'managed' && (
              <span
                className={cn(
                  'mt-0.5 size-2 shrink-0 rounded-full',
                  entry.enabled ? 'bg-primary/85' : 'bg-border',
                )}
              />
            )}
          </div>

          <div className="mt-1 truncate text-[12px] leading-5 text-muted-foreground">
            {preview}
          </div>

          <div className="mt-2 flex min-w-0 items-center gap-2 text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground/72">
            <span className="shrink-0">{getEntryTypeLabel(entry.kind)}</span>
            <span className="text-border/80">/</span>
            <span className="min-w-0 truncate">{entry.slug}</span>
          </div>
        </div>
      </div>
    </button>
  )
}

interface MetadataRowProps {
  label: string
  value: React.ReactNode
  mono?: boolean
}

function MetadataRow({ label, value, mono = false }: MetadataRowProps): React.ReactElement {
  return (
    <div className="grid gap-2 border-b border-border/45 px-4 py-3 last:border-b-0 md:grid-cols-[104px_minmax(0,1fr)] md:gap-4">
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className={cn('min-w-0 text-[14px] leading-6 text-foreground', mono && 'font-mono text-[13px]')}>
        {value}
      </div>
    </div>
  )
}

export function GlobalSkillsSettings(): React.ReactElement {
  const bumpCapabilitiesVersion = useSetAtom(workspaceCapabilitiesVersionAtom)
  const [entries, setEntries] = React.useState<GlobalSkillEntry[]>([])
  const [skillsDir, setSkillsDir] = React.useState('')
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [selectedDetail, setSelectedDetail] = React.useState<GlobalSkillDetail | null>(null)
  const [loadingList, setLoadingList] = React.useState(true)
  const [loadingDetail, setLoadingDetail] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [installRepoUrl, setInstallRepoUrl] = React.useState('')
  const [installSubdir, setInstallSubdir] = React.useState('')
  const [installSlug, setInstallSlug] = React.useState('')
  const [installing, setInstalling] = React.useState(false)

  const loadList = React.useCallback(async (): Promise<GlobalSkillEntry[]> => {
    setLoadingList(true)
    try {
      const [skillList, dir] = await Promise.all([
        window.electronAPI.getGlobalAgentSkills(),
        window.electronAPI.getGlobalAgentSkillsDir(),
      ])
      setEntries(skillList)
      setSkillsDir(dir)
      return skillList
    } catch (error) {
      console.error('[全局 Skills 设置] 加载失败:', error)
      return []
    } finally {
      setLoadingList(false)
    }
  }, [])

  const loadDetail = React.useCallback(async (entryId: string): Promise<void> => {
    setLoadingDetail(true)
    try {
      const detail = await window.electronAPI.getGlobalAgentSkillDetail(entryId)
      setSelectedDetail(detail)
    } catch (error) {
      console.error('[全局 Skills 设置] 详情加载失败:', error)
      setSelectedDetail(null)
    } finally {
      setLoadingDetail(false)
    }
  }, [])

  React.useEffect(() => {
    void loadList()
  }, [loadList])

  const filteredEntries = React.useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return entries
    return entries.filter((entry) => (
      `${entry.name} ${entry.slug} ${entry.description ?? ''} ${entry.sourceLabel} ${entry.kind}`.toLowerCase().includes(keyword)
    ))
  }, [entries, search])

  React.useEffect(() => {
    if (filteredEntries.length === 0) {
      setSelectedId(null)
      setSelectedDetail(null)
      return
    }

    if (!selectedId || !filteredEntries.some((entry) => entry.id === selectedId)) {
      setSelectedId(filteredEntries[0]?.id ?? null)
    }
  }, [filteredEntries, selectedId])

  React.useEffect(() => {
    if (!selectedId) return
    void loadDetail(selectedId)
  }, [loadDetail, selectedId])

  const selectedMeta = React.useMemo(() => (
    selectedId ? entries.find((entry) => entry.id === selectedId) ?? null : null
  ), [entries, selectedId])

  const groupedEntries = React.useMemo(() => {
    const groups = SOURCE_ORDER.map((source) => ({
      source,
      label: filteredEntries.find((entry) => entry.source === source)?.sourceLabel
        ?? (source === 'kila' ? 'Kila' : source === 'codex' ? 'Codex' : 'Claude'),
      entries: filteredEntries.filter((entry) => entry.source === source),
    }))

    return groups.filter((group) => group.entries.length > 0)
  }, [filteredEntries])

  const totalSkills = React.useMemo(
    () => entries.filter((entry) => entry.kind === 'skill').length,
    [entries],
  )

  const totalPlugins = React.useMemo(
    () => entries.filter((entry) => entry.kind === 'plugin').length,
    [entries],
  )

  const sourceCount = React.useMemo(
    () => new Set(entries.map((entry) => entry.source)).size,
    [entries],
  )

  const canManageSelected = selectedDetail?.managementMode === 'managed' && selectedDetail.kind === 'skill'
  const contentPreview = React.useMemo(() => formatContentPreview(selectedDetail), [selectedDetail])
  const detailLocation = React.useMemo(() => (
    selectedDetail ? resolveRelativePath(selectedDetail.path, selectedDetail.sourceRoot ?? skillsDir) : ''
  ), [selectedDetail, skillsDir])
  const detailContentFile = React.useMemo(() => (
    selectedDetail ? resolveRelativePath(selectedDetail.contentPath, selectedDetail.sourceRoot ?? skillsDir) : ''
  ), [selectedDetail, skillsDir])

  const handleDeleteSkill = React.useCallback(async (detail: GlobalSkillDetail): Promise<void> => {
    if (detail.managementMode !== 'managed' || detail.kind !== 'skill') return
    if (!confirm(`确定删除 Skill「${detail.name}」？此操作不可恢复。`)) return

    try {
      await window.electronAPI.deleteGlobalAgentSkill(detail.slug)
      bumpCapabilitiesVersion((value) => value + 1)
      const nextEntries = await loadList()
      if (selectedId === detail.id) {
        const nextSelected = nextEntries[0]?.id ?? null
        setSelectedId(nextSelected)
        if (!nextSelected) {
          setSelectedDetail(null)
        }
      }
    } catch (error) {
      console.error('[全局 Skills 设置] 删除失败:', error)
    }
  }, [bumpCapabilitiesVersion, loadList, selectedId])

  const handleToggleSkill = React.useCallback(async (detail: GlobalSkillDetail, enabled: boolean): Promise<void> => {
    if (detail.managementMode !== 'managed' || detail.kind !== 'skill') return

    try {
      await window.electronAPI.toggleGlobalAgentSkill(detail.slug, enabled)
      bumpCapabilitiesVersion((value) => value + 1)
      await loadList()
      await loadDetail(detail.id)
    } catch (error) {
      console.error('[全局 Skills 设置] 切换状态失败:', error)
    }
  }, [bumpCapabilitiesVersion, loadDetail, loadList])

  const handleInstallSkill = React.useCallback(async (): Promise<void> => {
    const repoUrl = installRepoUrl.trim()
    if (!repoUrl) return
    setInstalling(true)
    try {
      const result = await window.electronAPI.installGlobalAgentSkill({
        repoUrl,
        subdir: installSubdir.trim() || undefined,
        slug: installSlug.trim() || undefined,
      })
      setInstallRepoUrl('')
      setInstallSubdir('')
      setInstallSlug('')
      bumpCapabilitiesVersion((value) => value + 1)
      const nextEntries = await loadList()
      const installed = nextEntries.find((entry) => entry.slug === result.slug)
      if (installed) setSelectedId(installed.id)
    } catch (error) {
      console.error('[全局 Skills 设置] 安装失败:', error)
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      setInstalling(false)
    }
  }, [bumpCapabilitiesVersion, installRepoUrl, installSlug, installSubdir, loadList])

  const handleUpdateSkill = React.useCallback(async (detail: GlobalSkillDetail): Promise<void> => {
    if (detail.managementMode !== 'managed' || detail.kind !== 'skill') return
    setInstalling(true)
    try {
      await window.electronAPI.updateGlobalAgentSkill(detail.slug)
      bumpCapabilitiesVersion((value) => value + 1)
      await loadList()
      await loadDetail(detail.id)
    } catch (error) {
      console.error('[全局 Skills 设置] 更新失败:', error)
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      setInstalling(false)
    }
  }, [bumpCapabilitiesVersion, loadDetail, loadList])

  return (
    <div className="space-y-8">
      <SettingsSection
        title="技能库"
        description="统一浏览 Kila、Codex、Claude 三套能力来源。左侧浏览 Skill / Plugin，右侧查看详情；只有 Kila 自己管理的 Skill 支持启停和删除。"
        action={skillsDir ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => { void window.electronAPI.openGlobalAgentPath(skillsDir) }}
                className="rounded-xl border border-border/60 bg-background/80 p-2 text-muted-foreground transition-colors hover:border-primary/25 hover:bg-[hsl(var(--kila-accent-muted))] hover:text-foreground"
              >
                <FolderOpen className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>打开 Kila Skills 目录</TooltipContent>
          </Tooltip>
        ) : undefined}
      >
        <div className="space-y-4">
          <div className="grid gap-3 rounded-[var(--kila-panel-radius)] border border-border/45 bg-card/70 p-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_auto]">
            <Input
              value={installRepoUrl}
              onChange={(event) => setInstallRepoUrl(event.target.value)}
              placeholder="GitHub Skill 仓库 URL"
              className="h-11 rounded-xl border-border/50 bg-background text-sm shadow-none"
            />
            <Input
              value={installSubdir}
              onChange={(event) => setInstallSubdir(event.target.value)}
              placeholder="子目录（可选）"
              className="h-11 rounded-xl border-border/50 bg-background text-sm shadow-none"
            />
            <Input
              value={installSlug}
              onChange={(event) => setInstallSlug(event.target.value)}
              placeholder="Slug（可选）"
              className="h-11 rounded-xl border-border/50 bg-background text-sm shadow-none"
            />
            <button
              type="button"
              onClick={() => { void handleInstallSkill() }}
              disabled={installing || !installRepoUrl.trim()}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border/60 bg-background px-4 text-sm font-medium text-foreground/78 transition-colors hover:border-primary/25 hover:bg-[hsl(var(--kila-accent-muted))] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="size-4" />
              {installing ? '处理中' : '安装'}
            </button>
          </div>

          <div className="grid items-center gap-4 rounded-[var(--kila-panel-radius)] border border-border/45 bg-card/70 p-4 [grid-template-columns:minmax(0,1fr)_auto]">
            <div className="relative min-w-0">
              <Search className="absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索 Skill 或 Plugin..."
                className="h-12 rounded-xl border-border/50 bg-background pl-12 text-sm shadow-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <EntityMetadataChip tone="accent">{totalSkills} Skills</EntityMetadataChip>
              <EntityMetadataChip>{totalPlugins} Plugins</EntityMetadataChip>
              <EntityMetadataChip>{sourceCount} 来源</EntityMetadataChip>
            </div>
          </div>

          <div className="grid h-[min(74vh,860px)] min-h-[580px] gap-6 [grid-template-columns:minmax(300px,340px)_minmax(0,1fr)]">
            <div className="surface-panel flex min-h-0 flex-col overflow-hidden bg-card/82 p-0">
              <div className="px-4 pb-2.5 pt-4">
                <div className="text-[15px] font-semibold text-foreground">所有能力</div>
                <div className="mt-0.5 text-[12px] text-muted-foreground">
                  按来源聚合显示可见 Skill 与 Plugin
                </div>
              </div>

              {loadingList ? (
                <div className="flex h-full items-center justify-center py-12 text-sm text-muted-foreground">
                  加载中...
                </div>
              ) : groupedEntries.length === 0 ? (
                <div className="m-3 flex h-full items-center justify-center rounded-[20px] border border-dashed border-border/60 px-4 py-14 text-center text-sm text-muted-foreground">
                  没有匹配的条目。
                </div>
              ) : (
                <ScrollArea className="min-h-0 flex-1">
                  <div className="space-y-4 p-2.5">
                    {groupedEntries.map((group) => (
                      <section key={group.source} className="space-y-2">
                        <div className="flex items-center justify-between px-2 py-1">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/78">
                            {group.label}
                          </div>
                          <div className="text-[10.5px] tabular-nums text-muted-foreground/62">
                            {group.entries.length}
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          {group.entries.map((entry) => (
                            <LibraryListItem
                              key={entry.id}
                              entry={entry}
                              selected={selectedId === entry.id}
                              onSelect={() => setSelectedId(entry.id)}
                            />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>

            <div className="surface-panel min-h-0 min-w-0 overflow-hidden bg-card/88">
              <ScrollArea className="h-full">
                <div className="space-y-6 p-6">
                  {!selectedId || !selectedMeta ? (
                    <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-[20px] border border-dashed border-border/60 px-6 text-center">
                      <div className="text-sm font-medium text-foreground">选择一个条目查看详情</div>
                      <div className="max-w-md text-sm text-muted-foreground">
                        右侧会显示来源、类型、路径，以及 `SKILL.md` 或 `plugin.json` 原始内容。
                      </div>
                    </div>
                  ) : loadingDetail ? (
                    <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
                      正在加载详情...
                    </div>
                  ) : selectedDetail ? (
                    <>
                      <div className="rounded-[20px] border border-border/55 bg-background/72 p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex min-w-0 items-start gap-4">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border/55 bg-[hsl(var(--kila-accent-muted))] text-primary">
                              {selectedDetail.kind === 'plugin'
                                ? <Blocks className="size-5" />
                                : <Wand2 className="size-5" />}
                            </div>

                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="truncate text-[30px] font-medium tracking-tight text-foreground">
                                  {selectedDetail.name}
                                </div>
                                <EntityMetadataChip>{selectedDetail.sourceLabel}</EntityMetadataChip>
                                <EntityMetadataChip tone="accent">{getEntryTypeLabel(selectedDetail.kind)}</EntityMetadataChip>
                                {canManageSelected && (
                                  <EntityMetadataChip tone={selectedDetail.enabled ? 'accent' : 'neutral'}>
                                    {selectedDetail.enabled ? '已启用' : '已停用'}
                                  </EntityMetadataChip>
                                )}
                                {!canManageSelected && (
                                  <EntityMetadataChip>只读</EntityMetadataChip>
                                )}
                              </div>

                              <div className="mt-2 inline-flex max-w-full rounded-full border border-border/55 bg-background/72 px-2.5 py-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground/78">
                                <span className="truncate">{selectedDetail.slug}</span>
                              </div>

                              <div className="mt-3 max-w-3xl text-[14px] leading-6 text-muted-foreground">
                                {selectedDetail.description ?? '该条目未提供简介，建议直接查看下方原始内容。'}
                              </div>
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => { void window.electronAPI.openGlobalAgentPath(selectedDetail.path) }}
                                  className="rounded-xl border border-border/60 bg-background/80 p-3 text-muted-foreground transition-colors hover:border-primary/25 hover:bg-[hsl(var(--kila-accent-muted))] hover:text-foreground"
                                >
                                  <FolderOpen className="size-4" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>打开所在目录</TooltipContent>
                            </Tooltip>

                            {canManageSelected && (
                              <>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      onClick={() => { void handleUpdateSkill(selectedDetail) }}
                                      disabled={installing}
                                      className="rounded-xl border border-border/60 bg-background/80 p-3 text-muted-foreground transition-colors hover:border-primary/25 hover:bg-[hsl(var(--kila-accent-muted))] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      <RefreshCw className="size-4" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>根据来源锁更新 Skill</TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      onClick={() => { void handleDeleteSkill(selectedDetail) }}
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
                                    checked={selectedDetail.enabled}
                                    onCheckedChange={(enabled) => { void handleToggleSkill(selectedDetail, enabled) }}
                                  />
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="px-1 text-[13px] font-semibold text-foreground">元数据</div>
                        <div className="overflow-hidden rounded-[18px] border border-border/55 bg-background/65">
                          <MetadataRow label="标识符" value={selectedDetail.id} mono />
                          <MetadataRow label="名称" value={selectedDetail.name} />
                          <MetadataRow label="来源" value={selectedDetail.sourceLabel} />
                          <MetadataRow label="类型" value={getEntryTypeLabel(selectedDetail.kind)} />
                          <MetadataRow label="模式" value={selectedDetail.managementMode === 'managed' ? 'Kila 管理' : '只读浏览'} />
                          <MetadataRow label="位置" value={<span className="break-all">{detailLocation}</span>} mono />
                          <MetadataRow label="目录" value={<span className="break-all">{selectedDetail.path}</span>} mono />
                          <MetadataRow label="内容文件" value={<span className="break-all">{detailContentFile}</span>} mono />
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="px-1 text-[13px] font-semibold text-foreground">内容</div>
                        <div className="overflow-hidden rounded-[18px] border border-border/55 bg-background/65">
                          <div className="border-b border-border/45 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
                            {selectedDetail.contentType === 'json' ? 'plugin.json' : 'SKILL.md'}
                          </div>
                          <div className="min-w-0 px-5 py-5">
                            {selectedDetail.contentType === 'json' ? (
                              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-[16px] border border-border/45 bg-[hsl(var(--code-surface))] p-4 font-mono text-[12px] leading-6 text-foreground">
                                {contentPreview}
                              </pre>
                            ) : (
                              <MessageResponse
                                basePath={selectedDetail.path}
                                className={cn(
                                  '[&_h1]:font-sans [&_h2]:font-sans [&_h3]:font-sans',
                                  '[&_h1]:text-[28px] [&_h2]:text-[22px] [&_h3]:text-[17px]',
                                  '[&_p]:text-[14px] [&_pre]:bg-[hsl(var(--code-surface))]',
                                )}
                                compact
                              >
                                {contentPreview}
                              </MessageResponse>
                            )}
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
                      详情加载失败。
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>
      </SettingsSection>
    </div>
  )
}
