import * as React from 'react'
import { Brain } from 'lucide-react'
import type { ThinkingLevel } from '@kila/shared'
import { resolveModelMetadata } from '@kila/shared'
import type { ExtraCapabilitiesReasoning, ReasoningMode } from '@kila/shared'
import { useSessionThinkingLevelPreference, useSessionModelPreferenceOptional } from '@/hooks/useSessionPreferences'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ToolbarHoverPopover } from './ToolbarHoverPopover'

interface ThinkingLevelSelectorProps {
  buttonClassName?: string
  iconClassName?: string
}

interface LevelOption {
  value: ThinkingLevel
  label: string
  badgeLabel: string
  description: string
  buttonClassName: string
  badgeClassName: string
}

const DEFAULT_OPTIONS: LevelOption[] = [
  {
    value: 'none',
    label: 'none',
    badgeLabel: 'N',
    description: '关闭额外思考，优先速度',
    buttonClassName: 'bg-muted/70 text-muted-foreground hover:bg-accent hover:text-accent-foreground',
    badgeClassName: 'text-muted-foreground/80',
  },
  {
    value: 'low',
    label: 'low',
    badgeLabel: 'L',
    description: '轻量思考，适合快速问答',
    buttonClassName: 'bg-accent/80 text-muted-foreground hover:bg-accent hover:text-accent-foreground',
    badgeClassName: 'text-muted-foreground/85',
  },
  {
    value: 'medium',
    label: 'medium',
    badgeLabel: 'M',
    description: '均衡速度和推理深度',
    buttonClassName: 'bg-brand-soft text-brand-soft-foreground hover:bg-brand-soft-hover',
    badgeClassName: 'text-brand-soft-foreground',
  },
  {
    value: 'high',
    label: 'high',
    badgeLabel: 'H',
    description: '更深入地分析和推理',
    buttonClassName: 'bg-brand-soft-hover text-brand-soft-foreground hover:bg-[hsl(var(--brand-strong)/0.22)] hover:text-foreground',
    badgeClassName: 'text-brand-soft-foreground',
  },
  {
    value: 'xhigh',
    label: 'xhigh',
    badgeLabel: 'X',
    description: '最高思考强度，优先质量',
    buttonClassName: 'bg-[hsl(var(--brand-strong)/0.24)] text-foreground hover:bg-[hsl(var(--brand-strong)/0.32)]',
    badgeClassName: 'text-foreground/90',
  },
]

const ALL_LEVELS: ThinkingLevel[] = ['none', 'low', 'medium', 'high', 'xhigh']

/** 已查过的模型推理画像缓存（按 modelId 去重） */
const reasoningPortraitCache = new Map<string, ExtraCapabilitiesReasoning | null>()

/** effort 值映射到 ThinkingLevel */
function effortToThinkingLevel(effort: string): ThinkingLevel {
  switch (effort) {
    case 'minimal':
    case 'none':
      return 'none'
    case 'low':
      return 'low'
    case 'medium':
      return 'medium'
    case 'high':
      return 'high'
    case 'max':
    case 'xhigh':
      return 'xhigh'
    default:
      return 'medium'
  }
}

/** 把 effort_options 翻译为档位选项 */
function buildEffortOptions(effortOptions: string[]): LevelOption[] {
  const levels = effortOptions.map(effortToThinkingLevel)
  // 永远补上 none 选项作为关闭
  if (!levels.includes('none')) levels.unshift('none')
  // 去重 + 按 ALL_LEVELS 顺序排
  const unique = Array.from(new Set(levels))
  return ALL_LEVELS
    .filter((level) => unique.includes(level))
    .map((level) => DEFAULT_OPTIONS.find((opt) => opt.value === level)!)
    .filter(Boolean)
}

/** 根据 reasoning portrait 生成档位选项 */
function resolveLevelOptions(portrait: ExtraCapabilitiesReasoning | null | undefined): LevelOption[] {
  // 完全不知道模型能力（undefined）或 Provider DB 未命中（null）：显示全部档位
  if (!portrait) return DEFAULT_OPTIONS

  // 明确不支持推理：只显示 none
  if (!portrait.supported) {
    return [DEFAULT_OPTIONS[0]!]
  }

  const mode: ReasoningMode | undefined = portrait.mode
  const effortOptions = portrait.effort_options
  const levelOptions = portrait.level_options

  // effort 优先（OpenAI gpt-5/o3 等）
  if ((mode === 'effort' || mode === 'mixed') && effortOptions && effortOptions.length > 0) {
    return buildEffortOptions(effortOptions)
  }

  // level 模式（Gemini 3）：把 low/medium/high 映射到 ThinkingLevel
  if (mode === 'level' && levelOptions && levelOptions.length > 0) {
    const levels = levelOptions.map(effortToThinkingLevel)
    if (!levels.includes('none')) levels.unshift('none')
    const unique = Array.from(new Set(levels))
    return ALL_LEVELS
      .filter((level) => unique.includes(level))
      .map((level) => DEFAULT_OPTIONS.find((opt) => opt.value === level)!)
      .filter(Boolean)
  }

  // budget / fixed / 未指定 mode：保持默认 5 档
  return DEFAULT_OPTIONS
}

export function ThinkingLevelSelector({
  buttonClassName,
  iconClassName,
}: ThinkingLevelSelectorProps = {}): React.ReactElement {
  const [thinkingLevel, setThinkingLevel] = useSessionThinkingLevelPreference()
  const [sessionModel] = useSessionModelPreferenceOptional()

  // 先从内置 catalog 同步拿，拿不到再异步查 Provider DB
  const [reasoningPortrait, setReasoningPortrait] = React.useState<ExtraCapabilitiesReasoning | null | undefined>(undefined)

  React.useEffect(() => {
    if (!sessionModel) {
      setReasoningPortrait(undefined)
      return
    }

    const modelId = sessionModel.modelId

    // 缓存命中
    if (reasoningPortraitCache.has(modelId)) {
      setReasoningPortrait(reasoningPortraitCache.get(modelId)!)
      return
    }

    // 同步检查内置 catalog
    const metadata = resolveModelMetadata({
      modelId,
      modelName: modelId,
      channelProvider: 'custom',
      channelBaseUrl: '',
    })
    if (metadata.extraCapabilities?.reasoning) {
      reasoningPortraitCache.set(modelId, metadata.extraCapabilities.reasoning)
      setReasoningPortrait(metadata.extraCapabilities.reasoning)
      return
    }

    // 内置 catalog 没有推理画像：异步查 Provider DB
    let cancelled = false
    window.electronAPI
      .findProviderDbModel(modelId)
      .then((hit) => {
        if (cancelled) return
        const portrait = hit?.model.extra_capabilities?.reasoning ?? null
        reasoningPortraitCache.set(modelId, portrait)
        setReasoningPortrait(portrait)
      })
      .catch(() => {
        if (!cancelled) {
          reasoningPortraitCache.set(modelId, null)
          setReasoningPortrait(null)
        }
      })

    return () => { cancelled = true }
  }, [sessionModel?.channelId, sessionModel?.modelId])

  const options = React.useMemo(
    () => resolveLevelOptions(reasoningPortrait),
    [reasoningPortrait],
  )

  const currentOption = options.find((option) => option.value === thinkingLevel)
    ?? options[0]
    ?? DEFAULT_OPTIONS[0]!
  const tooltipText = `思考强度：${currentOption.label}`

  // 模型档位变化后，如果当前选中档位不在选项里，强制回落到 none 或第一项
  React.useEffect(() => {
    if (!options.some((opt) => opt.value === thinkingLevel)) {
      const fallback = options[0]?.value ?? 'none'
      if (fallback !== thinkingLevel) {
        setThinkingLevel(fallback)
      }
    }
  }, [options, thinkingLevel, setThinkingLevel])

  return (
    <ToolbarHoverPopover
      contentClassName="w-72 p-0"
      trigger={({ open, triggerProps }) => (
        <Button
          {...triggerProps}
          type="button"
          variant="ghost"
          size="icon"
          aria-label={tooltipText}
          className={cn(
            'relative overflow-visible transition-colors duration-200',
            buttonClassName ?? 'size-[30px] rounded-lg',
            currentOption.buttonClassName,
            open && 'ring-1 ring-border/50',
          )}
        >
          <Brain className={cn(iconClassName ?? 'size-5')} />
          <span
            className={cn(
              'pointer-events-none absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-background/90 bg-background px-1 font-mono text-[8px] font-semibold leading-none',
              currentOption.badgeClassName,
            )}
          >
            {currentOption.badgeLabel}
          </span>
        </Button>
      )}
    >
      {({ close }) => (
        <div className="space-y-2 p-4">
          <div className="space-y-1">
            {options.map((option) => {
              const isSelected = option.value === thinkingLevel
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setThinkingLevel(option.value)
                    close()
                  }}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-200',
                    isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50',
                  )}
                >
                  <span className="min-w-[52px] font-mono text-[11px] lowercase text-foreground/70">
                    {option.label}
                  </span>
                  <span className="text-xs leading-5 text-muted-foreground">
                    {option.description}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </ToolbarHoverPopover>
  )
}
