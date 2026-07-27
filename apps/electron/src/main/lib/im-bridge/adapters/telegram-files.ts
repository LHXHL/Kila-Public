import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FileAttachment } from '@kila/shared'
import { getImBridgeSessionFilesDir } from '../../config-paths'
import type { BridgeAttachmentReference } from './base-adapter'
import {
  DEFAULT_MAX_INBOUND_FILE_BYTES,
  assertActualSizeWithinLimit,
  assertDeclaredSizeWithinLimit,
  assertDownloadResponseOk,
} from './download-limits'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function sanitizeFilename(filename: string): string {
  return filename.replace(/[\\/:"*?<>|]+/g, '-').trim() || `attachment-${randomUUID()}`
}

async function downloadTelegramFile(
  fetchImpl: FetchLike,
  botToken: string,
  remoteId: string,
): Promise<{ filePath: string }> {
  const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(remoteId)}`)
  const payload = await response.json() as { ok: boolean; result?: { file_path?: string } }
  const filePath = payload.result?.file_path
  if (!payload.ok || !filePath) {
    throw new Error('Telegram 文件元信息获取失败')
  }

  return { filePath }
}

export async function downloadTelegramAttachments(input: {
  fetchImpl: FetchLike
  botToken: string
  attachments: BridgeAttachmentReference[]
  sessionId: string
  maxBytes?: number
}): Promise<FileAttachment[]> {
  const sessionDir = getImBridgeSessionFilesDir(input.sessionId)
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_INBOUND_FILE_BYTES
  const results: FileAttachment[] = []

  for (const attachment of input.attachments) {
    const filename = sanitizeFilename(attachment.filename)
    const meta = await downloadTelegramFile(input.fetchImpl, input.botToken, attachment.remoteId)
    const response = await input.fetchImpl(`https://api.telegram.org/file/bot${input.botToken}/${meta.filePath}`)
    assertDownloadResponseOk(response, filename)
    assertDeclaredSizeWithinLimit(response, filename, maxBytes)

    const buffer = Buffer.from(await response.arrayBuffer())
    assertActualSizeWithinLimit(buffer.byteLength, filename, maxBytes)

    const targetPath = join(sessionDir, filename)
    writeFileSync(targetPath, buffer)
    results.push({
      id: randomUUID(),
      filename,
      mediaType: attachment.mediaType,
      localPath: targetPath,
      size: attachment.size || buffer.byteLength,
    })
  }

  return results
}
