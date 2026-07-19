/**
 * 附件管理 IPC 处理器
 *
 * 附件保存/读取/对话框/文档提取
 */

import { dialog, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { extname as pathExtname } from 'node:path'
import { IPC_CHANNELS } from '@kila/shared'
import type { AttachmentSaveInput, AttachmentSaveResult, FileDialogResult } from '@kila/shared'
import { handle } from './shared'
import {
  saveAttachment,
  readAttachmentAsBase64,
  deleteAttachment,
  openFileDialog,
} from '../lib/attachment-service'
import { extractTextFromAttachment } from '../lib/document-parser'

export function registerAttachmentHandlers(): void {
  // 保存附件到本地
  handle(
    IPC_CHANNELS.SAVE_ATTACHMENT,
    async (_, input: AttachmentSaveInput): Promise<AttachmentSaveResult> => {
      return saveAttachment(input)
    }
  )

  // 读取附件（返回 base64）
  handle(
    IPC_CHANNELS.READ_ATTACHMENT,
    async (_, localPath: string): Promise<string> => {
      return readAttachmentAsBase64(localPath)
    }
  )

  // 另存图片到用户选择的位置
  handle(
    IPC_CHANNELS.SAVE_IMAGE_AS,
    async (event, localPath: string, defaultFilename: string): Promise<boolean> => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const ext = pathExtname(defaultFilename).replace('.', '').toLowerCase()
      const filterMap: Record<string, string> = { jpg: 'JPEG', jpeg: 'JPEG', png: 'PNG', gif: 'GIF', webp: 'WebP', bmp: 'BMP' }
      const filterName = filterMap[ext] ?? 'Image'

      const result = await dialog.showSaveDialog(win ?? BrowserWindow.getFocusedWindow()!, {
        defaultPath: defaultFilename,
        filters: [
          { name: `${filterName} 图片`, extensions: [ext || 'png'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      })

      if (result.canceled || !result.filePath) return false

      const base64 = readAttachmentAsBase64(localPath)
      writeFileSync(result.filePath, Buffer.from(base64, 'base64'))
      return true
    }
  )

  // 删除附件
  handle(
    IPC_CHANNELS.DELETE_ATTACHMENT,
    async (_, localPath: string): Promise<void> => {
      deleteAttachment(localPath)
    }
  )

  // 打开文件选择对话框
  handle(
    IPC_CHANNELS.OPEN_FILE_DIALOG,
    async (): Promise<FileDialogResult> => {
      return openFileDialog()
    }
  )

  // 提取附件文档的文本内容
  handle(
    IPC_CHANNELS.EXTRACT_ATTACHMENT_TEXT,
    async (_, localPath: string): Promise<string> => {
      return extractTextFromAttachment(localPath)
    }
  )
}
