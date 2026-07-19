import * as React from 'react'
import { toast } from 'sonner'
import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskRuntimeStatus,
  ScheduledTaskUpdateInput,
  SessionMeta,
} from '@kila/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScheduledTaskList } from './ScheduledTaskList'
import { ScheduledTaskEditorDialog } from './ScheduledTaskEditorDialog'
import { ScheduledTaskRunsPanel } from './ScheduledTaskRunsPanel'
import { getStatusToneClasses } from '@/lib/theme/status-tone'
import {
  getScheduledTaskHealthLabel,
  getScheduledTaskHealthReason,
  getScheduledTaskHealthTone,
} from './health-presentation'
import {
  parseScheduledTaskNaturalLanguage,
  type ScheduledTaskNaturalLanguageDraft,
} from './natural-language-draft'

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function formatTime(value?: number): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-CN')
}

function describeSchedule(task: ScheduledTask): string {
  switch (task.schedule.kind) {
    case 'every':
      return `每 ${task.schedule.minutes} 分钟`
    case 'cron':
      return task.schedule.expr
    case 'at':
      return new Date(task.schedule.at).toLocaleString('zh-CN')
    case 'loop':
      return 'loop 连续执行'
  }
}

function describeRunMode(task: ScheduledTask): string {
  return task.runMode === 'single_session' ? '连续会话' : '新建会话'
}

function describeDelivery(task: ScheduledTask): string {
  if (task.delivery.kind === 'none') return '不投递'
  if (task.delivery.kind === 'bridge_binding') {
    return `${task.delivery.channelType} · ${task.delivery.endpointKey}`
  }
  if (task.delivery.targets.length === 1) {
    const target = task.delivery.targets[0]
    return target ? `${target.channelType} · ${target.endpointKey}` : '不投递'
  }
  return `${task.delivery.targets.length} 个远程渠道目标`
}

function describeRuntimeStatus(status: ScheduledTaskRuntimeStatus | null): string {
  if (!status) return '等待加载'
  if (status.watchdogState === 'stale') return '陈旧'
  if (status.watchdogState === 'idle') return '未启动'
  return '正常'
}

function OverviewItem({
  label,
  value,
  helper,
}: {
  label: string
  value: React.ReactNode
  helper?: React.ReactNode
}): React.ReactElement {
  return (
    <div className="min-w-0 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-foreground">{value}</dd>
      {helper && <div className="mt-1 text-xs leading-5 text-muted-foreground">{helper}</div>}
    </div>
  )
}

export function ScheduledTasksSettings(): React.ReactElement {
  const [tasks, setTasks] = React.useState<ScheduledTask[]>([])
  const [runtimeStatus, setRuntimeStatus] = React.useState<ScheduledTaskRuntimeStatus | null>(null)
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(null)
  const [runs, setRuns] = React.useState<Awaited<ReturnType<typeof window.electronAPI.listScheduledTaskRuns>>>([])
  const [sessions, setSessions] = React.useState<SessionMeta[]>([])
  const [bindings, setBindings] = React.useState<Awaited<ReturnType<typeof window.electronAPI.listBridgeBindings>>>([])
  const [tools, setTools] = React.useState<Awaited<ReturnType<typeof window.electronAPI.getAgentTools>>>([])
  const [foregroundSession, setForegroundSession] = React.useState<SessionMeta | null>(null)
  const [settings, setSettings] = React.useState<Awaited<ReturnType<typeof window.electronAPI.getSettings>> | null>(null)
  const [editorTask, setEditorTask] = React.useState<ScheduledTask | null>(null)
  const [draftSeed, setDraftSeed] = React.useState<ScheduledTaskNaturalLanguageDraft | null>(null)
  const [naturalLanguageInput, setNaturalLanguageInput] = React.useState('')
  const [naturalLanguageError, setNaturalLanguageError] = React.useState<string | null>(null)
  const [editorOpen, setEditorOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)

  const selectedTask = React.useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  )

  const runningCount = React.useMemo(
    () => tasks.filter((task) => task.status === 'running').length,
    [tasks],
  )

  const failedCount = React.useMemo(
    () => tasks.filter((task) => (
      task.health?.state === 'late'
      || task.health?.state === 'failing'
      || task.health?.state === 'missed'
    )).length,
    [tasks],
  )

  const refresh = React.useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [nextTasks, nextRuntimeStatus, nextSessions, nextBindings, nextTools, nextForeground, nextSettings] = await Promise.all([
        window.electronAPI.listScheduledTasks(),
        window.electronAPI.getScheduledTaskRuntimeStatus(),
        window.electronAPI.listSessions(),
        window.electronAPI.listBridgeBindings(),
        window.electronAPI.getAgentTools(),
        window.electronAPI.getForegroundSession(),
        window.electronAPI.getSettings(),
      ])
      setTasks(nextTasks)
      setRuntimeStatus(nextRuntimeStatus)
      setSessions(nextSessions)
      setBindings(nextBindings)
      setTools(nextTools)
      setForegroundSession(nextForeground)
      setSettings(nextSettings)
      setSelectedTaskId((prev) => {
        if (prev && nextTasks.some((task) => task.id === prev)) {
          return prev
        }
        return nextTasks[0]?.id ?? null
      })
    } catch (error) {
      toast.error('加载定时任务失败', { description: getErrorMessage(error) })
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshRuns = React.useCallback(async (taskId: string | null): Promise<void> => {
    if (!taskId) {
      setRuns([])
      return
    }
    try {
      setRuns(await window.electronAPI.listScheduledTaskRuns(taskId, 50))
    } catch (error) {
      console.error('[ScheduledTasksSettings] 加载运行历史失败:', error)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh()
    }, 30_000)

    return () => {
      window.clearInterval(timer)
    }
  }, [refresh])

  React.useEffect(() => {
    void refreshRuns(selectedTaskId)
  }, [refreshRuns, selectedTaskId])

  React.useEffect(() => {
    return window.electronAPI.onScheduledTaskUpdated((_payload) => {
      void refresh()
      void refreshRuns(selectedTaskId)
    })
  }, [refresh, refreshRuns, selectedTaskId])

  const saveTask = React.useCallback(async (payload: ScheduledTaskCreateInput | ScheduledTaskUpdateInput, taskId?: string): Promise<void> => {
    try {
      if (taskId) {
        await window.electronAPI.updateScheduledTask(taskId, payload as ScheduledTaskUpdateInput)
      } else {
        const created = await window.electronAPI.createScheduledTask(payload as ScheduledTaskCreateInput)
        setSelectedTaskId(created.id)
      }
      await refresh()
    } catch (error) {
      toast.error('保存定时任务失败', { description: getErrorMessage(error) })
      throw error
    }
  }, [refresh])

  const openSession = React.useCallback((sessionId: string): void => {
    const session = sessions.find((item) => item.id === sessionId)
    if (!session) return
    void window.electronAPI.openSessionInMainWindow({
      sessionId,
      title: session.title,
    })
  }, [sessions])

  const runTaskNow = React.useCallback(async (taskId: string, successMessage = '任务已开始执行'): Promise<void> => {
    try {
      await window.electronAPI.runScheduledTaskNow(taskId)
      toast.success(successMessage)
      await Promise.all([refresh(), refreshRuns(taskId)])
    } catch (error) {
      toast.error('执行任务失败', { description: getErrorMessage(error) })
    }
  }, [refresh, refreshRuns])

  const recoverOverdueTasks = React.useCallback(async (): Promise<void> => {
    try {
      const status = await window.electronAPI.recoverOverdueScheduledTasks()
      setRuntimeStatus(status)
      toast.success('错过任务恢复扫描已完成')
      await refresh()
    } catch (error) {
      toast.error('恢复错过任务失败', { description: getErrorMessage(error) })
    }
  }, [refresh])

  const prepareNaturalLanguageDraft = React.useCallback((): void => {
    const result = parseScheduledTaskNaturalLanguage(naturalLanguageInput)
    if (!result.ok) {
      setNaturalLanguageError(result.reason)
      return
    }
    setNaturalLanguageError(null)
    setDraftSeed(result.draft)
  }, [naturalLanguageInput])

  const openDraftInEditor = React.useCallback((): void => {
    if (!draftSeed) return
    setEditorTask(null)
    setEditorOpen(true)
  }, [draftSeed])

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 px-1 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-3xl">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">定时任务</h2>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            管理后台调度、目标会话、远程投递和运行结果。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {foregroundSession && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-lg"
              onClick={() => {
                setDraftSeed(null)
                setEditorTask(null)
                setEditorOpen(true)
              }}
            >
              从当前会话创建
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            className="rounded-lg"
            onClick={() => {
              setEditorTask(null)
              setEditorOpen(true)
            }}
          >
            新建任务
          </Button>
          {(failedCount > 0 || runtimeStatus?.watchdogState !== 'healthy') && (
            <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => void recoverOverdueTasks()}>
              恢复错过任务
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-lg"
            onClick={() => void refresh()}
            disabled={loading}
          >
            {loading ? '刷新中…' : '刷新'}
          </Button>
        </div>
      </header>

      <section className="surface-panel rounded-xl p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="scheduled-task-natural-language" className="text-sm font-semibold text-foreground">
              用自然语言准备任务草稿
            </label>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              先解析为可核对的草稿，不会直接创建或启动任务。
            </p>
            <Input
              id="scheduled-task-natural-language"
              className="mt-2"
              value={naturalLanguageInput}
              placeholder="例如：每天上午 9 点总结当前项目进度"
              onChange={(event) => {
                setNaturalLanguageInput(event.target.value)
                setNaturalLanguageError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') prepareNaturalLanguageDraft()
              }}
            />
          </div>
          <Button type="button" variant="outline" onClick={prepareNaturalLanguageDraft}>
            解析草稿
          </Button>
        </div>
        {naturalLanguageError && (
          <p className="mt-2 text-xs text-destructive" role="alert">{naturalLanguageError}</p>
        )}
        {draftSeed && (
          <div className="mt-3 rounded-lg bg-muted/35 p-3" aria-live="polite">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">{draftSeed.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">{draftSeed.scheduleLabel}</div>
                <p className="mt-2 text-sm leading-6 text-foreground/85">{draftSeed.prompt}</p>
              </div>
              <Button type="button" size="sm" onClick={openDraftInEditor}>核对并完善</Button>
            </div>
          </div>
        )}
      </section>

      <section className="surface-panel rounded-xl px-5 py-2">
        <dl className="grid divide-y divide-border/45 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
          <div className="sm:px-4 sm:first:pl-0"><OverviewItem label="全部任务" value={tasks.length} helper={`${runningCount} 个运行中`} /></div>
          <div className="sm:px-4"><OverviewItem label="需关注" value={failedCount} helper="晚点、错过或最近执行失败" /></div>
          <div className="sm:px-4"><OverviewItem label="调度器" value={describeRuntimeStatus(runtimeStatus)} helper={runtimeStatus?.watchdogReason ?? '等待 scheduler heartbeat'} /></div>
          <div className="sm:px-4 sm:last:pr-0"><OverviewItem label="最近扫描" value={<span className="tabular-nums">{formatTime(runtimeStatus?.lastScanAt)}</span>} helper={`活跃运行 ${runtimeStatus?.activeRunCount ?? 0} 个`} /></div>
        </dl>
      </section>

      <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <ScheduledTaskList
          tasks={tasks}
          selectedTaskId={selectedTaskId}
          onSelect={setSelectedTaskId}
          onCreate={() => {
            setDraftSeed(null)
            setEditorTask(null)
            setEditorOpen(true)
          }}
        />

        <div className="space-y-4">
          {!selectedTask && (
            <section className="surface-panel rounded-xl px-6 py-10">
              <h3 className="text-lg font-semibold text-foreground">选择任务查看详情</h3>
              <p className="mt-2 max-w-[46ch] text-sm leading-6 text-muted-foreground">
                任务详情包含执行时间、健康状态、投递设置和最近运行记录。
              </p>
            </section>
          )}

          {selectedTask && (
            <>
              <section className="surface-panel overflow-hidden rounded-xl">
                <div className="px-6 py-5">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 max-w-3xl">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <span className={selectedTask.status === 'running'
                          ? getStatusToneClasses('success').text
                          : 'text-muted-foreground'}>
                          {selectedTask.status === 'running' ? '运行中' : '已停止'}
                        </span>
                        <span className="text-muted-foreground">{describeRunMode(selectedTask)}</span>
                        <span className="text-muted-foreground">{describeSchedule(selectedTask)}</span>
                        <span className={getStatusToneClasses(getScheduledTaskHealthTone(selectedTask.health?.state)).text}>
                          {getScheduledTaskHealthLabel(selectedTask)}
                        </span>
                      </div>

                      <h3 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{selectedTask.name}</h3>
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
                        {selectedTask.prompt || '该任务还没有填写 prompt。'}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => {
                        setDraftSeed(null)
                        setEditorTask(selectedTask)
                        setEditorOpen(true)
                      }}>编辑</Button>
                      <Button type="button" variant={selectedTask.status === 'running' ? 'outline' : 'default'} size="sm" className="rounded-lg" onClick={() => {
                        const action = selectedTask.status === 'running'
                          ? window.electronAPI.stopScheduledTask(selectedTask.id)
                          : window.electronAPI.startScheduledTask(selectedTask.id)
                        action.catch((error) => {
                          toast.error('切换定时任务状态失败', { description: getErrorMessage(error) })
                        })
                      }}>{selectedTask.status === 'running' ? '停止' : '启动'}</Button>
                      <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => void runTaskNow(selectedTask.id)}>立即执行</Button>
                      <Button type="button" variant="ghost" size="sm" className="rounded-lg text-destructive" onClick={() => {
                        window.electronAPI.deleteScheduledTask(selectedTask.id).catch((error) => {
                          toast.error('删除失败', { description: getErrorMessage(error) })
                        })
                      }}>删除</Button>
                    </div>
                  </div>
                </div>

                <div className="border-t border-border/50 px-6 py-4">
                  <dl className="grid gap-x-8 md:grid-cols-2 xl:grid-cols-3">
                    <OverviewItem label="下一次执行" value={<span className="tabular-nums">{formatTime(selectedTask.nextRunAt)}</span>} helper={selectedTask.status === 'running' ? '按 wall-clock 时间触发' : '任务停止后不会触发'} />
                    <OverviewItem label="上次成功" value={<span className="tabular-nums">{formatTime(selectedTask.lastSuccessfulAt)}</span>} helper={selectedTask.lastSuccessfulAt ? getScheduledTaskHealthReason(selectedTask) : '还没有成功执行记录'} />
                    <OverviewItem label="健康度" value={getScheduledTaskHealthLabel(selectedTask)} helper={getScheduledTaskHealthReason(selectedTask)} />
                    <OverviewItem label="最近 heartbeat" value={<span className="tabular-nums">{formatTime(selectedTask.lastHeartbeatAt)}</span>} helper={selectedTask.schedule.kind === 'loop' ? 'loop 活动会刷新 heartbeat' : '最近一次调度活动时间'} />
                    <OverviewItem label="结果投递" value={describeDelivery(selectedTask)} helper={selectedTask.aiCanExit ? 'AI 可主动结束 loop 任务' : '未启用 AI 主动结束'} />
                    <OverviewItem label="结果校验" value={selectedTask.resultVerifiers?.length ? `${selectedTask.resultVerifiers.length} 条规则` : '未启用'} helper={`已执行 ${selectedTask.executionCount} 次`} />
                  </dl>

                  {selectedTask.health && ['late', 'failing', 'missed'].includes(selectedTask.health.state) && (
                    <div className="mt-3 rounded-lg bg-muted/40 px-3 py-2.5 text-sm leading-6 text-foreground">
                      <span className={`font-semibold ${getStatusToneClasses(selectedTask.health.state === 'missed' ? 'danger' : 'warning').text}`}>状态：</span>
                      {selectedTask.health.reason}
                    </div>
                  )}
                  {selectedTask.lastError && (
                    <div className="mt-3 rounded-lg bg-muted/40 px-3 py-2.5 text-sm leading-6 text-foreground whitespace-pre-wrap">
                      <span className={`font-semibold ${getStatusToneClasses('danger').text}`}>错误：</span>
                      {selectedTask.lastError}
                    </div>
                  )}
                  {selectedTask.lastSessionId && (
                    <Button type="button" variant="ghost" size="sm" className="mt-3 rounded-md px-2" onClick={() => openSession(selectedTask.lastSessionId!)}>
                      打开最近会话
                    </Button>
                  )}
                </div>
              </section>

              <ScheduledTaskRunsPanel runs={runs} onOpenSession={openSession} onRetry={() => void runTaskNow(selectedTask.id, '失败任务已重新执行')} />
            </>
          )}
        </div>
      </div>

      <ScheduledTaskEditorDialog
        open={editorOpen}
        task={editorTask}
        draftSeed={editorTask ? null : draftSeed}
        sessions={sessions}
        bindings={bindings}
        tools={tools}
        foregroundSession={foregroundSession}
        defaultChannelId={settings?.agentChannelId}
        defaultModelId={settings?.agentModelId}
        onClose={() => setEditorOpen(false)}
        onSubmit={saveTask}
      />
    </div>
  )
}
