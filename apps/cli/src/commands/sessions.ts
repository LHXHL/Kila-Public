import type { SessionMessage, ThinkingLevel } from '@kila/shared'
import { connectToBridgeOrThrow } from '../client/bridge-client'
import { getLastTouchedSessionId, rememberLastTouchedSessionId } from '../client/cli-state'
import type { ParsedArgs } from '../args'
import { getBooleanFlag, getStringFlag } from '../args'
import { printHint, withHint } from '../format/hints'
import { printJson } from '../format/json-output'
import { formatRelativeTime, formatTable, truncate } from '../format/tables'

function formatMessageRole(message: SessionMessage): string {
  const source = message.messageSource && message.messageSource !== 'manual'
    ? ` [${message.messageSource}]`
    : ''
  return `${message.role}${source}`
}

export async function runSessionsCommand(args: ParsedArgs): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const limit = Number(getStringFlag(args, 'limit') ?? '20')
  const response = await client.listSessions(Number.isFinite(limit) && limit > 0 ? limit : 20)

  if (asJson) {
    printJson(response)
    return 0
  }

  const table = formatTable(
    ['ID', 'TITLE', 'MODEL', 'UPDATED', 'MESSAGES'],
    response.sessions.map((session) => [
      session.id.slice(0, 8),
      truncate(session.title, 28),
      truncate(session.modelId ?? '-', 20),
      formatRelativeTime(session.updatedAt),
      String(session.messageCount),
    ]),
  )
  process.stdout.write(`${table}\n`)
  printHint('运行 `kila session show <id>` 查看详情，或 `kila run --session <id> "继续"` 续聊')
  return 0
}

export async function runSessionShowCommand(args: ParsedArgs): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const sessionRef = args.positionals[0] ?? getLastTouchedSessionId()
  if (!sessionRef) {
    throw new Error(withHint(
      '缺少 session id 或前缀。',
      '`kila sessions` 查看最近会话',
    ))
  }

  const sessionId = await client.resolveSessionId(sessionRef)
  const response = await client.getSession(sessionId)
  rememberLastTouchedSessionId(sessionId)

  if (asJson) {
    printJson(response)
    return 0
  }

  const { session } = response
  process.stdout.write(`ID: ${session.id}\n`)
  process.stdout.write(`Title: ${session.title}\n`)
  process.stdout.write(`Project: ${session.projectPath}\n`)
  process.stdout.write(`Channel: ${session.channelId ?? '-'}\n`)
  process.stdout.write(`Model: ${session.modelId ?? '-'}\n`)
  process.stdout.write(`Thinking: ${session.thinkingLevel ?? '-'}\n`)
  process.stdout.write(`History turns: ${session.historyTurns ?? '-'}\n`)
  process.stdout.write(`Pinned: ${session.pinned ? 'yes' : 'no'}\n`)
  process.stdout.write(`Updated: ${new Date(session.updatedAt).toISOString()}\n`)
  process.stdout.write(`Messages: ${session.messageCount}\n`)
  printHint(`运行 \`kila session messages ${session.id}\` 查看消息，或 \`kila run --session ${session.id} "继续"\` 续聊`)
  return 0
}

export async function runSessionMessagesCommand(args: ParsedArgs): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const limit = Number(getStringFlag(args, 'limit') ?? '100')
  const sessionRef = args.positionals[0]
  if (!sessionRef) {
    throw new Error(withHint(
      '缺少 session id 或前缀。',
      '`kila sessions` 查看最近会话',
    ))
  }

  const sessionId = await client.resolveSessionId(sessionRef)
  const response = await client.getSessionMessages(
    sessionId,
    Number.isFinite(limit) && limit > 0 ? limit : 100,
  )
  rememberLastTouchedSessionId(sessionId)

  if (asJson) {
    printJson(response)
    return 0
  }

  for (const message of response.messages) {
    process.stdout.write(`[${new Date(message.createdAt).toISOString()}] ${formatMessageRole(message)}\n`)
    if (message.content.trim()) {
      process.stdout.write(`${message.content.trimEnd()}\n`)
    }
    if (message.attachments?.length) {
      process.stdout.write(`[attachments: ${message.attachments.length}]\n`)
    }
    process.stdout.write('\n')
  }

  return 0
}

export async function runSessionCreateCommand(args: ParsedArgs): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const cwd = getStringFlag(args, 'cwd')
  const title = getStringFlag(args, 'title')
  const channelRef = getStringFlag(args, 'channel')
  const modelId = getStringFlag(args, 'model')
  const channelId = channelRef ? await client.resolveChannelId(channelRef) : undefined
  const response = await client.createSession({
    title,
    projectPath: cwd,
    channelId,
    modelId,
  })
  rememberLastTouchedSessionId(response.session.id)

  if (asJson) {
    printJson(response)
    return 0
  }

  process.stdout.write(`[kila] created session ${response.session.id} (${response.session.title})\n`)
  return 0
}

export async function runSessionSwitchCommand(args: ParsedArgs): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const sessionRef = args.positionals[0]
  if (!sessionRef) {
    throw new Error(withHint(
      '缺少 session id 或前缀。',
      '`kila sessions` 查看最近会话',
    ))
  }

  const sessionId = await client.resolveSessionId(sessionRef)
  const response = await client.getSession(sessionId)
  rememberLastTouchedSessionId(sessionId)

  if (asJson) {
    printJson({ activeSessionId: sessionId, session: response.session })
    return 0
  }

  process.stdout.write(`[kila] active CLI session -> ${sessionId}\n`)
  printHint(`运行 \`kila run --session ${sessionId} "继续"\` 使用该会话`)
  return 0
}

export async function runSessionStopCommand(args: ParsedArgs): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const sessionRef = args.positionals[0] ?? getLastTouchedSessionId()
  if (!sessionRef) {
    throw new Error(withHint(
      '缺少 session id 或前缀。',
      '`kila sessions` 查看最近会话',
    ))
  }

  const sessionId = await client.resolveSessionId(sessionRef)
  await client.stopSession(sessionId)
  rememberLastTouchedSessionId(sessionId)

  if (asJson) {
    printJson({ sessionId, stopped: true })
    return 0
  }

  process.stdout.write(`[kila] stopped session ${sessionId}\n`)
  printHint(`运行 \`kila session show ${sessionId}\` 检查状态`)
  return 0
}

export async function runSessionUpdateCommand(args: ParsedArgs): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const sessionRef = args.positionals[0]
  if (!sessionRef) {
    throw new Error(withHint(
      '缺少 session id 或前缀。',
      '`kila sessions` 查看最近会话',
    ))
  }

  const channelRef = getStringFlag(args, 'channel')
  const modelId = getStringFlag(args, 'model')
  const thinkingLevel = getStringFlag(args, 'thinking') as ThinkingLevel | undefined
  const historyTurns = getStringFlag(args, 'history')

  if (!channelRef && !modelId && !thinkingLevel && !historyTurns) {
    throw new Error(withHint(
      '至少指定一个要更新的字段：--channel, --model, --thinking, --history',
      '`kila session update <id> --model glm-5.1`',
    ))
  }

  const sessionId = await client.resolveSessionId(sessionRef)

  let channelId: string | undefined
  if (channelRef) {
    channelId = await client.resolveChannelId(channelRef)
  } else if (modelId) {
    // --model 未指定 --channel 时，自动查找包含该模型的渠道
    const { channels } = await client.listChannels()
    const matches = channels.filter((ch) =>
      ch.models.some((m) => m.id === modelId && m.enabled),
    )
    if (matches.length === 0) {
      throw new Error(withHint(
        `没有渠道包含模型 ${modelId}。`,
        '`kila channels` 查看可用渠道和模型',
      ))
    }
    if (matches.length > 1) {
      const names = matches.map((ch) => `${ch.name} (${ch.id})`).join(', ')
      throw new Error(withHint(
        `模型 ${modelId} 存在于多个渠道：${names}。请用 --channel 指定。`,
        '`kila session update <id> --channel <name> --model <modelId>`',
      ))
    }
    channelId = matches[0]!.id
  }

  const updates: Record<string, unknown> = {}
  if (channelId) updates.channelId = channelId
  if (modelId) updates.modelId = modelId
  if (thinkingLevel) updates.thinkingLevel = thinkingLevel
  if (historyTurns) {
    updates.historyTurns = historyTurns === 'infinite' ? 'infinite' : Number(historyTurns)
  }

  const response = await client.updateSession(sessionId, updates)
  rememberLastTouchedSessionId(sessionId)

  if (asJson) {
    printJson(response)
    return 0
  }

  const s = response.session
  const parts: string[] = []
  if (channelId) parts.push(`channel=${s.channelId ?? '-'}`)
  if (modelId) parts.push(`model=${s.modelId ?? '-'}`)
  if (thinkingLevel) parts.push(`thinking=${s.thinkingLevel ?? '-'}`)
  if (historyTurns) parts.push(`history=${s.historyTurns ?? '-'}`)
  process.stdout.write(`[kila] updated session ${sessionId}: ${parts.join(', ')}\n`)
  return 0
}

export async function runSessionRenameCommand(args: ParsedArgs): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const sessionRef = args.positionals[0]
  const title = args.positionals.slice(1).join(' ').trim()
  if (!sessionRef) {
    throw new Error(withHint(
      '缺少 session id 或前缀。',
      '`kila sessions` 查看最近会话',
    ))
  }
  if (!title) {
    throw new Error(withHint(
      '缺少新的 session 标题。',
      '`kila session rename <id> "<new title>"`',
    ))
  }

  const sessionId = await client.resolveSessionId(sessionRef)
  const response = await client.updateSession(sessionId, { title })
  rememberLastTouchedSessionId(sessionId)

  if (asJson) {
    printJson(response)
    return 0
  }

  process.stdout.write(`[kila] renamed session ${sessionId} -> ${response.session.title}\n`)
  printHint(`运行 \`kila session show ${sessionId}\` 验证标题`)
  return 0
}

export async function runSessionDeleteCommand(args: ParsedArgs): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const confirmed = getBooleanFlag(args, 'yes')
  const sessionRef = args.positionals[0]
  if (!sessionRef) {
    throw new Error(withHint(
      '缺少 session id 或前缀。',
      '`kila sessions` 查看最近会话',
    ))
  }
  if (!confirmed) {
    throw new Error(withHint(
      '删除 session 需要显式传入 --yes。',
      '`kila session delete <id> --yes`',
    ))
  }

  const sessionId = await client.resolveSessionId(sessionRef)
  await client.deleteSession(sessionId)

  if (asJson) {
    printJson({ sessionId, deleted: true })
    return 0
  }

  process.stdout.write(`[kila] deleted session ${sessionId}\n`)
  return 0
}
