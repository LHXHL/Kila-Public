import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FileAttachment } from '@kila/shared'
import { getImBridgeSessionFilesDir } from '../../config-paths'
import type { BridgeAttachmentReference } from './base-adapter'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function sanitizeFilename(filename: string): string {
  return filename.replace(/[\\/:"*?<>|]+/g, '-').trim() || `attachment-${randomUUID()}`
}

export async function downloadDiscordAttachments(input: {
  fetchImpl: FetchLike
  attachments: BridgeAttachmentReference[]
  sessionId: string
}): Promise<FileAttachment[]> {
  const sessionDir = getImBridgeSessionFilesDir(input.sessionId)
  const results: FileAttachment[] = []

  for (const attachment of input.attachments) {
    if (!attachment.downloadUrl) continue

    const response = await input.fetchImpl(attachment.downloadUrl)
    const arrayBuffer = await response.arrayBuffer()
    const filename = sanitizeFilename(attachment.filename)
    const targetPath = join(sessionDir, filename)

    writeFileSync(targetPath, Buffer.from(arrayBuffer))
    results.push({
      id: randomUUID(),
      filename,
      mediaType: attachment.mediaType,
      localPath: targetPath,
      size: attachment.size || Buffer.byteLength(Buffer.from(arrayBuffer)),
    })
  }

  return results
}
