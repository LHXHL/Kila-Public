import type { BridgeChannelType } from './im-bridge'
import type { KilaPermissionMode, ThinkingLevel } from './agent'

export type ScheduledTaskStatus = 'running' | 'stopped'

export type ScheduledTaskRunMode = 'new_session' | 'single_session'

export type ScheduledTaskSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; minutes: number; startAt?: string }
  | { kind: 'cron'; expr: string; tz?: string }
  | { kind: 'loop' }

export type ScheduledTaskExecutionTarget =
  | {
      kind: 'new_session'
      projectPath: string
      titleTemplate?: string
    }
  | {
      kind: 'single_session'
      sessionId: string
    }

export type ScheduledTaskDelivery =
  | {
      kind: 'none'
    }
  | {
      kind: 'bridge_binding'
      endpointKey: string
      channelType: BridgeChannelType
    }
  | {
      kind: 'bridge_bindings'
      targets: ScheduledTaskDeliveryTarget[]
      failurePolicy?: 'all' | 'any'
    }

export interface ScheduledTaskDeliveryTarget {
  endpointKey: string
  channelType: BridgeChannelType
}

export type ScheduledTaskRunOutcome =
  | 'success'
  | 'error'
  | 'skipped_busy'
  | 'skipped_invalid_config'
  | 'skipped_concurrency_limit'
  | 'stopped_by_ai'

export type ScheduledTaskResultVerifier =
  | { kind: 'reply_non_empty' }
  | { kind: 'file_exists'; path: string }
  | { kind: 'bridge_delivery_success' }

export type ScheduledTaskHealthState =
  | 'healthy'
  | 'due_soon'
  | 'late'
  | 'missed'
  | 'failing'
  | 'paused'

export interface ScheduledTaskHealth {
  state: ScheduledTaskHealthState
  reason: string
  expectedByAt?: number
  missedRunCount: number
}

export interface ScheduledTaskRuntimeStatus {
  running: boolean
  activeRunCount: number
  lastScanAt?: number
  lastRecoveryAt?: number
  lastPersistAt?: number
  watchdogState: 'healthy' | 'stale' | 'idle'
  watchdogReason: string
}

export interface ScheduledTask {
  id: string
  name: string
  prompt: string

  schedule: ScheduledTaskSchedule
  runMode: ScheduledTaskRunMode
  executionTarget: ScheduledTaskExecutionTarget
  delivery: ScheduledTaskDelivery

  status: ScheduledTaskStatus

  channelId: string
  modelId?: string
  thinkingLevel?: ThinkingLevel
  historyTurns?: number | 'infinite'
  enabledToolIds?: string[]
  additionalDirectories?: string[]
  resultVerifiers?: ScheduledTaskResultVerifier[]

  permissionModeOverride: KilaPermissionMode
  aiCanExit: boolean
  notifyOnMissedRun: boolean

  createdAt: number
  updatedAt: number

  nextRunAt?: number
  lastTriggeredAt?: number
  lastCompletedAt?: number
  lastSuccessfulAt?: number
  lastHeartbeatAt?: number
  lastDurationMs?: number
  executionCount: number

  lastError?: string
  stopReason?: string
  lastMissedAlertKey?: string
  lastMissedAlertAt?: number

  lastSessionId?: string
  lastFinalReplyPreview?: string
  health?: ScheduledTaskHealth
}

export interface ScheduledTaskCreateInput {
  name: string
  prompt: string
  schedule: ScheduledTaskSchedule
  runMode: ScheduledTaskRunMode
  executionTarget: ScheduledTaskExecutionTarget
  delivery?: ScheduledTaskDelivery

  channelId: string
  modelId?: string
  thinkingLevel?: ThinkingLevel
  historyTurns?: number | 'infinite'
  enabledToolIds?: string[]
  additionalDirectories?: string[]
  resultVerifiers?: ScheduledTaskResultVerifier[]

  permissionModeOverride?: KilaPermissionMode
  aiCanExit?: boolean
  notifyOnMissedRun?: boolean
}

export interface ScheduledTaskUpdateInput extends Partial<Omit<ScheduledTaskCreateInput, 'runMode'>> {
  runMode?: ScheduledTaskRunMode
}

export interface ScheduledTaskRunRecord {
  id: string
  taskId: string
  triggerSource: 'scheduler' | 'manual'
  outcome: ScheduledTaskRunOutcome
  startedAt: number
  finishedAt: number
  durationMs: number
  sessionId?: string
  finalReplyPreview?: string
  error?: string
  verificationSummary?: string
}

export interface ScheduledTaskUpdatedPayload {
  taskId: string
  reason:
    | 'created'
    | 'updated'
    | 'deleted'
    | 'started'
    | 'stopped'
    | 'run-started'
    | 'run-finished'
}

export const SCHEDULED_TASK_IPC_CHANNELS = {
  LIST: 'scheduled-task:list',
  GET: 'scheduled-task:get',
  CREATE: 'scheduled-task:create',
  UPDATE: 'scheduled-task:update',
  DELETE: 'scheduled-task:delete',
  START: 'scheduled-task:start',
  STOP: 'scheduled-task:stop',
  RUN_NOW: 'scheduled-task:run-now',
  LIST_RUNS: 'scheduled-task:list-runs',
  GET_RUNTIME_STATUS: 'scheduled-task:get-runtime-status',
  RECOVER_OVERDUE: 'scheduled-task:recover-overdue',
  UPDATED: 'scheduled-task:updated',
} as const
