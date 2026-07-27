import type { FileDialogResult, QuickTaskSubmitInput, QuickTaskSubmitResult } from '@kila/shared'
import { BrowserWindow, dialog } from 'electron'
import { deleteConversationAttachments, openFileDialog, saveAttachment } from '../lib/attachment-service'
import { createSession, deleteSession } from '../lib/session-manager'
import { sendSessionMessage } from '../lib/session-service'
import { getSettings } from '../lib/settings-service'
import { getMainWindowWebContents, openSessionInMainWindow } from '../lib/settings-window-manager'
import { hideQuickTaskWindow, withQuickTaskBlurGuard } from '../lib/quick-task-window'
import { handleUntyped } from './shared'
import { normalizeQuickTaskInput } from '../lib/quick-task-input'
import { submitQuickTask } from '../lib/quick-task-service'
import { unwatchSessionProject, watchSessionProject } from '../lib/workspace-watcher'

import { createLogger } from '../lib/logger'

const log = createLogger('QuickTask IPC')
export function registerQuickTaskHandlers(): void {

  handleUntyped<[], FileDialogResult>('quick-task:pick-files', async () => {
    return withQuickTaskBlurGuard(() => openFileDialog())
  })

  handleUntyped<[], { path: string; name: string } | null>('quick-task:pick-project', async (event) => {
    return withQuickTaskBlurGuard(async () => {
      const owner = BrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showOpenDialog(owner ?? BrowserWindow.getFocusedWindow()!, {
        title: '选择快速任务项目',
        properties: ['openDirectory', 'createDirectory'],
      })
      const path = result.filePaths[0]
      if (result.canceled || !path) return null
      const name = path.split(/[\/]/).filter(Boolean).at(-1) ?? path
      return { path, name }
    })
  })
  handleUntyped<[QuickTaskSubmitInput], QuickTaskSubmitResult>('quick-task:submit', async (_event, rawInput) => {
    const input = normalizeQuickTaskInput(rawInput)
    return submitQuickTask(input, {
      getSettings,
      getMainTarget: getMainWindowWebContents,
      createSession,
      saveAttachment,
      deleteSession,
      deleteSessionAttachments: deleteConversationAttachments,
      watchSessionProject,
      unwatchSessionProject,
      openSession: openSessionInMainWindow,
      hideWindow: hideQuickTaskWindow,
      sendMessage: sendSessionMessage,
      onBackgroundError: (error, sessionId) => {
        log.error(`[QuickTask] 后台任务执行失败 (${sessionId}):`, error)
      },
    })
  })

  handleUntyped<[], void>('quick-task:hide', async () => {
    hideQuickTaskWindow()
  })
}
