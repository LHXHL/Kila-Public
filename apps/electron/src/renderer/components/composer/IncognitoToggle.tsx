import { useAtom } from 'jotai'
import { Eye, EyeOff } from 'lucide-react'
import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import { incognitoModeAtom } from '@/atoms/agent-ui-atoms'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/** 隐身模式切换按钮 — 紧贴发送按钮左侧 */
export function IncognitoToggle(): React.ReactElement {
  const { t } = useTranslation()
  const [incognitoMode, setIncognitoMode] = useAtom(incognitoModeAtom)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            'size-[30px] rounded-lg transition-colors',
            incognitoMode
              ? 'text-primary bg-primary/10 hover:bg-primary/15'
              : 'text-foreground/30 hover:text-foreground/60'
          )}
          onClick={() => setIncognitoMode((prev) => !prev)}
        >
          {incognitoMode ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>{incognitoMode ? t('agent.composer.incognitoOn') : t('agent.composer.incognitoOff')}</p>
      </TooltipContent>
    </Tooltip>
  )
}

