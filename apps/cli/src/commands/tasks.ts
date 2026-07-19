import { readFileSync } from 'node:fs'
import type {
  BridgeChannelType,
  CliBridgeTaskCreateRequest,
  CliBridgeTaskUpdateRequest,
  ScheduledTaskDelivery,
  ScheduledTaskDeliveryTarget,
  ScheduledTaskExecutionTarget,
  ScheduledTaskResultVerifier,
  ScheduledTaskSchedule,
  ThinkingLevel,
} from '@kila/shared'
import { connectToBridgeOrThrow } from '../client/bridge-client'
import type { ParsedArgs } from '../args'
import { getBooleanFlag, getStringFlag, getStringFlags } from '../args'
import { printHint, withHint } from '../format/hints'
import { printJson } from '../format/json-output'
import { formatRelativeTime, formatTable, truncate } from '../format/tables'

function parseCsv(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

export function parseThinkingLevel(value: string | undefined): ThinkingLevel | undefined {
  if (!value) return undefined
  if (value === 'none' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') {
    return value
  }
  throw new Error(`无效的 thinking level: ${value}`)
}

export function parseHistoryTurns(value: string | undefined): number | 'infinite' | undefined {
  if (!value) return undefined
  if (value === 'infinite') return 'infinite'
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`无效的 history turns: ${value}`)
  }
  return Math.trunc(parsed)
}

function parsePrompt(args: ParsedArgs): string {
  const filePath = getStringFlag(args, 'prompt-file')
  if (filePath) {
    return readFileSync(filePath, 'utf-8').trim()
  }
  const prompt = getStringFlag(args, 'prompt') ?? args.positionals.join(' ').trim()
  if (!prompt) {
    throw new Error(withHint(
      '缺少任务 prompt，请使用 --prompt 或 --prompt-file。',
      '`kila task create --name <name> --prompt "..." ...`',
    ))
  }
  return prompt
}

function parseSchedule(args: ParsedArgs): ScheduledTaskSchedule | undefined {
  const at = getStringFlag(args, 'at')
  const every = getStringFlag(args, 'every')
  const cron = getStringFlag(args, 'cron')
  const loop = getBooleanFlag(args, 'loop')

  const picks = [Boolean(at), Boolean(every), Boolean(cron), loop].filter(Boolean).length
  if (picks === 0) return undefined
  if (picks > 1) {
    throw new Error('只能使用一种 schedule：--at / --every / --cron / --loop')
  }

  if (at) {
    return { kind: 'at', at }
  }
  if (every) {
    const minutes = Number(every)
    if (!Number.isFinite(minutes) || minutes <= 0) {
      throw new Error('--every 必须是正整数分钟')
    }
    return { kind: 'every', minutes: Math.trunc(minutes) }
  }
  if (cron) {
    return { kind: 'cron', expr: cron, tz: getStringFlag(args, 'tz') }
  }
  return { kind: 'loop' }
}

function parseExecutionTarget(args: ParsedArgs, sessionId?: string): ScheduledTaskExecutionTarget | undefined {
  if (sessionId) {
    return {
      kind: 'single_session',
      sessionId,
    }
  }

  const cwd = getStringFlag(args, 'cwd')
  if (!cwd) return undefined
  return {
    kind: 'new_session',
    projectPath: cwd,
  }
}

function parseDelivery(args: ParsedArgs): ScheduledTaskDelivery | undefined {
  const targetValues = [
    ...getStringFlags(args, 'bridge-target'),
    ...getStringFlags(args, 'bridge-targets').flatMap((value) => value.split(',')),
  ].map((value) => value.trim()).filter(Boolean)
  const endpointKey = getStringFlag(args, 'bridge-endpoint')
  const channelType = getStringFlag(args, 'bridge-channel')

  if (targetValues.length > 0) {
    if (endpointKey || channelType) {
      throw new Error('不能同时使用 --bridge-target/--bridge-targets 和旧的 --bridge-endpoint/--bridge-channel')
    }

    const targets = targetValues.map(parseBridgeTarget)
    return {
      kind: 'bridge_bindings',
      targets,
      failurePolicy: parseDeliveryFailurePolicy(args),
    }
  }

  if (!endpointKey && !channelType) return undefined
  if (!endpointKey || !channelType) {
    throw new Error('bridge 投递需要同时提供 --bridge-endpoint 和 --bridge-channel')
  }
  const parsedChannelType = parseBridgeChannel(channelType)
  return {
    kind: 'bridge_binding',
    endpointKey,
    channelType: parsedChannelType,
  }
}

function parseBridgeChannel(value: string): BridgeChannelType {
  if (value === 'telegram' || value === 'discord' || value === 'feishu' || value === 'wechat') {
    return value
  }
  throw new Error(`不支持的 bridge channel: ${value}`)
}

function parseBridgeTarget(value: string): ScheduledTaskDeliveryTarget {
  const separatorIndex = value.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    throw new Error(`无效的 bridge target: ${value}，格式应为 <telegram|discord|feishu|wechat>:<endpointKey>`)
  }
  return {
    channelType: parseBridgeChannel(value.slice(0, separatorIndex)),
    endpointKey: value.slice(separatorIndex + 1).trim(),
  }
}

function parseDeliveryFailurePolicy(args: ParsedArgs): 'all' | 'any' | undefined {
  const policy = getStringFlag(args, 'bridge-failure-policy')
  if (!policy) return undefined
  if (policy === 'all' || policy === 'any') return policy
  throw new Error(`不支持的 bridge failure policy: ${policy}`)
}

function parseResultVerifiers(args: ParsedArgs): ScheduledTaskResultVerifier[] | undefined {
  const raw = getStringFlag(args, 'verify')
  if (!raw?.trim()) return undefined

  const verifiers = raw.split(',').map((item) => item.trim()).filter(Boolean).map((item) => {
    if (item === 'reply_non_empty') return { kind: 'reply_non_empty' } satisfies ScheduledTaskResultVerifier
    if (item === 'bridge_delivery_success') return { kind: 'bridge_delivery_success' } satisfies ScheduledTaskResultVerifier
    if (item.startsWith('file:')) {
      return { kind: 'file_exists', path: item.slice('file:'.length) } satisfies ScheduledTaskResultVerifier
    }
    throw new Error(`不支持的 verifier: ${item}`)
  })

  return verifiers
}

async function buildTaskCreateRequest(args: ParsedArgs): Promise<CliBridgeTaskCreateRequest> {
  const client = await connectToBridgeOrThrow()
  const name = getStringFlag(args, 'name')
  if (!name?.trim()) {
    throw new Error('缺少任务名称 --name')
  }

  const channelRef = getStringFlag(args, 'channel')
  if (!channelRef) {
    throw new Error('缺少渠道 --channel')
  }

  const sessionRef = getStringFlag(args, 'session')
  const sessionId = sessionRef ? await client.resolveSessionId(sessionRef) : undefined
  const schedule = parseSchedule(args)
  if (!schedule) {
    throw new Error('缺少 schedule，请使用 --at / --every / --cron / --loop')
  }
  const executionTarget = parseExecutionTarget(args, sessionId)
  if (!executionTarget) {
    throw new Error('缺少执行目标，请使用 --session 或 --cwd')
  }

  return {
    name: name.trim(),
    prompt: parsePrompt(args),
    schedule,
    runMode: executionTarget.kind === 'single_session' ? 'single_session' : 'new_session',
    executionTarget,
    delivery: parseDelivery(args),
    channelId: await client.resolveChannelId(channelRef),
    modelId: getStringFlag(args, 'model'),
    thinkingLevel: parseThinkingLevel(getStringFlag(args, 'thinking')),
    historyTurns: parseHistoryTurns(getStringFlag(args, 'history-turns')),
    enabledToolIds: parseCsv(getStringFlag(args, 'tools')),
    additionalDirectories: parseCsv(getStringFlag(args, 'dirs')),
    resultVerifiers: parseResultVerifiers(args),
    permissionModeOverride: getStringFlag(args, 'permission-mode') as 'auto' | 'smart' | undefined,
    aiCanExit: getBooleanFlag(args, 'ai-can-exit'),
    notifyOnMissedRun: getBooleanFlag(args, 'notify-missed'),
  }
}

async function buildTaskUpdateRequest(args: ParsedArgs): Promise<CliBridgeTaskUpdateRequest> {
  const client = await connectToBridgeOrThrow()
  const patch: CliBridgeTaskUpdateRequest = {}
  const name = getStringFlag(args, 'name')
  if (name?.trim()) patch.name = name.trim()

  const promptFile = getStringFlag(args, 'prompt-file')
  const prompt = getStringFlag(args, 'prompt')
  if (promptFile) patch.prompt = readFileSync(promptFile, 'utf-8').trim()
  else if (prompt) patch.prompt = prompt

  const schedule = parseSchedule(args)
  if (schedule) patch.schedule = schedule

  const sessionRef = getStringFlag(args, 'session')
  const sessionId = sessionRef ? await client.resolveSessionId(sessionRef) : undefined
  const executionTarget = parseExecutionTarget(args, sessionId)
  if (executionTarget) {
    patch.executionTarget = executionTarget
    patch.runMode = executionTarget.kind === 'single_session' ? 'single_session' : 'new_session'
  }

  const channelRef = getStringFlag(args, 'channel')
  if (channelRef) patch.channelId = await client.resolveChannelId(channelRef)
  const modelId = getStringFlag(args, 'model')
  if (modelId) patch.modelId = modelId

  const thinking = parseThinkingLevel(getStringFlag(args, 'thinking'))
  if (thinking) patch.thinkingLevel = thinking

  const historyTurns = parseHistoryTurns(getStringFlag(args, 'history-turns'))
  if (typeof historyTurns !== 'undefined') patch.historyTurns = historyTurns

  const tools = parseCsv(getStringFlag(args, 'tools'))
  if (tools) patch.enabledToolIds = tools
  const dirs = parseCsv(getStringFlag(args, 'dirs'))
  if (dirs) patch.additionalDirectories = dirs

  const delivery = parseDelivery(args)
  if (delivery) patch.delivery = delivery
  const verifiers = parseResultVerifiers(args)
  if (verifiers) patch.resultVerifiers = verifiers

  const permissionMode = getStringFlag(args, 'permission-mode')
  if (permissionMode) {
    patch.permissionModeOverride = permissionMode as 'auto' | 'smart'
  }
  if (args.flags.has('ai-can-exit')) patch.aiCanExit = getBooleanFlag(args, 'ai-can-exit')
  if (args.flags.has('notify-missed')) patch.notifyOnMissedRun = getBooleanFlag(args, 'notify-missed')

  return patch
}

export async function runTaskListCommand(args: ParsedArgs): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const response = await client.listTasks()

  if (asJson) {
    printJson(response)
    return 0
  }

  const table = formatTable(
    ['ID', 'NAME', 'STATUS', 'SCHEDULE', 'UPDATED'],
    response.tasks.map((task) => [
      task.id.slice(0, 8),
      truncate(task.name, 24),
      task.status,
      task.schedule.kind === 'cron'
        ? truncate(task.schedule.expr, 18)
        : task.schedule.kind === 'every'
          ? `every ${task.schedule.minutes}m`
          : task.schedule.kind === 'at'
            ? truncate(task.schedule.at, 18)
            : 'loop',
      formatRelativeTime(task.updatedAt),
    ]),
  )
  process.stdout.write(`${table}\n`)
  printHint('运行 `kila task show <id>` 查看详情，或 `kila task history <id>` 查看运行历史')
  return 0
}

export async function runTaskShowCommand(args: ParsedArgs): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const taskRef = args.positionals[0]
  if (!taskRef) throw new Error(withHint(
    '缺少 task id 或前缀。',
    '`kila task list` 查看可用任务',
  ))
  const taskId = await client.resolveTaskId(taskRef)
  const response = await client.getTask(taskId)

  if (asJson) {
    printJson(response)
    return 0
  }

  const { task } = response
  process.stdout.write(`ID: ${task.id}\n`)
  process.stdout.write(`Name: ${task.name}\n`)
  process.stdout.write(`Status: ${task.status}\n`)
  process.stdout.write(`Channel: ${task.channelId}\n`)
  process.stdout.write(`Model: ${task.modelId ?? '-'}\n`)
  process.stdout.write(`Run mode: ${task.runMode}\n`)
  process.stdout.write(`Schedule: ${JSON.stringify(task.schedule)}\n`)
  process.stdout.write(`Updated: ${new Date(task.updatedAt).toISOString()}\n`)
  if (task.lastError) {
    process.stdout.write(`Last error: ${task.lastError}\n`)
    printHint(`运行 \`kila task history ${task.id}\` 或 \`kila task runtime\` 继续排查`)
    return 0
  }
  printHint(`运行 \`kila task history ${task.id}\` 查看运行历史`)
  return 0
}

export async function runTaskCreateCommand(args: ParsedArgs): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const response = await client.createTask(await buildTaskCreateRequest(args))

  if (asJson) {
    printJson(response)
    return 0
  }

  process.stdout.write(`[kila] created task ${response.task.id} (${response.task.name})\n`)
  printHint(`运行 \`kila task show ${response.task.id}\` 检查配置，或 \`kila task run ${response.task.id}\` 立即触发`)
  return 0
}

export async function runTaskUpdateCommand(args: ParsedArgs): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const taskRef = args.positionals[0]
  if (!taskRef) throw new Error(withHint(
    '缺少 task id 或前缀。',
    '`kila task list` 查看可用任务',
  ))
  const taskId = await client.resolveTaskId(taskRef)
  const response = await client.updateTask(taskId, await buildTaskUpdateRequest({
    ...args,
    positionals: args.positionals.slice(1),
  }))

  if (asJson) {
    printJson(response)
    return 0
  }

  process.stdout.write(`[kila] updated task ${response.task.id}\n`)
  printHint(`运行 \`kila task show ${response.task.id}\` 验证更新结果`)
  return 0
}

async function runTaskActionCommand(
  action: 'start' | 'stop' | 'run' | 'delete',
  args: ParsedArgs,
): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const taskRef = args.positionals[0]
  if (!taskRef) throw new Error(withHint(
    '缺少 task id 或前缀。',
    '`kila task list` 查看可用任务',
  ))
  const taskId = await client.resolveTaskId(taskRef)

  if (action === 'delete' && !getBooleanFlag(args, 'yes')) {
    throw new Error(withHint(
      '删除 task 需要显式传入 --yes。',
      '`kila task delete <id> --yes`',
    ))
  }

  if (action === 'start') {
    const response = await client.startTask(taskId)
    if (asJson) printJson(response)
    else {
      process.stdout.write(`[kila] started task ${response.task.id}\n`)
      printHint(`运行 \`kila task history ${response.task.id}\` 查看后续运行结果`)
    }
    return 0
  }
  if (action === 'stop') {
    const response = await client.stopTask(taskId)
    if (asJson) printJson(response)
    else {
      process.stdout.write(`[kila] stopped task ${response.task.id}\n`)
      printHint(`运行 \`kila task show ${response.task.id}\` 确认状态`)
    }
    return 0
  }
  if (action === 'run') {
    const response = await client.runTask(taskId)
    if (asJson) printJson(response)
    else {
      process.stdout.write(`[kila] triggered task ${response.task.id}\n`)
      printHint(`运行 \`kila task history ${response.task.id}\` 查看本次执行结果`)
    }
    return 0
  }

  await client.deleteTask(taskId)
  if (asJson) printJson({ taskId, deleted: true })
  else process.stdout.write(`[kila] deleted task ${taskId}\n`)
  return 0
}

export function runTaskStartCommand(args: ParsedArgs): Promise<number> {
  return runTaskActionCommand('start', args)
}

export function runTaskStopCommand(args: ParsedArgs): Promise<number> {
  return runTaskActionCommand('stop', args)
}

export function runTaskRunCommand(args: ParsedArgs): Promise<number> {
  return runTaskActionCommand('run', args)
}

export function runTaskDeleteCommand(args: ParsedArgs): Promise<number> {
  return runTaskActionCommand('delete', args)
}

export async function runTaskHistoryCommand(args: ParsedArgs): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const taskRef = args.positionals[0]
  if (!taskRef) throw new Error(withHint(
    '缺少 task id 或前缀。',
    '`kila task list` 查看可用任务',
  ))
  const limit = Number(getStringFlag(args, 'limit') ?? '20')
  const taskId = await client.resolveTaskId(taskRef)
  const response = await client.listTaskRuns(taskId, Number.isFinite(limit) && limit > 0 ? limit : 20)

  if (asJson) {
    printJson(response)
    return 0
  }

  const table = formatTable(
    ['RUN', 'OUTCOME', 'STARTED', 'DURATION', 'SESSION'],
    response.runs.map((run) => [
      run.id.slice(0, 8),
      run.outcome,
      formatRelativeTime(run.startedAt),
      `${run.durationMs}ms`,
      truncate(run.sessionId ?? '-', 12),
    ]),
  )
  process.stdout.write(`${table}\n`)
  printHint('运行 `kila task runtime` 检查调度器健康状态')
  return 0
}

export async function runTaskRuntimeCommand(args: ParsedArgs): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const response = await client.getTaskRuntime()

  if (asJson) {
    printJson(response)
    return 0
  }

  process.stdout.write(`running: ${response.runtime.running ? 'yes' : 'no'}\n`)
  process.stdout.write(`active runs: ${response.runtime.activeRunCount}\n`)
  process.stdout.write(`watchdog: ${response.runtime.watchdogState}\n`)
  process.stdout.write(`reason: ${response.runtime.watchdogReason}\n`)
  printHint('如需排查具体任务，运行 `kila task list` 或 `kila task history <id>`')
  return 0
}
