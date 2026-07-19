/**
 * Agent 工具管理 IPC 处理器
 */

import { BrowserWindow } from 'electron'
import { AGENT_TOOL_IPC_CHANNELS } from '@kila/shared'
import type { AgentToolInfo, AgentToolState, AgentToolMeta } from '@kila/shared'
import { handle } from './shared'
import { getAllToolInfos } from '../lib/agent-tool-registry'
import { updateToolState, updateToolCredentials, getToolCredentials, addCustomTool, deleteCustomTool } from '../lib/agent-tool-config'

/** 工具配置变更后通知所有窗口刷新 */
function broadcastToolChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(AGENT_TOOL_IPC_CHANNELS.CUSTOM_TOOL_CHANGED)
    }
  }
}

export function registerAgentToolHandlers(): void {
  // 获取所有工具信息
  handle(
    AGENT_TOOL_IPC_CHANNELS.GET_ALL_TOOLS,
    async (): Promise<AgentToolInfo[]> => {
      return getAllToolInfos()
    }
  )

  // 获取工具凭据
  handle(
    AGENT_TOOL_IPC_CHANNELS.GET_TOOL_CREDENTIALS,
    async (_, toolId: string): Promise<Record<string, string>> => {
      return getToolCredentials(toolId)
    }
  )

  // 更新工具开关状态
  handle(
    AGENT_TOOL_IPC_CHANNELS.UPDATE_TOOL_STATE,
    async (_, toolId: string, state: AgentToolState): Promise<void> => {
      updateToolState(toolId, state)
      broadcastToolChanged()
    }
  )

  // 更新工具凭据
  handle(
    AGENT_TOOL_IPC_CHANNELS.UPDATE_TOOL_CREDENTIALS,
    async (_, toolId: string, credentials: Record<string, string>): Promise<void> => {
      updateToolCredentials(toolId, credentials)
      broadcastToolChanged()
    }
  )

  // 创建自定义工具
  handle(
    AGENT_TOOL_IPC_CHANNELS.CREATE_CUSTOM_TOOL,
    async (_, meta: AgentToolMeta): Promise<void> => {
      addCustomTool(meta)
      broadcastToolChanged()
    }
  )

  // 删除自定义工具
  handle(
    AGENT_TOOL_IPC_CHANNELS.DELETE_CUSTOM_TOOL,
    async (_, toolId: string): Promise<void> => {
      deleteCustomTool(toolId)
      broadcastToolChanged()
    }
  )

  // 测试工具连接
  handle(
    AGENT_TOOL_IPC_CHANNELS.TEST_TOOL,
    async (_, toolId: string): Promise<{ success: boolean; message: string }> => {
      // 联网搜索工具测试
      if (toolId === 'web-search') {
        const credentials = getToolCredentials('web-search')
        if (!credentials.apiKey) {
          return { success: false, message: '请先填写 Tavily API Key' }
        }
        try {
          const response = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: credentials.apiKey,
              query: 'test connection',
              search_depth: 'basic',
              max_results: 1,
            }),
          })
          if (!response.ok) {
            const errorText = await response.text()
            return { success: false, message: `API 请求失败 (${response.status}): ${errorText}` }
          }
          return { success: true, message: '连接成功，Tavily 搜索 API 可用' }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          return { success: false, message: `连接失败: ${msg}` }
        }
      }
      return { success: false, message: `工具 ${toolId} 不支持测试` }
    }
  )
}
