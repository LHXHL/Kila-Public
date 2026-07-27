/**
 * SettingsSecretInput - API Key 专用密码输入控件
 *
 * 内置密码显隐切换，适用于 API Key 等敏感信息输入。
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { LABEL_CLASS, DESCRIPTION_CLASS } from './SettingsUIConstants'
import { cn } from '@/lib/utils'

interface SettingsSecretInputProps {
  /** 标签文本 */
  label: string
  /** 描述文本（可选） */
  description?: string
  /** 输入值 */
  value: string
  /** 变更回调 */
  onChange: (value: string) => void
  /** 占位符 */
  placeholder?: string
  /** 失焦回调 */
  onBlur?: () => void
  /** 是否必填 */
  required?: boolean
  /** 是否禁用 */
  disabled?: boolean
  /** 是否已有已保存的密钥（显示掩码占位符） */
  hasSavedValue?: boolean
  /** 异步查看明文 */
  onReveal?: () => Promise<string>
}

const SAVED_SECRET_MASK = '••••••••••••'

export function SettingsSecretInput({
  label,
  description,
  value,
  onChange,
  onBlur,
  placeholder,
  required,
  disabled,
  hasSavedValue,
  onReveal,
}: SettingsSecretInputProps): React.ReactElement {
  const { t } = useTranslation()
  const inputId = React.useId()
  const descriptionId = `${inputId}-description`
  const [visible, setVisible] = React.useState(false)
  const [revealedValue, setRevealedValue] = React.useState('')
  const [revealing, setRevealing] = React.useState(false)
  const [revealError, setRevealError] = React.useState<string | null>(null)

  const isEditing = value.length > 0
  const showsSavedSecret = Boolean(hasSavedValue && !isEditing)
  const inputValue = isEditing
    ? value
    : showsSavedSecret
      ? (visible ? revealedValue : '')
      : value
  const inputType = visible ? 'text' : 'password'

  const handleToggleVisibility = React.useCallback(async (): Promise<void> => {
    if (disabled || revealing) return
    setRevealError(null)

    if (visible) {
      setVisible(false)
      return
    }

    if (showsSavedSecret && !revealedValue && onReveal) {
      setRevealing(true)
      try {
        const nextValue = await onReveal()
        setRevealedValue(nextValue)
      } catch (error) {
        console.error('[SettingsSecretInput] 查看明文失败:', error)
        setRevealError(error instanceof Error ? error.message : t('settings.secretInput.revealFailed'))
        return
      } finally {
        setRevealing(false)
      }
    }

    setVisible(true)
  }, [disabled, onReveal, revealedValue, revealing, showsSavedSecret, t, visible])

  const toggleLabel = visible ? t('settings.secretInput.hide') : t('settings.secretInput.reveal')

  return (
    <div className="px-4 py-3 space-y-2">
      <div>
        <label htmlFor={inputId} className={LABEL_CLASS}>{label}</label>
        {description && (
          <div id={descriptionId} className={cn(DESCRIPTION_CLASS, 'mt-0.5')}>{description}</div>
        )}
      </div>
      <div className="relative">
        <Input
          id={inputId}
          type={inputType}
          value={inputValue}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={showsSavedSecret ? SAVED_SECRET_MASK : placeholder}
          required={required}
          disabled={disabled || revealing}
          aria-describedby={[description ? descriptionId : null, revealError ? `${inputId}-error` : null].filter(Boolean).join(' ') || undefined}
          className="pr-10"
        />
        <button
          type="button"
          disabled={disabled || revealing}
          onClick={() => void handleToggleVisibility()}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
          aria-label={toggleLabel}
          title={toggleLabel}
        >
          {revealing ? <Loader2 size={16} className="animate-spin" /> : visible ? <EyeOff size={16} /> : <Eye size={16} />}
          <span className="sr-only">{toggleLabel}</span>
        </button>
      </div>
      {revealError && (
        <p id={`${inputId}-error`} role="alert" className="text-xs text-destructive">{revealError}</p>
      )}
      {hasSavedValue && (
        <div className="text-xs text-muted-foreground">{t('settings.secretInput.saved')}</div>
      )}
    </div>
  )
}
