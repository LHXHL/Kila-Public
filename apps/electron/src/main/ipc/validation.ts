import type {
  BridgeBindingUpdateInput,
  BridgeChannelType,
  BridgeConfigInput,
  FeishuBotConfigInput,
  AgentAttachDirectoryInput,
  AgentSaveFilesInput,
  AgentSaveWorkspaceFilesInput,
  AskUserResponse,
  GetTaskOutputInput,
  KilaPermissionMode,
  McpServerEntry,
  PermissionResponse,
  ScheduledTaskCreateInput,
  ScheduledTaskDelivery,
  ScheduledTaskExecutionTarget,
  ScheduledTaskResultVerifier,
  ScheduledTaskRunMode,
  ScheduledTaskSchedule,
  ScheduledTaskUpdateInput,
  SessionMessagesPageInput,
  SessionProjectFilesSaveInput,
  SessionSearchInput,
  StopTaskInput,
  ThinkingLevel,
  WeChatBridgeStartLoginInput,
  WorkspaceAttachDirectoryInput,
  WorkspaceMcpConfig,
} from '@kila/shared'
import type {
  DesktopNotificationInput,
  OpenSessionInMainWindowInput,
  SettingsTab,
} from '../../types'

const BRIDGE_CHANNELS = new Set<BridgeChannelType>([
  'telegram',
  'discord',
  'feishu',
  'wechat',
])
const THINKING_LEVELS = new Set<ThinkingLevel>([
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
])
const PERMISSION_MODES = new Set<KilaPermissionMode>(['auto', 'smart'])
const RUN_MODES = new Set<ScheduledTaskRunMode>([
  'new_session',
  'single_session',
])
const MCP_TRANSPORT_TYPES = new Set<McpServerEntry['type']>([
  'stdio',
  'http',
  'sse',
])
const PERMISSION_BEHAVIORS = new Set<PermissionResponse['behavior']>([
  'allow',
  'deny',
])
const TASK_TYPES = new Set<StopTaskInput['type']>(['agent', 'shell'])

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`)
  }
  return value as Record<string, unknown>
}

export function assertString(
  value: unknown,
  label: string,
  options: { optional?: boolean; max?: number; nonEmpty?: boolean } = {}
): string {
  if (value === undefined || value === null) {
    if (options.optional) return ''
    throw new Error(`${label} 必须是字符串`)
  }
  if (typeof value !== 'string') {
    throw new Error(`${label} 必须是字符串`)
  }
  if (options.nonEmpty && value.trim() === '') {
    throw new Error(`${label} 不能为空`)
  }
  if (options.max !== undefined && value.length > options.max) {
    throw new Error(`${label} 过长`)
  }
  return value
}

export function assertOptionalString(
  value: unknown,
  label: string,
  max = 4096
): string | undefined {
  if (value === undefined || value === null) return undefined
  return assertString(value, label, { max })
}

export function assertBoolean(
  value: unknown,
  label: string,
  fallback?: boolean
): boolean {
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback
    throw new Error(`${label} 必须是布尔值`)
  }
  if (typeof value !== 'boolean') {
    throw new Error(`${label} 必须是布尔值`)
  }
  return value
}

export function assertOptionalBoolean(
  value: unknown,
  label: string
): boolean | undefined {
  if (value === undefined || value === null) return undefined
  return assertBoolean(value, label)
}

export function assertNumber(
  value: unknown,
  label: string,
  options: {
    optional?: boolean
    min?: number
    max?: number
    integer?: boolean
  } = {}
): number {
  if (value === undefined || value === null) {
    if (options.optional) return 0
    throw new Error(`${label} 必须是数字`)
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} 必须是有限数字`)
  }
  if (options.integer && !Number.isInteger(value)) {
    throw new Error(`${label} 必须是整数`)
  }
  if (options.min !== undefined && value < options.min) {
    throw new Error(`${label} 不能小于 ${options.min}`)
  }
  if (options.max !== undefined && value > options.max) {
    throw new Error(`${label} 不能大于 ${options.max}`)
  }
  return value
}

export function assertOptionalNumber(
  value: unknown,
  label: string,
  options: { min?: number; max?: number; integer?: boolean } = {}
): number | undefined {
  if (value === undefined || value === null) return undefined
  return assertNumber(value, label, options)
}

export function assertStringArray(
  value: unknown,
  label: string,
  options: {
    optional?: boolean
    maxItems?: number
    maxItemLength?: number
  } = {}
): string[] {
  if (value === undefined || value === null) {
    if (options.optional) return []
    throw new Error(`${label} 必须是字符串数组`)
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} 必须是字符串数组`)
  }
  if (options.maxItems !== undefined && value.length > options.maxItems) {
    throw new Error(`${label} 条目过多`)
  }
  return value.map((item, index) =>
    assertString(item, `${label}[${index}]`, {
      max: options.maxItemLength ?? 4096,
    })
  )
}

function optionalStringArray(
  value: unknown,
  label: string,
  maxItems = 200
): string[] | undefined {
  if (value === undefined || value === null) return undefined
  return assertStringArray(value, label, { maxItems, maxItemLength: 4096 })
}

function assertEnum<T extends string>(
  value: unknown,
  label: string,
  values: Set<T>
): T {
  if (typeof value !== 'string' || !values.has(value as T)) {
    throw new Error(`${label} 无效`)
  }
  return value as T
}

function assertOptionalThinkingLevel(
  value: unknown
): ThinkingLevel | undefined {
  if (value === undefined || value === null) return undefined
  return assertEnum(value, 'thinkingLevel', THINKING_LEVELS)
}

function assertOptionalPermissionMode(
  value: unknown
): KilaPermissionMode | undefined {
  if (value === undefined || value === null) return undefined
  return assertEnum(value, 'permissionModeOverride', PERMISSION_MODES)
}

function validateDefaultSession(value: unknown) {
  if (value === undefined || value === null) return undefined
  const input = assertRecord(value, 'defaultSession')
  const historyTurns =
    input.historyTurns === 'infinite'
      ? 'infinite'
      : assertOptionalNumber(
          input.historyTurns,
          'defaultSession.historyTurns',
          { min: 0, max: 500, integer: true }
        )
  return {
    channelId: assertOptionalString(
      input.channelId,
      'defaultSession.channelId',
      256
    ),
    modelId: assertOptionalString(input.modelId, 'defaultSession.modelId', 256),
    thinkingLevel: assertOptionalThinkingLevel(input.thinkingLevel),
    historyTurns: historyTurns as number | 'infinite' | undefined,
    enabledToolIds: optionalStringArray(
      input.enabledToolIds,
      'defaultSession.enabledToolIds',
      200
    ),
  }
}

function validateChannelSessionOverride(value: unknown, label: string) {
  if (value === undefined || value === null) return undefined
  const input = assertRecord(value, label)
  return {
    channelId: assertOptionalString(input.channelId, `${label}.channelId`, 256),
    modelId: assertOptionalString(input.modelId, `${label}.modelId`, 256),
    projectPath: assertOptionalString(
      input.projectPath,
      `${label}.projectPath`,
      2048
    ),
  }
}

export function validateFeishuBotConfigInput(
  value: unknown
): FeishuBotConfigInput {
  const input = assertRecord(value, 'feishu bot')
  return {
    id: assertOptionalString(input.id, 'feishu bot.id', 128),
    name: assertString(input.name, 'feishu bot.name', {
      nonEmpty: true,
      max: 128,
    }),
    enabled: assertBoolean(input.enabled, 'feishu bot.enabled'),
    appId: assertString(input.appId, 'feishu bot.appId', { max: 512 }),
    appSecret: assertString(input.appSecret, 'feishu bot.appSecret', {
      max: 8192,
    }),
    defaultSession: validateChannelSessionOverride(
      input.defaultSession,
      'feishu bot.defaultSession'
    ),
  }
}

function validateMcpServerEntry(value: unknown, label: string): McpServerEntry {
  const input = assertRecord(value, label)
  const type = assertEnum(input.type, `${label}.type`, MCP_TRANSPORT_TYPES)
  const entry: McpServerEntry = {
    type,
    enabled: assertBoolean(input.enabled, `${label}.enabled`, false),
    command: assertOptionalString(input.command, `${label}.command`, 4096),
    args: optionalStringArray(input.args, `${label}.args`, 200),
    env: undefined,
    url: assertOptionalString(input.url, `${label}.url`, 4096),
    headers: undefined,
    timeout: assertOptionalNumber(input.timeout, `${label}.timeout`, {
      min: 1,
      max: 600,
      integer: true,
    }),
    isBuiltin: assertOptionalBoolean(input.isBuiltin, `${label}.isBuiltin`),
  }

  if (input.env !== undefined) {
    const env = assertRecord(input.env, `${label}.env`)
    entry.env = Object.fromEntries(
      Object.entries(env).map(([key, val]) => [
        assertString(key, `${label}.env key`, { nonEmpty: true, max: 256 }),
        assertString(val, `${label}.env.${key}`, { max: 8192 }),
      ])
    )
  }

  if (input.headers !== undefined) {
    const headers = assertRecord(input.headers, `${label}.headers`)
    entry.headers = Object.fromEntries(
      Object.entries(headers).map(([key, val]) => [
        assertString(key, `${label}.headers key`, { nonEmpty: true, max: 256 }),
        assertString(val, `${label}.headers.${key}`, { max: 8192 }),
      ])
    )
  }

  return entry
}

export function validateWorkspaceMcpConfig(value: unknown): WorkspaceMcpConfig {
  const input = assertRecord(value, 'MCP 配置')
  const servers = assertRecord(input.servers, 'MCP 配置.servers')
  return {
    servers: Object.fromEntries(
      Object.entries(servers).map(([name, entry]) => [
        assertString(name, 'MCP server name', { nonEmpty: true, max: 128 }),
        validateMcpServerEntry(entry, `MCP server ${name}`),
      ])
    ),
  }
}

export function validateBridgeChannel(value: unknown): BridgeChannelType {
  return assertEnum(value, 'bridge channel', BRIDGE_CHANNELS)
}

export function validateBridgeConfigInput(value: unknown): BridgeConfigInput {
  const input = assertRecord(value, 'Bridge 配置')
  return {
    enabled: assertBoolean(input.enabled, 'enabled'),
    autoStart: assertBoolean(input.autoStart, 'autoStart'),
    defaultSession: validateDefaultSession(input.defaultSession),
    telegram:
      input.telegram === undefined
        ? undefined
        : {
            ...assertRecord(input.telegram, 'telegram'),
            enabled: assertOptionalBoolean(
              assertRecord(input.telegram, 'telegram').enabled,
              'telegram.enabled'
            ),
            botToken: assertOptionalString(
              assertRecord(input.telegram, 'telegram').botToken,
              'telegram.botToken',
              8192
            ),
            allowedUserIds: optionalStringArray(
              assertRecord(input.telegram, 'telegram').allowedUserIds,
              'telegram.allowedUserIds',
              500
            ),
            maxInboundFileBytes: assertOptionalNumber(
              assertRecord(input.telegram, 'telegram').maxInboundFileBytes,
              'telegram.maxInboundFileBytes',
              { min: 0, max: 1024 * 1024 * 1024, integer: true }
            ),
            defaultSession: validateChannelSessionOverride(
              assertRecord(input.telegram, 'telegram').defaultSession,
              'telegram.defaultSession'
            ),
          },
    discord:
      input.discord === undefined
        ? undefined
        : {
            ...assertRecord(input.discord, 'discord'),
            enabled: assertOptionalBoolean(
              assertRecord(input.discord, 'discord').enabled,
              'discord.enabled'
            ),
            botToken: assertOptionalString(
              assertRecord(input.discord, 'discord').botToken,
              'discord.botToken',
              8192
            ),
            allowedUserIds: optionalStringArray(
              assertRecord(input.discord, 'discord').allowedUserIds,
              'discord.allowedUserIds',
              500
            ),
            allowedChannelIds: optionalStringArray(
              assertRecord(input.discord, 'discord').allowedChannelIds,
              'discord.allowedChannelIds',
              500
            ),
            allowedGuildIds: optionalStringArray(
              assertRecord(input.discord, 'discord').allowedGuildIds,
              'discord.allowedGuildIds',
              500
            ),
            requireMention: assertOptionalBoolean(
              assertRecord(input.discord, 'discord').requireMention,
              'discord.requireMention'
            ),
            maxInboundFileBytes: assertOptionalNumber(
              assertRecord(input.discord, 'discord').maxInboundFileBytes,
              'discord.maxInboundFileBytes',
              { min: 0, max: 1024 * 1024 * 1024, integer: true }
            ),
            defaultSession: validateChannelSessionOverride(
              assertRecord(input.discord, 'discord').defaultSession,
              'discord.defaultSession'
            ),
          },
    feishu:
      input.feishu === undefined
        ? undefined
        : {
            ...assertRecord(input.feishu, 'feishu'),
            enabled: assertOptionalBoolean(
              assertRecord(input.feishu, 'feishu').enabled,
              'feishu.enabled'
            ),
            appId: assertOptionalString(
              assertRecord(input.feishu, 'feishu').appId,
              'feishu.appId',
              512
            ),
            appSecret: assertOptionalString(
              assertRecord(input.feishu, 'feishu').appSecret,
              'feishu.appSecret',
              8192
            ),
            bots: Array.isArray(assertRecord(input.feishu, 'feishu').bots)
              ? (assertRecord(input.feishu, 'feishu').bots as unknown[]).map(
                  validateFeishuBotConfigInput
                )
              : undefined,
            sessionMirror:
              assertRecord(input.feishu, 'feishu').sessionMirror === undefined
                ? undefined
                : (() => {
                    const mirror = assertRecord(
                      assertRecord(input.feishu, 'feishu').sessionMirror,
                      'feishu.sessionMirror'
                    )
                    const mode = assertEnum(
                      mirror.mode,
                      'feishu.sessionMirror.mode',
                      new Set(['off', 'stream'] as const)
                    )
                    return {
                      mode,
                      botId: assertOptionalString(
                        mirror.botId,
                        'feishu.sessionMirror.botId',
                        128
                      ),
                    }
                  })(),
            allowP2P: assertOptionalBoolean(
              assertRecord(input.feishu, 'feishu').allowP2P,
              'feishu.allowP2P'
            ),
            allowGroup: assertOptionalBoolean(
              assertRecord(input.feishu, 'feishu').allowGroup,
              'feishu.allowGroup'
            ),
            requireMention: assertOptionalBoolean(
              assertRecord(input.feishu, 'feishu').requireMention,
              'feishu.requireMention'
            ),
            streamingCards: assertOptionalBoolean(
              assertRecord(input.feishu, 'feishu').streamingCards,
              'feishu.streamingCards'
            ),
            quietWindowMs: assertOptionalNumber(
              assertRecord(input.feishu, 'feishu').quietWindowMs,
              'feishu.quietWindowMs',
              { min: 0, max: 600000, integer: true }
            ),
            maxConcurrent: assertOptionalNumber(
              assertRecord(input.feishu, 'feishu').maxConcurrent,
              'feishu.maxConcurrent',
              { min: 1, max: 100, integer: true }
            ),
            defaultSession: validateChannelSessionOverride(
              assertRecord(input.feishu, 'feishu').defaultSession,
              'feishu.defaultSession'
            ),
          },
    wechat:
      input.wechat === undefined
        ? undefined
        : {
            ...assertRecord(input.wechat, 'wechat'),
            enabled: assertOptionalBoolean(
              assertRecord(input.wechat, 'wechat').enabled,
              'wechat.enabled'
            ),
            baseUrl: assertOptionalString(
              assertRecord(input.wechat, 'wechat').baseUrl,
              'wechat.baseUrl',
              4096
            ),
            accountIds: optionalStringArray(
              assertRecord(input.wechat, 'wechat').accountIds,
              'wechat.accountIds',
              500
            ),
            allowedUserIds: optionalStringArray(
              assertRecord(input.wechat, 'wechat').allowedUserIds,
              'wechat.allowedUserIds',
              500
            ),
            aggregateWindowMs: assertOptionalNumber(
              assertRecord(input.wechat, 'wechat').aggregateWindowMs,
              'wechat.aggregateWindowMs',
              { min: 0, max: 600000, integer: true }
            ),
            deferredOutboundTtlMs: assertOptionalNumber(
              assertRecord(input.wechat, 'wechat').deferredOutboundTtlMs,
              'wechat.deferredOutboundTtlMs',
              { min: 0, max: 86400000, integer: true }
            ),
            contextTtlMs: assertOptionalNumber(
              assertRecord(input.wechat, 'wechat').contextTtlMs,
              'wechat.contextTtlMs',
              { min: 0, max: 86400000, integer: true }
            ),
            defaultSession: validateChannelSessionOverride(
              assertRecord(input.wechat, 'wechat').defaultSession,
              'wechat.defaultSession'
            ),
          },
  }
}

export function validateBridgeBindingUpdateInput(
  value: unknown
): BridgeBindingUpdateInput {
  const input = assertRecord(value, 'Bridge binding')
  return {
    endpointKey: assertString(input.endpointKey, 'endpointKey', {
      nonEmpty: true,
      max: 512,
    }),
    sessionId: assertString(input.sessionId, 'sessionId', {
      nonEmpty: true,
      max: 128,
    }),
    projectPath: assertOptionalString(input.projectPath, 'projectPath', 2048),
  }
}

function validateSchedule(value: unknown): ScheduledTaskSchedule {
  const input = assertRecord(value, 'schedule')
  switch (input.kind) {
    case 'at':
      return {
        kind: 'at',
        at: assertString(input.at, 'schedule.at', { nonEmpty: true, max: 128 }),
      }
    case 'every':
      return {
        kind: 'every',
        minutes: assertNumber(input.minutes, 'schedule.minutes', {
          min: 1,
          max: 525600,
          integer: true,
        }),
        startAt: assertOptionalString(input.startAt, 'schedule.startAt', 128),
      }
    case 'cron':
      return {
        kind: 'cron',
        expr: assertString(input.expr, 'schedule.expr', {
          nonEmpty: true,
          max: 256,
        }),
        tz: assertOptionalString(input.tz, 'schedule.tz', 128),
      }
    case 'loop':
      return { kind: 'loop' }
    default:
      throw new Error('schedule.kind 无效')
  }
}

function validateExecutionTarget(value: unknown): ScheduledTaskExecutionTarget {
  const input = assertRecord(value, 'executionTarget')
  if (input.kind === 'new_session') {
    return {
      kind: 'new_session',
      projectPath: assertString(
        input.projectPath,
        'executionTarget.projectPath',
        { nonEmpty: true, max: 4096 }
      ),
      titleTemplate: assertOptionalString(
        input.titleTemplate,
        'executionTarget.titleTemplate',
        512
      ),
    }
  }
  if (input.kind === 'single_session') {
    return {
      kind: 'single_session',
      sessionId: assertString(input.sessionId, 'executionTarget.sessionId', {
        nonEmpty: true,
        max: 128,
      }),
    }
  }
  throw new Error('executionTarget.kind 无效')
}

function validateDelivery(value: unknown): ScheduledTaskDelivery | undefined {
  if (value === undefined || value === null) return undefined
  const input = assertRecord(value, 'delivery')
  if (input.kind === 'none') return { kind: 'none' }
  if (input.kind === 'bridge_binding') {
    return {
      kind: 'bridge_binding',
      endpointKey: assertString(input.endpointKey, 'delivery.endpointKey', {
        nonEmpty: true,
        max: 512,
      }),
      channelType: validateBridgeChannel(input.channelType),
    }
  }
  if (input.kind === 'bridge_bindings') {
    const targets = Array.isArray(input.targets) ? input.targets : []
    if (targets.length > 100) throw new Error('delivery.targets 条目过多')
    return {
      kind: 'bridge_bindings',
      targets: targets.map((target, index) => {
        const record = assertRecord(target, `delivery.targets[${index}]`)
        return {
          endpointKey: assertString(
            record.endpointKey,
            `delivery.targets[${index}].endpointKey`,
            { nonEmpty: true, max: 512 }
          ),
          channelType: validateBridgeChannel(record.channelType),
        }
      }),
      failurePolicy:
        input.failurePolicy === 'any'
          ? 'any'
          : input.failurePolicy === 'all'
            ? 'all'
            : undefined,
    }
  }
  throw new Error('delivery.kind 无效')
}

function validateResultVerifiers(
  value: unknown
): ScheduledTaskResultVerifier[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) throw new Error('resultVerifiers 必须是数组')
  if (value.length > 20) throw new Error('resultVerifiers 条目过多')
  return value.map((item, index) => {
    const input = assertRecord(item, `resultVerifiers[${index}]`)
    if (input.kind === 'reply_non_empty') return { kind: 'reply_non_empty' }
    if (input.kind === 'file_exists') {
      return {
        kind: 'file_exists',
        path: assertString(input.path, `resultVerifiers[${index}].path`, {
          nonEmpty: true,
          max: 4096,
        }),
      }
    }
    if (input.kind === 'bridge_delivery_success')
      return { kind: 'bridge_delivery_success' }
    throw new Error(`resultVerifiers[${index}].kind 无效`)
  })
}

export function validateScheduledTaskCreateInput(
  value: unknown
): ScheduledTaskCreateInput {
  const input = assertRecord(value, 'scheduled task')
  const historyTurns =
    input.historyTurns === 'infinite'
      ? 'infinite'
      : assertOptionalNumber(input.historyTurns, 'historyTurns', {
          min: 0,
          max: 500,
          integer: true,
        })
  return {
    name: assertString(input.name, 'name', { nonEmpty: true, max: 200 }),
    prompt: assertString(input.prompt, 'prompt', {
      nonEmpty: true,
      max: 200000,
    }),
    schedule: validateSchedule(input.schedule),
    runMode: assertEnum(input.runMode, 'runMode', RUN_MODES),
    executionTarget: validateExecutionTarget(input.executionTarget),
    delivery: validateDelivery(input.delivery),
    channelId: assertString(input.channelId, 'channelId', {
      nonEmpty: true,
      max: 256,
    }),
    modelId: assertOptionalString(input.modelId, 'modelId', 256),
    thinkingLevel: assertOptionalThinkingLevel(input.thinkingLevel),
    historyTurns,
    enabledToolIds: optionalStringArray(
      input.enabledToolIds,
      'enabledToolIds',
      200
    ),
    additionalDirectories: optionalStringArray(
      input.additionalDirectories,
      'additionalDirectories',
      200
    ),
    resultVerifiers: validateResultVerifiers(input.resultVerifiers),
    permissionModeOverride: assertOptionalPermissionMode(
      input.permissionModeOverride
    ),
    aiCanExit: assertOptionalBoolean(input.aiCanExit, 'aiCanExit'),
    notifyOnMissedRun: assertOptionalBoolean(
      input.notifyOnMissedRun,
      'notifyOnMissedRun'
    ),
  }
}

export function validateScheduledTaskUpdateInput(
  value: unknown
): ScheduledTaskUpdateInput {
  const input = assertRecord(value, 'scheduled task patch')
  return {
    name:
      input.name === undefined
        ? undefined
        : assertString(input.name, 'name', { nonEmpty: true, max: 200 }),
    prompt:
      input.prompt === undefined
        ? undefined
        : assertString(input.prompt, 'prompt', { nonEmpty: true, max: 200000 }),
    schedule:
      input.schedule === undefined
        ? undefined
        : validateSchedule(input.schedule),
    runMode:
      input.runMode === undefined
        ? undefined
        : assertEnum(input.runMode, 'runMode', RUN_MODES),
    executionTarget:
      input.executionTarget === undefined
        ? undefined
        : validateExecutionTarget(input.executionTarget),
    delivery: validateDelivery(input.delivery),
    channelId:
      input.channelId === undefined
        ? undefined
        : assertString(input.channelId, 'channelId', {
            nonEmpty: true,
            max: 256,
          }),
    modelId: assertOptionalString(input.modelId, 'modelId', 256),
    thinkingLevel: assertOptionalThinkingLevel(input.thinkingLevel),
    historyTurns:
      input.historyTurns === 'infinite'
        ? 'infinite'
        : assertOptionalNumber(input.historyTurns, 'historyTurns', {
            min: 0,
            max: 500,
            integer: true,
          }),
    enabledToolIds: optionalStringArray(
      input.enabledToolIds,
      'enabledToolIds',
      200
    ),
    additionalDirectories: optionalStringArray(
      input.additionalDirectories,
      'additionalDirectories',
      200
    ),
    resultVerifiers: validateResultVerifiers(input.resultVerifiers),
    permissionModeOverride: assertOptionalPermissionMode(
      input.permissionModeOverride
    ),
    aiCanExit: assertOptionalBoolean(input.aiCanExit, 'aiCanExit'),
    notifyOnMissedRun: assertOptionalBoolean(
      input.notifyOnMissedRun,
      'notifyOnMissedRun'
    ),
  }
}

export function validateDesktopNotificationInput(
  value: unknown
): DesktopNotificationInput {
  const input = assertRecord(value, 'notification')
  return {
    title: assertString(input.title, 'notification.title', {
      nonEmpty: true,
      max: 120,
    }),
    body: assertString(input.body, 'notification.body', { max: 2000 }),
    sessionId: assertOptionalString(
      input.sessionId,
      'notification.sessionId',
      128
    ),
    taskId: assertOptionalString(input.taskId, 'notification.taskId', 128),
  }
}

export function validateOpenSessionInMainWindowInput(
  value: unknown
): OpenSessionInMainWindowInput {
  const input = assertRecord(value, 'open session request')
  return {
    sessionId: assertString(input.sessionId, 'sessionId', {
      nonEmpty: true,
      max: 128,
    }),
    title: assertString(input.title, 'title', { max: 512 }),
    pendingPrompt: assertOptionalString(
      input.pendingPrompt,
      'pendingPrompt',
      200000
    ),
  }
}

export function validateSettingsTab(value: unknown): SettingsTab | undefined {
  if (value === undefined || value === null) return undefined
  return assertString(value, 'settings tab', { max: 128 }) as SettingsTab
}

export function validateWeChatStartLoginInput(
  value: unknown
): WeChatBridgeStartLoginInput | undefined {
  if (value === undefined || value === null) return undefined
  const input = assertRecord(value, 'wechat start login input')
  return {
    accountId: assertOptionalString(input.accountId, 'accountId', 128),
    label: assertOptionalString(input.label, 'label', 200),
    botType: assertOptionalString(input.botType, 'botType', 128),
  }
}

export function validateFilePayloads(
  value: unknown,
  label: string
): Array<{ filename: string; data: string }> {
  if (!Array.isArray(value)) throw new Error(`${label}.files 必须是数组`)
  if (value.length > 50) throw new Error(`${label}.files 条目过多`)
  return value.map((item, index) => {
    const input = assertRecord(item, `${label}.files[${index}]`)
    const filename = assertString(
      input.filename,
      `${label}.files[${index}].filename`,
      { nonEmpty: true, max: 255 }
    )
    if (filename.includes('/') || filename.includes('\\')) {
      throw new Error(`${label}.files[${index}].filename 无效`)
    }
    return {
      filename,
      data: assertString(input.data, `${label}.files[${index}].data`, {
        max: 100 * 1024 * 1024,
      }),
    }
  })
}

export function assertSessionId(value: unknown, label = 'sessionId'): string {
  return assertString(value, label, { nonEmpty: true, max: 128 })
}

export function assertMessageId(value: unknown, label = 'messageId'): string {
  return assertString(value, label, { nonEmpty: true, max: 128 })
}

export function validateSessionMessagesPageInput(
  value: unknown
): SessionMessagesPageInput {
  const input = assertRecord(value, '消息分页输入')
  return {
    sessionId: assertSessionId(input.sessionId),
    offset: assertOptionalNumber(input.offset, 'offset', {
      min: 0,
      max: 10_000_000,
      integer: true,
    }),
    limit: assertOptionalNumber(input.limit, 'limit', {
      min: 1,
      max: 200,
      integer: true,
    }),
  }
}

export function validateSessionSearchInput(value: unknown): SessionSearchInput {
  const input = assertRecord(value, '会话搜索输入')
  return {
    query: assertString(input.query, 'query', { max: 1_000 }),
    limitPerType: assertOptionalNumber(input.limitPerType, 'limitPerType', {
      min: 1,
      max: 50,
      integer: true,
    }),
  }
}

export function validateSessionProjectFilesSaveInput(
  value: unknown
): SessionProjectFilesSaveInput {
  const input = assertRecord(value, '项目文件保存输入')
  return {
    sessionId: assertSessionId(input.sessionId),
    files: validateFilePayloads(input.files, '项目文件保存输入'),
  }
}

export function validatePermissionResponse(value: unknown): PermissionResponse {
  const input = assertRecord(value, 'permission response')
  const behavior = assertEnum(input.behavior, 'behavior', PERMISSION_BEHAVIORS)
  return {
    requestId: assertString(input.requestId, 'requestId', {
      nonEmpty: true,
      max: 128,
    }),
    behavior,
    alwaysAllow: assertBoolean(input.alwaysAllow, 'alwaysAllow', false),
  }
}

export function validateAskUserResponse(value: unknown): AskUserResponse {
  const input = assertRecord(value, 'ask user response')
  const answersInput = assertRecord(input.answers, 'answers')
  return {
    requestId: assertString(input.requestId, 'requestId', {
      nonEmpty: true,
      max: 128,
    }),
    answers: Object.fromEntries(
      Object.entries(answersInput).map(([key, val]) => [
        assertString(key, 'answer key', { nonEmpty: true, max: 64 }),
        assertString(val, `answers.${key}`, { max: 20000 }),
      ])
    ),
  }
}

export function validateGetTaskOutputInput(value: unknown): GetTaskOutputInput {
  const input = assertRecord(value, 'task output input')
  return {
    taskId: assertString(input.taskId, 'taskId', { nonEmpty: true, max: 128 }),
    block: assertOptionalBoolean(input.block, 'block'),
  }
}

export function validateStopTaskInput(value: unknown): StopTaskInput {
  const input = assertRecord(value, 'stop task input')
  return {
    sessionId: assertString(input.sessionId, 'sessionId', {
      nonEmpty: true,
      max: 128,
    }),
    taskId: assertString(input.taskId, 'taskId', { nonEmpty: true, max: 128 }),
    type: assertEnum(input.type, 'type', TASK_TYPES),
  }
}

export function validateAgentSaveFilesInput(
  value: unknown
): AgentSaveFilesInput {
  const input = assertRecord(value, 'save files input')
  return {
    workspaceSlug: assertString(input.workspaceSlug, 'workspaceSlug', {
      nonEmpty: true,
      max: 128,
    }),
    sessionId: assertString(input.sessionId, 'sessionId', {
      nonEmpty: true,
      max: 128,
    }),
    files: validateFilePayloads(input.files, 'save files input'),
  }
}

export function validateAgentSaveWorkspaceFilesInput(
  value: unknown
): AgentSaveWorkspaceFilesInput {
  const input = assertRecord(value, 'save workspace files input')
  return {
    workspaceSlug: assertString(input.workspaceSlug, 'workspaceSlug', {
      nonEmpty: true,
      max: 128,
    }),
    files: validateFilePayloads(input.files, 'save workspace files input'),
  }
}

export function validateAgentAttachDirectoryInput(
  value: unknown
): AgentAttachDirectoryInput {
  const input = assertRecord(value, 'attach directory input')
  return {
    sessionId: assertString(input.sessionId, 'sessionId', {
      nonEmpty: true,
      max: 128,
    }),
    directoryPath: assertString(input.directoryPath, 'directoryPath', {
      nonEmpty: true,
      max: 4096,
    }),
  }
}

export function validateWorkspaceAttachDirectoryInput(
  value: unknown
): WorkspaceAttachDirectoryInput {
  const input = assertRecord(value, 'workspace attach directory input')
  return {
    workspaceSlug: assertString(input.workspaceSlug, 'workspaceSlug', {
      nonEmpty: true,
      max: 128,
    }),
    directoryPath: assertString(input.directoryPath, 'directoryPath', {
      nonEmpty: true,
      max: 4096,
    }),
  }
}
