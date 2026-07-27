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

export async function downloadDiscordAttachments(input: {
  fetchImpl: FetchLike
  attachments: BridgeAttachmentReference[]
  sessionId: string
  maxBytes?: number
}): Promise<FileAttachment[]> {
  const sessionDir = getImBridgeSessionFilesDir(input.sessionId)
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_INBOUND_FILE_BYTES
  const results: FileAttachment[] = []

  for (const attachment of input.attachments) {
    if (!attachment.downloadUrl) continue

    const filename = sanitizeFilename(attachment.filename)
    const response = await input.fetchImpl(attachment.downloadUrl)
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
