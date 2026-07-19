import * as React from 'react'
import {
  deriveThemeColorMap,
  getContrastRatio,
  validateThemeDefinition,
} from '@kila/shared'
import type { ThemeCoreColors, ThemeDefinition, ThemeValidationIssue } from '@kila/shared'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { ThemePreview } from './ThemePreview'
import {
  THEME_COLOR_FIELDS,
  colorPickerValueToOklch,
  hexColorInputToOklch,
  normalizeHexColorInput,
  themeColorValueToHex,
} from './theme-editor-utils'

interface ThemeEditorDialogProps {
  open: boolean
  mode: 'light' | 'dark'
  initialTheme: ThemeDefinition | null
  editing: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSave: (theme: ThemeDefinition) => Promise<void>
}

function ColorField({
  label,
  value,
  onChange,
  optional = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  optional?: boolean
}): React.ReactElement {
  const hexValue = themeColorValueToHex(value)
  const convertedValue = hexColorInputToOklch(hexValue)
  const pickerValue = convertedValue ? hexValue : '#000000'
  const invalid = (!optional && !hexValue) || (Boolean(hexValue) && !convertedValue)

  const handleTextChange = (nextValue: string): void => {
    const normalized = normalizeHexColorInput(nextValue)
    if (!normalized && optional) {
      onChange('')
      return
    }
    onChange(hexColorInputToOklch(normalized) ?? normalized)
  }
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-foreground">{label}{optional ? '（可选）' : ''}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={pickerValue}
          onChange={(event) => onChange(colorPickerValueToOklch(event.target.value))}
          className="h-9 w-11 cursor-pointer rounded-lg border border-input bg-transparent p-1"
          aria-label={`${label}颜色选择器`}
        />
        <Input
          value={hexValue}
          onChange={(event) => handleTextChange(event.target.value)}
          placeholder={optional ? '留空自动生成' : '#CC7D5E'}
          maxLength={7}
          spellCheck={false}
          aria-invalid={invalid}
          className={cn('font-mono text-xs uppercase', invalid && 'border-destructive')}
        />
      </div>
    </label>
  )
}

function contrastItems(theme: ThemeDefinition, mode: 'light' | 'dark'): Array<{ label: string; ratio: number; threshold: number }> {
  try {
    const colors = deriveThemeColorMap(theme, mode)
    return [
      { label: '正文 / 背景', ratio: getContrastRatio(colors['--foreground'], colors['--background']), threshold: 4.5 },
      { label: '按钮文字 / 按钮', ratio: getContrastRatio(colors['--primary-foreground'], colors['--primary']), threshold: 4.5 },
      { label: '弱文字 / 背景', ratio: getContrastRatio(colors['--muted-foreground'], colors['--background']), threshold: 3 },
    ]
  } catch {
    return []
  }
}

export function ThemeEditorDialog({
  open,
  mode,
  initialTheme,
  editing,
  busy,
  onOpenChange,
  onSave,
}: ThemeEditorDialogProps): React.ReactElement {
  const [draft, setDraft] = React.useState<ThemeDefinition | null>(initialTheme)
  const [customDark, setCustomDark] = React.useState(Boolean(initialTheme?.dark))
  const [submitIssues, setSubmitIssues] = React.useState<ThemeValidationIssue[]>([])

  React.useEffect(() => {
    if (!open) return
    setDraft(initialTheme)
    setCustomDark(Boolean(initialTheme?.dark))
    setSubmitIssues([])
  }, [initialTheme, open])

  if (!draft) return <></>
  const updateCoreColor = (key: keyof ThemeCoreColors, value: string): void => {
    setDraft((current) => current ? { ...current, colors: { ...current.colors, [key]: value } } : current)
  }
  const updateDarkColor = (key: keyof ThemeCoreColors, value: string): void => {
    setDraft((current) => current ? {
      ...current,
      dark: { colors: { ...current.dark?.colors, [key]: value || undefined } },
    } : current)
  }
  const validation = validateThemeDefinition(customDark ? draft : { ...draft, dark: undefined })
  const previewTheme = validation.theme ?? initialTheme ?? draft
  const contrasts = contrastItems(previewTheme, mode)

  const submit = async (): Promise<void> => {
    if (!validation.valid || !validation.theme) {
      setSubmitIssues(validation.issues)
      return
    }
    await onSave(customDark ? validation.theme : { ...validation.theme, dark: undefined })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? '编辑自定义主题' : '创建自定义主题'}</DialogTitle>
          <DialogDescription>使用 #RRGGBB 配置 7 个核心语义颜色，其余界面颜色由 Kila 自动派生并校正对比度。</DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-medium">名称</span>
                <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} maxLength={80} />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium">作者</span>
                <Input value={draft.author ?? ''} onChange={(event) => setDraft({ ...draft, author: event.target.value || undefined })} maxLength={80} />
              </label>
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">描述</span>
              <Textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} maxLength={300} />
            </label>
            <div>
              <h3 className="mb-3 text-sm font-medium">浅色核心配色</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {THEME_COLOR_FIELDS.map(([key, label]) => (
                  <ColorField key={key} label={label} value={draft.colors[key]} onChange={(value) => updateCoreColor(key, value)} />
                ))}
              </div>
            </div>
            <div className="rounded-xl bg-muted/35 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">自定义深色配色</div>
                  <div className="text-xs text-muted-foreground">关闭时由浅色配色自动生成；开启后可按需覆盖。</div>
                </div>
                <Switch checked={customDark} onCheckedChange={setCustomDark} />
              </div>
              {customDark && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {THEME_COLOR_FIELDS.map(([key, label]) => (
                    <ColorField key={key} label={label} optional value={draft.dark?.colors[key] ?? ''} onChange={(value) => updateDarkColor(key, value)} />
                  ))}
                </div>
              )}
            </div>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-0 lg:self-start">
            <div className="rounded-2xl bg-muted/30 p-4 shadow-sm">
              <div className="mb-3 text-sm font-medium">实时预览 · {mode === 'dark' ? '深色' : '浅色'}</div>
              <ThemePreview theme={previewTheme} mode={mode} />
            </div>
            <div className="rounded-2xl bg-card p-4 shadow-sm">
              <div className="mb-3 text-sm font-medium">可读性诊断</div>
              <div className="space-y-2">
                {contrasts.map((item) => (
                  <div key={item.label} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className={item.ratio >= item.threshold ? 'text-[hsl(var(--status-success))]' : 'text-destructive'}>
                      {item.ratio.toFixed(1)}:1 · {item.ratio >= item.threshold ? '通过' : '不足'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {(submitIssues.length > 0 || validation.issues.length > 0) && (
              <div role="alert" className="rounded-xl bg-[hsl(var(--status-danger-soft))] p-3 text-xs text-[hsl(var(--status-danger-foreground))]">
                {(submitIssues.length > 0 ? submitIssues : validation.issues).slice(0, 5).map((issue) => (
                  <div key={`${issue.path}-${issue.code}`}>{issue.path}: {issue.message}</div>
                ))}
              </div>
            )}
          </aside>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={busy || !validation.valid} onClick={() => { void submit() }}>{busy ? '保存中…' : '保存主题'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
