/**
 * AppearanceSettings - 外观设置页
 *
 * 主题切换（浅色/深色/跟随系统），使用 SettingsSegmentedControl。
 * 字体设置（系统字体选择 + 字体大小）。
 * 通过 Jotai atom 管理状态，持久化到 ~/.kila/settings.json。
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { deriveThemeVars, getBuiltinTheme, getBuiltinThemes } from '@kila/shared'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsSegmentedControl,
} from './primitives'
import { LABEL_CLASS, DESCRIPTION_CLASS } from './primitives/SettingsUIConstants'
import { resolvedThemeAtom, themeIdAtom, themeModeAtom, updateThemeId, updateThemeMode } from '@/atoms/theme'
import { fontFamilyAtom, fontSizeAtom, DEFAULT_FONT_SIZE } from '@/atoms/font-atoms'
import { cn } from '@/lib/utils'
import type { ThemeMode } from '../../../types'

/** 主题选项 */
const THEME_OPTIONS = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
]

/** 根据平台返回缩放快捷键提示 */
const isMac = navigator.userAgent.includes('Mac')
const ZOOM_HINT = isMac
  ? '使用 ⌘+ 放大、⌘- 缩小、⌘0 恢复默认大小'
  : '使用 Ctrl++ 放大、Ctrl+- 缩小、Ctrl+0 恢复默认大小'

/** 字体大小范围 */
const FONT_SIZE_MIN = 10
const FONT_SIZE_MAX = 32

const BUILTIN_THEMES = getBuiltinThemes()

function ThemePreview({
  themeId,
  mode,
}: {
  themeId: string
  mode: 'light' | 'dark'
}): React.ReactElement {
  const theme = getBuiltinTheme(themeId)
  const vars = React.useMemo(() => deriveThemeVars(theme, mode), [theme, mode])

  return (
    <div
      className="h-[86px] w-full overflow-hidden rounded-xl border"
      style={{
        backgroundColor: `hsl(${vars['--workspace']})`,
        borderColor: `hsl(${vars['--border']})`,
      }}
    >
      <div className="flex h-full">
        <div
          className="w-9 shrink-0 border-r px-2 py-2"
          style={{
            backgroundColor: `hsl(${vars['--kila-rail']})`,
            borderColor: `hsl(${vars['--border']})`,
          }}
        >
          <div
            className="mb-2 h-3 w-3 rounded-full"
            style={{ backgroundColor: `hsl(${vars['--kila-accent']})` }}
          />
          <div
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: `hsl(${vars['--muted']})` }}
          />
        </div>
        <div className="min-w-0 flex-1 p-2">
          <div
            className="mb-2 h-3 w-24 rounded-full"
            style={{ backgroundColor: `hsl(${vars['--kila-panel-surface-raised']})` }}
          />
          <div
            className="ml-auto mb-2 h-5 w-[58%] rounded-lg"
            style={{ backgroundColor: `hsl(${vars['--kila-user-bubble']})` }}
          />
          <div
            className="h-5 w-[68%] rounded-lg border"
            style={{
              backgroundColor: `hsl(${vars['--card']})`,
              borderColor: `hsl(${vars['--border']})`,
            }}
          />
          <div className="mt-2 flex items-center gap-1.5">
            <div
              className="h-2 flex-1 rounded-full"
              style={{ backgroundColor: `hsl(${vars['--kila-accent-muted']})` }}
            />
            <div
              className="h-2 w-8 rounded-full"
              style={{ backgroundColor: `hsl(${vars['--primary']})` }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export function AppearanceSettings(): React.ReactElement {
  const [themeMode, setThemeMode] = useAtom(themeModeAtom)
  const [themeId, setThemeId] = useAtom(themeIdAtom)
  const [fontFamily, setFontFamily] = useAtom(fontFamilyAtom)
  const [fontSize, setFontSize] = useAtom(fontSizeAtom)
  const resolvedTheme = useAtomValue(resolvedThemeAtom)
  const [systemFonts, setSystemFonts] = React.useState<string[]>([])
  const [fontsLoading, setFontsLoading] = React.useState(true)
  const [fontSizeInput, setFontSizeInput] = React.useState(String(fontSize))

  // 加载系统字体列表（一次性）
  React.useEffect(() => {
    window.electronAPI.getSystemFonts()
      .then((fonts) => {
        setSystemFonts(fonts)
        setFontsLoading(false)
      })
      .catch((err: unknown) => {
        console.error('[外观设置] 加载系统字体失败:', err)
        setFontsLoading(false)
      })
  }, [])

  // 同步 fontSize atom -> 输入框
  React.useEffect(() => {
    setFontSizeInput(String(fontSize))
  }, [fontSize])

  /** 切换主题模式 */
  const handleThemeChange = React.useCallback((value: string) => {
    const mode = value as ThemeMode
    setThemeMode(mode)
    updateThemeMode(mode)
  }, [setThemeMode])

  const handleThemeIdChange = React.useCallback((nextThemeId: string) => {
    setThemeId(nextThemeId)
    updateThemeId(nextThemeId)
  }, [setThemeId])

  /** 切换字体 */
  const handleFontChange = React.useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value
    setFontFamily(value)
    window.electronAPI.updateSettings({ fontFamily: value }).catch(console.error)
  }, [setFontFamily])

  /** 提交字体大小 */
  const commitFontSize = React.useCallback((raw: string) => {
    const parsed = parseInt(raw, 10)
    if (Number.isNaN(parsed)) {
      setFontSizeInput(String(fontSize))
      return
    }
    const clamped = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, parsed))
    setFontSize(clamped)
    setFontSizeInput(String(clamped))
    window.electronAPI.updateSettings({ fontSize: clamped }).catch(console.error)
  }, [fontSize, setFontSize])

  const handleFontSizeKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commitFontSize(fontSizeInput)
      ;(e.target as HTMLInputElement).blur()
    } else if (e.key === 'Escape') {
      setFontSizeInput(String(fontSize))
      ;(e.target as HTMLInputElement).blur()
    }
  }, [commitFontSize, fontSizeInput, fontSize])

  return (
    <div className="space-y-6">
      <SettingsSection
        title="外观设置"
        description="自定义应用的视觉风格"
      >
        <SettingsCard>
          <SettingsSegmentedControl
            label="主题模式"
            description="选择应用的配色方案"
            value={themeMode}
            onValueChange={handleThemeChange}
            options={THEME_OPTIONS}
          />
          <div className="space-y-3 px-4 py-3">
            <div>
              <div className={LABEL_CLASS}>配色主题</div>
              <div className={cn(DESCRIPTION_CLASS, 'mt-0.5')}>
                当前预览模式：{resolvedTheme === 'dark' ? '深色' : '浅色'}。点击主题后立即生效。
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {BUILTIN_THEMES.map((theme) => {
                const isSelected = theme.id === themeId
                return (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => handleThemeIdChange(theme.id)}
                    className={cn(
                      'flex flex-col items-start gap-2 rounded-xl border px-3 py-3 text-left transition-colors',
                      'border-border/50 bg-card/70 hover:bg-muted/30',
                      isSelected && 'border-primary/30 bg-[hsl(var(--kila-accent-muted))] text-[hsl(var(--kila-accent-foreground))]',
                    )}
                  >
                    <ThemePreview themeId={theme.id} mode={resolvedTheme} />
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium">{theme.name}</div>
                      <div className={cn('text-xs', isSelected ? 'text-[hsl(var(--brand-soft-foreground))/0.82]' : 'text-muted-foreground')}>
                        {theme.description}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
          <SettingsRow
            label="界面缩放"
            description={ZOOM_HINT}
          />
        </SettingsCard>
      </SettingsSection>

      {/* 字体设置 */}
      <SettingsSection
        title="字体设置"
        description="自定义界面的字体和大小"
      >
        <SettingsCard>
          {/* 字体选择器 */}
          <div className="px-4 py-3 space-y-2">
            <div>
              <div className={LABEL_CLASS}>字体</div>
            </div>
            <select
              value={fontFamily}
              onChange={handleFontChange}
              disabled={fontsLoading}
              className={cn(
                'w-full h-10 px-3 rounded-md border border-border bg-background text-foreground text-sm',
                'outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
                'appearance-none',
                'transition-colors',
                fontsLoading && 'opacity-50 cursor-not-allowed',
              )}
              style={fontFamily ? { fontFamily: `"${fontFamily}", system-ui, sans-serif` } : undefined}
            >
              <option value="" style={{ fontFamily: 'inherit' }}>
                系统默认
              </option>
              {systemFonts.map((font) => (
                <option
                  key={font}
                  value={font}
                  style={{ fontFamily: `"${font}", system-ui, sans-serif` }}
                >
                  {font}
                </option>
              ))}
            </select>
            <div className={cn(DESCRIPTION_CLASS, 'mt-0.5')}>
              选择应用界面的字体。保留系统默认将使用操作系统字体。
            </div>
          </div>

          {/* 字体大小 */}
          <div className="px-4 py-3 space-y-2">
            <div>
              <div className={LABEL_CLASS}>字体大小</div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={FONT_SIZE_MIN}
                max={FONT_SIZE_MAX}
                step={1}
                value={fontSizeInput}
                onChange={(e) => setFontSizeInput(e.target.value)}
                onBlur={() => commitFontSize(fontSizeInput)}
                onKeyDown={handleFontSizeKeyDown}
                className={cn(
                  'w-20 h-10 px-3 rounded-md border border-border bg-background text-foreground text-sm text-center',
                  'outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
                  'transition-colors',
                  '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                )}
              />
              <span className="text-sm text-muted-foreground">px</span>
            </div>
            <div className={cn(DESCRIPTION_CLASS, 'mt-0.5')}>
              {FONT_SIZE_MIN} – {FONT_SIZE_MAX} px
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}
