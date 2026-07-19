import * as React from 'react'
import type { TFunction } from 'i18next'
import type { KilaPermissionMode } from '@kila/shared'
import { useTranslation } from 'react-i18next'
import { Shield, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface PermissionModeOption {
  value: KilaPermissionMode
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}

export function getPermissionModeOptions(t: TFunction): PermissionModeOption[] {
  return [
    {
      value: 'auto',
      label: t('settings.permissionModes.auto.label'),
      description: t('settings.permissionModes.auto.description'),
      icon: ShieldCheck,
    },
    {
      value: 'smart',
      label: t('settings.permissionModes.smart.label'),
      description: t('settings.permissionModes.smart.description'),
      icon: Shield,
    },
  ]
}

interface PermissionModeSelectorProps {
  value: KilaPermissionMode
  onChange: (value: KilaPermissionMode) => void
  disabled?: boolean
  className?: string
}

export function PermissionModeSelector({
  value,
  onChange,
  disabled = false,
  className,
}: PermissionModeSelectorProps): React.ReactElement {
  const { t } = useTranslation()
  const options = React.useMemo(() => getPermissionModeOptions(t), [t])

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {options.map((option) => {
        const Icon = option.icon
        const selected = option.value === value

        return (
          <React.Fragment key={option.value}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant={selected ? 'default' : 'outline'}
                  disabled={disabled}
                  aria-pressed={selected}
                  aria-label={option.label}
                  onClick={() => onChange(option.value)}
                >
                  <Icon className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <div className="space-y-0.5">
                  <div className="font-medium">{option.label}</div>
                  <div className="max-w-56 text-[11px] text-primary-foreground/80">
                    {option.description}
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          </React.Fragment>
        )
      })}
    </div>
  )
}
