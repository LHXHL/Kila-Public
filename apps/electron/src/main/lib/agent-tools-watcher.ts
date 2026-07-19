/**
 * Agent 工具配置文件监听器
 *
 * 监听 ~/.kila/agent-tools.json 的变化，
 * 当 Agent 通过文件系统修改配置后自动通知渲染进程刷新工具列表。
 *
 * 使用 node:fs.watch + debounce 防抖，避免高频写入导致多次通知。
 */

import { watch, existsSync } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { BrowserWindow } from 'electron'
import { AGENT_TOOL_IPC_CHANNELS } from '@kila/shared'
import { getAgentToolsConfigPath } from './config-paths'

/** debounce 延迟（ms） */

import { createLogger } from './logger'
const log = createLogger('Agent 工具监听')

const DEBOUNCE_MS = 500

let watcher: FSWatcher | null = null

/**
 * 启动 agent-tools.json 文件监听
 *
 * 文件变化时向所有窗口广播 CUSTOM_TOOL_CHANGED 事件。
 */
export function startAgentToolsWatcher(): void {
  const filePath = getAgentToolsConfigPath()

  if (!existsSync(filePath)) {
    log.info('[Agent 工具监听] 配置文件不存在，跳过:', filePath)
    return
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  try {
    watcher = watch(filePath, (_eventType) => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        const windows = BrowserWindow.getAllWindows()
        for (const win of windows) {
          if (!win.isDestroyed()) {
            win.webContents.send(AGENT_TOOL_IPC_CHANNELS.CUSTOM_TOOL_CHANGED)
          }
        }
        log.info('[Agent 工具监听] 配置变更，已通知渲染进程')
        debounceTimer = null
      }, DEBOUNCE_MS)
    })

    log.info('[Agent 工具监听] 已启动')
  } catch (err) {
    log.error('[Agent 工具监听] 启动失败:', err)
  }
}

/**
 * 停止 agent-tools.json 文件监听
 */
export function stopAgentToolsWatcher(): void {
  if (watcher) {
    watcher.close()
    watcher = null
    log.info('[Agent 工具监听] 已停止')
  }
}
