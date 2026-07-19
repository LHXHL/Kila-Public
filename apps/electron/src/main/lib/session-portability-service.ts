import { dialog, BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import type {
  FileAttachment,
  SessionExportInput,
  SessionExportResult,
  SessionImportInput,
  SessionImportResult,
  SessionMessage,
  SessionMeta,
} from '@kila/shared'
import { resolveAttachmentPath } from './config-paths'
import { saveAttachment } from './attachment-service'
import { createSession, getSessionMessages, getSessionMeta, saveSessionMessages, updateSessionMeta } from './session-manager'
import { listSessionPinnedWidgets, pinSessionWidget } from './session-board-manager'

interface SessionExportManifest {
  format: 'kila-session-export'
  version: 1
  exportedAt: number
  sessionId: string
  messageCount: number
  attachmentCount: number
  boardWidgetCount: number
}

interface ExportedAttachmentRecord {
  messageId: string
  attachmentId: string
  filename: string
  mediaType: string
  size: number
  exportPath: string
}

interface AttachmentRewrite {
  from: FileAttachment
  to: FileAttachment
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160) || 'attachment'
}

async function pickExportDirectory(session: SessionMeta): Promise<string | null> {
  const parentWindow = BrowserWindow.getFocusedWindow() ?? undefined
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, {
      title: '选择会话导出目录',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: `${safeFilename(session.title)}.kila-session`,
    })
    : await dialog.showOpenDialog({
      title: '选择会话导出目录',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: `${safeFilename(session.title)}.kila-session`,
    })

  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]!
}

async function pickImportDirectory(): Promise<string | null> {
  const parentWindow = BrowserWindow.getFocusedWindow() ?? undefined
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, {
      title: '选择 Kila Session Export v1 目录',
      properties: ['openDirectory'],
    })
    : await dialog.showOpenDialog({
      title: '选择 Kila Session Export v1 目录',
      properties: ['openDirectory'],
    })

  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]!
}

function copyExportAttachments(
  exportDir: string,
  messages: SessionMessage[],
  includeAttachments: boolean,
): { messages: SessionMessage[]; records: ExportedAttachmentRecord[] } {
  if (!includeAttachments) return { messages, records: [] }

  const attachmentsDir = join(exportDir, 'attachments')
  mkdirSync(attachmentsDir, { recursive: true })
  const records: ExportedAttachmentRecord[] = []

  const rewritten = messages.map((message) => {
    if (!message.attachments?.length) return message

    const attachments = message.attachments.map((attachment) => {
      const sourcePath = resolveAttachmentPath(attachment.localPath, { allowAbsolute: true })
      if (!existsSync(sourcePath)) return attachment

      const exportedName = `${message.id}-${attachment.id}${extname(attachment.filename) || extname(sourcePath) || '.bin'}`
      const exportPath = join('attachments', safeFilename(exportedName))
      const targetPath = join(exportDir, exportPath)
      writeFileSync(targetPath, readFileSync(sourcePath))
      records.push({
        messageId: message.id,
        attachmentId: attachment.id,
        filename: attachment.filename,
        mediaType: attachment.mediaType,
        size: attachment.size,
        exportPath,
      })

      return {
        ...attachment,
        localPath: exportPath,
      }
    })

    return { ...message, attachments }
  })

  return { messages: rewritten, records }
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf-8')) as T
}

function writeJsonFile(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
}

function renderMarkdownTranscript(session: SessionMeta, messages: SessionMessage[]): string {
  const lines = [
    `# ${session.title}`,
    '',
    `- Session: ${session.id}`,
    `- Project: ${session.project.path}`,
    `- Exported: ${new Date().toISOString()}`,
    '',
  ]

  for (const message of messages) {
    lines.push(`## ${message.role} · ${new Date(message.createdAt).toISOString()}`)
    lines.push('')
    lines.push(message.content?.trim() || '_empty_')
    if (message.attachments?.length) {
      lines.push('')
      lines.push('Attachments:')
      for (const attachment of message.attachments) {
        lines.push(`- ${attachment.filename} (${attachment.mediaType}, ${attachment.size} bytes): ${attachment.localPath}`)
      }
    }
    lines.push('')
  }

  return `${lines.join('\n').trimEnd()}\n`
}

function readExportedMessages(filePath: string): SessionMessage[] {
  if (!existsSync(filePath)) return []
  return readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as SessionMessage)
}

function rewriteImportedAttachments(sessionId: string, sourceDir: string, messages: SessionMessage[]): {
  messages: SessionMessage[]
  attachmentCount: number
  rewrites: AttachmentRewrite[]
} {
  let attachmentCount = 0
  const rewrites: AttachmentRewrite[] = []

  const rewritten = messages.map((message) => {
    if (!message.attachments?.length) return message

    const attachments = message.attachments.map((attachment) => {
      const exportedPath = resolve(sourceDir, attachment.localPath)
      if (!existsSync(exportedPath)) return attachment
      const saved = saveAttachment({
        conversationId: sessionId,
        filename: attachment.filename || basename(exportedPath),
        mediaType: attachment.mediaType,
        data: readFileSync(exportedPath).toString('base64'),
      }).attachment
      attachmentCount += 1
      rewrites.push({ from: attachment, to: saved })
      return saved
    })

    return { ...message, attachments }
  })

  return { messages: rewritten, attachmentCount, rewrites }
}

export async function exportSessionBundle(input: SessionExportInput): Promise<SessionExportResult> {
  const session = getSessionMeta(input.sessionId)
  if (!session) throw new Error(`Session 不存在: ${input.sessionId}`)

  const exportDir = input.targetDir ? resolve(input.targetDir) : await pickExportDirectory(session)
  if (!exportDir) return { canceled: true }
  mkdirSync(exportDir, { recursive: true })

  const messages = getSessionMessages(session.id)
  const board = listSessionPinnedWidgets(session.id)
  const { messages: exportMessages, records } = copyExportAttachments(exportDir, messages, input.includeAttachments !== false)
  const manifest: SessionExportManifest = {
    format: 'kila-session-export',
    version: 1,
    exportedAt: Date.now(),
    sessionId: session.id,
    messageCount: exportMessages.length,
    attachmentCount: records.length,
    boardWidgetCount: board.length,
  }

  writeJsonFile(join(exportDir, 'manifest.json'), manifest)
  writeJsonFile(join(exportDir, 'session.json'), session)
  writeFileSync(join(exportDir, 'messages.jsonl'), `${exportMessages.map((message) => JSON.stringify(message)).join('\n')}\n`, 'utf-8')
  writeFileSync(join(exportDir, 'transcript.md'), renderMarkdownTranscript(session, exportMessages), 'utf-8')
  writeJsonFile(join(exportDir, 'board.json'), { widgets: board })
  writeJsonFile(join(exportDir, 'attachments.json'), { attachments: records })

  return {
    canceled: false,
    exportDir,
    sessionId: session.id,
    messageCount: exportMessages.length,
    attachmentCount: records.length,
    boardWidgetCount: board.length,
  }
}

export async function importSessionBundle(input: SessionImportInput = {}): Promise<SessionImportResult> {
  const sourceDir = input.sourceDir ? resolve(input.sourceDir) : await pickImportDirectory()
  if (!sourceDir) return { canceled: true, dryRun: input.dryRun === true }

  const manifest = readJsonFile<SessionExportManifest>(join(sourceDir, 'manifest.json'))
  if (manifest.format !== 'kila-session-export' || manifest.version !== 1) {
    throw new Error('不支持的 Kila session export 格式')
  }

  const exportedSession = readJsonFile<SessionMeta>(join(sourceDir, 'session.json'))
  const messages = readExportedMessages(join(sourceDir, 'messages.jsonl'))
  const boardPath = join(sourceDir, 'board.json')
  const board = existsSync(boardPath)
    ? readJsonFile<{ widgets?: ReturnType<typeof listSessionPinnedWidgets> }>(boardPath).widgets ?? []
    : []

  const attachmentsDir = join(sourceDir, 'attachments')
  const attachmentCount = existsSync(attachmentsDir)
    ? readdirSync(attachmentsDir, { withFileTypes: true }).filter((entry) => entry.isFile()).length
    : 0

  if (input.dryRun === true) {
    return {
      canceled: false,
      dryRun: true,
      sourceDir,
      title: exportedSession.title,
      messageCount: messages.length,
      attachmentCount,
      boardWidgetCount: board.length,
      sourceVersion: manifest.version,
    }
  }

  const imported = createSession({
    title: `${exportedSession.title}（导入）`,
    projectPath: exportedSession.project?.path && existsSync(exportedSession.project.path)
      ? exportedSession.project.path
      : undefined,
    channelId: exportedSession.channelId,
    modelId: exportedSession.modelId,
    thinkingLevel: exportedSession.thinkingLevel,
    historyTurns: exportedSession.historyTurns,
    enabledToolIds: exportedSession.enabledToolIds,
  })
  updateSessionMeta(imported.id, {
    messageSource: exportedSession.messageSource,
    messageSourceLabel: exportedSession.messageSourceLabel,
    relatedTaskId: exportedSession.relatedTaskId,
    pinned: exportedSession.pinned,
  })
  const { messages: rewrittenMessages, attachmentCount: importedAttachmentCount } = rewriteImportedAttachments(imported.id, sourceDir, messages)
  saveSessionMessages(imported.id, rewrittenMessages)

  for (const widget of board) {
    pinSessionWidget({
      sessionId: imported.id,
      sourceMessageId: widget.sourceMessageId,
      sourceBlockKey: widget.sourceBlockKey,
      title: widget.title,
      payload: widget.payload,
    })
  }

  return {
    canceled: false,
    dryRun: false,
    sourceDir,
    sessionId: imported.id,
    title: imported.title,
    messageCount: rewrittenMessages.length,
    attachmentCount: importedAttachmentCount,
    boardWidgetCount: board.length,
    sourceVersion: manifest.version,
  }
}
