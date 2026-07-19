import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import type { AgentEvent, AgentMessage, PermissionRequest, SessionMeta } from '@kila/shared'
import { agentEventBus } from './agent-service'
import { permissionService } from './agent-permission-service'
import { getChannelById } from './channel-manager'
import {
  createSession,
  getSessionMessages,
  getSessionMeta,
} from './session-manager'
import { deleteSessionWithCleanup } from './session-cleanup-service'
import { createDefaultSessionService } from './session-service'
import { getSettings } from './settings-service'


import { createLogger } from './logger'
const log = createLogger('验收')

const WRITE_TOKEN = 'SESSION_PROJECT_WRITE_DONE'
const NOTE_FILENAME = 'session-project-acceptance-note.txt'
const NOTE_CONTENT = 'session-project-acceptance-ok'

type RunSummary = {
  reply: string
  normalizedReply: string
  callbackErrors: string[]
  toolStarts: Array<{ toolName: string; toolUseId: string }>
  toolResults: Array<{ toolName?: string; toolUseId: string; isError: boolean }>
  errors: Array<{ type: 'error' | 'typed_error'; message: string; title?: string; code?: string }>
  eventTypes: string[]
  newMessages: Array<{ role: AgentMessage['role']; content: string }>
}

type EventRecord = {
  sessionId: string
  event: AgentEvent
}

export type SessionProjectAcceptanceReport = {
  startedAt: string
  finishedAt: string
  channelId: string
  modelId: string
  sessionId: string
  initialProject: {
    projectPath: string
    projectSource: SessionMeta['project']['source']
    projectProfileId: string
  }
  lockedProject: {
    projectPath: string
    projectSource: SessionMeta['project']['source']
    projectProfileId: string
    projectLockedAt: number
  }
  permissions: Array<{
    requestId: string
    toolName: string
    description: string
    dangerLevel: string
  }>
  writeRun: RunSummary
  continuationRun: RunSummary
  readRun: RunSummary
  filesystem: {
    notePath: string
    noteContent: string
    projectDirExistsAfterRun: boolean
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function createHeadlessWebContents(): WebContents {
  return {
    send: () => {},
    isDestroyed: () => false,
  } as unknown as WebContents
}

function normalizeReply(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/)
  const unfenced = fenced?.[1] ?? trimmed
  return unfenced.trim().replace(/^["'`]+|["'`]+$/g, '')
}

function summarizeMessages(messages: AgentMessage[]): Array<{ role: AgentMessage['role']; content: string }> {
  return messages.map((message) => ({
    role: message.role,
    content: message.content.slice(0, 200),
  }))
}

function toAgentLikeMessages(sessionId: string, messageCountBefore: number): AgentMessage[] {
  return getSessionMessages(sessionId)
    .slice(messageCountBefore)
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      id: message.id,
      role: message.role === 'assistant' || message.role === 'status' || message.role === 'tool'
        ? message.role
        : 'user',
      content: message.content,
      createdAt: message.createdAt,
      model: message.model,
      attachments: message.attachments,
      events: message.events,
      errorCode: message.errorCode,
      errorTitle: message.errorTitle,
      errorDetails: message.errorDetails,
      errorOriginal: message.errorOriginal,
      errorCanRetry: message.errorCanRetry,
      errorActions: message.errorActions,
    }))
}

async function runPrompt(input: {
  sessionId: string
  channelId: string
  modelId: string
  prompt: string
  observedEvents: EventRecord[]
  webContents: WebContents
}): Promise<RunSummary> {
  const sessionService = createDefaultSessionService(input.webContents)
  const messageCountBefore = getSessionMessages(input.sessionId).length
  const eventCountBefore = input.observedEvents.length
  const callbackErrors: string[] = []

  await sessionService.sendMessage({
    sessionId: input.sessionId,
    userMessage: input.prompt,
    channelId: input.channelId,
    modelId: input.modelId,
  }, input.webContents).catch((error) => {
    callbackErrors.push(error instanceof Error ? error.message : String(error))
    throw error
  })

  const newMessages = toAgentLikeMessages(input.sessionId, messageCountBefore)
  const assistantMessage = [...newMessages].reverse().find((message) => message.role === 'assistant')
  assert(
    assistantMessage,
    `本轮没有生成 assistant 消息。新增消息: ${JSON.stringify(summarizeMessages(newMessages), null, 2)}`,
  )

  const messageEvents = newMessages.flatMap((message) => message.events ?? [])
  const liveEvents = input.observedEvents.slice(eventCountBefore).map((record) => record.event)
  const mergedEvents = [...liveEvents, ...messageEvents]
  const errors: RunSummary['errors'] = []

  for (const event of mergedEvents) {
    if (event.type === 'error') {
      errors.push({ type: 'error', message: event.message })
      continue
    }

    if (event.type === 'typed_error') {
      errors.push({
        type: 'typed_error',
        message: event.error.message,
        title: event.error.title,
        code: event.error.code,
      })
    }
  }

  return {
    reply: assistantMessage.content,
    normalizedReply: normalizeReply(assistantMessage.content),
    callbackErrors,
    toolStarts: mergedEvents
      .filter((event): event is Extract<AgentEvent, { type: 'tool_start' }> => event.type === 'tool_start')
      .map((event) => ({ toolName: event.toolName, toolUseId: event.toolUseId })),
    toolResults: mergedEvents
      .filter((event): event is Extract<AgentEvent, { type: 'tool_result' }> => event.type === 'tool_result')
      .map((event) => ({
        toolName: event.toolName,
        toolUseId: event.toolUseId,
        isError: event.isError,
      })),
    errors,
    eventTypes: mergedEvents.map((event) => event.type),
    newMessages: summarizeMessages(newMessages),
  }
}

export async function runSessionProjectAcceptance(): Promise<SessionProjectAcceptanceReport> {
  const settings = getSettings()
  const channelId = process.env.KILA_ACCEPTANCE_CHANNEL_ID || settings.agentChannelId
  const modelId = process.env.KILA_ACCEPTANCE_MODEL_ID || settings.agentModelId

  assert(channelId, '未在 ~/.kila/settings.json 中找到 agentChannelId')
  assert(modelId, '未在 ~/.kila/settings.json 中找到 agentModelId')

  const channel = getChannelById(channelId)
  assert(channel, `渠道不存在: ${channelId}`)
  assert(channel.enabled, `渠道未启用: ${channelId}`)

  const startedAtMs = Date.now()
  const observedEvents: EventRecord[] = []
  const observedPermissions: PermissionRequest[] = []
  const webContents = createHeadlessWebContents()
  const session = createSession({
    title: 'Session project acceptance',
    channelId,
    modelId,
  })
  const sessionId = session.id
  let succeeded = false

  const initialProject = {
    projectPath: session.project.path,
    projectSource: session.project.source,
    projectProfileId: session.project.profileId,
  }
  const notePath = join(initialProject.projectPath, NOTE_FILENAME)

  const cleanup = async (): Promise<void> => {
    try {
      await deleteSessionWithCleanup(sessionId)
    } catch (error) {
      log.warn('[验收] 删除临时会话失败:', error)
    }
  }

  const unsubscribe = agentEventBus.on((eventSessionId, event) => {
    if (eventSessionId !== sessionId) return

    observedEvents.push({ sessionId: eventSessionId, event })

    if (event.type === 'permission_request') {
      observedPermissions.push(event.request)
      permissionService.respondToPermission(event.request.requestId, 'allow', false)
    }
  })

  try {
    assert(initialProject.projectSource === 'temp', `新会话默认项目目录不是 temp: ${JSON.stringify(initialProject)}`)
    assert(existsSync(initialProject.projectPath), `初始项目目录不存在: ${initialProject.projectPath}`)

    const writeRun = await runPrompt({
      sessionId,
      channelId,
      modelId,
      observedEvents,
      webContents,
      prompt: [
        `You must use the Write tool to create ${NOTE_FILENAME} in the current project directory.`,
        `The file content must be exactly: ${NOTE_CONTENT}`,
        `Do not use Bash. Do not use Edit. Reply with exactly ${WRITE_TOKEN} and nothing else after the file is written.`,
      ].join(' '),
    })

    assert(
      writeRun.normalizedReply === WRITE_TOKEN,
      `写入轮回复不符合预期: ${JSON.stringify(writeRun, null, 2)}`,
    )
    assert(
      writeRun.toolStarts.some((tool) => tool.toolName === 'Write'),
      `写入轮未观察到 Write 工具启动: ${JSON.stringify(writeRun, null, 2)}`,
    )
    assert(
      writeRun.toolResults.some((tool) => tool.toolName === 'Write' && !tool.isError),
      `写入轮未观察到成功的 Write 工具结果: ${JSON.stringify(writeRun, null, 2)}`,
    )
    assert(
      observedPermissions.some((request) => request.toolName === 'Write'),
      `未观察到 Write 权限请求: ${JSON.stringify(observedPermissions, null, 2)}`,
    )
    assert(existsSync(notePath), `项目目录文件不存在: ${notePath}`)

    const lockedMeta = getSessionMeta(sessionId)
    assert(lockedMeta, `会话不存在: ${sessionId}`)
    assert(lockedMeta.project.path === initialProject.projectPath, '首条消息后 projectPath 不应改变')
    assert(lockedMeta.project.profileId === initialProject.projectProfileId, '首条消息后 profileId 不应改变')
    assert(typeof lockedMeta.project.lockedAt === 'number', `首条消息后项目目录未锁定: ${JSON.stringify(lockedMeta.project)}`)

    const noteContent = readFileSync(notePath, 'utf-8')
    assert(
      noteContent.trim() === NOTE_CONTENT,
      `项目目录文件内容不符合预期: ${JSON.stringify(noteContent)}`,
    )

    const continuationRun = await runPrompt({
      sessionId,
      channelId,
      modelId,
      observedEvents,
      webContents,
      prompt: 'What exact confirmation token did you reply with in the previous assistant message? Reply with the token only.',
    })

    assert(
      continuationRun.normalizedReply === WRITE_TOKEN,
      `续聊轮未正确复述上轮 token: ${JSON.stringify(continuationRun, null, 2)}`,
    )

    const readRun = await runPrompt({
      sessionId,
      channelId,
      modelId,
      observedEvents,
      webContents,
      prompt: [
        `You must use the Read tool to read ${NOTE_FILENAME} in the current project directory.`,
        'Do not answer from memory.',
        `Reply with exactly ${NOTE_CONTENT} and nothing else.`,
      ].join(' '),
    })

    assert(
      readRun.normalizedReply === NOTE_CONTENT,
      `读取轮回复不符合预期: ${JSON.stringify(readRun, null, 2)}`,
    )
    assert(
      readRun.toolStarts.some((tool) => tool.toolName === 'Read'),
      `读取轮未观察到 Read 工具启动: ${JSON.stringify(readRun, null, 2)}`,
    )
    assert(
      readRun.toolResults.some((tool) => tool.toolName === 'Read' && !tool.isError),
      `读取轮未观察到成功的 Read 工具结果: ${JSON.stringify(readRun, null, 2)}`,
    )

    succeeded = true

    return {
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date().toISOString(),
      channelId,
      modelId,
      sessionId,
      initialProject,
      lockedProject: {
        projectPath: lockedMeta.project.path,
        projectSource: lockedMeta.project.source,
        projectProfileId: lockedMeta.project.profileId,
        projectLockedAt: lockedMeta.project.lockedAt!,
      },
      permissions: observedPermissions.map((request) => ({
        requestId: request.requestId,
        toolName: request.toolName,
        description: request.description,
        dangerLevel: request.dangerLevel,
      })),
      writeRun,
      continuationRun,
      readRun,
      filesystem: {
        notePath,
        noteContent,
        projectDirExistsAfterRun: existsSync(initialProject.projectPath),
      },
    }
  } finally {
    unsubscribe()
    if (succeeded || process.env.KILA_ACCEPTANCE_KEEP_FAILURE !== '1') {
      await cleanup()
    } else {
      log.warn('[验收] 已保留失败现场，便于排查')
    }
  }
}
