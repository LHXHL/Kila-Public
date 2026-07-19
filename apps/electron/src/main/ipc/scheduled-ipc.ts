/**
 * 定时任务 IPC 处理器
 *
 * 定时任务 CRUD + 运行
 */

import { SCHEDULED_TASK_IPC_CHANNELS } from '@kila/shared'
import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskRunRecord,
  ScheduledTaskRuntimeStatus,
  ScheduledTaskUpdateInput,
} from '@kila/shared'
import { handle } from './shared'
import { scheduledTaskManager } from '../lib/scheduled-task-singleton'
import { assertOptionalNumber, assertOptionalString, assertString, validateScheduledTaskCreateInput, validateScheduledTaskUpdateInput } from './validation'

export function registerScheduledTaskHandlers(): void {
  handle(
    SCHEDULED_TASK_IPC_CHANNELS.LIST,
    async (): Promise<ScheduledTask[]> => {
      return scheduledTaskManager.listTasks()
    },
  )

  handle(
    SCHEDULED_TASK_IPC_CHANNELS.GET,
    async (_, taskId: string): Promise<ScheduledTask | null> => {
      return scheduledTaskManager.getTask(assertString(taskId, 'taskId', { nonEmpty: true, max: 128 }))
    },
  )

  handle(
    SCHEDULED_TASK_IPC_CHANNELS.CREATE,
    async (_, input: ScheduledTaskCreateInput): Promise<ScheduledTask> => {
      return scheduledTaskManager.createTask(validateScheduledTaskCreateInput(input))
    },
  )

  handle(
    SCHEDULED_TASK_IPC_CHANNELS.UPDATE,
    async (_, taskId: string, patch: ScheduledTaskUpdateInput): Promise<ScheduledTask> => {
      return scheduledTaskManager.updateTask(
        assertString(taskId, 'taskId', { nonEmpty: true, max: 128 }),
        validateScheduledTaskUpdateInput(patch),
      )
    },
  )

  handle(
    SCHEDULED_TASK_IPC_CHANNELS.DELETE,
    async (_, taskId: string): Promise<void> => {
      await scheduledTaskManager.deleteTask(assertString(taskId, 'taskId', { nonEmpty: true, max: 128 }))
    },
  )

  handle(
    SCHEDULED_TASK_IPC_CHANNELS.START,
    async (_, taskId: string): Promise<ScheduledTask> => {
      return scheduledTaskManager.startTask(assertString(taskId, 'taskId', { nonEmpty: true, max: 128 }))
    },
  )

  handle(
    SCHEDULED_TASK_IPC_CHANNELS.STOP,
    async (_, taskId: string, reason?: string): Promise<ScheduledTask> => {
      return scheduledTaskManager.stopTask(
        assertString(taskId, 'taskId', { nonEmpty: true, max: 128 }),
        assertOptionalString(reason, 'reason', 1000),
      )
    },
  )

  handle(
    SCHEDULED_TASK_IPC_CHANNELS.RUN_NOW,
    async (_, taskId: string): Promise<void> => {
      await scheduledTaskManager.runTaskNow(assertString(taskId, 'taskId', { nonEmpty: true, max: 128 }))
    },
  )

  handle(
    SCHEDULED_TASK_IPC_CHANNELS.LIST_RUNS,
    async (_, taskId: string, limit?: number): Promise<ScheduledTaskRunRecord[]> => {
      return scheduledTaskManager.listRuns(
        assertString(taskId, 'taskId', { nonEmpty: true, max: 128 }),
        assertOptionalNumber(limit, 'limit', { min: 1, max: 500, integer: true }),
      )
    },
  )

  handle(
    SCHEDULED_TASK_IPC_CHANNELS.GET_RUNTIME_STATUS,
    async (): Promise<ScheduledTaskRuntimeStatus> => {
      return scheduledTaskManager.getRuntimeStatus()
    },
  )

  handle(
    SCHEDULED_TASK_IPC_CHANNELS.RECOVER_OVERDUE,
    async (): Promise<ScheduledTaskRuntimeStatus> => {
      await scheduledTaskManager.recoverOverdueTasksNow()
      return scheduledTaskManager.getRuntimeStatus()
    },
  )
}
