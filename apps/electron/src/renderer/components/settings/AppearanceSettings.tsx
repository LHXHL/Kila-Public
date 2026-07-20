/**
 * 外观设置：主题模式、内置/用户主题管理与字体设置。
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { Copy, Download, FolderOpen, MoreHorizontal, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { DEFAULT_THEME_ID, getBuiltinTheme } from '@kila/shared'
import type { ThemeDefinition, ThemeRecord } from '@kila/shared'
import { toast } from 'sonner'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsSegmentedControl,
} from './primitives'
import { LABEL_CLASS, DESCRIPTION_CLASS } from './primitives/SettingsUIConstants'
import {
  resolvedThemeAtom,
  themeCatalogAtom,
  themeIdAtom,
  themeModeAtom,
  updateThemeId,
  updateThemeMode,
} from '@/atoms/theme'
import { fontFamilyAtom, fontSizeAtom } from '@/atoms/font-atoms'
import { Button } from '@/components/ui/button'
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
import type { ThemeMode } from '../../../types'
import { ThemeEditorDialog } from './theme/ThemeEditorDialog'
import { ThemePreview } from './theme/ThemePreview'
import { cloneAsCustomTheme } from './theme/theme-editor-utils'

const THEME_OPTIONS = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
]

const isMac = navigator.userAgent.includes('Mac')
const ZOOM_HINT = isMac
  ? '使用 ⌘+ 放大、⌘- 缩小、⌘0 恢复默认大小'
  : '使用 Ctrl++ 放大、Ctrl+- 缩小、Ctrl+0 恢复默认大小'
const FONT_SIZE_MIN = 10
const FONT_SIZE_MAX = 32

interface EditorState {
  theme: ThemeDefinition
  editing: boolean
}

function ThemeCard({
  record,
  selected,
  mode,
  onSelect,
  onEdit,
  onDuplicate,
  onExport,
  onDelete,
}: {
  record: ThemeRecord
  selected: boolean
  mode: 'light' | 'dark'
  onSelect: () => void
  onEdit: () => void
  onDuplicate: () => void
  onExport: () => void
  onDelete: () => void
}): React.ReactElement {
  return (
    <div
      className={cn(
        'group relative rounded-2xl bg-card/75 p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md',
        selected && 'bg-[hsl(var(--kila-accent-muted))] shadow-[0_0_0_1px_hsl(var(--primary)/0.22)]',
      )}
    >
      <button type="button" className="block w-full text-left" onClick={onSelect}>
        <ThemePreview theme={record.theme} mode={mode} />
        <div className="mt-2.5 pr-8">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{record.theme.name}</span>
            {record.source === 'custom' && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">我的</span>
            )}
          </div>
          <div className="mt-0.5 line-clamp-2 min-h-8 text-xs text-muted-foreground">{record.theme.description}</div>
        </div>
      </button>
      {/* 非模态菜单避免 Radix 与 OverlayScrollbars 组合时锁住整页指针事件。 */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute bottom-3 right-3 opacity-70 hover:opacity-100"
            aria-label={`${record.theme.name}主题操作`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="z-[100] titlebar-no-drag">
          {record.source === 'custom' && (
            <DropdownMenuItem onSelect={onEdit}><Pencil />编辑</DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onDuplicate}><Copy />复制并编辑</DropdownMenuItem>
          {record.source === 'custom' && (
            <>
              <DropdownMenuItem onSelect={onExport}><Download />导出</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onDelete}>
                <Trash2 />删除
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function AppearanceSettings(): React.ReactElement {
  const [themeMode, setThemeMode] = useAtom(themeModeAtom)
  const [themeId, setThemeId] = useAtom(themeIdAtom)
  const [themeCatalog, setThemeCatalog] = useAtom(themeCatalogAtom)
  const [fontFamily, setFontFamily] = useAtom(fontFamilyAtom)
  const [fontSize, setFontSize] = useAtom(fontSizeAtom)
  const resolvedTheme = useAtomValue(resolvedThemeAtom)
  const [systemFonts, setSystemFonts] = React.useState<string[]>([])
  const [fontsLoading, setFontsLoading] = React.useState(true)
  const [fontSizeInput, setFontSizeInput] = React.useState(String(fontSize))
  const [editor, setEditor] = React.useState<EditorState | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<ThemeRecord | null>(null)

  const builtinThemes = themeCatalog.themes.filter((record) => record.source === 'builtin')
  const customThemes = themeCatalog.themes.filter((record) => record.source === 'custom')
  const existingIds = React.useMemo(() => new Set(themeCatalog.themes.map((record) => record.theme.id)), [themeCatalog])

  React.useEffect(() => {
    window.electronAPI.getSystemFonts()
      .then((fonts) => {
        setSystemFonts(fonts)
        setFontsLoading(false)
      })
      .catch((error: unknown) => {
        console.error('[外观设置] 加载系统字体失败:', error)
        setFontsLoading(false)
      })
  }, [])

  React.useEffect(() => setFontSizeInput(String(fontSize)), [fontSize])

  const handleThemeChange = React.useCallback((value: string) => {
    const mode = value as ThemeMode
    setThemeMode(mode)
    void updateThemeMode(mode).catch((error: unknown) => toast.error(error instanceof Error ? error.message : '主题模式保存失败'))
  }, [setThemeMode])

  const selectTheme = React.useCallback((nextThemeId: string) => {
    setThemeId(nextThemeId)
    void updateThemeId(nextThemeId).catch((error: unknown) => {
      setThemeId(DEFAULT_THEME_ID)
      toast.error(error instanceof Error ? error.message : '主题切换失败')
    })
  }, [setThemeId])

  const openCreate = React.useCallback(() => {
    const base = getBuiltinTheme(DEFAULT_THEME_ID)
    setEditor({
      editing: false,
      theme: cloneAsCustomTheme(base, '我的主题', existingIds),
    })
  }, [existingIds])

  const openDuplicate = React.useCallback((record: ThemeRecord) => {
    setEditor({
      editing: false,
      theme: cloneAsCustomTheme(record.theme, `${record.theme.name}副本`, existingIds),
    })
  }, [existingIds])

  const saveTheme = React.useCallback(async (theme: ThemeDefinition) => {
    if (!editor) return
    setBusy(true)
    try {
      const result = editor.editing
        ? await window.electronAPI.updateTheme(theme.id, theme)
        : await window.electronAPI.createTheme(theme)
      setThemeCatalog(result.catalog)
      setEditor(null)
      selectTheme(result.theme.theme.id)
      toast.success(editor.editing ? '主题已更新' : '主题已创建')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '主题保存失败')
    } finally {
      setBusy(false)
    }
  }, [editor, selectTheme, setThemeCatalog])

  const importTheme = React.useCallback(async () => {
    try {
      const imported = await window.electronAPI.importTheme()
      if (imported.canceled || !imported.result) return
      setThemeCatalog(imported.result.catalog)
      selectTheme(imported.result.theme.theme.id)
      toast.success(`已导入主题「${imported.result.theme.theme.name}」`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '主题导入失败')
    }
  }, [selectTheme, setThemeCatalog])

  const exportTheme = React.useCallback(async (record: ThemeRecord) => {
    try {
      if (await window.electronAPI.exportTheme(record.theme.id)) toast.success('主题已导出')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '主题导出失败')
    }
  }, [])

  const deleteTheme = React.useCallback(async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      const catalog = await window.electronAPI.deleteTheme(deleteTarget.theme.id)
      setThemeCatalog(catalog)
      if (themeId === deleteTarget.theme.id) setThemeId(DEFAULT_THEME_ID)
      setDeleteTarget(null)
      toast.success('主题已删除')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '主题删除失败')
    } finally {
      setBusy(false)
    }
  }, [deleteTarget, setThemeCatalog, setThemeId, themeId])

  const handleFontChange = React.useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value
    setFontFamily(value)
    void window.electronAPI.updateSettings({ fontFamily: value }).catch(console.error)
  }, [setFontFamily])

  const commitFontSize = React.useCallback((raw: string) => {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isNaN(parsed)) {
      setFontSizeInput(String(fontSize))
      return
    }
    const clamped = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, parsed))
    setFontSize(clamped)
    setFontSizeInput(String(clamped))
    void window.electronAPI.updateSettings({ fontSize: clamped }).catch(console.error)
  }, [fontSize, setFontSize])

  const handleFontSizeKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      commitFontSize(fontSizeInput)
      event.currentTarget.blur()
    } else if (event.key === 'Escape') {
      setFontSizeInput(String(fontSize))
      event.currentTarget.blur()
    }
  }, [commitFontSize, fontSize, fontSizeInput])

  const renderThemeGrid = (records: ThemeRecord[]): React.ReactElement => (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {records.map((record) => (
        <ThemeCard
          key={record.theme.id}
          record={record}
          selected={record.theme.id === themeId}
          mode={resolvedTheme}
          onSelect={() => selectTheme(record.theme.id)}
          onEdit={() => setEditor({ editing: true, theme: record.theme })}
          onDuplicate={() => openDuplicate(record)}
          onExport={() => { void exportTheme(record) }}
          onDelete={() => setDeleteTarget(record)}
        />
      ))}
    </div>
  )

  return (
    <div className="space-y-6">
      <SettingsSection title="外观设置" description="自定义应用的视觉风格">
        <SettingsCard>
          <SettingsSegmentedControl
            label="主题模式"
            description="选择浅色、深色或跟随系统"
            value={themeMode}
            onValueChange={handleThemeChange}
            options={THEME_OPTIONS}
          />
          <div className="space-y-5 px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className={LABEL_CLASS}>配色主题</div>
                <div className={cn(DESCRIPTION_CLASS, 'mt-0.5')}>当前预览：{resolvedTheme === 'dark' ? '深色' : '浅色'}。选择后会同步到所有窗口。</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => { void window.electronAPI.openThemesDirectory().catch((error: unknown) => toast.error(error instanceof Error ? error.message : '打开目录失败')) }}>
                  <FolderOpen />主题目录
                </Button>
                <Button variant="outline" size="sm" onClick={() => { void importTheme() }}><Upload />导入</Button>
                <Button size="sm" onClick={openCreate}><Plus />新建</Button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">内置主题</div>
              {renderThemeGrid(builtinThemes)}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">我的主题</div>
                <span className="text-xs text-muted-foreground">{customThemes.length} 个</span>
              </div>
              {customThemes.length > 0 ? renderThemeGrid(customThemes) : (
                <button
                  type="button"
                  onClick={openCreate}
                  className="flex w-full flex-col items-center justify-center rounded-2xl bg-muted/25 px-6 py-10 text-center transition-colors hover:bg-muted/40"
                >
                  <Plus className="mb-2 size-5 text-muted-foreground" />
                  <span className="text-sm font-medium">创建第一个自定义主题</span>
                  <span className="mt-1 text-xs text-muted-foreground">也可以导入 *.kila-theme.json 文件</span>
                </button>
              )}
            </div>

            {themeCatalog.issues.length > 0 && (
              <div className="rounded-xl bg-[hsl(var(--status-warning-soft))] p-3 text-xs text-[hsl(var(--status-warning-foreground))]">
                <div className="font-medium">有 {themeCatalog.issues.length} 个主题文件未能加载</div>
                {themeCatalog.issues.slice(0, 3).map((issue) => <div key={issue.fileName} className="mt-1">{issue.fileName}: {issue.message}</div>)}
              </div>
            )}
          </div>
          <SettingsRow label="界面缩放" description={ZOOM_HINT} />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="字体设置" description="自定义界面的字体和大小">
        <SettingsCard>
          <div className="space-y-2 px-4 py-3">
            <div className={LABEL_CLASS}>字体</div>
            <select
              value={fontFamily}
              onChange={handleFontChange}
              disabled={fontsLoading}
              className={cn(
                'h-10 w-full appearance-none rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:ring-2 focus:ring-ring focus:ring-offset-1',
                fontsLoading && 'cursor-not-allowed opacity-50',
              )}
              style={fontFamily ? { fontFamily: `"${fontFamily}", system-ui, sans-serif` } : undefined}
            >
              <option value="">系统默认</option>
              {systemFonts.map((font) => <option key={font} value={font} style={{ fontFamily: `"${font}", system-ui, sans-serif` }}>{font}</option>)}
            </select>
            <div className={DESCRIPTION_CLASS}>保留系统默认将使用操作系统字体。</div>
          </div>
          <div className="space-y-2 px-4 py-3">
            <div className={LABEL_CLASS}>字体大小</div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={FONT_SIZE_MIN}
                max={FONT_SIZE_MAX}
                value={fontSizeInput}
                onChange={(event) => setFontSizeInput(event.target.value)}
                onBlur={() => commitFontSize(fontSizeInput)}
                onKeyDown={handleFontSizeKeyDown}
                className="h-10 w-20 rounded-xl border border-border bg-background px-3 text-center text-sm outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
              />
              <span className="text-sm text-muted-foreground">px</span>
            </div>
            <div className={DESCRIPTION_CLASS}>{FONT_SIZE_MIN} – {FONT_SIZE_MAX} px</div>
          </div>
        </SettingsCard>
      </SettingsSection>

      <ThemeEditorDialog
        open={editor !== null}
        mode={resolvedTheme}
        initialTheme={editor?.theme ?? null}
        editing={editor?.editing ?? false}
        busy={busy}
        onOpenChange={(open) => { if (!open) setEditor(null) }}
        onSave={saveTheme}
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open && !busy) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除主题“{deleteTarget?.theme.name}”？</AlertDialogTitle>
            <AlertDialogDescription>主题文件将从 ~/.kila/themes 删除。若它是当前主题，Kila 会自动切换回默认主题。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={(event) => { event.preventDefault(); void deleteTheme() }}>
              {busy ? '删除中…' : '删除主题'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
