import { ipcRenderer } from 'electron'
import { SCHEDULED_TASK_IPC_CHANNELS } from '@kila/shared/ipc'
import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskRunRecord,
  ScheduledTaskRuntimeStatus,
  ScheduledTaskUpdateInput,
  ScheduledTaskUpdatedPayload,
} from '@kila/shared'
import { invoke } from '../invoke'

export interface ScheduledPreloadApi {
  listScheduledTasks: () => Promise<ScheduledTask[]>
  getScheduledTask: (taskId: string) => Promise<ScheduledTask | null>
  createScheduledTask: (input: ScheduledTaskCreateInput) => Promise<ScheduledTask>
  updateScheduledTask: (taskId: string, patch: ScheduledTaskUpdateInput) => Promise<ScheduledTask>
  deleteScheduledTask: (taskId: string) => Promise<void>
  startScheduledTask: (taskId: string) => Promise<ScheduledTask>
  stopScheduledTask: (taskId: string, reason?: string) => Promise<ScheduledTask>
  runScheduledTaskNow: (taskId: string) => Promise<void>
  listScheduledTaskRuns: (taskId: string, limit?: number) => Promise<ScheduledTaskRunRecord[]>
  getScheduledTaskRuntimeStatus: () => Promise<ScheduledTaskRuntimeStatus>
  recoverOverdueScheduledTasks: () => Promise<ScheduledTaskRuntimeStatus>
  onScheduledTaskUpdated: (callback: (payload: ScheduledTaskUpdatedPayload) => void) => () => void
}

export function createScheduledApi(): ScheduledPreloadApi {
  return {
    listScheduledTasks: () => invoke(SCHEDULED_TASK_IPC_CHANNELS.LIST),
    getScheduledTask: (taskId) => invoke(SCHEDULED_TASK_IPC_CHANNELS.GET, taskId),
    createScheduledTask: (input) => invoke(SCHEDULED_TASK_IPC_CHANNELS.CREATE, input),
    updateScheduledTask: (taskId, patch) => invoke(SCHEDULED_TASK_IPC_CHANNELS.UPDATE, taskId, patch),
    deleteScheduledTask: (taskId) => invoke(SCHEDULED_TASK_IPC_CHANNELS.DELETE, taskId),
    startScheduledTask: (taskId) => invoke(SCHEDULED_TASK_IPC_CHANNELS.START, taskId),
    stopScheduledTask: (taskId, reason) => invoke(SCHEDULED_TASK_IPC_CHANNELS.STOP, taskId, reason),
    runScheduledTaskNow: (taskId) => invoke(SCHEDULED_TASK_IPC_CHANNELS.RUN_NOW, taskId),
    listScheduledTaskRuns: (taskId, limit) => invoke(SCHEDULED_TASK_IPC_CHANNELS.LIST_RUNS, taskId, limit),
    getScheduledTaskRuntimeStatus: () => invoke(SCHEDULED_TASK_IPC_CHANNELS.GET_RUNTIME_STATUS),
    recoverOverdueScheduledTasks: () => invoke(SCHEDULED_TASK_IPC_CHANNELS.RECOVER_OVERDUE),
    onScheduledTaskUpdated: (callback) => {
      const listener = (_: Electron.IpcRendererEvent, payload: ScheduledTaskUpdatedPayload): void => callback(payload)
      ipcRenderer.on(SCHEDULED_TASK_IPC_CHANNELS.UPDATED, listener)
      return () => ipcRenderer.removeListener(SCHEDULED_TASK_IPC_CHANNELS.UPDATED, listener)
    },
  }
}
