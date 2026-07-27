import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type {
  BridgeBinding,
  AgentToolInfo,
  KilaPermissionMode,
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskDelivery,
  ScheduledTaskResultVerifier,
  ScheduledTaskRunMode,
  ScheduledTaskUpdateInput,
  SessionMeta,
  ThinkingLevel,
} from '@kila/shared'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { OverlayScrollbarArea } from '@/components/ui/overlay-scrollbar'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { SettingsSelect } from '../primitives/SettingsSelect'
import { ScheduledTaskScheduleEditor } from './ScheduledTaskScheduleEditor'
import { ScheduledTaskRuntimeFields } from './ScheduledTaskRuntimeFields'
import { ScheduledTaskResultFields } from './ScheduledTaskResultFields'
import { FieldGroup, SectionCard } from './editor-primitives'
import {
  describeEditorDelivery,
  describeVerifiers,
  hasVerifier,
  readFileVerifierPath,
} from './editor-delivery'
import { cn } from '@/lib/utils'

interface ScheduledTaskEditorDialogProps {
  open: boolean
  task: ScheduledTask | null
  draftSeed?: Pick<ScheduledTaskCreateInput, 'name' | 'prompt' | 'schedule'> | null
  sessions: SessionMeta[]
  bindings: BridgeBinding[]
  tools: AgentToolInfo[]
  foregroundSession: SessionMeta | null
  defaultChannelId?: string
  defaultModelId?: string
  onClose: () => void
  onSubmit: (value: ScheduledTaskCreateInput | ScheduledTaskUpdateInput, taskId?: string) => Promise<void>
}

const NO_SESSION_VALUE = '__none__'

function toToolSelection(tools: AgentToolInfo[], enabledToolIds: string[] | undefined): string[] {
  if (enabledToolIds?.length) return enabledToolIds
  return tools.filter((tool) => tool.enabled).map((tool) => tool.meta.id)
}

/** 摘要行的调度描述，比列表页更短 */
function describeSummarySchedule(t: TFunction, schedule: ScheduledTask['schedule']): string {
  switch (schedule.kind) {
    case 'every':
      return t('settingsTasks.editor.summary.everyMinutes', { count: schedule.minutes })
    case 'cron':
      return schedule.expr
    case 'at':
      return t('settingsTasks.editor.summary.singleShot')
    case 'loop':
      return t('settingsTasks.editor.summary.loop')
  }
}

export function ScheduledTaskEditorDialog({
  open,
  task,
  draftSeed,
  sessions,
  bindings,
  tools,
  foregroundSession,
  defaultChannelId,
  defaultModelId,
  onClose,
  onSubmit,
}: ScheduledTaskEditorDialogProps): React.ReactElement {
  const { t } = useTranslation()
  const taskSessionId = task?.executionTarget.kind === 'single_session'
    ? task.executionTarget.sessionId
    : null
  const seedSession = task
    ? (taskSessionId
      ? sessions.find((item) => item.id === taskSessionId) ?? null
      : null)
    : foregroundSession

  const [name, setName] = React.useState('')
  const [prompt, setPrompt] = React.useState('')
  const [schedule, setSchedule] = React.useState<ScheduledTask['schedule']>({ kind: 'every', minutes: 5 })
  const [runMode, setRunMode] = React.useState<ScheduledTaskRunMode>('new_session')
  const [projectPath, setProjectPath] = React.useState('')
  const [singleSessionId, setSingleSessionId] = React.useState('')
  const [modelSelection, setModelSelection] = React.useState<{ channelId: string; modelId: string } | null>(null)
  const [thinkingLevel, setThinkingLevel] = React.useState<ThinkingLevel>('medium')
  const [historyTurns, setHistoryTurns] = React.useState<string>('20')
  const [additionalDirectories, setAdditionalDirectories] = React.useState('')
  const [selectedToolIds, setSelectedToolIds] = React.useState<string[]>([])
  const [delivery, setDelivery] = React.useState<ScheduledTaskDelivery>({ kind: 'none' })
  const [resultVerifiers, setResultVerifiers] = React.useState<ScheduledTaskResultVerifier[]>([])
  const [verificationFilePath, setVerificationFilePath] = React.useState('')
  const [permissionModeOverride, setPermissionModeOverride] = React.useState<KilaPermissionMode>('auto')
  const [aiCanExit, setAiCanExit] = React.useState(false)
  const [notifyOnMissedRun, setNotifyOnMissedRun] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return

    if (task) {
      setName(task.name)
      setPrompt(task.prompt)
      setSchedule(task.schedule)
      setRunMode(task.runMode)
      setProjectPath(task.executionTarget.kind === 'new_session' ? task.executionTarget.projectPath : '')
      setSingleSessionId(task.executionTarget.kind === 'single_session' ? task.executionTarget.sessionId : '')
      setModelSelection(task.modelId
        ? { channelId: task.channelId, modelId: task.modelId }
        : null)
      setThinkingLevel(task.thinkingLevel ?? 'medium')
      setHistoryTurns(task.historyTurns === 'infinite' ? 'infinite' : String(task.historyTurns ?? 20))
      setAdditionalDirectories((task.additionalDirectories ?? []).join('\n'))
      setSelectedToolIds(toToolSelection(tools, task.enabledToolIds))
      setDelivery(task.delivery)
      setResultVerifiers(task.resultVerifiers ?? [])
      setVerificationFilePath(readFileVerifierPath(task.resultVerifiers ?? []))
      setPermissionModeOverride(task.permissionModeOverride ?? 'auto')
      setAiCanExit(task.aiCanExit)
      setNotifyOnMissedRun(Boolean(task.notifyOnMissedRun))
      return
    }

    setName(draftSeed?.name || (seedSession
      ? t('settingsTasks.editor.defaultNameFromSession', { title: seedSession.title })
      : t('settingsTasks.editor.defaultName')))
    setPrompt(draftSeed?.prompt ?? '')
    setSchedule(draftSeed?.schedule ?? { kind: 'every', minutes: 5 })
    setRunMode(seedSession ? 'single_session' : 'new_session')
    setProjectPath(seedSession?.project.path ?? '')
    setSingleSessionId(seedSession?.id ?? '')
    setModelSelection(
      seedSession?.channelId && seedSession.modelId
        ? { channelId: seedSession.channelId, modelId: seedSession.modelId }
        : defaultChannelId && defaultModelId
          ? { channelId: defaultChannelId, modelId: defaultModelId }
          : null,
    )
    setThinkingLevel(seedSession?.thinkingLevel ?? 'medium')
    setHistoryTurns(seedSession?.historyTurns === 'infinite' ? 'infinite' : String(seedSession?.historyTurns ?? 20))
    setAdditionalDirectories((seedSession?.attachedDirectories ?? []).join('\n'))
    setSelectedToolIds(toToolSelection(tools, seedSession?.enabledToolIds))
    setDelivery({ kind: 'none' })
    setResultVerifiers([{ kind: 'reply_non_empty' }])
    setVerificationFilePath('')
    setPermissionModeOverride('auto')
    setAiCanExit(false)
    setNotifyOnMissedRun(false)
  }, [defaultChannelId, defaultModelId, draftSeed, foregroundSession, open, seedSession, t, task, tools])

  React.useEffect(() => {
    if (!open) return

    if (schedule.kind !== 'loop') {
      setAiCanExit(false)
      return
    }

    if (!task) {
      setAiCanExit((prev) => (prev ? prev : true))
    }
  }, [open, schedule.kind, task])

  const summaryName = name.trim() || t('settingsTasks.editor.untitledTask')
  const summaryPrompt = prompt.trim() || t('settingsTasks.editor.promptSummaryPlaceholder')
  const summaryRunMode = runMode === 'single_session'
    ? t('settingsTasks.runMode.singleSession')
    : t('settingsTasks.runMode.newSession')
  const summaryModel = modelSelection?.modelId ?? t('settingsTasks.editor.noModel')
  const summaryTools = selectedToolIds.length > 0
    ? t('settingsTasks.editor.toolCount', { count: selectedToolIds.length })
    : t('settingsTasks.editor.noTools')
  const summaryVerifiers = describeVerifiers(t, resultVerifiers)

  const toggleVerifier = React.useCallback((kind: ScheduledTaskResultVerifier['kind'], enabled: boolean): void => {
    setResultVerifiers((prev) => {
      const filtered = prev.filter((verifier) => verifier.kind !== kind)
      if (!enabled) return filtered
      if (kind === 'file_exists') {
        return [...filtered, { kind: 'file_exists', path: verificationFilePath.trim() }]
      }
      return [...filtered, { kind }]
    })
  }, [verificationFilePath])

  React.useEffect(() => {
    if (!hasVerifier(resultVerifiers, 'file_exists')) return
    setResultVerifiers((prev) => prev.map((verifier) => (
      verifier.kind === 'file_exists'
        ? { kind: 'file_exists', path: verificationFilePath.trim() }
        : verifier
    )))
  }, [verificationFilePath])

  const submit = React.useCallback(async (): Promise<void> => {
    if (!modelSelection?.channelId) {
      throw new Error(t('settingsTasks.editor.selectModelError'))
    }

    const executionTarget = runMode === 'single_session'
      ? {
          kind: 'single_session' as const,
          sessionId: singleSessionId,
        }
      : {
          kind: 'new_session' as const,
          projectPath,
        }

    const parsedHistoryTurns = historyTurns === 'infinite'
      ? 'infinite'
      : Math.max(0, Number(historyTurns || 20))

    const payload: ScheduledTaskCreateInput = {
      name: name.trim(),
      prompt: prompt.trim(),
      schedule,
      runMode,
      executionTarget,
      delivery,
      channelId: modelSelection.channelId,
      modelId: modelSelection.modelId,
      thinkingLevel,
      historyTurns: parsedHistoryTurns,
      enabledToolIds: selectedToolIds,
      additionalDirectories: additionalDirectories
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean),
      resultVerifiers: resultVerifiers
        .filter((verifier) => verifier.kind !== 'file_exists' || verifier.path.trim())
        .map((verifier) => verifier.kind === 'file_exists'
          ? { kind: 'file_exists', path: verifier.path.trim() }
          : verifier),
      aiCanExit,
      permissionModeOverride,
      notifyOnMissedRun,
    }

    setSaving(true)
    try {
      await onSubmit(payload, task?.id)
      onClose()
    } finally {
      setSaving(false)
    }
  }, [
    additionalDirectories,
    aiCanExit,
    delivery,
    historyTurns,
    modelSelection,
    name,
    notifyOnMissedRun,
    onClose,
    onSubmit,
    projectPath,
    prompt,
    permissionModeOverride,
    resultVerifiers,
    runMode,
    schedule,
    selectedToolIds,
    singleSessionId,
    t,
    task?.id,
    thinkingLevel,
    verificationFilePath,
  ])

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="w-[calc(100vw-32px)] max-h-[90vh] max-w-[1120px] overflow-hidden border-border/60 bg-background p-0 sm:w-[calc(100vw-48px)]">
        <div className="flex h-[min(90vh,920px)] min-h-0 flex-col">
          <DialogHeader className="border-b border-border/60 px-6 py-5">
            <div className="pr-10">
              <DialogTitle className="text-2xl font-semibold tracking-tight">
                {task ? t('settingsTasks.editor.editTitle') : t('settingsTasks.editor.createTitle')}
              </DialogTitle>
              <DialogDescription className="mt-2 max-w-3xl text-sm leading-6">
                {t('settingsTasks.editor.description')}
              </DialogDescription>
            </div>
          </DialogHeader>

          <OverlayScrollbarArea
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7 sm:py-6"
            options={{ overflow: { x: 'hidden', y: 'scroll' } }}
          >
            <section className="border-b border-border/50 pb-5">
              <div className="text-xs font-medium text-muted-foreground">{t('settingsTasks.editor.summaryHeading')}</div>

              <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 max-w-3xl">
                  <div className="text-xl font-semibold tracking-tight text-foreground">
                    {summaryName}
                  </div>
                  <p className="mt-2 line-clamp-3 text-sm leading-7 text-muted-foreground">
                    {summaryPrompt}
                  </p>
                </div>

                {seedSession && (
                  <div className="border-l border-border/60 pl-4 text-sm text-muted-foreground">
                    <div className="font-medium text-foreground">{t('settingsTasks.editor.sourceSession')}</div>
                    <div className="mt-1">{seedSession.title}</div>
                    <div className="text-xs">{seedSession.project.name}</div>
                  </div>
                )}
              </div>

              <dl className="mt-4 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                {[
                  [t('settingsTasks.editor.summary.schedule'), describeSummarySchedule(t, schedule)],
                  [t('settingsTasks.editor.summary.runMode'), summaryRunMode],
                  [t('settingsTasks.editor.summary.model'), summaryModel],
                  [t('settingsTasks.editor.summary.delivery'), describeEditorDelivery(t, delivery, bindings)],
                  [t('settingsTasks.editor.summary.tools'), summaryTools],
                  [t('settingsTasks.editor.summary.verification'), summaryVerifiers],
                ].map(([label, value]) => (
                  <div key={label} className="flex min-w-0 gap-2">
                    <dt className="shrink-0 text-muted-foreground">{label}</dt>
                    <dd className="truncate font-medium text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <div className="mt-6 grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="space-y-5">
                <SectionCard
                  title={t('settingsTasks.editor.content.title')}
                  description={t('settingsTasks.editor.content.description')}
                >
                  <FieldGroup label={t('settingsTasks.editor.content.nameLabel')}>
                    <Input value={name} onChange={(event) => setName(event.target.value)} />
                  </FieldGroup>

                  <FieldGroup
                    label={t('settingsTasks.editor.content.promptLabel')}
                    description={t('settingsTasks.editor.content.promptDescription')}
                  >
                    <Textarea
                      rows={10}
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      placeholder={t('settingsTasks.editor.content.promptPlaceholder')}
                    />
                  </FieldGroup>
                </SectionCard>

                <SectionCard
                  title={t('settingsTasks.editor.schedule.title')}
                  description={t('settingsTasks.editor.schedule.description')}
                >
                  <ScheduledTaskScheduleEditor value={schedule} onChange={setSchedule} />
                </SectionCard>

                <SectionCard
                  title={t('settingsTasks.editor.target.title')}
                  description={t('settingsTasks.editor.target.description')}
                >
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      type="button"
                      variant={runMode === 'new_session' ? 'default' : 'outline'}
                      className={cn('h-auto flex-col items-start rounded-lg px-4 py-3 text-left', runMode !== 'new_session' && 'bg-background/80')}
                      onClick={() => setRunMode('new_session')}
                    >
                      <span className="text-sm font-semibold">{t('settingsTasks.editor.target.newSession')}</span>
                      <span className={cn('text-[11px] leading-5', runMode === 'new_session' ? 'text-[hsl(var(--brand-soft-foreground))/0.82]' : 'text-muted-foreground')}>
                        {t('settingsTasks.editor.target.newSessionHint')}
                      </span>
                    </Button>
                    <Button
                      type="button"
                      variant={runMode === 'single_session' ? 'default' : 'outline'}
                      className={cn('h-auto flex-col items-start rounded-lg px-4 py-3 text-left', runMode !== 'single_session' && 'bg-background/80')}
                      onClick={() => setRunMode('single_session')}
                    >
                      <span className="text-sm font-semibold">{t('settingsTasks.editor.target.singleSession')}</span>
                      <span className={cn('text-[11px] leading-5', runMode === 'single_session' ? 'text-[hsl(var(--brand-soft-foreground))/0.82]' : 'text-muted-foreground')}>
                        {t('settingsTasks.editor.target.singleSessionHint')}
                      </span>
                    </Button>
                  </div>

                  {runMode === 'new_session' ? (
                    <FieldGroup
                      label={t('settingsTasks.editor.target.projectPathLabel')}
                      description={t('settingsTasks.editor.target.projectPathDescription')}
                    >
                      <div className="flex gap-2">
                        <Input value={projectPath} onChange={(event) => setProjectPath(event.target.value)} />
                        <Button
                          type="button"
                          variant="outline"
                          className="shrink-0 rounded-lg"
                          onClick={() => {
                            window.electronAPI.openFolderDialog().then((result) => {
                              if (result?.path) setProjectPath(result.path)
                            }).catch(console.error)
                          }}
                        >
                          {t('settingsTasks.editor.target.chooseFolder')}
                        </Button>
                      </div>
                    </FieldGroup>
                  ) : (
                    <SettingsSelect
                      label={t('settingsTasks.editor.target.sessionLabel')}
                      value={singleSessionId || NO_SESSION_VALUE}
                      onValueChange={(value) => setSingleSessionId(value === NO_SESSION_VALUE ? '' : value)}
                      options={[
                        { value: NO_SESSION_VALUE, label: t('settingsTasks.editor.target.sessionPlaceholder') },
                        ...sessions.map((session) => ({ value: session.id, label: session.title })),
                      ]}
                    />
                  )}
                </SectionCard>
              </div>

              <div className="space-y-5">
                <SectionCard
                  title={t('settingsTasks.editor.runtime.title')}
                  description={t('settingsTasks.editor.runtime.description')}
                >
                  <ScheduledTaskRuntimeFields
                    tools={tools}
                    modelSelection={modelSelection}
                    onModelSelectionChange={setModelSelection}
                    thinkingLevel={thinkingLevel}
                    onThinkingLevelChange={setThinkingLevel}
                    historyTurns={historyTurns}
                    onHistoryTurnsChange={setHistoryTurns}
                    additionalDirectories={additionalDirectories}
                    onAdditionalDirectoriesChange={setAdditionalDirectories}
                    selectedToolIds={selectedToolIds}
                    onSelectedToolIdsChange={setSelectedToolIds}
                    permissionMode={permissionModeOverride}
                    onPermissionModeChange={setPermissionModeOverride}
                  />

                  <ScheduledTaskResultFields
                    bindings={bindings}
                    delivery={delivery}
                    onDeliveryChange={setDelivery}
                    resultVerifiers={resultVerifiers}
                    onToggleVerifier={toggleVerifier}
                    verificationFilePath={verificationFilePath}
                    onVerificationFilePathChange={setVerificationFilePath}
                    notifyOnMissedRun={notifyOnMissedRun}
                    onNotifyOnMissedRunChange={setNotifyOnMissedRun}
                    aiCanExit={aiCanExit}
                    onAiCanExitChange={setAiCanExit}
                  />
                </SectionCard>
              </div>
            </div>
          </OverlayScrollbarArea>

          <div className="border-t border-border/60 bg-background/92 px-6 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs leading-6 text-muted-foreground">
                {t('settingsTasks.editor.footerNotice')}
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" className="rounded-lg" onClick={onClose} disabled={saving}>
                  {t('settingsTasks.editor.cancel')}
                </Button>
                <Button type="button" className="rounded-lg" onClick={() => void submit()} disabled={saving}>
                  {saving ? t('settingsTasks.editor.saving') : t('settingsTasks.editor.save')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
