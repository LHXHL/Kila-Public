import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FileAttachment } from '@kila/shared'
import { getImBridgeSessionFilesDir } from '../../config-paths'
import type { BridgeAttachmentReference } from './base-adapter'

interface FeishuClientForDownload {
  request: (input: { method: string; url: string; params?: Record<string, unknown> }) => Promise<{
    data?: { file_key?: string }
  }>
  im: {
    message: {
      resource: (input: { path: Record<string, unknown>; params: Record<string, unknown> }) => Promise<{
        data?: { file_key?: string }
      }>
    }
    file: {
      get: (input: { params: Record<string, unknown> }) => Promise<{
        data?: { content?: string }
      }>
    }
  }
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[\\/:"*?<>|]+/g, '-').trim() || `attachment-${randomUUID()}`
}

/**
 * 飞书附件下载
 *
 * 通过飞书 API 获取消息资源，下载到本地 session 目录。
 * 支持图片、文件、视频等飞书消息附件类型。
 */
export async function downloadFeishuAttachments(input: {
  client: FeishuClientForDownload
  attachments: BridgeAttachmentReference[]
  sessionId: string
}): Promise<FileAttachment[]> {
  const sessionDir = getImBridgeSessionFilesDir(input.sessionId)
  const results: FileAttachment[] = []

  for (const attachment of input.attachments) {
    try {
      // 飞书获取消息资源文件
      const resourceResponse = await input.client.im.message.resource({
        path: { message_id: attachment.remoteId, file_key: attachment.filename },
        params: { type: 'file' },
      })

      const fileKey = resourceResponse.data?.file_key
      if (!fileKey) continue

      // 下载文件内容
      const fileResponse = await input.client.im.file.get({
        params: { file_key: fileKey },
      })

      if (!fileResponse.data?.content) continue

      // base64 解码
      const buffer = Buffer.from(fileResponse.data.content, 'base64')
      const filename = sanitizeFilename(attachment.filename)
      const targetPath = join(sessionDir, filename)

      writeFileSync(targetPath, buffer)
      results.push({
        id: randomUUID(),
        filename,
        mediaType: attachment.mediaType,
        localPath: targetPath,
        size: buffer.byteLength,
      })
    } catch (error) {
      // 单个附件失败不阻塞其他附件
      continue
    }
  }

  return results
}
