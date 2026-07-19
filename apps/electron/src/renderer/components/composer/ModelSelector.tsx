/**
 * ModelSelector - 模型选择器
 *
 * 现代化设计：
 * - Dialog 或底部工具栏 Popover，按使用场景呈现
 * - 按渠道分组，灰色背景供应商标题行
 * - 选中项左侧绿色竖条高亮
 * - 触发按钮：模型 logo + 模型名 + Chevron
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import { ChevronDown, CircleDollarSign, Cpu, Eye, FileText, Search, Wrench, Zap } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  selectedModelAtom,
} from '@/atoms/session-preference-atoms'
import { sessionsAtom } from '@/atoms/session-atoms'
import { useSessionModelPreferenceOptional } from '@/hooks/useSessionPreferences'
import { useSessionIdOptional } from '@/contexts/session-context'
import { getModelLogo, getChannelLogo, isOpenAIChannelLogo, isOpenAIModelLogo } from '@/lib/model-logo'
import { cn } from '@/lib/utils'
import { resolveModelMetadata } from '@kila/shared'
import type { Channel, ModelOption } from '@kila/shared'

/** 从渠道列表构建扁平化的模型选项 */
function buildModelOptions(channels: Channel[], filterChannelId?: string): ModelOption[] {
  const options: ModelOption[] = []

  for (const channel of channels) {
    if (!channel.enabled) continue
    if (filterChannelId && channel.id !== filterChannelId) continue

    for (const model of channel.models) {
      if (!model.enabled) continue

      options.push({
        channelId: channel.id,
        channelName: channel.name,
        modelId: model.id,
        modelName: model.name,
        provider: channel.provider,
        baseUrl: channel.baseUrl,
        metadataOverride: model.metadataOverride,
      })
    }
  }

  return options
}

/** 按渠道分组模型选项 */
function groupByChannel(options: ModelOption[]): Map<string, ModelOption[]> {
  const groups = new Map<string, ModelOption[]>()

  for (const option of options) {
    const key = option.channelId
    const group = groups.get(key) ?? []
    group.push(option)
    groups.set(key, group)
  }

  return groups
}

export interface ModelCapabilityChip {
  key: 'tool' | 'thinking' | 'vision' | 'video' | 'file' | 'context-window' | 'price'
  label: string
}

function formatContextWindow(contextWindow: number): string {
  if (contextWindow >= 1_000_000) {
    return `${(contextWindow / 1_000_000).toFixed(1)}M`
  }
  if (contextWindow >= 1_000) {
    return `${Math.round(contextWindow / 1_000)}k`
  }
  return `${contextWindow}`
}

export function buildModelCapabilityChips(option: ModelOption): ModelCapabilityChip[] {
  const metadata = resolveModelMetadata({
    channelProvider: option.provider,
    channelBaseUrl: option.baseUrl ?? '',
    modelId: option.modelId,
    modelName: option.modelName,
    metadataOverride: option.metadataOverride,
  })

  const chips: ModelCapabilityChip[] = []

  if (metadata.contextWindowTokens) {
    chips.push({
      key: 'context-window',
      label: formatContextWindow(metadata.contextWindowTokens),
    })
  }
  if (metadata.abilities.tools === 'supported') {
    chips.push({ key: 'tool', label: 'Tool' })
  }
  if (metadata.abilities.reasoning === 'supported') {
    chips.push({ key: 'thinking', label: 'Thinking' })
  }
  if (metadata.abilities.vision === 'supported') {
    chips.push({ key: 'vision', label: 'Vision' })
  }
  if (metadata.abilities.video === 'supported') {
    chips.push({ key: 'video', label: 'Video' })
  }
  if (metadata.abilities.fileInput === 'supported') {
    chips.push({ key: 'file', label: 'File' })
  }
  const inputPrice = metadata.pricing?.inputPerMillionUsd ?? metadata.pricing?.inputPerMillion
  const outputPrice = metadata.pricing?.outputPerMillionUsd ?? metadata.pricing?.outputPerMillion
  if (inputPrice !== undefined || outputPrice !== undefined) {
    const symbol = metadata.pricing?.currency === 'CNY' ? '¥' : '$'
    chips.push({
      key: 'price',
      label: `${symbol}${inputPrice ?? '-'} / ${symbol}${outputPrice ?? '-'}`,
    })
  }

  return chips
}

function getCapabilityIcon(key: ModelCapabilityChip['key']): React.ReactElement | null {
  switch (key) {
    case 'tool':
      return <Wrench size={10} />
    case 'thinking':
      return <Zap size={10} />
    case 'vision':
      return <Eye size={10} />
    case 'video':
      return <Eye size={10} />
    case 'file':
      return <FileText size={10} />
    case 'price':
      return <CircleDollarSign size={10} />
    default:
      return null
  }
}

/** ModelSelector 可选属性 */
interface ModelSelectorProps {
  /** 仅显示此渠道的模型 */
  filterChannelId?: string
  /** 呈现方式：设置页使用 Dialog，输入区工具栏使用底部 Popover */
  presentation?: 'dialog' | 'bottom-popover'
  /** 外部选中模型（不传则用内部 selectedModelAtom） */
  externalSelectedModel?: { channelId: string; modelId: string } | null
  /** 外部选择回调 */
  onModelSelect?: (option: ModelOption) => void
}

export function ModelSelector({
  filterChannelId,
  presentation = 'dialog',
  externalSelectedModel,
  onModelSelect,
}: ModelSelectorProps = {}): React.ReactElement {
  const [sessionModel, setSessionModel] = useSessionModelPreferenceOptional()
  const sessionId = useSessionIdOptional()
  const setSessions = useSetAtom(sessionsAtom)
  const setGlobalModel = useSetAtom(selectedModelAtom)
  const [channels, setChannels] = React.useState<Channel[]>([])
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')

  // 外部模型优先 → per-session 模型
  const selectedModel = externalSelectedModel !== undefined ? externalSelectedModel : sessionModel

  // 加载渠道列表
  React.useEffect(() => {
    window.electronAPI.listChannels().then(setChannels).catch(console.error)
  }, [])

  // 每次打开时刷新，重置搜索
  React.useEffect(() => {
    if (open) {
      window.electronAPI.listChannels().then(setChannels).catch(console.error)
      setSearch('')
    }
  }, [open])

  const modelOptions = React.useMemo(() => buildModelOptions(channels, filterChannelId), [channels, filterChannelId])
  const grouped = React.useMemo(() => groupByChannel(modelOptions), [modelOptions])

  // 搜索过滤
  const filteredGrouped = React.useMemo(() => {
    if (!search.trim()) return grouped

    const query = search.toLowerCase()
    const filtered = new Map<string, ModelOption[]>()

    for (const [channelId, options] of grouped.entries()) {
      const matchedOptions = options.filter(
        (o) =>
          o.modelName.toLowerCase().includes(query) ||
          o.channelName.toLowerCase().includes(query)
      )
      if (matchedOptions.length > 0) {
        filtered.set(channelId, matchedOptions)
      }
    }

    return filtered
  }, [grouped, search])

  // 扁平化过滤后的模型列表，用于键盘导航
  const flatOptions = React.useMemo(() => {
    const result: ModelOption[] = []
    for (const options of filteredGrouped.values()) {
      result.push(...options)
    }
    return result
  }, [filteredGrouped])

  // 键盘高亮索引
  const [highlightIndex, setHighlightIndex] = React.useState(-1)
  const itemRefs = React.useRef<Map<number, HTMLButtonElement>>(new Map())

  // 搜索变化时重置高亮
  React.useEffect(() => {
    setHighlightIndex(-1)
  }, [search])

  // 高亮项变化时滚动到可见区域
  React.useEffect(() => {
    if (highlightIndex < 0) return
    const el = itemRefs.current.get(highlightIndex)
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlightIndex])

  // 查找当前选中的模型信息
  const currentModelInfo = React.useMemo(() => {
    if (!selectedModel) return null
    return modelOptions.find(
      (o) => o.channelId === selectedModel.channelId && o.modelId === selectedModel.modelId
    ) ?? null
  }, [selectedModel, modelOptions])

  /** 选择模型并持久化到当前session */
  const handleSelect = React.useCallback((option: ModelOption): void => {
    if (onModelSelect) {
      onModelSelect(option)
      setOpen(false)
      return
    }

    // 写入 per-session Map + 同步全局默认值
    if (setSessionModel) {
      setSessionModel({ channelId: option.channelId, modelId: option.modelId })
    }
    setGlobalModel({ channelId: option.channelId, modelId: option.modelId })
    setOpen(false)

    // 将模型/渠道选择保存到当前session元数据
    if (sessionId) {
      window.electronAPI
        .updateSessionMeta(sessionId, {
          channelId: option.channelId,
          modelId: option.modelId,
        })
        .then(async () => {
          const sessions = await window.electronAPI.listSessions()
          setSessions(sessions)
        })
        .catch(console.error)
    }
  }, [sessionId, onModelSelect, setSessionModel, setGlobalModel, setSessions])

  /** 搜索框键盘导航 */
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (flatOptions.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIndex((prev) => (prev < flatOptions.length - 1 ? prev + 1 : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIndex((prev) => (prev > 0 ? prev - 1 : flatOptions.length - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = flatOptions[highlightIndex >= 0 ? highlightIndex : 0]
      if (target) handleSelect(target)
    }
  }

  if (modelOptions.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-2 py-1">
        <Cpu className="size-3.5" />
        <span>暂无可用模型</span>
      </div>
    )
  }

  const triggerButton = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex h-[30px] items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
    >
      {currentModelInfo ? (
        <img
          src={getModelLogo(currentModelInfo.modelId, currentModelInfo.provider)}
          alt={currentModelInfo.modelName}
          className={cn(
            'size-4 rounded object-cover',
            isOpenAIModelLogo(currentModelInfo.modelId, currentModelInfo.provider) && 'dark:invert',
          )}
        />
      ) : (
        <Cpu className="size-3.5" />
      )}
      <span className="max-w-[200px] truncate">
        {currentModelInfo ? currentModelInfo.modelName : '选择模型'}
      </span>
      <ChevronDown className="size-3" />
    </button>
  )

  const panelContent = (listMaxHeightClassName = 'max-h-[420px]', compact = false): React.ReactElement => (
    <>
      <div className={cn(
        'flex items-center border-b border-border/60',
        compact ? 'gap-2 px-3 py-2' : 'gap-2.5 px-4 py-3',
      )}>
        <Search className={cn(
          'flex-shrink-0 text-muted-foreground/60',
          compact ? 'size-4' : 'size-5',
        )} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder="搜索模型..."
          className={cn(
            'flex-1 bg-transparent outline-none placeholder:text-muted-foreground/50',
            compact ? 'text-sm' : 'text-base',
          )}
          autoFocus
        />
      </div>

      <div className={cn(listMaxHeightClassName, 'overflow-y-auto', compact ? 'py-0.5' : 'py-1')}>
        {filteredGrouped.size === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            未找到模型
          </div>
        ) : (
          (() => {
            let flatIndex = 0
            return Array.from(filteredGrouped.entries()).map(([channelId, options]) => {
              const first = options[0]
              if (!first) return null

              return (
                <div key={channelId}>
                  {/* 供应商标题行 - 灰色背景 */}
                  <div className={cn(
                    'flex items-center gap-2 bg-muted/50 border-b border-border/30',
                    compact ? 'px-3 py-1.5' : 'px-4 py-2',
                  )}>
                    <img
                      src={getChannelLogo(channels.find((c) => c.id === channelId)?.baseUrl ?? '')}
                      alt={first.channelName}
                      className={cn(
                        compact ? 'size-4 rounded object-cover' : 'size-5 rounded object-cover',
                        isOpenAIChannelLogo(channels.find((c) => c.id === channelId)?.baseUrl ?? '') && 'dark:invert',
                      )}
                    />
                    <span className={cn('font-medium text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
                      {first.channelName}
                    </span>
                  </div>

                  {/* 该渠道下的模型列表 */}
                  <div className={compact ? 'py-0.5' : 'py-1'}>
                    {options.map((option) => {
                      const isSelected =
                        selectedModel?.channelId === option.channelId &&
                        selectedModel?.modelId === option.modelId
                      const capabilityChips = buildModelCapabilityChips(option)
                      const currentFlatIndex = flatIndex++
                      const isHighlighted = currentFlatIndex === highlightIndex

                      return (
                        <button
                          key={`${option.channelId}:${option.modelId}`}
                          ref={(el) => {
                            if (el) itemRefs.current.set(currentFlatIndex, el)
                            else itemRefs.current.delete(currentFlatIndex)
                          }}
                          type="button"
                          onClick={() => handleSelect(option)}
                          onMouseEnter={() => setHighlightIndex(currentFlatIndex)}
                          className={cn(
                            compact
                              ? 'grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 px-3 py-1.5 rounded-md text-left transition-colors'
                              : 'flex w-full items-start gap-3 px-4 py-2 rounded-lg text-left transition-colors',
                            'hover:bg-accent',
                            isHighlighted && 'bg-accent',
                            isSelected && 'bg-accent/30 border-l-2 border-l-primary'
                          )}
                        >
                          <div className="flex min-w-0 items-start gap-2">
                            <img
                              src={getModelLogo(option.modelId, option.provider)}
                              alt={option.modelName}
                              className={cn(
                                compact
                                  ? 'mt-0.5 size-4 rounded object-cover flex-shrink-0'
                                  : 'mt-0.5 size-5 rounded object-cover flex-shrink-0',
                                isOpenAIModelLogo(option.modelId, option.provider) && 'dark:invert',
                              )}
                            />
                            <div className="min-w-0 flex-1">
                            <span className={cn(
                              'block truncate',
                              compact ? 'text-sm leading-5 font-normal' : 'text-sm',
                              isSelected ? 'text-foreground' : 'text-foreground/80'
                            )}>
                              {option.modelName}
                            </span>
                            {capabilityChips.length > 0 && (
                              <div className={cn('flex flex-wrap', compact ? 'mt-0.5 gap-2' : 'mt-1 gap-1')}>
                                {capabilityChips.map((chip) => (
                                  <span
                                    key={chip.key}
                                    className={cn(
                                      compact
                                        ? 'inline-flex items-center gap-1 text-[10px] leading-3 text-muted-foreground/60'
                                        : 'inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium',
                                      !compact && (
                                        isSelected
                                          ? 'border-primary/20 bg-primary/10 text-primary/80'
                                          : 'border-border/60 bg-muted/60 text-muted-foreground'
                                      ),
                                    )}
                                  >
                                    {getCapabilityIcon(chip.key)}
                                    {chip.label}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          </div>
                          {compact && (
                            <div className={cn(
                              'justify-self-end self-start truncate text-right font-mono text-[11px] leading-5 font-normal tabular-nums',
                              isSelected ? 'text-foreground/70' : 'text-muted-foreground/45'
                            )}>
                              {option.modelId}
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })
          })()
        )}
      </div>
    </>
  )

  if (presentation === 'bottom-popover') {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {triggerButton}
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={8}
          style={{ width: 'min(380px, calc(100vw - 24px))', maxWidth: 'calc(100vw - 24px)' }}
          className="overflow-hidden rounded-xl border bg-popover p-0 shadow-xl"
        >
          {panelContent('max-h-[390px]', true)}
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <>
      {triggerButton}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg gap-0 p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>选择模型</DialogTitle>
          </DialogHeader>
          {panelContent()}
        </DialogContent>
      </Dialog>
    </>
  )
}
