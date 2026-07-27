import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  Brain,
  CheckCircle2,
  Clipboard,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { SettingsCard, SettingsInput, SettingsToggle } from './primitives'
import type { AppSettings } from '../../../types'

interface MemoryStatus {
  mode: 'local' | 'nowledge'
  activeProvider: 'local' | 'nowledge'
  localReady: boolean
  memoryDirectory: string
  nowledgeEnabled: boolean
  nowledgeConfigured: boolean
  nowledgeHealthy: boolean
  nowledgeBackendVersion?: string
  checkedAt: number
  detail?: string
}

interface MemoryItem {
  uri: string
  title?: string
  content: string
  category: string
  tags: string[]
  projectPath?: string
  updatedAt: number
}

const DEFAULT_NOWLEDGE_URL = 'http://127.0.0.1:14242'
const RECENT_MEMORY_LIMIT = 12
const ALL_MEMORY_PAGE_SIZE = 20

/** 拼装「配置提示词」，逐条走翻译，避免在源码里硬编码整段中文 */
function buildNowledgeSetupPrompt(t: TFunction): string {
  const steps = [1, 2, 3, 4, 5, 6]
    .map((index) => `${index}. ${t(`settings.memory.setupPrompt.step${index}`)}`)
    .join('\n')
  return `${t('settings.memory.setupPrompt.intro')}\n\n${steps}`
}

function formatTime(value: number, language: string): string {
  return new Date(value).toLocaleString(language, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function isLocalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
  } catch {
    return false
  }
}

interface MemoryRowProps {
  item: MemoryItem
  onSelect: (item: MemoryItem) => void
  onDelete?: (uri: string) => void
}

function MemoryRow({ item, onSelect, onDelete }: MemoryRowProps): React.ReactElement {
  const { t, i18n } = useTranslation()
  return (
    <div className="flex gap-3 px-5 py-4 [&+&]:border-t [&+&]:border-border/30">
      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{item.title || item.category}</span>
          <span className="text-xs text-muted-foreground">{formatTime(item.updatedAt, i18n.language)}</span>
        </div>
        <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{item.content}</p>
        <Button variant="link" size="sm" className="mt-1 h-auto p-0 text-xs" onClick={() => onSelect(item)}>
          {t('settings.memory.viewDetail')}
        </Button>
      </div>
      {onDelete && <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label={t('settings.memory.deleteMemory')} onClick={() => onDelete(item.uri)}><Trash2 className="h-4 w-4" /></Button>}
    </div>
  )
}

export function MemorySettings(): React.ReactElement {
  const { t, i18n } = useTranslation()
  const [loading, setLoading] = React.useState(true)
  const [detecting, setDetecting] = React.useState(false)
  const [settings, setSettings] = React.useState<AppSettings | null>(null)
  const [status, setStatus] = React.useState<MemoryStatus | null>(null)
  const [memories, setMemories] = React.useState<MemoryItem[]>([])
  const [refreshing, setRefreshing] = React.useState(false)
  const [selectedMemory, setSelectedMemory] = React.useState<MemoryItem | null>(null)
  const [allMemoriesOpen, setAllMemoriesOpen] = React.useState(false)
  const [allMemories, setAllMemories] = React.useState<MemoryItem[]>([])
  const [allMemoriesPage, setAllMemoriesPage] = React.useState(0)
  const [allMemoriesHasNext, setAllMemoriesHasNext] = React.useState(false)
  const [allMemoriesLoading, setAllMemoriesLoading] = React.useState(false)
  const [allMemoriesError, setAllMemoriesError] = React.useState<string | null>(null)
  const allMemoriesScrollRef = React.useRef<HTMLDivElement>(null)
  const [nowledgeUrl, setNowledgeUrl] = React.useState(DEFAULT_NOWLEDGE_URL)

  const memoryEnabled = Boolean(status?.nowledgeConfigured)

  const loadRuntime = React.useCallback(async (requestedMemoryLimit: number): Promise<void> => {
    const [nextSettings, nextStatus, nextMemories] = await Promise.all([
      window.electronAPI.getSettings(),
      window.electronAPI.getMemoryStatus(),
      window.electronAPI.listMemories({ limit: requestedMemoryLimit }),
    ])
    setSettings(nextSettings)
    setStatus(nextStatus as MemoryStatus)
    setMemories(nextMemories)
    setNowledgeUrl(nextSettings.memoryNowledgeBaseUrl || DEFAULT_NOWLEDGE_URL)
  }, [])

  React.useEffect(() => {
    void loadRuntime(RECENT_MEMORY_LIMIT)
      .catch((error) => {
        console.error('[MemorySettings] 加载失败:', error)
        toast.error(t('settings.memory.loadSettingsFailed'))
      })
      .finally(() => setLoading(false))
  }, [loadRuntime])

  const loadAllMemoriesPage = React.useCallback(async (page: number): Promise<number> => {
    const nextPage = Math.max(Math.floor(page), 0)
    setAllMemoriesLoading(true)
    setAllMemoriesError(null)
    try {
      const rows = await window.electronAPI.listMemories({
        limit: ALL_MEMORY_PAGE_SIZE + 1,
        offset: nextPage * ALL_MEMORY_PAGE_SIZE,
      })
      const pageRows = rows.slice(0, ALL_MEMORY_PAGE_SIZE)
      setAllMemories(pageRows)
      setAllMemoriesPage(nextPage)
      setAllMemoriesHasNext(rows.length > ALL_MEMORY_PAGE_SIZE)
      return pageRows.length
    } catch (error) {
      const message = error instanceof Error ? error.message : t('settings.memory.loadAllFailed')
      setAllMemoriesError(message)
      throw error
    } finally {
      setAllMemoriesLoading(false)
    }
  }, [])

  const persist = React.useCallback(async (updates: Partial<AppSettings>): Promise<void> => {
    const next = await window.electronAPI.updateSettings(updates)
    setSettings(next)
    await loadRuntime(RECENT_MEMORY_LIMIT)
  }, [loadRuntime])

  const handleDetect = React.useCallback(async (): Promise<void> => {
    setDetecting(true)
    try {
      const result = await window.electronAPI.detectLocalNowledge()
      if (!result.found || !result.baseUrl || !isLocalUrl(result.baseUrl)) {
        toast.error(t('settings.memory.notDetected'))
        return
      }
      await persist({
        memoryNowledgeEnabled: true,
        memoryNowledgeBaseUrl: result.baseUrl,
        memoryNowledgeApiKey: result.apiKey,
      })
      toast.success(t('settings.memory.enabledToast'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.memory.detectFailed'))
    } finally {
      setDetecting(false)
    }
  }, [persist])

  const handleUrlSave = React.useCallback(async (): Promise<void> => {
    if (!isLocalUrl(nowledgeUrl)) {
      toast.error(t('settings.memory.localOnly'))
      return
    }
    await persist({ memoryNowledgeBaseUrl: nowledgeUrl.trim() })
  }, [nowledgeUrl, persist])

  const handleDeleteMemory = React.useCallback(async (uri: string): Promise<void> => {
    if (!window.confirm(t('settings.memory.deleteConfirm'))) return
    try {
      await window.electronAPI.forgetMemory(uri)
      await loadRuntime(RECENT_MEMORY_LIMIT)
      if (allMemoriesOpen) {
        const pageItemCount = await loadAllMemoriesPage(allMemoriesPage)
        if (pageItemCount === 0 && allMemoriesPage > 0) {
          await loadAllMemoriesPage(allMemoriesPage - 1)
        }
      }
      toast.success(t('settings.memory.deleted'))
    } catch (error) {
      console.error('[MemorySettings] 删除长期记忆失败:', error)
      toast.error(error instanceof Error ? error.message : t('settings.memory.deleteFailed'))
    }
  }, [allMemoriesOpen, allMemoriesPage, loadAllMemoriesPage, loadRuntime])

  const handleRefresh = React.useCallback(async (): Promise<void> => {
    setRefreshing(true)
    try {
      await loadRuntime(RECENT_MEMORY_LIMIT)
      if (allMemoriesOpen) await loadAllMemoriesPage(allMemoriesPage)
      toast.success(t('settings.memory.refreshed'))
    } catch (error) {
      console.error('[MemorySettings] 刷新失败:', error)
      toast.error(error instanceof Error ? error.message : t('settings.memory.refreshFailed'))
    } finally {
      setRefreshing(false)
    }
  }, [allMemoriesOpen, allMemoriesPage, loadAllMemoriesPage, loadRuntime])

  const handleShowAllMemories = React.useCallback(async (): Promise<void> => {
    setAllMemoriesOpen(true)
    setAllMemories([])
    setAllMemoriesPage(0)
    try {
      await loadAllMemoriesPage(0)
    } catch (error) {
      console.error('[MemorySettings] 加载全部长期记忆失败:', error)
      toast.error(error instanceof Error ? error.message : t('settings.memory.loadAllFailed'))
    }
  }, [loadAllMemoriesPage])

  const handleAllMemoriesPageChange = React.useCallback(async (page: number): Promise<void> => {
    if (allMemoriesLoading || page < 0 || (page > allMemoriesPage && !allMemoriesHasNext)) return
    try {
      await loadAllMemoriesPage(page)
    } catch (error) {
      console.error('[MemorySettings] 切换长期记忆分页失败:', error)
      toast.error(error instanceof Error ? error.message : t('settings.memory.loadPageFailed'))
    }
  }, [allMemoriesHasNext, allMemoriesLoading, allMemoriesPage, loadAllMemoriesPage])

  React.useEffect(() => {
    allMemoriesScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' })
  }, [allMemoriesPage])

  const handleCopySetupPrompt = React.useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(buildNowledgeSetupPrompt(t))
      toast.success(t('settings.memory.promptCopied'))
    } catch {
      toast.error(t('settings.memory.copyFailed'))
    }
  }, [t])

  if (loading || !settings) {
    return <div className="flex min-h-56 items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
  }

  return (
    <div className="w-full space-y-6 pb-8">
      <header>
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-kila-accent" />
          <h2 className="text-base font-semibold text-foreground">{t('settings.memory.title')}</h2>
        </div>
        <p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">
          {t('settings.memory.description')}
        </p>
      </header>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('settings.memory.nowledgeTitle')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t('settings.memory.nowledgeDescription')}</p>
        </div>
        <SettingsCard>
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${status?.nowledgeHealthy ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                {status?.nowledgeHealthy ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              </span>
              <div>
                <div className="text-sm font-medium text-foreground">{status?.nowledgeHealthy ? t('settings.memory.stateConnected') : settings.memoryNowledgeEnabled ? t('settings.memory.stateUnavailable') : t('settings.memory.stateDisabled')}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{status?.detail ?? t('settings.memory.stateHint')}</div>
              </div>
            </div>
            <Switch
              checked={settings.memoryNowledgeEnabled ?? false}
              onCheckedChange={(checked) => void persist({ memoryNowledgeEnabled: checked })}
              aria-label={t('settings.memory.enableAria')}
            />
          </div>
          <SettingsInput
            label={t('settings.memory.serviceUrl')}
            description={t('settings.memory.serviceUrlHint')}
            value={nowledgeUrl}
            onChange={setNowledgeUrl}
            onBlur={() => void handleUrlSave()}
            placeholder={DEFAULT_NOWLEDGE_URL}
            disabled={!settings.memoryNowledgeEnabled}
          />
          <div className="flex flex-wrap justify-end gap-2 px-5 py-4">
            <Button variant="outline" size="sm" onClick={() => void window.electronAPI.openExternal('https://mem.nowledge.co')}>
              <ExternalLink className="h-4 w-4" />{t('settings.memory.getNowledge')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void handleCopySetupPrompt()}>
              <Clipboard className="h-4 w-4" />{t('settings.memory.copyPrompt')}
            </Button>
            <Button size="sm" disabled={detecting} onClick={() => void handleDetect()}>
              {detecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{t('settings.memory.autoDetect')}
            </Button>
          </div>
        </SettingsCard>

        <SettingsCard>
          <SettingsToggle
            label={t('settings.memory.autoInject')}
            description={t('settings.memory.autoInjectDescription')}
            checked={settings.memorySessionContextEnabled ?? true}
            onCheckedChange={(checked) => void persist({ memorySessionContextEnabled: checked })}
          />
        </SettingsCard>

        <div className="grid grid-cols-[28px_1fr] gap-x-3 gap-y-3 rounded-lg bg-muted/35 px-4 py-4 text-sm">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">1</span><div><div className="font-medium text-foreground">{t('settings.memory.guide1Title')}</div><div className="mt-0.5 text-muted-foreground">{t('settings.memory.guide1Body')}</div></div>
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">2</span><div><div className="font-medium text-foreground">{t('settings.memory.guide2Title')}</div><div className="mt-0.5 text-muted-foreground">{t('settings.memory.guide2Body')}</div></div>
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">3</span><div><div className="font-medium text-foreground">{t('settings.memory.guide3Title')}</div><div className="mt-0.5 text-muted-foreground">{t('settings.memory.guide3Body')}</div></div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div><h3 className="text-sm font-semibold text-foreground">{t('settings.memory.listTitle')}</h3><p className="mt-1 text-sm text-muted-foreground">{t('settings.memory.listDescription')}</p></div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" disabled={refreshing || !memoryEnabled} onClick={() => void handleShowAllMemories()}>
              {t('settings.memory.viewAll')}
            </Button>
            <Button variant="ghost" size="sm" disabled={refreshing} onClick={() => void handleRefresh()}>
              <RefreshCw className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />{t('settings.about.refresh')}
            </Button>
          </div>
        </div>
        <SettingsCard divided={false}>
          {!memoryEnabled ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">{t('settings.memory.notEnabled')}</div>
          ) : memories.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">{t('settings.memory.emptyHint')}</div>
          ) : memories.map((item) => <MemoryRow key={item.uri} item={item} onSelect={setSelectedMemory} onDelete={(uri) => void handleDeleteMemory(uri)} />)}
        </SettingsCard>
      </section>

      <Dialog open={allMemoriesOpen} onOpenChange={setAllMemoriesOpen}>
        <DialogContent className="flex max-h-[85vh] w-[calc(100vw-32px)] max-w-3xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{t('settings.memory.allTitle')}</DialogTitle>
            <DialogDescription>{t('settings.memory.allDescription', { size: ALL_MEMORY_PAGE_SIZE })}</DialogDescription>
          </DialogHeader>
          <div
            ref={allMemoriesScrollRef}
            className="relative h-[min(60vh,640px)] min-h-56 overflow-y-auto rounded-lg bg-muted/20"
            aria-busy={allMemoriesLoading}
          >
            {allMemories.length === 0 && allMemoriesLoading ? (
              <div className="flex min-h-56 items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : allMemories.length === 0 && allMemoriesError ? (
              <div className="flex min-h-56 flex-col items-center justify-center gap-3 px-5 text-center text-sm text-muted-foreground">
                <p>{allMemoriesError}</p>
                <Button variant="outline" size="sm" onClick={() => void handleAllMemoriesPageChange(allMemoriesPage)}>{t('settings.memory.retry')}</Button>
              </div>
            ) : allMemories.length === 0 ? (
              <div className="flex min-h-56 items-center justify-center px-5 text-center text-sm text-muted-foreground">{t('settings.memory.empty')}</div>
            ) : (
              allMemories.map((item) => <MemoryRow key={item.uri} item={item} onSelect={setSelectedMemory} onDelete={(uri) => void handleDeleteMemory(uri)} />)
            )}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border/40 pt-3">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {allMemoriesLoading && allMemories.length > 0 && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t('settings.memory.pageInfo', { page: allMemoriesPage + 1, count: allMemories.length })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={allMemoriesLoading || allMemoriesPage === 0}
                onClick={() => void handleAllMemoriesPageChange(allMemoriesPage - 1)}
              >
                <ChevronLeft className="h-4 w-4" />{t('settings.memory.prevPage')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={allMemoriesLoading || !allMemoriesHasNext}
                onClick={() => void handleAllMemoriesPageChange(allMemoriesPage + 1)}
              >
                {t('settings.memory.nextPage')}<ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={selectedMemory !== null} onOpenChange={(open) => { if (!open) setSelectedMemory(null) }}>
        <DialogContent className="flex max-h-[85vh] w-[calc(100vw-32px)] max-w-2xl flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>{selectedMemory?.title || selectedMemory?.category || t('settings.memory.detailTitle')}</DialogTitle>
            <DialogDescription>
              {selectedMemory && `${formatTime(selectedMemory.updatedAt, i18n.language)} · ${selectedMemory.category}${selectedMemory.projectPath ? ` · ${selectedMemory.projectPath}` : ` · ${t('settings.memory.globalScope')}`}`}
            </DialogDescription>
          </DialogHeader>
          {selectedMemory && (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-2">
              <div className="flex flex-wrap gap-1.5">
                {selectedMemory.tags.map((tag) => <span key={tag} className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">#{tag}</span>)}
              </div>
              <div className="rounded-lg bg-muted/35 p-4 text-sm leading-6 text-foreground">
                <p className="whitespace-pre-wrap break-words">{selectedMemory.content}</p>
              </div>
              <p className="break-all font-mono text-[11px] text-muted-foreground">{selectedMemory.uri}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
