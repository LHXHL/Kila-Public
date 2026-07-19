/**
 * SettingsInput - 设置文本输入控件
 *
 * 封装 ShadcnUI Input，集成标签和描述。
 * 支持错误状态提示。
 */

import * as React from 'react'
import { Input } from '@/components/ui/input'
import { LABEL_CLASS, DESCRIPTION_CLASS } from './SettingsUIConstants'
import { cn } from '@/lib/utils'

interface SettingsInputProps {
  /** 标签文本 */
  label: string
  /** 描述文本（可选） */
  description?: string
  /** 输入值 */
  value: string
  /** 变更回调 */
  onChange: (value: string) => void
  /** 失焦回调（可选，用于延迟保存场景） */
  onBlur?: () => void
  /** 占位符 */
  placeholder?: string
  /** 是否必填 */
  required?: boolean
  /** 是否禁用 */
  disabled?: boolean
  /** 错误信息（可选） */
  error?: string
  /** 输入类型 */
  type?: string
  /** 键盘事件（可选） */
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
  /** 输入框额外 className */
  inputClassName?: string
}

export function SettingsInput({
  label,
  description,
  value,
  onChange,
  onBlur,
  placeholder,
  required,
  disabled,
  error,
  type = 'text',
  onKeyDown,
  inputClassName,
}: SettingsInputProps): React.ReactElement {
  const inputId = React.useId()
  const descriptionId = `${inputId}-description`
  const errorId = `${inputId}-error`
  return (
    <div className="px-4 py-3 space-y-2">
      <div>
        <label htmlFor={inputId} className={LABEL_CLASS}>{label}</label>
        {description && (
          <div id={descriptionId} className={cn(DESCRIPTION_CLASS, 'mt-0.5')}>{description}</div>
        )}
      </div>
      <Input
        id={inputId}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={[description ? descriptionId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined}
        className={cn(
          error && 'border-destructive focus-visible:ring-destructive',
          inputClassName,
        )}
      />
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">{error}</p>
      )}
    </div>
  )
}
