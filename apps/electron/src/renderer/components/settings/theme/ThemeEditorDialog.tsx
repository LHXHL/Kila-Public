import * as React from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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
      <span className="text-xs font-medium text-foreground">{label}{optional ? t('settings.themeEditor.optionalSuffix') : ''}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={pickerValue}
          onChange={(event) => onChange(colorPickerValueToOklch(event.target.value))}
          className="h-9 w-11 cursor-pointer rounded-lg border border-input bg-transparent p-1"
          aria-label={t('settings.themeEditor.colorPicker', { label })}
        />
        <Input
          value={hexValue}
          onChange={(event) => handleTextChange(event.target.value)}
          placeholder={optional ? t('settings.themeEditor.autoPlaceholder') : '#CC7D5E'}
          maxLength={7}
          spellCheck={false}
          aria-invalid={invalid}
          className={cn('font-mono text-xs uppercase', invalid && 'border-destructive')}
        />
      </div>
    </label>
  )
}

/** 对比度诊断项；translate 由调用方注入，保持本函数为纯函数 */
function contrastItems(
  theme: ThemeDefinition,
  mode: 'light' | 'dark',
  t: (key: string) => string,
): Array<{ label: string; ratio: number; threshold: number }> {
  try {
    const colors = deriveThemeColorMap(theme, mode)
    return [
      { label: t('settings.themeEditor.contrastBodyBg'), ratio: getContrastRatio(colors['--foreground'], colors['--background']), threshold: 4.5 },
      { label: t('settings.themeEditor.contrastButtonText'), ratio: getContrastRatio(colors['--primary-foreground'], colors['--primary']), threshold: 4.5 },
      { label: t('settings.themeEditor.contrastMutedBg'), ratio: getContrastRatio(colors['--muted-foreground'], colors['--background']), threshold: 3 },
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
  const { t } = useTranslation()
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
  const contrasts = contrastItems(previewTheme, mode, t)

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
          <DialogTitle>{editing ? t('settings.themeEditor.titleEdit') : t('settings.themeEditor.titleCreate')}</DialogTitle>
          <DialogDescription>{t('settings.themeEditor.description')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-medium">{t('settings.themeEditor.name')}</span>
                <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} maxLength={80} />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium">{t('settings.themeEditor.author')}</span>
                <Input value={draft.author ?? ''} onChange={(event) => setDraft({ ...draft, author: event.target.value || undefined })} maxLength={80} />
              </label>
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">{t('settings.themeEditor.desc')}</span>
              <Textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} maxLength={300} />
            </label>
            <div>
              <h3 className="mb-3 text-sm font-medium">{t('settings.themeEditor.lightCore')}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {THEME_COLOR_FIELDS.map(([key, label]) => (
                  <ColorField key={key} label={label} value={draft.colors[key]} onChange={(value) => updateCoreColor(key, value)} />
                ))}
              </div>
            </div>
            <div className="rounded-xl bg-muted/35 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">{t('settings.themeEditor.customDark')}</div>
                  <div className="text-xs text-muted-foreground">{t('settings.themeEditor.customDarkHint')}</div>
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
              <div className="mb-3 text-sm font-medium">{t('settings.themeEditor.livePreview')} · {mode === 'dark' ? t('settings.themeEditor.modeDark') : t('settings.themeEditor.modeLight')}</div>
              <ThemePreview theme={previewTheme} mode={mode} />
            </div>
            <div className="rounded-2xl bg-card p-4 shadow-sm">
              <div className="mb-3 text-sm font-medium">{t('settings.themeEditor.readability')}</div>
              <div className="space-y-2">
                {contrasts.map((item) => (
                  <div key={item.label} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className={item.ratio >= item.threshold ? 'text-status-success' : 'text-destructive'}>
                      {item.ratio.toFixed(1)}:1 · {item.ratio >= item.threshold ? t('settings.themeEditor.pass') : t('settings.themeEditor.fail')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {(submitIssues.length > 0 || validation.issues.length > 0) && (
              <div role="alert" className="rounded-xl bg-status-danger-soft p-3 text-xs text-status-danger-foreground">
                {(submitIssues.length > 0 ? submitIssues : validation.issues).slice(0, 5).map((issue) => (
                  <div key={`${issue.path}-${issue.code}`}>{issue.path}: {issue.message}</div>
                ))}
              </div>
            )}
          </aside>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button disabled={busy || !validation.valid} onClick={() => { void submit() }}>{busy ? t('settings.themeEditor.saving') : t('settings.themeEditor.saveTheme')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
