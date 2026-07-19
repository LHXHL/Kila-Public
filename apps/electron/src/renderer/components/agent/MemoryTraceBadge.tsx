import * as React from 'react'
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
  memory: { label: '长期记忆', Icon: FileText },
  thread: { label: '相关会话', Icon: MessageSquareText },
  notebook: { label: '笔记', Icon: BookOpen },
} as const

function getProviderLabel(item: MemoryRecallTraceItem): string {
  if (item.provider === 'nowledge') return 'Nowledge'
  if (item.provider === 'local') return '本地'
  return '记忆来源'
}

function RecallItem({ item }: { item: MemoryRecallTraceItem }): React.ReactElement {
  const { Icon, label } = ITEM_PRESENTATION[item.kind]
  const metadata = [
    getProviderLabel(item),
    item.source,
    item.category,
  ].filter(Boolean)

  return (
    <details className="group rounded-xl bg-muted/35 open:bg-muted/50">
      <summary className="flex cursor-pointer list-none items-start gap-2.5 px-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 [&::-webkit-details-marker]:hidden">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-background/75 text-muted-foreground shadow-sm">
          <Icon className="size-3.5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-xs font-medium text-foreground">{item.title}</span>
            <span className="shrink-0 rounded-full bg-background/70 px-1.5 py-0.5 text-[9px] text-muted-foreground">{label}</span>
          </span>
          <span className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-[11px] leading-4 text-muted-foreground">
            {item.content || '未返回可展示的内容片段'}
          </span>
        </span>
        <ChevronDown className="mt-1 size-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>

      <div className="space-y-2 px-3 pb-3 pl-[3.75rem]">
        <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
          {metadata.map((value) => (
            <span key={value} className="rounded-full bg-background/70 px-1.5 py-0.5">{value}</span>
          ))}
          {item.tags?.map((tag) => (
            <span key={tag} className="rounded-full bg-background/70 px-1.5 py-0.5">#{tag}</span>
          ))}
        </div>
        <div className="rounded-lg bg-background/70 px-3 py-2 text-xs leading-5 text-foreground shadow-sm">
          <p className="whitespace-pre-wrap break-words">{item.content || '未返回可展示的内容片段'}</p>
          {item.truncated && <p className="mt-2 text-[10px] text-muted-foreground">内容较长，这里仅展示召回时保存的前 1600 个字符。</p>}
        </div>
        <p className="break-all font-mono text-[9px] leading-4 text-muted-foreground/70">{item.id}</p>
      </div>
    </details>
  )
}

export function MemoryRecallDetails({ trace }: { trace: MemoryRunTrace }): React.ReactElement {
  const items = trace.recallItems ?? []
  const recalledCount = trace.recalledMemoryCount + trace.relatedThreadCount + trace.notebookCount
  const workingMemoryLabels = [
    trace.usedGlobalWorkingMemory ? '全局' : null,
    trace.usedProjectWorkingMemory ? '项目' : null,
  ].filter((value): value is string => Boolean(value))

  return (
    <div className="flex max-h-[min(68vh,32rem)] flex-col">
      <div className="shrink-0 px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <h4 className="text-sm font-semibold text-foreground">本轮记忆召回</h4>
          <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">{recalledCount} 项</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
          <span className="rounded-full bg-muted/60 px-2 py-1">长期记忆 {trace.recalledMemoryCount}</span>
          <span className="rounded-full bg-muted/60 px-2 py-1">相关会话 {trace.relatedThreadCount}</span>
          <span className="rounded-full bg-muted/60 px-2 py-1">笔记 {trace.notebookCount}</span>
        </div>
        {workingMemoryLabels.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span>工作记忆</span>
            {workingMemoryLabels.map((label) => (
              <span key={label} className="rounded-full bg-primary/10 px-2 py-0.5 text-foreground/75">{label}</span>
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
            旧记录未保存召回详情。
          </div>
        ) : (
          <div className="rounded-xl bg-muted/35 px-4 py-5 text-center text-xs leading-5 text-muted-foreground">
            本轮没有召回内容。
          </div>
        )}
      </div>
    </div>
  )
}

export function getMemoryWriteLabel(trace: MemoryRunTrace): string | null {
  if (trace.incognito) return '只读'
  if (trace.writeStatus === 'queued') return null
  if (trace.writeStatus === 'failed') return '整理失败'
  if (trace.writeStatus === 'written' && (trace.writtenMemoryCount ?? 0) > 0) {
    return `新增 ${trace.writtenMemoryCount} 条`
  }
  return null
}

export function MemoryTraceBadge({ trace }: { trace?: MemoryRunTrace }): React.ReactElement | null {
  if (!trace) return null

  const providerLabel = trace.provider === 'nowledge' ? 'Nowledge + 本地' : '本地记忆'
  const recalledCount = trace.recalledMemoryCount + trace.relatedThreadCount + trace.notebookCount
  const statusLabel = trace.recallStatus === 'error'
    ? '召回失败，已降级'
    : trace.recallStatus === 'disabled'
      ? '未启用记忆'
      : `召回 ${recalledCount} 项`
  const writeLabel = getMemoryWriteLabel(trace)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'group mt-2 inline-flex items-center gap-1.5 rounded-full bg-muted/45 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
            (trace.recallStatus === 'error' || trace.writeStatus === 'failed') && 'text-amber-600 dark:text-amber-400',
          )}
          aria-label={`${[providerLabel, statusLabel, writeLabel].filter(Boolean).join('，')}，点击查看召回详情`}
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
