import * as React from 'react'
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
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { SettingsSelect } from '../primitives/SettingsSelect'
import { ModelSelector } from '@/components/composer/ModelSelector'
import { PermissionModeSelector } from '@/components/agent/PermissionModeSelector'
import { ScheduledTaskScheduleEditor } from './ScheduledTaskScheduleEditor'
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

const THINKING_OPTIONS: Array<{ value: ThinkingLevel; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
]

function toToolSelection(tools: AgentToolInfo[], enabledToolIds: string[] | undefined): string[] {
  if (enabledToolIds?.length) return enabledToolIds
  return tools.filter((tool) => tool.enabled).map((tool) => tool.meta.id)
}

function describeSchedule(schedule: ScheduledTask['schedule']): string {
  switch (schedule.kind) {
    case 'every':
      return `every ${schedule.minutes} min`
    case 'cron':
      return schedule.expr
    case 'at':
      return 'single shot'
    case 'loop':
      return 'loop'
  }
}

function describeDelivery(delivery: ScheduledTaskDelivery, bindings: BridgeBinding[]): string {
  if (delivery.kind === 'none') return '不投递'
  const targets = getDeliveryTargets(delivery)
  if (targets.length === 0) return '不投递'
  if (targets.length === 1) {
    const target = targets[0]!
    const binding = bindings.find((item) => item.endpointKey === target.endpointKey)
    return binding ? `${binding.displayName || binding.endpointKey} · ${binding.channelType}` : `${target.endpointKey} · ${target.channelType}`
  }
  return `${targets.length} 个远程渠道目标`
}

function getDeliveryTargets(delivery: ScheduledTaskDelivery): Array<{ endpointKey: string; channelType: BridgeBinding['channelType'] }> {
  if (delivery.kind === 'bridge_binding') {
    return [{ endpointKey: delivery.endpointKey, channelType: delivery.channelType }]
  }
  if (delivery.kind === 'bridge_bindings') {
    return delivery.targets
  }
  return []
}

function setDeliveryTarget(delivery: ScheduledTaskDelivery, binding: BridgeBinding, enabled: boolean): ScheduledTaskDelivery {
  const nextTargets = getDeliveryTargets(delivery)
    .filter((target) => target.endpointKey !== binding.endpointKey)
  if (enabled) {
    nextTargets.push({
      endpointKey: binding.endpointKey,
      channelType: binding.channelType,
    })
  }
  if (nextTargets.length === 0) return { kind: 'none' }
  return {
    kind: 'bridge_bindings',
    targets: nextTargets,
    failurePolicy: delivery.kind === 'bridge_bindings' ? delivery.failurePolicy : 'all',
  }
}

function hasVerifier(verifiers: ScheduledTaskResultVerifier[], kind: ScheduledTaskResultVerifier['kind']): boolean {
  return verifiers.some((verifier) => verifier.kind === kind)
}

function readFileVerifierPath(verifiers: ScheduledTaskResultVerifier[]): string {
  const verifier = verifiers.find((item) => item.kind === 'file_exists')
  return verifier?.kind === 'file_exists' ? verifier.path : ''
}

function describeVerifiers(verifiers: ScheduledTaskResultVerifier[]): string {
  if (verifiers.length === 0) return '无校验'
  return verifiers.map((verifier) => {
    switch (verifier.kind) {
      case 'reply_non_empty':
        return 'reply'
      case 'bridge_delivery_success':
        return 'bridge'
      case 'file_exists':
        return `file:${verifier.path}`
    }
  }).join(' · ')
}

function FieldGroup({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="space-y-2.5">
      <div>
        <Label className="text-sm font-medium text-foreground">{label}</Label>
        {description && (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  )
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section className="border-t border-border/50 pt-5 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
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

    setName(draftSeed?.name ?? (seedSession ? `定时任务 · ${seedSession.title}` : '新定时任务'))
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
  }, [defaultChannelId, defaultModelId, draftSeed, foregroundSession, open, seedSession, task, tools])

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

  const summaryName = name.trim() || '未命名任务'
  const summaryPrompt = prompt.trim() || '将在这里显示任务 prompt 摘要，方便在保存前快速核对任务全貌。'
  const summaryRunMode = runMode === 'single_session' ? '连续会话' : '新建会话'
  const summaryModel = modelSelection?.modelId ?? '未选择模型'
  const summaryTools = selectedToolIds.length > 0 ? `${selectedToolIds.length} 个工具` : '未选择工具'
  const summaryVerifiers = describeVerifiers(resultVerifiers)
  const selectedDeliveryTargets = getDeliveryTargets(delivery)
  const selectedDeliveryEndpointKeys = new Set(selectedDeliveryTargets.map((target) => target.endpointKey))

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
      throw new Error('请选择模型')
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
                {task ? '编辑定时任务' : '新建定时任务'}
              </DialogTitle>
              <DialogDescription className="mt-2 max-w-3xl text-sm leading-6">
                配置任务内容、执行时间、目标会话和结果处理。
              </DialogDescription>
            </div>
          </DialogHeader>

          <OverlayScrollbarArea
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7 sm:py-6"
            options={{ overflow: { x: 'hidden', y: 'scroll' } }}
          >
            <section className="border-b border-border/50 pb-5">
              <div className="text-xs font-medium text-muted-foreground">任务摘要</div>

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
                    <div className="font-medium text-foreground">来源会话</div>
                    <div className="mt-1">{seedSession.title}</div>
                    <div className="text-xs">{seedSession.project.name}</div>
                  </div>
                )}
              </div>

              <dl className="mt-4 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ['执行时间', describeSchedule(schedule)],
                  ['会话模式', summaryRunMode],
                  ['模型', summaryModel],
                  ['投递', describeDelivery(delivery, bindings)],
                  ['工具', summaryTools],
                  ['校验', summaryVerifiers],
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
                  title="任务内容"
                  description="任务名称与 prompt 定义了这个后台流程的身份和预期输出。"
                >
                  <FieldGroup label="名称">
                    <Input value={name} onChange={(event) => setName(event.target.value)} />
                  </FieldGroup>

                  <FieldGroup label="Prompt" description="这里的内容会在每次触发时发送给 Agent。">
                    <Textarea
                      rows={10}
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      placeholder="输入定时触发时发送给 Agent 的内容"
                    />
                  </FieldGroup>
                </SectionCard>

                <SectionCard
                  title="执行时间"
                  description="可以选择固定间隔、cron、一次性触发或 loop 持续自治。"
                >
                  <ScheduledTaskScheduleEditor value={schedule} onChange={setSchedule} />
                </SectionCard>

                <SectionCard
                  title="目标会话与投递"
                  description="新建会话适合周期性报告；连续会话适合长期上下文演进。"
                >
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      type="button"
                      variant={runMode === 'new_session' ? 'default' : 'outline'}
                      className={cn('h-auto flex-col items-start rounded-lg px-4 py-3 text-left', runMode !== 'new_session' && 'bg-background/80')}
                      onClick={() => setRunMode('new_session')}
                    >
                      <span className="text-sm font-semibold">新建会话</span>
                      <span className={cn('text-[11px] leading-5', runMode === 'new_session' ? 'text-[hsl(var(--brand-soft-foreground))/0.82]' : 'text-muted-foreground')}>
                        每次执行创建一条新的 session
                      </span>
                    </Button>
                    <Button
                      type="button"
                      variant={runMode === 'single_session' ? 'default' : 'outline'}
                      className={cn('h-auto flex-col items-start rounded-lg px-4 py-3 text-left', runMode !== 'single_session' && 'bg-background/80')}
                      onClick={() => setRunMode('single_session')}
                    >
                      <span className="text-sm font-semibold">连续会话</span>
                      <span className={cn('text-[11px] leading-5', runMode === 'single_session' ? 'text-[hsl(var(--brand-soft-foreground))/0.82]' : 'text-muted-foreground')}>
                        把消息持续追加到同一个 session
                      </span>
                    </Button>
                  </div>

                  {runMode === 'new_session' ? (
                    <FieldGroup label="项目目录" description="新建会话会以这个目录作为 project root。">
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
                          选择目录
                        </Button>
                      </div>
                    </FieldGroup>
                  ) : (
                    <SettingsSelect
                      label="目标会话"
                      value={singleSessionId || '__none__'}
                      onValueChange={(value) => setSingleSessionId(value === '__none__' ? '' : value)}
                      options={[
                        { value: '__none__', label: '请选择会话' },
                        ...sessions.map((session) => ({ value: session.id, label: session.title })),
                      ]}
                    />
                  )}
                </SectionCard>
              </div>

              <div className="space-y-5">
                <SectionCard
                  title="运行配置与结果"
                  description="右侧统一配置运行时上下文、启用工具和结果处理策略。"
                >
                  <FieldGroup label="模型">
                    <ModelSelector
                      externalSelectedModel={modelSelection}
                      onModelSelect={(option) => {
                        setModelSelection({ channelId: option.channelId, modelId: option.modelId })
                      }}
                    />
                  </FieldGroup>

                  <div className="grid gap-4 md:grid-cols-2">
                    <SettingsSelect
                      label="Thinking"
                      value={thinkingLevel}
                      onValueChange={(value) => setThinkingLevel(value as ThinkingLevel)}
                      options={THINKING_OPTIONS}
                    />

                    <FieldGroup label="History Turns">
                      <Input value={historyTurns} onChange={(event) => setHistoryTurns(event.target.value)} />
                    </FieldGroup>
                  </div>

                  <FieldGroup label="Additional Directories" description="每行一个目录，作为本次任务的附加上下文范围。">
                    <Textarea
                      rows={5}
                      value={additionalDirectories}
                      onChange={(event) => setAdditionalDirectories(event.target.value)}
                      placeholder="每行一个目录"
                    />
                  </FieldGroup>

                  <FieldGroup label="Enabled Tools" description="只启用本任务真正需要的工具，能让行为更可预测。">
                    <div className="flex flex-wrap gap-2">
                      {tools.map((tool) => {
                        const active = selectedToolIds.includes(tool.meta.id)
                        return (
                          <button
                            key={tool.meta.id}
                            type="button"
                            className={cn(
                              'rounded-md border px-2.5 py-1.5 text-xs transition-colors',
                              active
                                ? 'border-[hsl(var(--brand-soft-foreground)/0.18)] bg-brand-soft text-brand-soft-foreground'
                                : 'border-border/60 bg-background/80 text-muted-foreground',
                            )}
                            onClick={() => {
                              setSelectedToolIds((prev) => (
                                prev.includes(tool.meta.id)
                                  ? prev.filter((item) => item !== tool.meta.id)
                                  : [...prev, tool.meta.id]
                              ))
                            }}
                          >
                            {tool.meta.name}
                          </button>
                        )
                      })}
                    </div>
                  </FieldGroup>

                  <FieldGroup label="权限模式" description="后台任务会严格按这里的模式运行，不依赖当前前台会话的审批状态。">
                    <div className="border-b border-border/45 px-1 py-3 last:border-b-0">
                      <PermissionModeSelector value={permissionModeOverride} onChange={setPermissionModeOverride} />
                      <div className="mt-2 text-xs leading-5 text-muted-foreground">
                        `auto` 适合完全自动化任务；`smart` 是默认交互策略，适合需要审批敏感操作的后台流程。
                      </div>
                    </div>
                  </FieldGroup>

                  <div className="rounded-lg bg-muted/25 px-4 py-4">
                    <div className="text-xs font-medium text-muted-foreground">
                      结果处理
                    </div>

                    <div className="mt-4 space-y-4">
                      <FieldGroup label="结果投递" description="可同时投递到多个远程渠道绑定；默认要求全部投递成功才通过远程渠道送达校验。">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between border-b border-border/45 px-1 py-3 last:border-b-0">
                            <div>
                              <div className="text-sm font-medium text-foreground">不投递</div>
                              <div className="mt-1 text-xs text-muted-foreground">只在本地 session 记录任务结果。</div>
                            </div>
                            <Switch
                              checked={delivery.kind === 'none'}
                              onCheckedChange={(checked) => {
                                if (checked) setDelivery({ kind: 'none' })
                              }}
                            />
                          </div>
                          {bindings.length === 0 && (
                            <div className="rounded-lg border border-dashed border-border/60 px-4 py-3 text-sm text-muted-foreground">
                              当前没有远程渠道绑定。先从 Telegram / Discord / 飞书 / 微信发一条消息创建绑定。
                            </div>
                          )}
                          {bindings.map((binding) => (
                            <div key={binding.endpointKey} className="flex items-center justify-between border-b border-border/45 px-1 py-3 last:border-b-0">
                              <div>
                                <div className="text-sm font-medium text-foreground">{binding.displayName || binding.endpointKey}</div>
                                <div className="mt-1 text-xs text-muted-foreground">{binding.channelType} · {binding.endpointKey}</div>
                              </div>
                              <Switch
                                checked={selectedDeliveryEndpointKeys.has(binding.endpointKey)}
                                onCheckedChange={(checked) => {
                                  setDelivery((prev) => setDeliveryTarget(prev, binding, checked))
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      </FieldGroup>

                      <FieldGroup label="结果校验" description="把“任务跑了”和“产出合格”分开判断，适合日报、日记和备份类任务。">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between border-b border-border/45 px-1 py-3 last:border-b-0">
                            <div>
                              <div className="text-sm font-medium text-foreground">Reply 非空</div>
                              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                                推荐给写日记、日报和总结任务，避免“执行成功但没有正文”。
                              </div>
                            </div>
                            <Switch
                              checked={hasVerifier(resultVerifiers, 'reply_non_empty')}
                              onCheckedChange={(checked) => toggleVerifier('reply_non_empty', checked)}
                            />
                          </div>

                          <div className="flex items-center justify-between border-b border-border/45 px-1 py-3 last:border-b-0">
                            <div>
                              <div className="text-sm font-medium text-foreground">远程渠道投递成功</div>
                              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                                如果任务依赖远程渠道送达最终结果，可以把投递也纳入成功条件。
                              </div>
                            </div>
                            <Switch
                              checked={hasVerifier(resultVerifiers, 'bridge_delivery_success')}
                              onCheckedChange={(checked) => toggleVerifier('bridge_delivery_success', checked)}
                            />
                          </div>

                          <div className="border-b border-border/45 px-1 py-3 last:border-b-0">
                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <div className="text-sm font-medium text-foreground">文件产出存在</div>
                                <div className="mt-1 text-xs leading-5 text-muted-foreground">
                                  适合备份、日志或写文件类任务。路径默认相对当前 project root 解析。
                                </div>
                              </div>
                              <Switch
                                checked={hasVerifier(resultVerifiers, 'file_exists')}
                                onCheckedChange={(checked) => toggleVerifier('file_exists', checked)}
                              />
                            </div>

                            {hasVerifier(resultVerifiers, 'file_exists') && (
                              <div className="mt-3">
                                <Input
                                  value={verificationFilePath}
                                  onChange={(event) => setVerificationFilePath(event.target.value)}
                                  placeholder="例如 diary/today.md"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      </FieldGroup>

                      <div className="flex items-center justify-between border-b border-border/45 px-1 py-3 last:border-b-0">
                        <div>
                          <div className="text-sm font-medium text-foreground">Missed run 提醒</div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">
                            当任务错过本轮 deadline 时，追加本地 system message；如果配置了远程渠道，也会发出提醒。
                          </div>
                        </div>
                        <Switch checked={notifyOnMissedRun} onCheckedChange={setNotifyOnMissedRun} />
                      </div>

                      <div className="flex items-center justify-between border-b border-border/45 px-1 py-3 last:border-b-0">
                        <div>
                          <div className="text-sm font-medium text-foreground">AI 可结束任务</div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">
                            仅 loop 模式下建议开启，允许模型在任务完成后主动调用退出工具。
                          </div>
                        </div>
                        <Switch checked={aiCanExit} onCheckedChange={setAiCanExit} />
                      </div>
                    </div>
                  </div>
                </SectionCard>
              </div>
            </div>
          </OverlayScrollbarArea>

          <div className="border-t border-border/60 bg-background/92 px-6 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs leading-6 text-muted-foreground">
                定时任务会使用你为它单独配置的权限模式运行，不会继承当前前台会话的审批状态。
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" className="rounded-lg" onClick={onClose} disabled={saving}>
                  取消
                </Button>
                <Button type="button" className="rounded-lg" onClick={() => void submit()} disabled={saving}>
                  {saving ? '保存中...' : '保存任务'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
