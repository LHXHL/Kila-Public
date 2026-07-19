/**
 * IPC 处理器入口
 *
 * 按业务域拆分的 IPC 处理器统一注册入口。
 */

import { BrowserWindow } from 'electron'
import { FEISHU_BRIDGE_IPC_CHANNELS, IM_BRIDGE_IPC_CHANNELS, SCHEDULED_TASK_IPC_CHANNELS, WECHAT_BRIDGE_IPC_CHANNELS } from '@kila/shared'
import { bridgeManager } from '../lib/im-bridge/bridge-manager'
import { scheduledTaskManager } from '../lib/scheduled-task-singleton'
import { registerUpdaterIpc } from '../lib/updater/updater-ipc'

import { registerRuntimeHandlers } from './runtime-ipc'
import { registerGitHandlers } from './git-ipc'
import { registerChannelHandlers } from './channel-ipc'
import { registerProviderDbHandlers } from './provider-db-ipc'
import { registerSessionHandlers } from './session-ipc'
import { registerSessionBoardHandlers } from './session-board-ipc'
import { registerScheduledTaskHandlers } from './scheduled-ipc'
import { registerAttachmentHandlers } from './attachment-ipc'
import { registerSettingsHandlers } from './settings-ipc'
import { registerThemeHandlers } from './theme-ipc'
import { registerCapabilityHandlers } from './capability-ipc'
import { registerAgentFileHandlers } from './agent-file-ipc'
import { registerAgentHandlers } from './agent-ipc'
import { registerAgentToolHandlers } from './agent-tool-ipc'
import { registerBridgeHandlers } from './bridge-ipc'
import { registerPersonalityHandlers } from './personality-ipc'
import { registerSystemPromptHandlers } from './system-prompt-ipc'
import { registerTokenUsageHandlers } from './token-usage-ipc'
import { registerNotificationHandlers } from './notification-ipc'
import { registerGitHubReleaseHandlers } from './github-release-ipc'
import { registerMemoryHandlers } from './memory-ipc'
import { registerNativeFeelHandlers } from './native-feel-ipc'
import { registerCuaDriverHandlers } from './cua-driver-ipc'
import { registerQuickTaskHandlers } from './quick-task-ipc'
import { initializeProjectRunChangesTracking } from '../lib/project-run-changes'

/**
 * 注册 IPC 处理器
 */
export function registerIpcHandlers(): void {
  console.log('[IPC] 正在注册 IPC 处理器...')
  initializeProjectRunChangesTracking()

  // 共享事件转发：Bridge 状态变更
  bridgeManager.onStatusChanged((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.webContents.send(IM_BRIDGE_IPC_CHANNELS.STATUS_CHANGED, status)
      win.webContents.send(FEISHU_BRIDGE_IPC_CHANNELS.MULTI_STATUS_CHANGED, bridgeManager.getFeishuMultiStatus())
    }
  })

  bridgeManager.onWeChatLoginStateChanged((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.webContents.send(WECHAT_BRIDGE_IPC_CHANNELS.LOGIN_STATE_CHANGED, state)
    }
  })

  bridgeManager.onWeChatAccountStatusChanged((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.webContents.send(WECHAT_BRIDGE_IPC_CHANNELS.ACCOUNT_STATUS_CHANGED, status)
    }
  })

  // 共享事件转发：定时任务更新
  scheduledTaskManager.onUpdated((payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.webContents.send(SCHEDULED_TASK_IPC_CHANNELS.UPDATED, payload)
    }
  })

  // 注册各业务域处理器
  registerRuntimeHandlers()
  registerGitHandlers()
  registerChannelHandlers()
  registerProviderDbHandlers()
  registerSessionHandlers()
  registerSessionBoardHandlers()
  registerScheduledTaskHandlers()
  registerAttachmentHandlers()
  registerSettingsHandlers()
  registerThemeHandlers()
  registerCapabilityHandlers()
  registerAgentFileHandlers()
  registerAgentHandlers()
  registerAgentToolHandlers()
  registerBridgeHandlers()
  registerPersonalityHandlers()
  registerSystemPromptHandlers()
  registerTokenUsageHandlers()
  registerNotificationHandlers()
  registerGitHubReleaseHandlers()
  registerMemoryHandlers()
  registerNativeFeelHandlers()
  registerCuaDriverHandlers()
  registerQuickTaskHandlers()

  console.log('[IPC] IPC 处理器注册完成')

  // 注册更新 IPC 处理器
  registerUpdaterIpc()
}
