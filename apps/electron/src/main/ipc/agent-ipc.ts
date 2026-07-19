/**
 * Agent 权限/AskUser/后台任务/目录/附件 IPC 处理器
 */

import { SESSION_IPC_CHANNELS, AGENT_IPC_CHANNELS } from '@kila/shared'
import type {
  PermissionResponse,
  AskUserResponse,
  AgentSaveFilesInput,
  AgentSaveWorkspaceFilesInput,
  AgentSavedFile,
  AgentAttachDirectoryInput,
  WorkspaceAttachDirectoryInput,
  GetTaskOutputInput,
  GetTaskOutputResult,
  StopTaskInput,
} from '@kila/shared'
import { handle } from './shared'
import { permissionService } from '../lib/agent-permission-service'
import { askUserService } from '../lib/agent-ask-user-service'
import { saveFilesToAgentSession, saveFilesToWorkspaceFiles } from '../lib/agent-service'
import { getSessionMeta as getUnifiedSessionMeta, updateSessionMeta as updateUnifiedSessionMeta } from '../lib/session-manager'
import {
  attachWorkspaceDirectory,
  detachWorkspaceDirectory,
  getWorkspaceAttachedDirectories,
} from '../lib/agent-workspace-manager'
import {
  getWorkspaceFilesDir,
} from '../lib/config-paths'
import {
  watchAttachedDirectory,
  unwatchAttachedDirectory,
} from '../lib/workspace-watcher'
import { processRegistry } from '../lib/process-registry'
import {
  assertString,
  validateAgentAttachDirectoryInput,
  validateAgentSaveFilesInput,
  validateAgentSaveWorkspaceFilesInput,
  validateAskUserResponse,
  validateGetTaskOutputInput,
  validatePermissionResponse,
  validateStopTaskInput,
  validateWorkspaceAttachDirectoryInput,
} from './validation'


import { createLogger } from '../lib/logger'
const log = createLogger('IPC')

export function registerAgentHandlers(): void {
  // ===== 权限系统 =====

  handle(
    AGENT_IPC_CHANNELS.PERMISSION_RESPOND,
    async (event, response: PermissionResponse): Promise<void> => {
      response = validatePermissionResponse(response)
      const { requestId, behavior, alwaysAllow } = response
      permissionService.respondToPermission(requestId, behavior, alwaysAllow)
    }
  )

  // ===== 后台任务 =====

  handle(
    AGENT_IPC_CHANNELS.GET_TASK_OUTPUT,
    async (_, input: GetTaskOutputInput): Promise<GetTaskOutputResult> => {
      try {
        input = validateGetTaskOutputInput(input)
        return await processRegistry.getOutput(input.taskId, {
          block: input.block,
        })
      } catch (error) {
        log.error('[IPC] 获取任务输出失败:', error)
        throw error
      }
    }
  )

  handle(
    AGENT_IPC_CHANNELS.STOP_TASK,
    async (_, input: StopTaskInput): Promise<void> => {
      try {
        input = validateStopTaskInput(input)
        if (input.type === 'shell') {
          processRegistry.stop(input.taskId)
        } else {
          log.warn('[IPC] STOP_TASK: Agent 任务暂不支持单独停止')
        }
      } catch (error) {
        log.error('[IPC] 停止任务失败:', error)
        throw error
      }
    }
  )

  // ===== AskUser =====

  handle(
    AGENT_IPC_CHANNELS.ASK_USER_RESPOND,
    async (event, response: AskUserResponse): Promise<void> => {
      response = validateAskUserResponse(response)
      const { requestId, answers } = response
      askUserService.respondToAskUser(requestId, answers)
    }
  )

  // ===== Agent 附件 =====

  handle(
    AGENT_IPC_CHANNELS.SAVE_FILES_TO_SESSION,
    async (_, input: AgentSaveFilesInput): Promise<AgentSavedFile[]> => {
      return saveFilesToAgentSession(validateAgentSaveFilesInput(input))
    }
  )

  handle(
    AGENT_IPC_CHANNELS.SAVE_FILES_TO_WORKSPACE,
    async (_, input: AgentSaveWorkspaceFilesInput): Promise<AgentSavedFile[]> => {
      return saveFilesToWorkspaceFiles(validateAgentSaveWorkspaceFilesInput(input))
    }
  )

  handle(
    AGENT_IPC_CHANNELS.GET_WORKSPACE_FILES_PATH,
    async (_, workspaceSlug: string): Promise<string> => {
      return getWorkspaceFilesDir(assertString(workspaceSlug, 'workspaceSlug', { nonEmpty: true, max: 128 }))
    }
  )

  // ===== 附加目录 =====

  handle(
    AGENT_IPC_CHANNELS.ATTACH_DIRECTORY,
    async (_, input: AgentAttachDirectoryInput): Promise<string[]> => {
      input = validateAgentAttachDirectoryInput(input)
      const meta = getUnifiedSessionMeta(input.sessionId)
      if (!meta) throw new Error(`会话不存在: ${input.sessionId}`)

      const existing = meta.attachedDirectories ?? []
      if (existing.includes(input.directoryPath)) return existing

      const updated = [...existing, input.directoryPath]
      updateUnifiedSessionMeta(input.sessionId, { attachedDirectories: updated })
      watchAttachedDirectory(input.directoryPath)
      return updated
    }
  )

  handle(
    AGENT_IPC_CHANNELS.DETACH_DIRECTORY,
    async (_, input: AgentAttachDirectoryInput): Promise<string[]> => {
      input = validateAgentAttachDirectoryInput(input)
      const meta = getUnifiedSessionMeta(input.sessionId)
      if (!meta) throw new Error(`会话不存在: ${input.sessionId}`)

      const existing = meta.attachedDirectories ?? []
      const updated = existing.filter((d) => d !== input.directoryPath)
      updateUnifiedSessionMeta(input.sessionId, { attachedDirectories: updated })
      unwatchAttachedDirectory(input.directoryPath)
      return updated
    }
  )

  handle(
    AGENT_IPC_CHANNELS.ATTACH_WORKSPACE_DIRECTORY,
    async (_, input: WorkspaceAttachDirectoryInput): Promise<string[]> => {
      input = validateWorkspaceAttachDirectoryInput(input)
      const updated = attachWorkspaceDirectory(input.workspaceSlug, input.directoryPath)
      watchAttachedDirectory(input.directoryPath)
      return updated
    }
  )

  handle(
    AGENT_IPC_CHANNELS.DETACH_WORKSPACE_DIRECTORY,
    async (_, input: WorkspaceAttachDirectoryInput): Promise<string[]> => {
      input = validateWorkspaceAttachDirectoryInput(input)
      const updated = detachWorkspaceDirectory(input.workspaceSlug, input.directoryPath)
      unwatchAttachedDirectory(input.directoryPath)
      return updated
    }
  )

  handle(
    AGENT_IPC_CHANNELS.GET_WORKSPACE_DIRECTORIES,
    async (_, workspaceSlug: string): Promise<string[]> => {
      return getWorkspaceAttachedDirectories(assertString(workspaceSlug, 'workspaceSlug', { nonEmpty: true, max: 128 }))
    }
  )
}
