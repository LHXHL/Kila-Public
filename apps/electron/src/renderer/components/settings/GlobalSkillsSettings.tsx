import * as React from 'react'
import { useSetAtom } from 'jotai'
import { Blocks, Download, FolderOpen, Search, Wand2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { workspaceCapabilitiesVersionAtom } from '@/atoms/agent-atoms'
import { EntityMetadataChip } from '@/components/ui/entity-metadata-chip'
import { SettingsSection } from './primitives'
import { SkillDetailDialog } from './SkillDetailDialog'
import { cn } from '@/lib/utils'
import type {
  GlobalSkillEntry,
  GlobalSkillEntryKind,
  GlobalSkillEntrySource,
  GlobalSkillDetail,
} from '@kila/shared'

const SOURCE_ORDER: GlobalSkillEntrySource[] = ['kila', 'codex', 'claude']

function getEntryTypeLabel(kind: GlobalSkillEntryKind): string {
  return kind === 'plugin' ? 'Plugin' : 'Skill'
}

function getEntryIcon(kind: GlobalSkillEntryKind): React.ReactElement {
  return kind === 'plugin'
    ? <Blocks className="size-4" />
    : <Wand2 className="size-4" />
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
            ? 'border-primary/18 bg-kila-accent-muted text-primary'
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

          <div className="mt-1 line-clamp-2 min-h-10 break-words text-[12px] leading-5 text-muted-foreground">
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
    if (!selectedId) return
    void loadDetail(selectedId)
  }, [loadDetail, selectedId])

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

  const handleDeleteSkill = React.useCallback(async (detail: GlobalSkillDetail): Promise<void> => {
    if (detail.managementMode !== 'managed' || detail.kind !== 'skill') return
    if (!confirm(`确定删除 Skill「${detail.name}」？此操作不可恢复。`)) return

    try {
      await window.electronAPI.deleteGlobalAgentSkill(detail.slug)
      bumpCapabilitiesVersion((value) => value + 1)
      await loadList()
      if (selectedId === detail.id) {
        setSelectedId(null)
        setSelectedDetail(null)
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

  const handleSelectEntry = React.useCallback((entryId: string): void => {
    setSelectedDetail(null)
    setSelectedId(entryId)
  }, [])

  const handleDetailOpenChange = React.useCallback((open: boolean): void => {
    if (open) return
    setSelectedId(null)
    setSelectedDetail(null)
  }, [])

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
        description="统一浏览 Kila、Codex、Claude 三套能力来源。点击 Skill 或 Plugin 后在弹窗中查看完整详情；只有 Kila 管理的 Skill 支持启停和删除。"
        action={skillsDir ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => { void window.electronAPI.openGlobalAgentPath(skillsDir) }}
                className="rounded-xl border border-border/60 bg-background/80 p-2 text-muted-foreground transition-colors hover:border-primary/25 hover:bg-kila-accent-muted hover:text-foreground"
              >
                <FolderOpen className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>打开 Kila Skills 目录</TooltipContent>
          </Tooltip>
        ) : undefined}
      >
        <div className="space-y-4">
          <div className="grid gap-3 rounded-[var(--kila-panel-radius)] border border-border/45 bg-card/70 p-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_auto]">
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
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border/60 bg-background px-4 text-sm font-medium text-foreground/78 transition-colors hover:border-primary/25 hover:bg-kila-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="size-4" />
              {installing ? '处理中' : '安装'}
            </button>
          </div>

          <div className="grid items-center gap-4 rounded-[var(--kila-panel-radius)] border border-border/45 bg-card/70 p-4 xl:grid-cols-[minmax(0,1fr)_auto]">
            <div className="relative min-w-0">
              <Search className="absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索 Skill 或 Plugin..."
                className="h-12 rounded-xl border-border/50 bg-background pl-12 text-sm shadow-none"
              />
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <EntityMetadataChip tone="accent">{totalSkills} Skills</EntityMetadataChip>
              <EntityMetadataChip>{totalPlugins} Plugins</EntityMetadataChip>
              <EntityMetadataChip>{sourceCount} 来源</EntityMetadataChip>
            </div>
          </div>

          <div className="rounded-[var(--kila-panel-radius)] border border-border/45 bg-card/70 p-3 sm:p-4">
            {loadingList ? (
              <div className="flex min-h-[280px] items-center justify-center text-sm text-muted-foreground">
                加载中...
              </div>
            ) : groupedEntries.length === 0 ? (
              <div className="flex min-h-[280px] items-center justify-center rounded-[20px] border border-dashed border-border/60 px-4 text-center text-sm text-muted-foreground">
                没有匹配的条目。
              </div>
            ) : (
              <div className="space-y-6">
                {groupedEntries.map((group) => (
                  <section key={group.source} className="space-y-3">
                    <div className="flex items-center justify-between px-1">
                      <div>
                        <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/78">
                          {group.label}
                        </div>
                        <div className="mt-0.5 text-[12px] text-muted-foreground/70">
                          点击卡片查看完整详情
                        </div>
                      </div>
                      <EntityMetadataChip>{group.entries.length}</EntityMetadataChip>
                    </div>

                    <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {group.entries.map((entry) => (
                        <LibraryListItem
                          key={entry.id}
                          entry={entry}
                          selected={selectedId === entry.id}
                          onSelect={() => handleSelectEntry(entry.id)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      </SettingsSection>

      <SkillDetailDialog
        open={selectedId !== null}
        detail={selectedDetail}
        loading={loadingDetail || (selectedId !== null && selectedDetail === null)}
        installing={installing}
        skillsDir={skillsDir}
        onOpenChange={handleDetailOpenChange}
        onUpdate={(detail) => { void handleUpdateSkill(detail) }}
        onDelete={(detail) => { void handleDeleteSkill(detail) }}
        onToggle={(detail, enabled) => { void handleToggleSkill(detail, enabled) }}
      />
    </div>
  )
}
