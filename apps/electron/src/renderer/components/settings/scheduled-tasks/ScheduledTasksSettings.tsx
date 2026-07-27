import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { toast } from 'sonner'
import type {
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
  describeDelivery,
  describeRunMode,
  describeSchedule,
  formatTaskDateTime,
} from './task-presentation'
import {
  formatDraftScheduleLabel,
  parseScheduledTaskNaturalLanguage,
  type ScheduledTaskNaturalLanguageDraft,
} from './natural-language-draft'

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function describeRuntimeStatus(t: TFunction, status: ScheduledTaskRuntimeStatus | null): string {
  if (!status) return t('settingsTasks.runtimeStatus.loading')
  if (status.watchdogState === 'stale') return t('settingsTasks.runtimeStatus.stale')
  if (status.watchdogState === 'idle') return t('settingsTasks.runtimeStatus.idle')
  return t('settingsTasks.runtimeStatus.healthy')
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
  const { t, i18n } = useTranslation()
  const [tasks, setTasks] = React.useState<Awaited<ReturnType<typeof window.electronAPI.listScheduledTasks>>>([])
  const [runtimeStatus, setRuntimeStatus] = React.useState<ScheduledTaskRuntimeStatus | null>(null)
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(null)
  const [runs, setRuns] = React.useState<Awaited<ReturnType<typeof window.electronAPI.listScheduledTaskRuns>>>([])
  const [sessions, setSessions] = React.useState<SessionMeta[]>([])
  const [bindings, setBindings] = React.useState<Awaited<ReturnType<typeof window.electronAPI.listBridgeBindings>>>([])
  const [tools, setTools] = React.useState<Awaited<ReturnType<typeof window.electronAPI.getAgentTools>>>([])
  const [foregroundSession, setForegroundSession] = React.useState<SessionMeta | null>(null)
  const [settings, setSettings] = React.useState<Awaited<ReturnType<typeof window.electronAPI.getSettings>> | null>(null)
  const [editorTask, setEditorTask] = React.useState<Awaited<ReturnType<typeof window.electronAPI.listScheduledTasks>>[number] | null>(null)
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
      toast.error(t('settingsTasks.toast.loadFailed'), { description: getErrorMessage(error) })
    } finally {
      setLoading(false)
    }
  }, [t])

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
      toast.error(t('settingsTasks.toast.saveFailed'), { description: getErrorMessage(error) })
      throw error
    }
  }, [refresh, t])

  const openSession = React.useCallback((sessionId: string): void => {
    const session = sessions.find((item) => item.id === sessionId)
    if (!session) return
    void window.electronAPI.openSessionInMainWindow({
      sessionId,
      title: session.title,
    })
  }, [sessions])

  const runTaskNow = React.useCallback(async (taskId: string, successMessage?: string): Promise<void> => {
    try {
      await window.electronAPI.runScheduledTaskNow(taskId)
      toast.success(successMessage ?? t('settingsTasks.toast.runStarted'))
      await Promise.all([refresh(), refreshRuns(taskId)])
    } catch (error) {
      toast.error(t('settingsTasks.toast.runFailed'), { description: getErrorMessage(error) })
    }
  }, [refresh, refreshRuns, t])

  const recoverOverdueTasks = React.useCallback(async (): Promise<void> => {
    try {
      const status = await window.electronAPI.recoverOverdueScheduledTasks()
      setRuntimeStatus(status)
      toast.success(t('settingsTasks.toast.recoverDone'))
      await refresh()
    } catch (error) {
      toast.error(t('settingsTasks.toast.recoverFailed'), { description: getErrorMessage(error) })
    }
  }, [refresh, t])

  const prepareNaturalLanguageDraft = React.useCallback((): void => {
    const result = parseScheduledTaskNaturalLanguage(naturalLanguageInput)
    if (!result.ok) {
      setNaturalLanguageError(t(result.reasonKey))
      return
    }
    setNaturalLanguageError(null)
    setDraftSeed(result.draft)
  }, [naturalLanguageInput, t])

  const openDraftInEditor = React.useCallback((): void => {
    if (!draftSeed) return
    setEditorTask(null)
    setEditorOpen(true)
  }, [draftSeed])

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 px-1 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-3xl">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">{t('settingsTasks.title')}</h2>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            {t('settingsTasks.description')}
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
              {t('settingsTasks.actions.createFromSession')}
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
            {t('settingsTasks.actions.create')}
          </Button>
          {(failedCount > 0 || runtimeStatus?.watchdogState !== 'healthy') && (
            <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => void recoverOverdueTasks()}>
              {t('settingsTasks.actions.recoverOverdue')}
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
            {loading ? t('settingsTasks.actions.refreshing') : t('settingsTasks.actions.refresh')}
          </Button>
        </div>
      </header>

      <section className="surface-panel rounded-xl p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="scheduled-task-natural-language" className="text-sm font-semibold text-foreground">
              {t('settingsTasks.naturalLanguage.label')}
            </label>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t('settingsTasks.naturalLanguage.hint')}
            </p>
            <Input
              id="scheduled-task-natural-language"
              className="mt-2"
              value={naturalLanguageInput}
              placeholder={t('settingsTasks.naturalLanguage.placeholder')}
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
            {t('settingsTasks.naturalLanguage.parse')}
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
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatDraftScheduleLabel(t, draftSeed.scheduleLabel)}
                </div>
                <p className="mt-2 text-sm leading-6 text-foreground/85">{draftSeed.prompt}</p>
              </div>
              <Button type="button" size="sm" onClick={openDraftInEditor}>
                {t('settingsTasks.naturalLanguage.review')}
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="surface-panel rounded-xl px-5 py-2">
        <dl className="grid divide-y divide-border/45 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
          <div className="sm:px-4 sm:first:pl-0">
            <OverviewItem
              label={t('settingsTasks.overview.totalTasks')}
              value={tasks.length}
              helper={t('settingsTasks.overview.runningCount', { count: runningCount })}
            />
          </div>
          <div className="sm:px-4">
            <OverviewItem
              label={t('settingsTasks.overview.needsAttention')}
              value={failedCount}
              helper={t('settingsTasks.overview.needsAttentionHelper')}
            />
          </div>
          <div className="sm:px-4">
            <OverviewItem
              label={t('settingsTasks.overview.scheduler')}
              value={describeRuntimeStatus(t, runtimeStatus)}
              helper={runtimeStatus?.watchdogReason ?? t('settingsTasks.overview.schedulerWaiting')}
            />
          </div>
          <div className="sm:px-4 sm:last:pr-0">
            <OverviewItem
              label={t('settingsTasks.overview.lastScan')}
              value={<span className="tabular-nums">{formatTaskDateTime(runtimeStatus?.lastScanAt, i18n.language)}</span>}
              helper={t('settingsTasks.overview.activeRuns', { count: runtimeStatus?.activeRunCount ?? 0 })}
            />
          </div>
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
              <h3 className="text-lg font-semibold text-foreground">{t('settingsTasks.detail.emptyTitle')}</h3>
              <p className="mt-2 max-w-[46ch] text-sm leading-6 text-muted-foreground">
                {t('settingsTasks.detail.emptyDescription')}
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
                          {selectedTask.status === 'running'
                            ? t('settingsTasks.status.running')
                            : t('settingsTasks.status.stopped')}
                        </span>
                        <span className="text-muted-foreground">{describeRunMode(t, selectedTask)}</span>
                        <span className="text-muted-foreground">{describeSchedule(t, selectedTask, i18n.language)}</span>
                        <span className={getStatusToneClasses(getScheduledTaskHealthTone(selectedTask.health?.state)).text}>
                          {getScheduledTaskHealthLabel(t, selectedTask)}
                        </span>
                      </div>

                      <h3 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{selectedTask.name}</h3>
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
                        {selectedTask.prompt || t('settingsTasks.detail.noPrompt')}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => {
                        setDraftSeed(null)
                        setEditorTask(selectedTask)
                        setEditorOpen(true)
                      }}>{t('settingsTasks.detail.edit')}</Button>
                      <Button type="button" variant={selectedTask.status === 'running' ? 'outline' : 'default'} size="sm" className="rounded-lg" onClick={() => {
                        const action = selectedTask.status === 'running'
                          ? window.electronAPI.stopScheduledTask(selectedTask.id)
                          : window.electronAPI.startScheduledTask(selectedTask.id)
                        action.catch((error) => {
                          toast.error(t('settingsTasks.toast.toggleFailed'), { description: getErrorMessage(error) })
                        })
                      }}>
                        {selectedTask.status === 'running'
                          ? t('settingsTasks.status.stop')
                          : t('settingsTasks.status.start')}
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => void runTaskNow(selectedTask.id)}>
                        {t('settingsTasks.detail.runNow')}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" className="rounded-lg text-destructive" onClick={() => {
                        window.electronAPI.deleteScheduledTask(selectedTask.id).catch((error) => {
                          toast.error(t('settingsTasks.toast.deleteFailed'), { description: getErrorMessage(error) })
                        })
                      }}>{t('settingsTasks.detail.delete')}</Button>
                    </div>
                  </div>
                </div>

                <div className="border-t border-border/50 px-6 py-4">
                  <dl className="grid gap-x-8 md:grid-cols-2 xl:grid-cols-3">
                    <OverviewItem
                      label={t('settingsTasks.detail.nextRunLabel')}
                      value={<span className="tabular-nums">{formatTaskDateTime(selectedTask.nextRunAt, i18n.language)}</span>}
                      helper={selectedTask.status === 'running'
                        ? t('settingsTasks.detail.nextRunRunningHelper')
                        : t('settingsTasks.detail.nextRunStoppedHelper')}
                    />
                    <OverviewItem
                      label={t('settingsTasks.detail.lastSuccessLabel')}
                      value={<span className="tabular-nums">{formatTaskDateTime(selectedTask.lastSuccessfulAt, i18n.language)}</span>}
                      helper={selectedTask.lastSuccessfulAt
                        ? getScheduledTaskHealthReason(t, selectedTask)
                        : t('settingsTasks.detail.noSuccessHelper')}
                    />
                    <OverviewItem
                      label={t('settingsTasks.detail.healthLabel')}
                      value={getScheduledTaskHealthLabel(t, selectedTask)}
                      helper={getScheduledTaskHealthReason(t, selectedTask)}
                    />
                    <OverviewItem
                      label={t('settingsTasks.detail.heartbeatLabel')}
                      value={<span className="tabular-nums">{formatTaskDateTime(selectedTask.lastHeartbeatAt, i18n.language)}</span>}
                      helper={selectedTask.schedule.kind === 'loop'
                        ? t('settingsTasks.detail.heartbeatLoopHelper')
                        : t('settingsTasks.detail.heartbeatHelper')}
                    />
                    <OverviewItem
                      label={t('settingsTasks.detail.deliveryLabel')}
                      value={describeDelivery(t, selectedTask)}
                      helper={selectedTask.aiCanExit
                        ? t('settingsTasks.detail.aiCanExitHelper')
                        : t('settingsTasks.detail.aiCannotExitHelper')}
                    />
                    <OverviewItem
                      label={t('settingsTasks.detail.verificationLabel')}
                      value={selectedTask.resultVerifiers?.length
                        ? t('settingsTasks.detail.verifierCount', { count: selectedTask.resultVerifiers.length })
                        : t('settingsTasks.detail.verifierDisabled')}
                      helper={t('settingsTasks.detail.executionCountHelper', { count: selectedTask.executionCount })}
                    />
                  </dl>

                  {selectedTask.health && ['late', 'failing', 'missed'].includes(selectedTask.health.state) && (
                    <div className="mt-3 rounded-lg bg-muted/40 px-3 py-2.5 text-sm leading-6 text-foreground">
                      <span className={`font-semibold ${getStatusToneClasses(selectedTask.health.state === 'missed' ? 'danger' : 'warning').text}`}>
                        {t('settingsTasks.detail.statusPrefix')}
                      </span>
                      {selectedTask.health.reason}
                    </div>
                  )}
                  {selectedTask.lastError && (
                    <div className="mt-3 rounded-lg bg-muted/40 px-3 py-2.5 text-sm leading-6 text-foreground whitespace-pre-wrap">
                      <span className={`font-semibold ${getStatusToneClasses('danger').text}`}>
                        {t('settingsTasks.detail.errorPrefix')}
                      </span>
                      {selectedTask.lastError}
                    </div>
                  )}
                  {selectedTask.lastSessionId && (
                    <Button type="button" variant="ghost" size="sm" className="mt-3 rounded-md px-2" onClick={() => openSession(selectedTask.lastSessionId!)}>
                      {t('settingsTasks.detail.openLastSession')}
                    </Button>
                  )}
                </div>
              </section>

              <ScheduledTaskRunsPanel
                runs={runs}
                onOpenSession={openSession}
                onRetry={() => void runTaskNow(selectedTask.id, t('settingsTasks.toast.retryStarted'))}
              />
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
