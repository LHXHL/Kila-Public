import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Settings, Wand2 } from 'lucide-react'
import { workspaceCapabilitiesVersionAtom } from '@/atoms/agent-atoms'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ToolbarHoverPopover } from './ToolbarHoverPopover'
import {
  listEnabledSkillMentionItems,
  renderSkillMentionItem,
  type SkillMentionItem,
} from '@/components/agent/mention-suggestions'

interface SkillTriggerButtonProps {
  buttonClassName?: string
  iconClassName?: string
  onSelectSkill: (item: { id: string; label: string }) => void
  onManageSkills?: () => void
}

export function SkillTriggerButton({
  buttonClassName,
  iconClassName,
  onSelectSkill,
  onManageSkills,
}: SkillTriggerButtonProps): React.ReactElement {
  const capabilitiesVersion = useAtomValue(workspaceCapabilitiesVersionAtom)
  const [skills, setSkills] = React.useState<SkillMentionItem[]>([])
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const lastLoadedCapabilitiesVersionRef = React.useRef<number | null>(null)

  const loadSkills = React.useCallback(async () => {
    if (loading) return
    if (lastLoadedCapabilitiesVersionRef.current === capabilitiesVersion) return

    setLoading(true)
    setLoadError(null)
    try {
      const nextSkills = await listEnabledSkillMentionItems()
      setSkills(nextSkills)
      lastLoadedCapabilitiesVersionRef.current = capabilitiesVersion
    } catch (error) {
      console.error('[SkillTriggerButton] 加载技能失败:', error)
      setSkills([])
      setLoadError(error instanceof Error ? error.message : '技能列表加载失败')
    } finally {
      setLoading(false)
    }
  }, [capabilitiesVersion, loading])

  return (
    <ToolbarHoverPopover
      contentClassName="w-[320px] p-0"
      onOpenChange={(open) => {
        if (!open) return
        void loadSkills()
      }}
      trigger={({ open, triggerProps }) => (
        <Button
          {...triggerProps}
          type="button"
          variant="ghost"
          size="icon"
          aria-label="技能"
          className={cn(
            buttonClassName ?? 'size-[30px] rounded-lg',
            'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            open && 'bg-muted/50',
          )}
        >
          <Wand2 className={cn(iconClassName ?? 'size-5')} />
        </Button>
      )}
    >
      {({ close }) => (
        <div className="flex max-h-[280px] flex-col">
          {loading ? (
            <div className="px-3 py-4 text-xs text-muted-foreground">加载中...</div>
          ) : loadError ? (
            <div role="alert" className="space-y-2 px-3 py-4 text-xs">
              <p className="text-destructive">{loadError}</p>
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => {
                  lastLoadedCapabilitiesVersionRef.current = null
                  void loadSkills()
                }}
              >
                重试
              </button>
            </div>
          ) : skills.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground">无可用技能</div>
          ) : (
            <div className="max-h-[240px] overflow-y-auto py-1">
              {skills.map((skill) => (
                <button
                  key={skill.id}
                  type="button"
                  className="flex w-full items-start gap-2 px-2.5 py-2 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
                  onClick={() => {
                    onSelectSkill({ id: skill.id, label: skill.name })
                    close()
                  }}
                >
                  {renderSkillMentionItem(skill)}
                </button>
              ))}
            </div>
          )}

          {onManageSkills && (
            <button
              type="button"
              className="flex items-center gap-1.5 border-t border-border/60 px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => {
                close()
                onManageSkills()
              }}
            >
              <Settings className="size-3" />
              <span>管理技能库</span>
            </button>
          )}
        </div>
      )}
    </ToolbarHoverPopover>
  )
}
