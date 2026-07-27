/**
 * 附件存储服务
 *
 * 负责文件附件的本地存储、读取和删除。
 * 存储路径：~/.kila/attachments/{conversationId}/{uuid}.ext
 *
 * - 保存：base64 解码 → 写入文件
 * - 读取：文件 → base64 编码（用于 API 发送）
 * - 删除：单个文件或整个对话附件目录
 * - 文件选择对话框：Electron dialog → 读取选中文件
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, rmSync } from 'node:fs'
import { extname, basename, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { dialog, BrowserWindow } from 'electron'
import {
  getAttachmentsDir,
  getConversationAttachmentsDir,
  resolveAttachmentPath,
  safePathSegment,
} from './config-paths'
import type {
  FileAttachment,
  AttachmentSaveInput,
  AttachmentSaveResult,
  FileDialogResult,
} from '@kila/shared'

/** 支持的图片 MIME 类型 */

import { createLogger } from './logger'
const log = createLogger('附件服务')

const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

/** 扩展名 → MIME 类型映射 */
const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.py': 'text/x-python',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
}

/** 文件选择对话框支持的过滤器 */
const FILE_FILTERS = [
  {
    name: '支持的文件',
    extensions: [
      'png', 'jpg', 'jpeg', 'gif', 'webp',
      'pdf', 'txt', 'md', 'json', 'csv', 'xml', 'html',
      'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
      'odt', 'odp', 'ods',
    ],
  },
  {
    name: '所有文件',
    extensions: ['*'],
  },
]

/**
 * 判断是否为图片附件
 */
export function isImageAttachment(mediaType: string): boolean {
  return IMAGE_MIME_TYPES.has(mediaType)
}

/**
 * 根据扩展名获取 MIME 类型
 */
export function getMimeType(ext: string): string {
  const normalized = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
  return MIME_MAP[normalized] || 'application/octet-stream'
}

/**
 * 从原始文件名提取安全扩展名
 *
 * 只保留字母数字，长度上限 16；异常输入统一落到 `.bin`。
 */
function safeExtension(filename: string): string {
  const raw = typeof filename === 'string' ? extname(filename) : ''
  const normalized = raw.replace(/[^a-zA-Z0-9.]/g, '')
  if (!normalized.startsWith('.') || normalized.length < 2 || normalized.length > 16) {
    return '.bin'
  }
  // 只允许单段扩展名，杜绝 '..' 与多点构造
  return /^\.[a-zA-Z0-9]+$/.test(normalized) ? normalized.toLowerCase() : '.bin'
}

/**
 * 存量绝对路径附件的放行器
 *
 * 早期版本允许把任意绝对路径写进 `attachment.localPath`。
 * 这类历史数据仍需可读，但绝不能由 Renderer 自由指定路径，
 * 因此由调用方（IPC 层）注入 Agent 文件访问白名单校验函数。
 * 不注入时，绝对路径一律拒绝。
 */
export interface AttachmentAccessOptions {
  assertAbsoluteAccess?: (absolutePath: string) => string
}

/**
 * 解析附件 localPath
 *
 * - 相对路径：强制约束在 `~/.kila/attachments/` 内
 * - 绝对路径：仅当调用方注入了白名单校验器时才放行
 */
function resolveReadableAttachmentPath(
  localPath: string,
  options: AttachmentAccessOptions,
): string {
  if (typeof localPath !== 'string' || localPath.trim() === '') {
    throw new Error('附件路径不能为空')
  }

  if (isAbsolute(localPath)) {
    if (!options.assertAbsoluteAccess) {
      throw new Error('附件路径必须是相对路径')
    }
    // 存量绝对路径：复用与其它文件 IPC 相同的工作区白名单
    return options.assertAbsoluteAccess(resolveAttachmentPath(localPath, { allowAbsolute: true }))
  }

  return resolveAttachmentPath(localPath)
}

/**
 * 保存附件到本地
 *
 * 将 base64 编码的文件数据解码后写入
 * ~/.kila/attachments/{conversationId}/{uuid}.ext
 *
 * @param input 保存附件参数
 * @returns 保存结果，包含附件元信息
 */
export function saveAttachment(input: AttachmentSaveInput): AttachmentSaveResult {
  const { conversationId, filename, mediaType, data } = input

  // 会话 ID 先净化再落盘，避免 '../../../tmp/x' 这类穿越写入任意目录
  const safeConversationId = safePathSegment(conversationId)

  // 确保目录存在
  const dir = getConversationAttachmentsDir(safeConversationId)

  // 生成唯一文件名：扩展名同样净化，防止 '.php/../../evil' 之类的构造
  const ext = safeExtension(filename)
  const id = randomUUID()
  const storedFilename = `${id}${ext}`
  const localPath = `${safeConversationId}/${storedFilename}`
  const fullPath = join(dir, storedFilename)

  // base64 解码并写入
  const buffer = Buffer.from(data, 'base64')
  writeFileSync(fullPath, buffer)

  const attachment: FileAttachment = {
    id,
    filename,
    mediaType,
    localPath,
    size: buffer.length,
  }

  log.info(`[附件服务] 已保存附件: ${filename} → ${localPath} (${buffer.length} 字节)`)
  return { attachment }
}


/**
 * 读取附件并返回 base64 编码
 *
 * 用于发送到 AI API 时读取图片数据。
 *
 * @param localPath 相对路径 {conversationId}/{uuid}.ext
 * @returns base64 编码的文件数据
 */
export function readAttachmentAsBase64(
  localPath: string,
  options: AttachmentAccessOptions = {},
): string {
  const fullPath = resolveReadableAttachmentPath(localPath, options)

  if (!existsSync(fullPath)) {
    throw new Error(`附件文件不存在: ${localPath}`)
  }

  const buffer = readFileSync(fullPath)
  return buffer.toString('base64')
}

/**
 * 删除单个附件
 *
 * @param localPath 相对路径 {conversationId}/{uuid}.ext
 */
export function deleteAttachment(
  localPath: string,
  options: AttachmentAccessOptions = {},
): void {
  const fullPath = resolveReadableAttachmentPath(localPath, options)

  if (existsSync(fullPath)) {
    try {
      unlinkSync(fullPath)
      log.info(`[附件服务] 已删除附件: ${localPath}`)
    } catch (error) {
      log.warn(`[附件服务] 删除附件失败: ${localPath}`, error)
    }
  }
}

/**
 * 删除对话的全部附件
 *
 * 删除整个 ~/.kila/attachments/{conversationId}/ 目录。
 *
 * @param conversationId 对话 ID
 */
export function deleteConversationAttachments(conversationId: string): void {
  // 净化后再拼接，避免 conversationId 携带 '../' 递归删除任意目录
  const dir = join(getAttachmentsDir(), safePathSegment(conversationId))

  if (existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true })
      log.info(`[附件服务] 已删除对话附件目录: ${conversationId}`)
    } catch (error) {
      log.warn(`[附件服务] 删除对话附件目录失败: ${conversationId}`, error)
    }
  }
}

/**
 * 打开文件选择对话框
 *
 * 弹出 Electron 文件选择对话框，支持多选，
 * 读取选中的文件并返回 base64 编码数据。
 *
 * @returns 选中的文件列表
 */
export async function openFileDialog(): Promise<FileDialogResult> {
  // macOS 上必须传入父窗口，否则对话框可能出现在应用窗口后面
  const parentWindow = BrowserWindow.getFocusedWindow()
  const dialogOptions: Electron.OpenDialogOptions = {
    properties: ['openFile', 'multiSelections'],
    filters: FILE_FILTERS,
  }

  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions)

  if (result.canceled || result.filePaths.length === 0) {
    return { files: [] }
  }

  const files = result.filePaths.map((filePath) => {
    const buffer = readFileSync(filePath)
    const filename = basename(filePath)
    const ext = extname(filePath)
    const mediaType = getMimeType(ext)

    return {
      filename,
      mediaType,
      data: buffer.toString('base64'),
      size: buffer.length,
    }
  })

  log.info(`[附件服务] 文件对话框选择了 ${files.length} 个文件`)
  return { files }
}
