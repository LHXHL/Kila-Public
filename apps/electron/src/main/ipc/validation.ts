import type {
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
  WorkspaceAttachDirectoryInput,
  WorkspaceMcpConfig,
} from '@kila/shared'
import type {
  DesktopNotificationInput,
  OpenSessionInMainWindowInput,
  SettingsTab,
} from '../../types'
import {
  assertRecord,
  assertString,
  assertOptionalString,
  assertBoolean,
  assertOptionalBoolean,
  assertNumber,
  assertOptionalNumber,
  assertStringArray,
  optionalStringArray,
  assertEnum,
} from './validation-primitives'
import { validateBridgeChannel } from './validation-im-bridge'

// 通用校验原语已拆分至 validation-primitives.ts；此处再导出，保持既有 `from './validation'` 导入不变。
export {
  assertString,
  assertOptionalString,
  assertBoolean,
  assertOptionalBoolean,
  assertNumber,
  assertOptionalNumber,
  assertStringArray,
}

// IM Bridge 校验已拆分至 validation-im-bridge.ts；此处再导出，保持既有 `from './validation'` 导入不变。
export {
  validateBridgeChannel,
  validateBridgeConfigInput,
  validateBridgeBindingUpdateInput,
  validateFeishuBotConfigInput,
  validateWeChatStartLoginInput,
} from './validation-im-bridge'

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
