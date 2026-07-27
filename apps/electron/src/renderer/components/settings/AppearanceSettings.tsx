/**
 * 外观设置：主题模式、内置/用户主题管理与字体设置。
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
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

const isMac = navigator.userAgent.includes('Mac')
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
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'group relative rounded-2xl bg-card/75 p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md',
        selected && 'bg-kila-accent-muted shadow-[0_0_0_1px_hsl(var(--primary)/0.22)]',
      )}
    >
      <button type="button" className="block w-full text-left" onClick={onSelect}>
        <ThemePreview theme={record.theme} mode={mode} />
        <div className="mt-2.5 pr-8">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{record.theme.name}</span>
            {record.source === 'custom' && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t('settings.appearance.customBadge')}</span>
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
            aria-label={t('settings.appearance.themeActions', { name: record.theme.name })}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="z-[100] titlebar-no-drag">
          {record.source === 'custom' && (
            <DropdownMenuItem onSelect={onEdit}><Pencil />{t('settings.appearance.edit')}</DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onDuplicate}><Copy />{t('settings.appearance.duplicate')}</DropdownMenuItem>
          {record.source === 'custom' && (
            <>
              <DropdownMenuItem onSelect={onExport}><Download />{t('settings.appearance.export')}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onDelete}>
                <Trash2 />{t('common.delete')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function AppearanceSettings(): React.ReactElement {
  const { t } = useTranslation()
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

  const themeOptions = React.useMemo(() => [
    { value: 'light', label: t('settings.appearance.themeLight') },
    { value: 'dark', label: t('settings.appearance.themeDark') },
    { value: 'system', label: t('settings.appearance.themeSystem') },
  ], [t])
  const zoomHint = isMac ? t('settings.appearance.zoomHintMac') : t('settings.appearance.zoomHintWindows')

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
    void updateThemeMode(mode).catch((error: unknown) => toast.error(error instanceof Error ? error.message : t('settings.appearance.themeModeSaveFailed')))
  }, [setThemeMode, t])

  const selectTheme = React.useCallback((nextThemeId: string) => {
    setThemeId(nextThemeId)
    void updateThemeId(nextThemeId).catch((error: unknown) => {
      setThemeId(DEFAULT_THEME_ID)
      toast.error(error instanceof Error ? error.message : t('settings.appearance.themeSwitchFailed'))
    })
  }, [setThemeId, t])

  const openCreate = React.useCallback(() => {
    const base = getBuiltinTheme(DEFAULT_THEME_ID)
    setEditor({
      editing: false,
      theme: cloneAsCustomTheme(base, t('settings.appearance.newThemeName'), existingIds),
    })
  }, [existingIds, t])

  const openDuplicate = React.useCallback((record: ThemeRecord) => {
    setEditor({
      editing: false,
      theme: cloneAsCustomTheme(record.theme, t('settings.appearance.duplicateName', { name: record.theme.name }), existingIds),
    })
  }, [existingIds, t])

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
      toast.success(editor.editing ? t('settings.appearance.themeUpdated') : t('settings.appearance.themeCreated'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.appearance.themeSaveFailed'))
    } finally {
      setBusy(false)
    }
  }, [editor, selectTheme, setThemeCatalog, t])

  const importTheme = React.useCallback(async () => {
    try {
      const imported = await window.electronAPI.importTheme()
      if (imported.canceled || !imported.result) return
      setThemeCatalog(imported.result.catalog)
      selectTheme(imported.result.theme.theme.id)
      toast.success(t('settings.appearance.themeImported', { name: imported.result.theme.theme.name }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.appearance.themeImportFailed'))
    }
  }, [selectTheme, setThemeCatalog, t])

  const exportTheme = React.useCallback(async (record: ThemeRecord) => {
    try {
      if (await window.electronAPI.exportTheme(record.theme.id)) toast.success(t('settings.appearance.themeExported'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.appearance.themeExportFailed'))
    }
  }, [t])

  const deleteTheme = React.useCallback(async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      const catalog = await window.electronAPI.deleteTheme(deleteTarget.theme.id)
      setThemeCatalog(catalog)
      if (themeId === deleteTarget.theme.id) setThemeId(DEFAULT_THEME_ID)
      setDeleteTarget(null)
      toast.success(t('settings.appearance.themeDeleted'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.appearance.themeDeleteFailed'))
    } finally {
      setBusy(false)
    }
  }, [deleteTarget, setThemeCatalog, setThemeId, t, themeId])

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
      <SettingsSection title={t('settings.appearance.title')} description={t('settings.appearance.description')}>
        <SettingsCard>
          <SettingsSegmentedControl
            label={t('settings.appearance.theme')}
            description={t('settings.appearance.themeDescription')}
            value={themeMode}
            onValueChange={handleThemeChange}
            options={themeOptions}
          />
          <div className="space-y-5 px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className={LABEL_CLASS}>{t('settings.appearance.colorTheme')}</div>
                <div className={cn(DESCRIPTION_CLASS, 'mt-0.5')}>
                  {t('settings.appearance.colorThemePreview', {
                    mode: resolvedTheme === 'dark' ? t('settings.appearance.themeDark') : t('settings.appearance.themeLight'),
                  })}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => { void window.electronAPI.openThemesDirectory().catch((error: unknown) => toast.error(error instanceof Error ? error.message : t('settings.appearance.openDirectoryFailed'))) }}>
                  <FolderOpen />{t('settings.appearance.themesDirectory')}
                </Button>
                <Button variant="outline" size="sm" onClick={() => { void importTheme() }}><Upload />{t('settings.appearance.import')}</Button>
                <Button size="sm" onClick={openCreate}><Plus />{t('settings.appearance.create')}</Button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('settings.appearance.builtinThemes')}</div>
              {renderThemeGrid(builtinThemes)}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('settings.appearance.myThemes')}</div>
                <span className="text-xs text-muted-foreground">{t('settings.appearance.themeCount', { count: customThemes.length })}</span>
              </div>
              {customThemes.length > 0 ? renderThemeGrid(customThemes) : (
                <button
                  type="button"
                  onClick={openCreate}
                  className="flex w-full flex-col items-center justify-center rounded-2xl bg-muted/25 px-6 py-10 text-center transition-colors hover:bg-muted/40"
                >
                  <Plus className="mb-2 size-5 text-muted-foreground" />
                  <span className="text-sm font-medium">{t('settings.appearance.createFirstTheme')}</span>
                  <span className="mt-1 text-xs text-muted-foreground">{t('settings.appearance.importHint')}</span>
                </button>
              )}
            </div>

            {themeCatalog.issues.length > 0 && (
              <div className="rounded-xl bg-status-warning-soft p-3 text-xs text-status-warning-foreground">
                <div className="font-medium">{t('settings.appearance.themeLoadIssues', { count: themeCatalog.issues.length })}</div>
                {themeCatalog.issues.slice(0, 3).map((issue) => <div key={issue.fileName} className="mt-1">{issue.fileName}: {issue.message}</div>)}
              </div>
            )}
          </div>
          <SettingsRow label={t('settings.appearance.zoom')} description={zoomHint} />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('settings.appearance.font')} description={t('settings.appearance.fontDescription')}>
        <SettingsCard>
          <div className="space-y-2 px-4 py-3">
            <div className={LABEL_CLASS}>{t('settings.appearance.fontFamily')}</div>
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
              <option value="">{t('settings.appearance.systemDefaultFont')}</option>
              {systemFonts.map((font) => <option key={font} value={font} style={{ fontFamily: `"${font}", system-ui, sans-serif` }}>{font}</option>)}
            </select>
            <div className={DESCRIPTION_CLASS}>{t('settings.appearance.fontFamilyDescription')}</div>
          </div>
          <div className="space-y-2 px-4 py-3">
            <div className={LABEL_CLASS}>{t('settings.appearance.fontSize')}</div>
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
            <AlertDialogTitle>{t('settings.appearance.deleteThemeTitle', { name: deleteTarget?.theme.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('settings.appearance.deleteThemeDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={(event) => { event.preventDefault(); void deleteTheme() }}>
              {busy ? t('settings.appearance.deleting') : t('settings.appearance.deleteTheme')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
