/**
 * FileBrowser — 通用文件浏览器面板
 *
 * 显示指定根路径下的文件树，支持：
 * - 文件夹懒加载展开（Chevron 旋转动画）
 * - 单击选中、Cmd/Ctrl+Click 多选
 * - 选中后显示三点菜单（打开 / 在文件夹中显示 / 重命名 / 移动 / 删除）
 * - 文件/文件夹删除（带确认session框）
 * - 原位重命名（含同名检查）
 * - 自动刷新
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import {
  Folder,
  FolderOpen,
  FileText,
  ChevronRight,
  Loader2,
  Trash2,
  RefreshCw,
  ExternalLink,
  FolderSearch,
  MoreHorizontal,
  FolderInput,
  Pencil,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { workspaceFilesVersionAtom } from '@/atoms/agent-atoms'
import type { FileEntry } from '@kila/shared'

interface FileBrowserProps {
  rootPath: string
  /** 隐藏内置顶部工具栏（面包屑 + 按钮），由外部自行渲染 */
  hideToolbar?: boolean
  /** 嵌入模式：不使用内部 ScrollArea 和 h-full，由外部容器控制布局和滚动 */
  embedded?: boolean
  /** 选中条目回调 */
  onEntrySelect?: (entry: FileEntry) => void
  /** 自定义预览行为（默认仍走旧 previewFile IPC） */
  onEntryPreview?: (entry: FileEntry) => void
}

export function FileBrowser({
  rootPath,
  hideToolbar,
  embedded,
  onEntrySelect,
  onEntryPreview,
}: FileBrowserProps): React.ReactElement {
  const [entries, setEntries] = React.useState<FileEntry[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const filesVersion = useAtomValue(workspaceFilesVersionAtom)
  const loadRequestIdRef = React.useRef(0)

  // 选中状态
  const [selectedPaths, setSelectedPaths] = React.useState<Set<string>>(new Set())
  // 删除确认状态
  const [deleteTarget, setDeleteTarget] = React.useState<FileEntry | null>(null)
  const [deleteCount, setDeleteCount] = React.useState(1)
  // 重命名状态
  const [renamingPath, setRenamingPath] = React.useState<string | null>(null)
  // 移动中状态
  const [moving, setMoving] = React.useState(false)

  const selectedCount = selectedPaths.size

  /** 加载根目录 */
  const loadRoot = React.useCallback(async () => {
    const requestId = ++loadRequestIdRef.current
    if (!rootPath) {
      setEntries([])
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const items = await window.electronAPI.listDirectory(rootPath)
      if (loadRequestIdRef.current !== requestId) return
      setEntries(items)
    } catch (err) {
      if (loadRequestIdRef.current !== requestId) return
      const msg = err instanceof Error ? err.message : '加载失败'
      setError(msg)
      setEntries([])
    } finally {
      if (loadRequestIdRef.current !== requestId) return
      setLoading(false)
    }
  }, [rootPath])

  React.useEffect(() => {
    setSelectedPaths(new Set())
    setDeleteTarget(null)
    setDeleteCount(1)
    setRenamingPath(null)
    setMoving(false)
    loadRoot()
  }, [loadRoot, filesVersion])

  /** 选中项 */
  const handleSelect = React.useCallback((entry: FileEntry, event: { metaKey: boolean; ctrlKey: boolean }) => {
    onEntrySelect?.(entry)
    const isMulti = event.metaKey || event.ctrlKey
    if (isMulti) {
      setSelectedPaths((prev) => {
        const next = new Set(prev)
        if (next.has(entry.path)) {
          next.delete(entry.path)
        } else {
          next.add(entry.path)
        }
        return next
      })
    } else {
      setSelectedPaths(new Set([entry.path]))
    }
  }, [onEntrySelect])

  /** 点击空白区域清空选中 */
  const handleBackgroundClick = React.useCallback((e: React.MouseEvent) => {
    // 只处理直接点击容器的情况
    if (e.target === e.currentTarget) {
      setSelectedPaths(new Set())
    }
  }, [])

  /** 在文件夹中显示 */
  const handleShowInFolder = React.useCallback((entry: FileEntry) => {
    window.electronAPI.showInFolder(entry.path).catch(console.error)
  }, [])

  /** 开始重命名 */
  const handleStartRename = React.useCallback((entry: FileEntry) => {
    setRenamingPath(entry.path)
  }, [])

  /** 取消重命名 */
  const handleCancelRename = React.useCallback(() => {
    setRenamingPath(null)
  }, [])

  /** 执行重命名 */
  const handleRename = React.useCallback(async (filePath: string, newName: string): Promise<string | null> => {
    // 同名检查
    const parentDir = filePath.substring(0, filePath.lastIndexOf('/'))
    try {
      const siblings = await window.electronAPI.listDirectory(parentDir)
      const conflict = siblings.some((s) => s.name === newName && s.path !== filePath)
      if (conflict) {
        return '同名文件已存在'
      }
    } catch {
      // 无法列出目录，跳过检查
    }

    try {
      await window.electronAPI.renameFile(filePath, newName)
      await loadRoot()
      setRenamingPath(null)
      setSelectedPaths(new Set())
      return null
    } catch (err) {
      return err instanceof Error ? err.message : '重命名失败'
    }
  }, [loadRoot])

  /** 触发删除（支持多选） */
  const handleRequestDelete = React.useCallback((entry: FileEntry) => {
    setDeleteTarget(entry)
    setDeleteCount(selectedCount > 1 ? selectedCount : 1)
  }, [selectedCount])

  /** 执行删除 */
  const handleDelete = React.useCallback(async () => {
    if (!deleteTarget) return
    try {
      if (selectedPaths.size > 1) {
        // 批量删除
        for (const path of selectedPaths) {
          await window.electronAPI.deleteFile(path)
        }
      } else {
        await window.electronAPI.deleteFile(deleteTarget.path)
      }
      setSelectedPaths(new Set())
      await loadRoot()
    } catch (err) {
      console.error('[FileBrowser] 删除失败:', err)
    }
    setDeleteTarget(null)
  }, [deleteTarget, selectedPaths, loadRoot])

  /** 移动文件 */
  const handleMove = React.useCallback(async (entry: FileEntry) => {
    setMoving(true)
    try {
      const result = await window.electronAPI.openFolderDialog()
      if (!result) return

      if (selectedPaths.size > 1) {
        for (const path of selectedPaths) {
          await window.electronAPI.moveFile(path, result.path)
        }
      } else {
        await window.electronAPI.moveFile(entry.path, result.path)
      }
      setSelectedPaths(new Set())
      await loadRoot()
    } catch (err) {
      console.error('[FileBrowser] 移动失败:', err)
    } finally {
      setMoving(false)
    }
  }, [selectedPaths, loadRoot])

  // 显示根路径最后两段作为面包屑
  const breadcrumb = React.useMemo(() => {
    const parts = rootPath.split('/').filter(Boolean)
    return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : rootPath
  }, [rootPath])

  const fileTree = (
    <div role="tree" aria-label="项目文件" aria-multiselectable="true" className="px-1.5 py-1" onClick={handleBackgroundClick}>
      {error && (
        <div className="px-3 py-2 text-xs text-destructive">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">{error}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => { void loadRoot() }}
            >
              重试
            </Button>
          </div>
        </div>
      )}
      {!error && loading && entries.length === 0 && (
        <div className="flex items-center justify-center px-3 py-8 text-xs text-muted-foreground">
          <Loader2 className="mr-2 size-3.5 animate-spin" />
          正在加载目录...
        </div>
      )}
      {!error && !loading && entries.length === 0 && (
        <div className="px-3 py-4 text-xs text-muted-foreground text-center">
          目录为空
        </div>
      )}
      {!error && loading && entries.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          正在刷新目录...
        </div>
      )}
      {entries.map((entry) => (
        <FileTreeItem
          key={entry.path}
          entry={entry}
          depth={0}
          selectedPaths={selectedPaths}
          selectedCount={selectedCount}
          renamingPath={renamingPath}
          moving={moving}
          refreshVersion={filesVersion}
          onSelect={handleSelect}
          onShowInFolder={handleShowInFolder}
          onStartRename={handleStartRename}
          onCancelRename={handleCancelRename}
          onRename={handleRename}
          onDelete={handleRequestDelete}
          onMove={handleMove}
          onRefresh={loadRoot}
          onEntryPreview={onEntryPreview}
        />
      ))}
    </div>
  )

  return (
    <div className={cn('flex min-h-0 flex-col', !embedded ? 'h-full bg-background' : 'bg-transparent')}>
      {/* 顶部工具栏（可由外部接管） */}
      {!hideToolbar && (
        <div className="mx-2 mt-2 flex h-[44px] flex-shrink-0 items-center gap-1 rounded-xl bg-[hsl(var(--kila-panel-surface-raised)/0.72)] px-3 pr-10 shadow-sm">
          <span className="text-xs text-muted-foreground truncate flex-1" title={rootPath}>
            {breadcrumb}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={() => window.electronAPI.openFile(rootPath).catch(console.error)}
            title="在 Finder 中打开"
            aria-label="在文件管理器中打开项目目录"
          >
            <ExternalLink className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={loadRoot}
            disabled={loading}
            aria-label="刷新文件树"
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          </Button>
        </div>
      )}

      {/* 文件树 */}
      {embedded ? fileTree : (
        <ScrollArea className="min-h-0 flex-1">
          {fileTree}
        </ScrollArea>
      )}

      {/* 删除确认session框 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteCount > 1 ? (
                <>确定要删除选中的 <strong>{deleteCount}</strong> 个项目吗？</>
              ) : (
                <>
                  确定要删除 <strong>{deleteTarget?.name}</strong> 吗？
                  {deleteTarget?.isDirectory && '（包含所有子文件）'}
                </>
              )}
              此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ===== FileTreeItem 子组件 =====

interface FileTreeItemProps {
  entry: FileEntry
  depth: number
  selectedPaths: Set<string>
  selectedCount: number
  renamingPath: string | null
  moving: boolean
  /** 文件版本号，变化时已展开的文件夹自动重新加载子项 */
  refreshVersion: number
  onSelect: (entry: FileEntry, event: { metaKey: boolean; ctrlKey: boolean }) => void
  onShowInFolder: (entry: FileEntry) => void
  onStartRename: (entry: FileEntry) => void
  onCancelRename: () => void
  onRename: (filePath: string, newName: string) => Promise<string | null>
  onDelete: (entry: FileEntry) => void
  onMove: (entry: FileEntry) => void
  onRefresh: () => Promise<void>
  onEntryPreview?: (entry: FileEntry) => void
}

function FileTreeItem({
  entry,
  depth,
  selectedPaths,
  selectedCount,
  renamingPath,
  moving,
  refreshVersion,
  onSelect,
  onShowInFolder,
  onStartRename,
  onCancelRename,
  onRename,
  onDelete,
  onMove,
  onRefresh,
  onEntryPreview,
}: FileTreeItemProps): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false)
  const [children, setChildren] = React.useState<FileEntry[]>([])
  const [childrenLoaded, setChildrenLoaded] = React.useState(false)
  const [childrenLoading, setChildrenLoading] = React.useState(false)
  const [childrenError, setChildrenError] = React.useState<string | null>(null)

  // 当 refreshVersion 变化时，已展开的文件夹自动重新加载子项
  React.useEffect(() => {
    if (expanded && childrenLoaded && entry.isDirectory) {
      window.electronAPI.listDirectory(entry.path)
        .then((items) => setChildren(items))
        .catch((err) => console.error('[FileTreeItem] 刷新子目录失败:', err))
    }
  }, [refreshVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  // 重命名编辑状态
  const [editName, setEditName] = React.useState('')
  const [renameError, setRenameError] = React.useState<string | null>(null)
  const renameInputRef = React.useRef<HTMLInputElement>(null)
  const justStartedEditing = React.useRef(false)

  const isSelected = selectedPaths.has(entry.path)
  const isRenaming = renamingPath === entry.path

  /** 展开/收起文件夹 */
  const toggleDir = async (): Promise<void> => {
    if (!entry.isDirectory || childrenLoading) return

    if (!expanded && !childrenLoaded) {
      setChildrenLoading(true)
      setChildrenError(null)
      try {
        const items = await window.electronAPI.listDirectory(entry.path)
        setChildren(items)
        setChildrenLoaded(true)
        setExpanded(true)
      } catch (err) {
        console.error('[FileTreeItem] 加载子目录失败:', err)
        setChildrenError(err instanceof Error ? err.message : '子目录加载失败')
      } finally {
        setChildrenLoading(false)
      }
      return
    }

    setExpanded(!expanded)
  }

  /** 点击行为：选中 + 文件夹展开/收起 */
  const handleClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    onSelect(entry, e)
    if (entry.isDirectory && !e.metaKey && !e.ctrlKey) {
      toggleDir()
    }
  }

  /** 双击预览文件 */
  const handleDoubleClick = (): void => {
    if (!entry.isDirectory) {
      if (onEntryPreview) {
        onEntryPreview(entry)
      } else {
        window.electronAPI.previewFile(entry.path).catch(console.error)
      }
    }
  }

  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return
    const tree = event.currentTarget.closest('[role="tree"]')
    const items = tree ? Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]')) : []
    const currentIndex = items.indexOf(event.currentTarget)

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : Math.max(0, Math.min(items.length - 1, currentIndex + (event.key === 'ArrowDown' ? 1 : -1)))
      items[nextIndex]?.focus()
      return
    }

    if (event.key === 'ArrowRight' && entry.isDirectory) {
      event.preventDefault()
      if (!expanded) void toggleDir()
      else items[currentIndex + 1]?.focus()
      return
    }
    if (event.key === 'ArrowLeft' && entry.isDirectory && expanded) {
      event.preventDefault()
      setExpanded(false)
      return
    }
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      onSelect(entry, { metaKey: event.metaKey, ctrlKey: event.ctrlKey })
      if (event.key === 'Enter') {
        if (entry.isDirectory) void toggleDir()
        else handleDoubleClick()
      }
    }
  }

  /** 删除后刷新子目录 */
  const handleRefreshAfterDelete = async (): Promise<void> => {
    if (childrenLoaded) {
      try {
        const items = await window.electronAPI.listDirectory(entry.path)
        setChildren(items)
      } catch {
        await onRefresh()
      }
    }
  }

  // 进入重命名编辑模式
  React.useEffect(() => {
    if (isRenaming) {
      setEditName(entry.name)
      setRenameError(null)
      justStartedEditing.current = true
      const timer = setTimeout(() => {
        justStartedEditing.current = false
        const input = renameInputRef.current
        if (input) {
          input.focus()
          // 只选中文件名部分，不包括后缀
          const lastDotIndex = entry.name.lastIndexOf('.')
          if (lastDotIndex > 0 && !entry.isDirectory) {
            input.setSelectionRange(0, lastDotIndex)
          } else {
            input.select()
          }
        }
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [isRenaming, entry.name, entry.isDirectory])

  /** 保存重命名 */
  const saveRename = async (): Promise<void> => {
    if (justStartedEditing.current) return

    const trimmed = editName.trim()
    if (!trimmed || trimmed === entry.name) {
      onCancelRename()
      return
    }
    const error = await onRename(entry.path, trimmed)
    if (error) {
      setRenameError(error)
    }
  }

  /** 重命名键盘事件 */
  const handleRenameKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void saveRename()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancelRename()
    }
  }

  /** 重命名失焦 */
  const handleBlur = (): void => {
    if (renameError) {
      onCancelRename()
      setRenameError(null)
    } else {
      void saveRename()
    }
  }

  const paddingLeft = 8 + depth * 16
  const showMenu = isSelected && selectedCount > 0 && !isRenaming

  return (
    <>
      <div
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={isSelected}
        aria-expanded={entry.isDirectory ? expanded : undefined}
        tabIndex={0}
        className={cn(
          'mx-0.5 flex items-center gap-1 rounded-lg py-1 pr-2 text-sm group',
          isSelected ? 'bg-accent' : 'hover:bg-accent/50',
        )}
        style={{ paddingLeft }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleTreeKeyDown}
      >
        {/* 展开/收起图标 */}
        {entry.isDirectory ? (
          childrenLoading ? (
            <Loader2 className="size-3.5 flex-shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <ChevronRight
              className={cn(
                'size-3.5 text-muted-foreground flex-shrink-0 transition-transform duration-150',
                expanded && 'rotate-90',
              )}
            />
          )
        ) : (
          <span className="w-3.5 flex-shrink-0" />
        )}

        {/* 文件/文件夹图标 */}
        {entry.isDirectory ? (
          expanded ? (
            <FolderOpen className="size-4 flex-shrink-0 text-[hsl(var(--brand-soft-foreground))]" />
          ) : (
            <Folder className="size-4 flex-shrink-0 text-[hsl(var(--brand-soft-foreground))]" />
          )
        ) : (
          <FileText className="size-4 text-muted-foreground flex-shrink-0" />
        )}

        {/* 文件名 / 重命名输入框 */}
        {isRenaming ? (
          <div className="flex-1 min-w-0">
            <input
              ref={renameInputRef}
              value={editName}
              onChange={(e) => { setEditName(e.target.value); setRenameError(null) }}
              onKeyDown={handleRenameKeyDown}
              onBlur={handleBlur}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'w-full bg-transparent text-xs border-b outline-none py-0.5',
                renameError ? 'border-destructive' : 'border-primary/50',
              )}
              maxLength={255}
            />
            {renameError && (
              <div className="text-[10px] text-destructive mt-0.5">{renameError}</div>
            )}
          </div>
        ) : (
          <span className="truncate text-xs flex-1">{entry.name}</span>
        )}

        {/* 三点菜单按钮 */}
        {showMenu && (
          <div
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`更多操作：${entry.name}`}
                  className="h-6 w-6 rounded flex items-center justify-center hover:bg-accent/70"
                >
                  <MoreHorizontal className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40 z-[9999] min-w-0 p-0.5">
                {selectedCount === 1 && (
                  <DropdownMenuItem
                    className="text-xs py-1 [&>svg]:size-3.5"
                    onSelect={() => onShowInFolder(entry)}
                  >
                    <FolderSearch />
                    在文件夹中显示
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="text-xs py-1 [&>svg]:size-3.5"
                  disabled={moving}
                  onSelect={() => { void onMove(entry) }}
                >
                  <FolderInput />
                  {selectedCount > 1 ? `移动选中 (${selectedCount})` : '移动到...'}
                </DropdownMenuItem>
                {selectedCount === 1 && (
                  <DropdownMenuItem
                    className="text-xs py-1 [&>svg]:size-3.5"
                    onSelect={() => onStartRename(entry)}
                  >
                    <Pencil />
                    重命名
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator className="my-0.5" />
                <DropdownMenuItem
                  className="text-xs py-1 [&>svg]:size-3.5 text-destructive"
                  onSelect={() => onDelete(entry)}
                >
                  <Trash2 />
                  {selectedCount > 1 ? `删除选中 (${selectedCount})` : '删除'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* 子项 */}
      {childrenError && (
        <div role="alert" className="flex items-center gap-2 py-1 text-[11px] text-destructive" style={{ paddingLeft: paddingLeft + 24 }}>
          <span className="truncate">{childrenError}</span>
          <button type="button" className="text-primary hover:underline" onClick={() => { void toggleDir() }}>重试</button>
        </div>
      )}
      {expanded && children.length === 0 && childrenLoaded && (
        <div
          className="text-[11px] text-muted-foreground/50 py-1"
          style={{ paddingLeft: paddingLeft + 24 }}
        >
          空文件夹
        </div>
      )}
      {expanded && children.map((child) => (
        <FileTreeItem
          key={child.path}
          entry={child}
          depth={depth + 1}
          selectedPaths={selectedPaths}
          selectedCount={selectedCount}
          renamingPath={renamingPath}
          moving={moving}
          refreshVersion={refreshVersion}
          onSelect={onSelect}
          onShowInFolder={onShowInFolder}
          onStartRename={onStartRename}
          onCancelRename={onCancelRename}
          onRename={onRename}
          onDelete={onDelete}
          onMove={onMove}
          onRefresh={handleRefreshAfterDelete}
          onEntryPreview={onEntryPreview}
        />
      ))}
    </>
  )
}
