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
import { handle, assertAgentFileAccess } from './shared'
import { assertString } from './validation-primitives'
import {
  saveAttachment,
  readAttachmentAsBase64,
  deleteAttachment,
  openFileDialog,
} from '../lib/attachment-service'
import { extractTextFromAttachment } from '../lib/document-parser'

/** 附件 localPath 的长度上限 */
const MAX_ATTACHMENT_PATH_LENGTH = 4096

/**
 * 存量绝对路径附件的访问策略
 *
 * 附件域此前是唯一脱离白名单的文件 IPC：Renderer 传入任意绝对路径即可读回本地文件。
 * 现在相对路径强制约束在附件目录内，绝对路径统一走与其它文件 IPC 相同的
 * `assertAgentFileAccess` 工作区白名单。
 */
const ATTACHMENT_ACCESS = { assertAbsoluteAccess: assertAgentFileAccess }

/** 校验 Renderer 传入的附件路径 */
function assertAttachmentPath(value: unknown): string {
  const localPath = assertString(value, 'localPath', {
    nonEmpty: true,
    max: MAX_ATTACHMENT_PATH_LENGTH,
  })
  if (localPath.includes('\0')) {
    throw new Error('localPath 包含非法字符')
  }
  return localPath
}

export function registerAttachmentHandlers(): void {
  // 保存附件到本地
  handle(
    IPC_CHANNELS.SAVE_ATTACHMENT,
    async (_, input: AttachmentSaveInput): Promise<AttachmentSaveResult> => {
      return saveAttachment({
        conversationId: assertString(input?.conversationId, 'conversationId', { nonEmpty: true, max: 256 }),
        filename: assertString(input?.filename, 'filename', { nonEmpty: true, max: 512 }),
        mediaType: assertString(input?.mediaType, 'mediaType', { nonEmpty: true, max: 256 }),
        data: assertString(input?.data, 'data', { nonEmpty: true }),
      })
    }
  )

  // 读取附件（返回 base64）
  handle(
    IPC_CHANNELS.READ_ATTACHMENT,
    async (_, localPath: string): Promise<string> => {
      return readAttachmentAsBase64(assertAttachmentPath(localPath), ATTACHMENT_ACCESS)
    }
  )

  // 另存图片到用户选择的位置
  handle(
    IPC_CHANNELS.SAVE_IMAGE_AS,
    async (event, localPath: string, defaultFilename: string): Promise<boolean> => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const safeFilename = assertString(defaultFilename, 'defaultFilename', { nonEmpty: true, max: 512 })
      const ext = pathExtname(safeFilename).replace('.', '').toLowerCase()
      const filterMap: Record<string, string> = { jpg: 'JPEG', jpeg: 'JPEG', png: 'PNG', gif: 'GIF', webp: 'WebP', bmp: 'BMP' }
      const filterName = filterMap[ext] ?? 'Image'

      const result = await dialog.showSaveDialog(win ?? BrowserWindow.getFocusedWindow()!, {
        defaultPath: safeFilename,
        filters: [
          { name: `${filterName} 图片`, extensions: [ext || 'png'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      })

      if (result.canceled || !result.filePath) return false

      const base64 = readAttachmentAsBase64(assertAttachmentPath(localPath), ATTACHMENT_ACCESS)
      writeFileSync(result.filePath, Buffer.from(base64, 'base64'))
      return true
    }
  )

  // 删除附件
  handle(
    IPC_CHANNELS.DELETE_ATTACHMENT,
    async (_, localPath: string): Promise<void> => {
      deleteAttachment(assertAttachmentPath(localPath), ATTACHMENT_ACCESS)
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
      return extractTextFromAttachment(assertAttachmentPath(localPath))
    }
  )
}
