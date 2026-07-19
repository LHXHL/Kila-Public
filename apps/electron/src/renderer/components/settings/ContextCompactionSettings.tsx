import * as React from 'react'
import { Archive, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { SettingsCard, SettingsSection } from './primitives'
import {
  loadCompactionRecords,
  summarizeCompactionRecords,
  type CompactionRecord,
} from './context-compaction-data'

function formatInteger(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(Math.round(value))
}

function formatDateTime(value?: number): string {
  if (!value) return '无'
  return new Date(value).toLocaleString('zh-CN')
}

function reasonLabel(reason: CompactionRecord['reason']): string {
  if (reason === 'manual') return '手动'
  if (reason === 'overflow') return '溢出'
  if (reason === 'threshold') return '阈值'
  return '未知'
}

function MetricCard(input: {
  label: string
  value: string
  description: string
}): React.ReactElement {
  return (
    <div className="rounded-xl border border-border/60 bg-background/80 p-4">
      <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{input.label}</div>
      <div className="mt-2 text-2xl font-semibold text-foreground">{input.value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{input.description}</div>
    </div>
  )
}

export function ContextCompactionSettings(): React.ReactElement {
  const [records, setRecords] = React.useState<CompactionRecord[]>([])
  const [loading, setLoading] = React.useState(true)
  const [failedSessionCount, setFailedSessionCount] = React.useState(0)

  const loadRecords = React.useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await loadCompactionRecords({
        listSessions: window.electronAPI.listSessions,
        getSessionMessagesPage: window.electronAPI.getSessionMessagesPage,
      })
      setRecords(result.records)
      setFailedSessionCount(result.failures.length)
      if (result.failures.length > 0) {
        console.warn('[ContextCompactionSettings] 部分 Session 加载失败:', result.failures)
        toast.warning(`${result.failures.length} 个会话的压缩记录读取失败，已保留其他结果`)
      }
    } catch (error) {
      console.error('[ContextCompactionSettings] 加载上下文压缩记录失败:', error)
      setFailedSessionCount(0)
      toast.error('加载上下文压缩记录失败')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadRecords()
  }, [loadRecords])

  const summary = React.useMemo(() => summarizeCompactionRecords(records), [records])

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Context Compaction"
        description="Pi AgentSession 自动压缩与手动压缩事件。"
        action={(
          <Button variant="outline" size="sm" onClick={() => { void loadRecords() }} disabled={loading}>
            {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
            刷新
          </Button>
        )}
      >
        <SettingsCard divided={false} className="p-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <MetricCard
              label="压缩次数"
              value={formatInteger(summary.count)}
              description={`最近一次：${formatDateTime(summary.lastCompactedAt)}`}
            />
            <MetricCard
              label="溢出恢复"
              value={formatInteger(summary.overflowCount)}
              description={`${formatInteger(summary.retryCount)} 次触发 retry`}
            />
            <MetricCard
              label="压缩前 Token"
              value={formatInteger(summary.tokensBefore)}
              description="compact_complete.tokensBefore 合计"
            />
            <MetricCard
              label="摘要长度"
              value={formatInteger(summary.summaryChars)}
              description="summaryText 字符数合计"
            />
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="压缩历史"
        description="按会话记录已持久化的 compact_complete 事件。"
      >
        <SettingsCard divided={false} className="overflow-hidden">
          {failedSessionCount > 0 && (
            <div className="border-b border-amber-500/20 bg-amber-500/8 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
              {failedSessionCount} 个会话记录损坏或读取失败；下方统计已跳过这些会话。
            </div>
          )}
          <div className="grid grid-cols-[1.1fr,0.8fr,0.8fr,0.8fr,0.8fr] gap-3 border-b border-border/60 bg-muted/25 px-4 py-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            <span>Session</span>
            <span>时间</span>
            <span>原因</span>
            <span>Token</span>
            <span>摘要</span>
          </div>
          <div className="max-h-[520px] overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center px-6 py-12 text-sm text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" />
                正在加载...
              </div>
            ) : records.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-14 text-center text-sm text-muted-foreground">
                <Archive className="mb-3 size-8 text-muted-foreground/70" />
                <div>还没有压缩记录。</div>
              </div>
            ) : (
              records.map((record) => (
                <div key={record.id} className="grid grid-cols-[1.1fr,0.8fr,0.8fr,0.8fr,0.8fr] gap-3 border-b border-border/50 px-4 py-3 text-sm last:border-b-0">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{record.sessionTitle}</div>
                    <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{record.sessionId}</div>
                  </div>
                  <span className="text-muted-foreground">{formatDateTime(record.createdAt)}</span>
                  <span>{reasonLabel(record.reason)}</span>
                  <span>{record.tokensBefore ? formatInteger(record.tokensBefore) : '-'}</span>
                  <div className="min-w-0">
                    <div className="truncate">{record.summaryText ? `${record.summaryText.length} chars` : '-'}</div>
                    {record.firstKeptEntryId && (
                      <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                        kept: {record.firstKeptEntryId}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}
