import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  CliBridgeTaskCreateRequest,
  CliBridgeTaskListResponse,
  CliBridgeTaskResponse,
  CliBridgeTaskRunsResponse,
  CliBridgeTaskRuntimeResponse,
  CliBridgeTaskUpdateRequest,
} from '@kila/shared'
import { scheduledTaskManager } from '../../scheduled-task-singleton'
import { readJsonBody, sendError, sendJson } from '../http'

export function handleCliBridgeTasks(response: ServerResponse): void {
  sendJson(response, 200, {
    tasks: scheduledTaskManager.listTasks(),
  } satisfies CliBridgeTaskListResponse)
}

export function handleCliBridgeTask(
  response: ServerResponse,
  taskId: string,
): void {
  const task = scheduledTaskManager.getTask(taskId)
  if (!task) {
    sendError(response, 404, `定时任务不存在: ${taskId}`)
    return
  }

  sendJson(response, 200, { task } satisfies CliBridgeTaskResponse)
}

export async function handleCliBridgeCreateTask(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJsonBody<CliBridgeTaskCreateRequest>(request)
  const task = await scheduledTaskManager.createTask(body)
  sendJson(response, 201, { task } satisfies CliBridgeTaskResponse)
}

export async function handleCliBridgeUpdateTask(
  request: IncomingMessage,
  response: ServerResponse,
  taskId: string,
): Promise<void> {
  const body = await readJsonBody<CliBridgeTaskUpdateRequest>(request)
  const task = await scheduledTaskManager.updateTask(taskId, body)
  sendJson(response, 200, { task } satisfies CliBridgeTaskResponse)
}

export async function handleCliBridgeDeleteTask(
  response: ServerResponse,
  taskId: string,
): Promise<void> {
  await scheduledTaskManager.deleteTask(taskId)
  sendJson(response, 200, { ok: true })
}

export async function handleCliBridgeStartTask(
  response: ServerResponse,
  taskId: string,
): Promise<void> {
  const task = await scheduledTaskManager.startTask(taskId)
  sendJson(response, 200, { task } satisfies CliBridgeTaskResponse)
}

export async function handleCliBridgeStopTask(
  response: ServerResponse,
  taskId: string,
): Promise<void> {
  const task = await scheduledTaskManager.stopTask(taskId)
  sendJson(response, 200, { task } satisfies CliBridgeTaskResponse)
}

export async function handleCliBridgeRunTask(
  response: ServerResponse,
  taskId: string,
): Promise<void> {
  await scheduledTaskManager.runTaskNow(taskId)
  const task = scheduledTaskManager.getTask(taskId)
  if (!task) {
    sendJson(response, 200, { ok: true })
    return
  }
  sendJson(response, 200, { task } satisfies CliBridgeTaskResponse)
}

export function handleCliBridgeTaskRuns(
  response: ServerResponse,
  taskId: string,
  limit: number,
): void {
  sendJson(response, 200, {
    taskId,
    runs: scheduledTaskManager.listRuns(taskId, limit),
  } satisfies CliBridgeTaskRunsResponse)
}

export function handleCliBridgeTaskRuntime(response: ServerResponse): void {
  sendJson(response, 200, {
    runtime: scheduledTaskManager.getRuntimeStatus(),
  } satisfies CliBridgeTaskRuntimeResponse)
}
