import * as React from 'react'
import {
  BookOpen,
  Brain,
  CheckCircle2,
  Clipboard,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  FolderOpen,
  HardDrive,
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
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
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

interface NotebookItem {
  uri: string
  title?: string
  content: string
  tags: string[]
  projectPath?: string
  createdAt: number
  updatedAt: number
}

const DEFAULT_NOWLEDGE_URL = 'http://127.0.0.1:14242'
const RECENT_MEMORY_LIMIT = 12
const ALL_MEMORY_PAGE_SIZE = 20

const NOWLEDGE_SETUP_PROMPT = `请帮我完成 Kila 的 Nowledge Mem 本地配置：

1. 先确认操作系统，并检查 Nowledge Mem 是否已经安装和运行。
2. 如果没有安装，引导我从 https://mem.nowledge.co 获取桌面客户端。不要替我下载或执行未知安装包。
3. 启动后检查本地服务 http://127.0.0.1:14242/health；只配置 localhost，不使用远程服务。
4. 如果 nmem CLI 可用，运行 nmem status 验证；不可用时不强制安装，Kila 可以直接访问本地 HTTP 服务。
5. 回到 Kila「设置 → 记忆」，点击「自动检测并启用」。
6. 最后说明：启用 Nowledge 后，新的长期记忆直接写入 Nowledge；本地笔记、项目 Working Memory 和旧 Markdown 记忆仍保存在 ~/.kila/memory。`

function formatTime(value: number): string {
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function isLocalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
  } catch {
    return false
  }
}

function isLocalMemoryUri(uri: string): boolean {
  return uri.startsWith('memory://global/') || uri.startsWith('memory://project/')
}

interface MemoryRowProps {
  item: MemoryItem
  onSelect: (item: MemoryItem) => void
  onDelete?: (uri: string) => void
}

function MemoryRow({ item, onSelect, onDelete }: MemoryRowProps): React.ReactElement {
  return (
    <div className="flex gap-3 px-5 py-4 [&+&]:border-t [&+&]:border-border/30">
      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{item.title || item.category}</span>
          <span className="text-xs text-muted-foreground">{formatTime(item.updatedAt)}</span>
          {!isLocalMemoryUri(item.uri) && <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300">Nowledge</span>}
        </div>
        <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{item.content}</p>
        <Button variant="link" size="sm" className="mt-1 h-auto p-0 text-xs" onClick={() => onSelect(item)}>
          查看详情
        </Button>
      </div>
      {onDelete && <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label="删除记忆" onClick={() => onDelete(item.uri)}><Trash2 className="h-4 w-4" /></Button>}
    </div>
  )
}

export function MemorySettings(): React.ReactElement {
  const [loading, setLoading] = React.useState(true)
  const [detecting, setDetecting] = React.useState(false)
  const [settings, setSettings] = React.useState<AppSettings | null>(null)
  const [status, setStatus] = React.useState<MemoryStatus | null>(null)
  const [memories, setMemories] = React.useState<MemoryItem[]>([])
  const [notebooks, setNotebooks] = React.useState<NotebookItem[]>([])
  const [pendingCount, setPendingCount] = React.useState(0)
  const [projectPath, setProjectPath] = React.useState<string | undefined>()
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
  const [noteTitle, setNoteTitle] = React.useState('')
  const [noteContent, setNoteContent] = React.useState('')
  const [savingNote, setSavingNote] = React.useState(false)

  const loadRuntime = React.useCallback(async (requestedMemoryLimit: number): Promise<void> => {
    const foreground = await window.electronAPI.getForegroundSession().catch(() => null)
    const currentProjectPath = foreground?.project?.path
    setProjectPath(currentProjectPath)
    const [nextSettings, nextStatus, nextMemories, nextNotebooks, pending] = await Promise.all([
      window.electronAPI.getSettings(),
      window.electronAPI.getMemoryStatus(),
      window.electronAPI.listMemories({ limit: requestedMemoryLimit }),
      window.electronAPI.listNotebookEntries({ limit: 8, projectPath: currentProjectPath }),
      window.electronAPI.listPendingMemoryWrites(),
    ])
    setSettings(nextSettings)
    setStatus(nextStatus as MemoryStatus)
    setMemories(nextMemories)
    setNotebooks(nextNotebooks)
    setPendingCount(pending.length)
    setNowledgeUrl(nextSettings.memoryNowledgeBaseUrl || DEFAULT_NOWLEDGE_URL)
  }, [])

  React.useEffect(() => {
    void loadRuntime(RECENT_MEMORY_LIMIT)
      .catch((error) => {
        console.error('[MemorySettings] 加载失败:', error)
        toast.error('无法加载记忆设置')
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
      const message = error instanceof Error ? error.message : '无法加载全部长期记忆'
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
        toast.error('未检测到本机 Nowledge，请确认桌面客户端正在运行')
        return
      }
      await persist({
        memoryNowledgeEnabled: true,
        memoryNowledgeBaseUrl: result.baseUrl,
        memoryNowledgeApiKey: result.apiKey,
      })
      toast.success('Nowledge 长期记忆已启用')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Nowledge 检测失败')
    } finally {
      setDetecting(false)
    }
  }, [persist])

  const handleUrlSave = React.useCallback(async (): Promise<void> => {
    if (!isLocalUrl(nowledgeUrl)) {
      toast.error('Kila 仅允许连接本机 Nowledge（localhost / 127.0.0.1）')
      return
    }
    await persist({ memoryNowledgeBaseUrl: nowledgeUrl.trim() })
  }, [nowledgeUrl, persist])

  const handleDeleteMemory = React.useCallback(async (uri: string): Promise<void> => {
    if (!window.confirm('确定删除这条长期记忆吗？')) return
    try {
      await window.electronAPI.forgetMemory(uri)
      await loadRuntime(RECENT_MEMORY_LIMIT)
      if (allMemoriesOpen) {
        const pageItemCount = await loadAllMemoriesPage(allMemoriesPage)
        if (pageItemCount === 0 && allMemoriesPage > 0) {
          await loadAllMemoriesPage(allMemoriesPage - 1)
        }
      }
      toast.success('长期记忆已删除')
    } catch (error) {
      console.error('[MemorySettings] 删除长期记忆失败:', error)
      toast.error(error instanceof Error ? error.message : '长期记忆删除失败')
    }
  }, [allMemoriesOpen, allMemoriesPage, loadAllMemoriesPage, loadRuntime])

  const handleRefresh = React.useCallback(async (): Promise<void> => {
    setRefreshing(true)
    try {
      await loadRuntime(RECENT_MEMORY_LIMIT)
      if (allMemoriesOpen) await loadAllMemoriesPage(allMemoriesPage)
      toast.success('长期记忆已刷新')
    } catch (error) {
      console.error('[MemorySettings] 刷新失败:', error)
      toast.error(error instanceof Error ? error.message : '长期记忆刷新失败')
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
      toast.error(error instanceof Error ? error.message : '无法加载全部长期记忆')
    }
  }, [loadAllMemoriesPage])

  const handleAllMemoriesPageChange = React.useCallback(async (page: number): Promise<void> => {
    if (allMemoriesLoading || page < 0 || (page > allMemoriesPage && !allMemoriesHasNext)) return
    try {
      await loadAllMemoriesPage(page)
    } catch (error) {
      console.error('[MemorySettings] 切换长期记忆分页失败:', error)
      toast.error(error instanceof Error ? error.message : '无法加载长期记忆分页')
    }
  }, [allMemoriesHasNext, allMemoriesLoading, allMemoriesPage, loadAllMemoriesPage])

  React.useEffect(() => {
    allMemoriesScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' })
  }, [allMemoriesPage])

  const handleOpenMemoryDirectory = React.useCallback(async (): Promise<void> => {
    try {
      await window.electronAPI.openMemoryDirectory()
    } catch (error) {
      console.error('[MemorySettings] 打开记忆目录失败:', error)
      toast.error(error instanceof Error ? error.message : '无法打开记忆目录')
    }
  }, [])

  const handleCreateNote = React.useCallback(async (): Promise<void> => {
    if (!noteContent.trim()) {
      toast.error('请填写笔记内容')
      return
    }
    setSavingNote(true)
    try {
      await window.electronAPI.writeNotebookEntry({
        title: noteTitle.trim() || undefined,
        content: noteContent.trim(),
        projectPath,
      })
      setNoteTitle('')
      setNoteContent('')
      await loadRuntime(RECENT_MEMORY_LIMIT)
      toast.success('笔记已保存为本地 Markdown')
    } finally {
      setSavingNote(false)
    }
  }, [loadRuntime, noteContent, noteTitle, projectPath])

  const handleDeleteNote = React.useCallback(async (uri: string): Promise<void> => {
    if (!window.confirm('确定删除这条本地笔记吗？')) return
    await window.electronAPI.forgetNotebookEntry(uri)
    await loadRuntime(RECENT_MEMORY_LIMIT)
    toast.success('本地笔记已删除')
  }, [loadRuntime])

  const handleCopySetupPrompt = React.useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(NOWLEDGE_SETUP_PROMPT)
      toast.success('配置提示词已复制')
    } catch {
      toast.error('复制失败，请检查剪贴板权限')
    }
  }, [])

  if (loading || !settings) {
    return <div className="flex min-h-56 items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
  }

  return (
    <div className="w-full space-y-6 pb-8">
      <header>
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-[hsl(var(--kila-accent))]" />
          <h2 className="text-base font-semibold text-foreground">记忆</h2>
        </div>
        <p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">
          启用 Nowledge 后，长期记忆直接写入 Nowledge；未启用时使用本地 Markdown。
        </p>
      </header>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">本地存储</h3>
          <p className="mt-1 text-sm text-muted-foreground">用于本地笔记、项目 Working Memory 和旧 Markdown 记忆兼容。</p>
        </div>
        <SettingsCard divided={false} className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><HardDrive className="h-4 w-4" /></span>
                本地存储已就绪
              </div>
              <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{status?.memoryDirectory ?? '~/.kila/memory'}</p>
              {projectPath && <p className="mt-1 truncate text-xs text-muted-foreground">当前项目：{projectPath}</p>}
            </div>
            <Button variant="outline" size="sm" onClick={() => void handleOpenMemoryDirectory()}>
              <FolderOpen className="h-4 w-4" />打开目录
            </Button>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 max-sm:grid-cols-1">
            <div className="rounded-lg bg-muted/45 px-3 py-2.5"><div className="text-xs text-muted-foreground">最近记忆</div><div className="mt-1 text-lg font-semibold tabular-nums">{memories.length}</div></div>
            <div className="rounded-lg bg-muted/45 px-3 py-2.5"><div className="text-xs text-muted-foreground">最近笔记</div><div className="mt-1 text-lg font-semibold tabular-nums">{notebooks.length}</div></div>
            <div className="rounded-lg bg-muted/45 px-3 py-2.5"><div className="text-xs text-muted-foreground">待恢复</div><div className="mt-1 text-lg font-semibold tabular-nums">{pendingCount}</div></div>
          </div>
        </SettingsCard>
        <SettingsCard>
          <SettingsToggle
            label="自动注入相关记忆"
            description="运行前从当前长期记忆来源及本地兼容记忆中检索相关内容。"
            checked={settings.memorySessionContextEnabled ?? true}
            onCheckedChange={(checked) => void persist({ memorySessionContextEnabled: checked })}
          />
        </SettingsCard>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Nowledge 长期记忆</h3>
          <p className="mt-1 text-sm text-muted-foreground">启用后，新的长期记忆会直接写入本机 Nowledge。</p>
        </div>
        <SettingsCard>
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${status?.nowledgeHealthy ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                {status?.nowledgeHealthy ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              </span>
              <div>
                <div className="text-sm font-medium text-foreground">{status?.nowledgeHealthy ? '本地服务已连接' : settings.memoryNowledgeEnabled ? '服务不可用' : '尚未启用'}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{status?.detail ?? '安装 Nowledge Mem 后可启用长期记忆'}</div>
              </div>
            </div>
            <Switch
              checked={settings.memoryNowledgeEnabled ?? false}
              onCheckedChange={(checked) => void persist({ memoryNowledgeEnabled: checked })}
              aria-label="启用 Nowledge 长期记忆"
            />
          </div>
          <SettingsInput
            label="本地服务地址"
            description="仅允许 localhost；默认端口为 14242。"
            value={nowledgeUrl}
            onChange={setNowledgeUrl}
            onBlur={() => void handleUrlSave()}
            placeholder={DEFAULT_NOWLEDGE_URL}
            disabled={!settings.memoryNowledgeEnabled}
          />
          <div className="flex flex-wrap justify-end gap-2 px-5 py-4">
            <Button variant="outline" size="sm" onClick={() => void window.electronAPI.openExternal('https://mem.nowledge.co')}>
              <ExternalLink className="h-4 w-4" />获取 Nowledge
            </Button>
            <Button variant="outline" size="sm" onClick={() => void handleCopySetupPrompt()}>
              <Clipboard className="h-4 w-4" />复制配置提示词
            </Button>
            <Button size="sm" disabled={detecting} onClick={() => void handleDetect()}>
              {detecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}自动检测并启用
            </Button>
          </div>
        </SettingsCard>

        <div className="grid grid-cols-[28px_1fr] gap-x-3 gap-y-3 rounded-lg bg-muted/35 px-4 py-4 text-sm">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">1</span><div><div className="font-medium text-foreground">安装并启动桌面客户端</div><div className="mt-0.5 text-muted-foreground">无需登录即可使用本机服务；确保托盘或 Dock 中能看到运行图标。</div></div>
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">2</span><div><div className="font-medium text-foreground">在 Kila 中自动检测</div><div className="mt-0.5 text-muted-foreground">Kila 检查 127.0.0.1:14242，并保存本地连接配置。</div></div>
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">3</span><div><div className="font-medium text-foreground">新建会话验证召回</div><div className="mt-0.5 text-muted-foreground">写入一条长期记忆后，在此处刷新并确认它来自 Nowledge。</div></div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div><h3 className="text-sm font-semibold text-foreground">长期记忆</h3><p className="mt-1 text-sm text-muted-foreground">展示全部项目与全局记忆的最近条目。</p></div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" disabled={refreshing} onClick={() => void handleShowAllMemories()}>
              查看全部
            </Button>
            <Button variant="ghost" size="sm" disabled={refreshing} onClick={() => void handleRefresh()}>
              <RefreshCw className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />刷新
            </Button>
          </div>
        </div>
        <SettingsCard divided={false}>
          {memories.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">还没有长期记忆。明确告诉 Agent“请记住……”即可创建第一条。</div>
          ) : memories.map((item) => <MemoryRow key={item.uri} item={item} onSelect={setSelectedMemory} onDelete={(uri) => void handleDeleteMemory(uri)} />)}
        </SettingsCard>
      </section>

      <Dialog open={allMemoriesOpen} onOpenChange={setAllMemoriesOpen}>
        <DialogContent className="flex max-h-[85vh] w-[calc(100vw-32px)] max-w-3xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>全部长期记忆</DialogTitle>
            <DialogDescription>按更新时间从新到旧排列，每页 {ALL_MEMORY_PAGE_SIZE} 条。点击条目可查看完整内容。</DialogDescription>
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
                <Button variant="outline" size="sm" onClick={() => void handleAllMemoriesPageChange(allMemoriesPage)}>重试</Button>
              </div>
            ) : allMemories.length === 0 ? (
              <div className="flex min-h-56 items-center justify-center px-5 text-center text-sm text-muted-foreground">还没有长期记忆。</div>
            ) : (
              allMemories.map((item) => <MemoryRow key={item.uri} item={item} onSelect={setSelectedMemory} onDelete={(uri) => void handleDeleteMemory(uri)} />)
            )}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border/40 pt-3">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {allMemoriesLoading && allMemories.length > 0 && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              第 {allMemoriesPage + 1} 页 · 本页 {allMemories.length} 条
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={allMemoriesLoading || allMemoriesPage === 0}
                onClick={() => void handleAllMemoriesPageChange(allMemoriesPage - 1)}
              >
                <ChevronLeft className="h-4 w-4" />上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={allMemoriesLoading || !allMemoriesHasNext}
                onClick={() => void handleAllMemoriesPageChange(allMemoriesPage + 1)}
              >
                下一页<ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={selectedMemory !== null} onOpenChange={(open) => { if (!open) setSelectedMemory(null) }}>
        <DialogContent className="flex max-h-[85vh] w-[calc(100vw-32px)] max-w-2xl flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>{selectedMemory?.title || selectedMemory?.category || '长期记忆详情'}</DialogTitle>
            <DialogDescription>
              {selectedMemory && `${formatTime(selectedMemory.updatedAt)} · ${selectedMemory.category}${selectedMemory.projectPath ? ` · ${selectedMemory.projectPath}` : ' · 全局'}`}
            </DialogDescription>
          </DialogHeader>
          {selectedMemory && (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-2">
              <div className="flex flex-wrap gap-1.5">
                {selectedMemory.tags.map((tag) => <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">#{tag}</span>)}
              </div>
              <div className="rounded-lg bg-muted/35 p-4 text-sm leading-6 text-foreground">
                <p className="whitespace-pre-wrap break-words">{selectedMemory.content}</p>
              </div>
              <p className="break-all font-mono text-[11px] text-muted-foreground">{selectedMemory.uri}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <section className="space-y-3">
        <div><h3 className="text-sm font-semibold text-foreground">本地笔记</h3><p className="mt-1 text-sm text-muted-foreground">用户主动维护的内容，不参与自动改写。</p></div>
        <SettingsCard divided={false} className="p-5">
          <div className="grid gap-3">
            <Input value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} placeholder="标题（可选）" />
            <Textarea value={noteContent} onChange={(event) => setNoteContent(event.target.value)} placeholder="记录需要长期保留的资料、清单或约束" rows={4} />
            <div className="flex justify-end"><Button size="sm" disabled={savingNote} onClick={() => void handleCreateNote()}>{savingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4" />}保存笔记</Button></div>
          </div>
          {notebooks.length > 0 && <div className="mt-5 space-y-3 border-t border-border/30 pt-4">{notebooks.map((note) => <div key={note.uri} className="flex gap-3 rounded-lg bg-muted/35 px-3 py-2.5"><div className="min-w-0 flex-1"><div className="text-sm font-medium text-foreground">{note.title || '未命名笔记'}</div><p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">{note.content}</p></div><Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="删除笔记" onClick={() => void handleDeleteNote(note.uri)}><Trash2 className="h-4 w-4" /></Button></div>)}</div>}
        </SettingsCard>
      </section>
    </div>
  )
}
