import { copyFileSync, existsSync } from 'node:fs'
import { extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FileAttachment, SessionMessage } from '@kila/shared'
import { getConversationAttachmentsDir, resolveAttachmentPath } from './config-paths'
import { createLogger } from './logger'

const log = createLogger('Session 附件')

/**
 * 将消息前缀中引用的附件复制到新 Session，使分叉不依赖父 Session 的附件目录。
 */
export function cloneSessionMessageAttachments(
  targetSessionId: string,
  messages: SessionMessage[],
): SessionMessage[] {
  const targetDir = getConversationAttachmentsDir(targetSessionId)
  const cloned = new Map<string, FileAttachment>()

  return messages.map((message) => {
    if (!message.attachments?.length) return message
    const attachments = message.attachments.map((attachment) => {
      const cached = cloned.get(attachment.localPath)
      if (cached) return cached

      const sourcePath = resolveAttachmentPath(attachment.localPath, { allowAbsolute: true })
      if (!existsSync(sourcePath)) {
        log.warn(`[Session 附件] 分叉时附件不存在，保留原引用: ${attachment.localPath}`)
        return attachment
      }

      const id = randomUUID()
      const storedFilename = `${id}${extname(attachment.filename) || extname(sourcePath) || '.bin'}`
      const localPath = `${targetSessionId}/${storedFilename}`
      copyFileSync(sourcePath, join(targetDir, storedFilename))
      const next = { ...attachment, id, localPath }
      cloned.set(attachment.localPath, next)
      return next
    })
    return { ...message, attachments }
  })
}
