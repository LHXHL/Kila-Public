import type * as React from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import {
  BookOpen,
  Brain,
  ChevronDown,
  FileText,
  MessageSquareText,
} from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { MemoryRecallTraceItem, MemoryRunTrace } from '@kila/shared'

const ITEM_PRESENTATION = {
  memory: { labelKey: 'agent.memory.longTerm', Icon: FileText },
  thread: { labelKey: 'agent.memory.relatedSession', Icon: MessageSquareText },
  notebook: { labelKey: 'agent.memory.notebook', Icon: BookOpen },
} as const

function RecallItem({ item }: { item: MemoryRecallTraceItem }): React.ReactElement {
  const { t } = useTranslation()
  const { Icon, labelKey } = ITEM_PRESENTATION[item.kind]
  const label = t(labelKey)
  // 本地记忆已移除，来源单一，不再暴露 provider；仅保留 source / category 等补充说明
  const metadata = [item.source, item.category].filter(Boolean)

  return (
    <details className="group rounded-lg bg-muted/35 open:bg-muted/50">
      <summary className="flex cursor-pointer list-none items-start gap-2.5 px-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 [&::-webkit-details-marker]:hidden">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-background/75 text-muted-foreground shadow-sm">
          <Icon className="size-3.5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-xs font-medium text-foreground">{item.title}</span>
            <span className="shrink-0 rounded-md bg-background/70 px-1.5 py-0.5 text-[9px] text-muted-foreground">{label}</span>
          </span>
          <span className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-[11px] leading-4 text-muted-foreground">
            {item.content || t('agent.memory.emptyContent')}
          </span>
        </span>
        <ChevronDown className="mt-1 size-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>

      <div className="space-y-2 px-3 pb-3 pl-[3.75rem]">
        <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
          {metadata.map((value) => (
            <span key={value} className="rounded-md bg-background/70 px-1.5 py-0.5">{value}</span>
          ))}
          {item.tags?.map((tag) => (
            <span key={tag} className="rounded-md bg-background/70 px-1.5 py-0.5">#{tag}</span>
          ))}
        </div>
        <div className="rounded-lg bg-background/70 px-3 py-2 text-xs leading-5 text-foreground shadow-sm">
          <p className="whitespace-pre-wrap break-words">{item.content || t('agent.memory.emptyContent')}</p>
          {item.truncated && <p className="mt-2 text-[10px] text-muted-foreground">{t('agent.memory.truncatedNote')}</p>}
        </div>
        <p className="break-all font-mono text-[9px] leading-4 text-muted-foreground/70">{item.id}</p>
      </div>
    </details>
  )
}

export function MemoryRecallDetails({ trace }: { trace: MemoryRunTrace }): React.ReactElement {
  const { t } = useTranslation()
  const items = trace.recallItems ?? []
  const recalledCount = trace.recalledMemoryCount + trace.relatedThreadCount + trace.notebookCount
  const workingMemoryLabels = [
    trace.usedGlobalWorkingMemory ? t('agent.memory.scopeGlobal') : null,
    trace.usedProjectWorkingMemory ? t('agent.memory.scopeProject') : null,
  ].filter((value): value is string => Boolean(value))

  return (
    <div className="flex max-h-[min(68vh,32rem)] flex-col">
      <div className="shrink-0 px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <h4 className="text-sm font-semibold text-foreground">{t('agent.memory.recallTitle')}</h4>
          <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">{t('agent.memory.itemCount', { count: recalledCount })}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
          <span className="rounded-md bg-muted/60 px-2 py-1">{t('agent.memory.longTerm')} {trace.recalledMemoryCount}</span>
          <span className="rounded-md bg-muted/60 px-2 py-1">{t('agent.memory.relatedSession')} {trace.relatedThreadCount}</span>
          <span className="rounded-md bg-muted/60 px-2 py-1">{t('agent.memory.notebook')} {trace.notebookCount}</span>
        </div>
        {workingMemoryLabels.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span>{t('agent.memory.workingMemory')}</span>
            {workingMemoryLabels.map((label) => (
              <span key={label} className="rounded-md bg-primary/10 px-2 py-0.5 text-foreground/75">{label}</span>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
        {items.length > 0 ? (
          <div className="space-y-2">
            {items.map((item, index) => (
              <RecallItem key={`${item.kind}:${item.id}:${index}`} item={item} />
            ))}
          </div>
        ) : recalledCount > 0 ? (
          <div className="rounded-xl bg-muted/35 px-4 py-5 text-center text-xs leading-5 text-muted-foreground">
            {t('agent.memory.legacyNoDetails')}
          </div>
        ) : (
          <div className="rounded-xl bg-muted/35 px-4 py-5 text-center text-xs leading-5 text-muted-foreground">
            {t('agent.memory.emptyRecall')}
          </div>
        )}
      </div>
    </div>
  )
}

export function getMemoryWriteLabel(trace: MemoryRunTrace, t: TFunction): string | null {
  if (trace.incognito) return t('agent.memory.readOnly')
  if (trace.writeStatus === 'queued') return null
  if (trace.writeStatus === 'failed') return t('agent.memory.writeFailed')
  if (trace.writeStatus === 'written' && (trace.writtenMemoryCount ?? 0) > 0) {
    return t('agent.memory.written', { count: trace.writtenMemoryCount ?? 0 })
  }
  return null
}

export function MemoryTraceBadge({ trace }: { trace?: MemoryRunTrace }): React.ReactElement | null {
  const { t } = useTranslation()
  if (!trace) return null

  const providerLabel = t('agent.memory.source')
  const recalledCount = trace.recalledMemoryCount + trace.relatedThreadCount + trace.notebookCount
  const statusLabel = trace.recallStatus === 'error'
    ? t('agent.memory.recallError')
    : trace.recallStatus === 'disabled'
      ? t('agent.memory.recallDisabled')
      : t('agent.memory.recalled', { count: recalledCount })
  const writeLabel = getMemoryWriteLabel(trace, t)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'group mt-2 inline-flex items-center gap-1.5 rounded-lg bg-muted/45 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
            (trace.recallStatus === 'error' || trace.writeStatus === 'failed') && 'text-status-warning',
          )}
          aria-label={t('agent.memory.badgeAria', {
            summary: [providerLabel, statusLabel, writeLabel].filter(Boolean).join('，'),
          })}
        >
          <Brain className="size-3" aria-hidden="true" />
          <span>{providerLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{statusLabel}</span>
          {writeLabel && (
            <>
              <span aria-hidden="true">·</span>
              <span>{writeLabel}</span>
            </>
          )}
          <ChevronDown className="size-3 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={8}
        collisionPadding={16}
        className="w-[min(26rem,calc(100vw-2rem))] overflow-hidden border-border/50 p-0 shadow-xl"
      >
        <MemoryRecallDetails trace={trace} />
      </PopoverContent>
    </Popover>
  )
}
