import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import type {
  AgentEvent,
  AskUserRequest,
  CliAskUserResponseRequest,
  CliPermissionResponseRequest,
  CliRunCompleteReason,
  CliRunRequest,
  KilaPermissionMode,
  PermissionRequest,
} from '@kila/shared'
import { connectToBridgeOrThrow, type CliBridgeClient } from '../client/bridge-client'
import { getLastTouchedSessionId, rememberLastTouchedSessionId } from '../client/cli-state'
import type { ParsedArgs } from '../args'
import { getBooleanFlag, getStringFlag } from '../args'
import { printJson } from '../format/json-output'
import { StreamPrinter } from '../format/stream-printer'
import { truncate } from '../format/tables'
import { promptForAskUser } from '../interactive/ask-user-prompt'
import { promptForPermission } from '../interactive/permission-prompt'

type PendingInteraction =
  | { kind: 'permission'; request: PermissionRequest }
  | { kind: 'ask-user'; request: AskUserRequest }

interface RunCommandResult {
  sessionId: string | null
  reason: CliRunCompleteReason | null
  assistantText: string
  error: string | null
}

async function readStdinIfNeeded(): Promise<string> {
  if (process.stdin.isTTY) {
    return ''
  }

  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf-8').trim()
}

function buildMessage(prompt: string, stdinText: string): string {
  if (prompt && stdinText) {
    return `${prompt}\n\n${stdinText}`.trim()
  }
  return (prompt || stdinText).trim()
}

function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

async function promptForResumeMessage(): Promise<string> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    return (await readline.question('prompt> ')).trim()
  } finally {
    readline.close()
  }
}

async function getLatestAssistantText(
  client: CliBridgeClient,
  sessionId: string,
): Promise<string> {
  const response = await client.getSessionMessages(sessionId, 100)
  for (let index = response.messages.length - 1; index >= 0; index -= 1) {
    const message = response.messages[index]
    if (message?.role === 'assistant' && message.content.trim()) {
      return message.content
    }
  }
  return ''
}

function formatToolStatus(event: Extract<AgentEvent, { type: 'tool_start' | 'tool_update' | 'tool_result' }>): string {
  switch (event.type) {
    case 'tool_start':
      return `tool ${event.toolName} started`
    case 'tool_update':
      return `tool ${event.toolName ?? event.toolUseId}: ${truncate(event.partialText, 80)}`
    case 'tool_result':
      return `tool ${event.toolName ?? event.toolUseId} ${event.isError ? 'failed' : 'finished'}`
  }
}

export async function runRunCommand(args: ParsedArgs): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const noStream = getBooleanFlag(args, 'no-stream')
  const verbose = getBooleanFlag(args, 'verbose')
  const rawResumeValue = args.flags.get('resume')
  const resumeFlag = rawResumeValue === true
  const cwdFlag = getStringFlag(args, 'cwd')
  const channelRef = getStringFlag(args, 'channel')
  const modelId = getStringFlag(args, 'model')
  const permissionMode = getStringFlag(args, 'permission-mode')

  if (permissionMode && permissionMode !== 'auto' && permissionMode !== 'smart') {
    throw new Error(`无效的 permission mode: ${permissionMode}`)
  }

  const resolvedPermissionMode = permissionMode as KilaPermissionMode | undefined

  const stdinText = await readStdinIfNeeded()
  let prompt = args.positionals.join(' ').trim()
  let requestedSessionRef = getStringFlag(args, 'session')
  let implicitResumeRequested = false

  if (!requestedSessionRef && typeof rawResumeValue === 'string') {
    requestedSessionRef = rawResumeValue
  } else if (!requestedSessionRef && resumeFlag) {
    requestedSessionRef = getLastTouchedSessionId() ?? undefined
    implicitResumeRequested = true
  }

  if (requestedSessionRef && cwdFlag) {
    throw new Error('--cwd 仅允许用于新 session')
  }

  const printer = new StreamPrinter()
  let activeSessionId: string | null = null
  let finalReason: CliRunCompleteReason | null = null
  let streamError: string | null = null
  let sawTextDelta = false
  let receivedBridgeEvent = false
  let stopRequested = false
  let queueRunning = false
  const dismissedRequestIds = new Set<string>()
  const interactionQueue: PendingInteraction[] = []

  const processInteractionQueue = async (): Promise<void> => {
    if (queueRunning) return
    queueRunning = true

    try {
      while (interactionQueue.length > 0) {
        const item = interactionQueue.shift()
        if (!item) continue

        const requestId = item.kind === 'permission'
          ? item.request.requestId
          : item.request.requestId
        if (dismissedRequestIds.has(requestId)) {
          continue
        }

        if (!isInteractiveTerminal()) {
          streamError = item.kind === 'permission'
            ? `非交互终端无法响应权限请求: ${item.request.toolName}`
            : '非交互终端无法响应 AskUser 请求'
          printer.printInfo(`[kila] ${streamError}`)
          if (activeSessionId) {
            await client.stopSession(activeSessionId).catch(() => {})
          }
          return
        }

        printer.stopLoading()

        if (item.kind === 'permission') {
          const response: CliPermissionResponseRequest = await promptForPermission(item.request)
          dismissedRequestIds.add(response.requestId)
          await client.respondToPermission(response)
        } else {
          const response: CliAskUserResponseRequest = await promptForAskUser(item.request)
          dismissedRequestIds.add(response.requestId)
          await client.respondToAskUser(response)
        }
      }
    } finally {
      queueRunning = false
    }
  }

  const sigintHandler = (): void => {
    if (stopRequested) {
      process.stderr.write('\n[kila] force exit\n')
      process.exit(130)
    }

    stopRequested = true
    if (!activeSessionId) {
      process.stderr.write('\n')
      process.exit(130)
    }

    printer.printInfo(`\n[kila] stopping session ${activeSessionId}... press Ctrl+C again to force exit`)
    void client.stopSession(activeSessionId).catch((error) => {
      printer.printInfo(`[kila] stop failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  process.on('SIGINT', sigintHandler)

  try {
    let sessionId: string | undefined
    if (requestedSessionRef) {
      try {
        sessionId = await client.resolveSessionId(requestedSessionRef)
      } catch (error) {
        if (typeof rawResumeValue === 'string' && !getStringFlag(args, 'session')) {
          const fallbackSessionId = getLastTouchedSessionId()
          if (!fallbackSessionId) {
            throw error
          }

          prompt = [rawResumeValue, ...args.positionals].join(' ').trim()
          sessionId = fallbackSessionId
          implicitResumeRequested = true
        } else {
          throw error
        }
      }
    }

    if (implicitResumeRequested && !sessionId) {
      throw new Error('没有可恢复的最近 CLI session')
    }

    const channelId = channelRef
      ? await client.resolveChannelId(channelRef)
      : undefined
    let message = buildMessage(prompt, stdinText)
    if (!message && typeof rawResumeValue !== 'undefined' && isInteractiveTerminal()) {
      prompt = await promptForResumeMessage()
      message = buildMessage(prompt, stdinText)
    }
    if (!message) {
      throw new Error('缺少 prompt 或 stdin 输入')
    }
    const request: CliRunRequest = {
      message,
      sessionId,
      projectPath: sessionId ? undefined : resolve(cwdFlag ?? process.cwd()),
      channelId,
      modelId,
      ...(resolvedPermissionMode ? { permissionModeOverride: resolvedPermissionMode } : {}),
    }

    activeSessionId = sessionId ?? null

    if (!asJson) {
      printer.startLoading()
    }

    for await (const event of client.run(request)) {
      receivedBridgeEvent = true

      switch (event.event) {
        case 'session_created':
          activeSessionId = event.data.session.id
          if (verbose && !asJson) {
            printer.printInfo(`[kila] session ${activeSessionId} created`)
          }
          break

        case 'session_stream':
          if (event.data.type !== 'agent_event') break

          switch (event.data.event.type) {
            case 'text_delta':
              sawTextDelta = true
              if (!asJson && !noStream) {
                printer.printText(event.data.event.text)
              }
              break

            case 'tool_start':
            case 'tool_update':
            case 'tool_result':
              if (!asJson) {
                if (verbose) {
                  printer.printInfo(`[${event.data.event.type}] ${formatToolStatus(event.data.event)}`)
                } else {
                  printer.setStatus(formatToolStatus(event.data.event))
                }
              }
              break

            case 'permission_request':
              interactionQueue.push({ kind: 'permission', request: event.data.event.request })
              await processInteractionQueue()
              break

            case 'ask_user_request':
              interactionQueue.push({ kind: 'ask-user', request: event.data.event.request })
              await processInteractionQueue()
              break

            case 'permission_resolved':
            case 'ask_user_resolved':
              dismissedRequestIds.add(event.data.event.requestId)
              break

            case 'typed_error':
              streamError = event.data.event.error.message
              if (!asJson) {
                printer.printInfo(`[error] ${streamError}`)
              }
              break

            case 'error':
              streamError = event.data.event.message
              if (!asJson) {
                printer.printInfo(`[error] ${streamError}`)
              }
              break

            default:
              if (verbose && !asJson && (
                event.data.event.type.startsWith('thinking_')
                || event.data.event.type.startsWith('retry_')
                || event.data.event.type === 'usage_update'
              )) {
                printer.printInfo(`[${event.data.event.type}]`)
              }
              break
          }
          break

        case 'title_updated':
          if (verbose && !asJson) {
            printer.printInfo(`[kila] title updated: ${event.data.title}`)
          }
          break

        case 'session_error':
          streamError = event.data.error
          if (!asJson) {
            printer.printInfo(`[error] ${streamError}`)
          }
          break

        case 'session_complete':
          finalReason = event.data.reason
          break

        case 'session_updated':
          break
      }
    }
  } catch (error) {
    streamError = error instanceof Error ? error.message : String(error)
    finalReason = 'error'
    if (!asJson) {
      printer.printInfo(`[error] ${streamError}`)
    }
  } finally {
    process.off('SIGINT', sigintHandler)
    printer.stopLoading()
    printer.clearStatus()
  }

  const assistantText = activeSessionId && receivedBridgeEvent
    ? await getLatestAssistantText(client, activeSessionId).catch(() => '')
    : ''

  if (activeSessionId) {
    rememberLastTouchedSessionId(activeSessionId)
  }

  if (asJson) {
    printJson({
      sessionId: activeSessionId,
      reason: finalReason,
      assistantText,
      error: streamError,
    } satisfies RunCommandResult)
  } else {
    if ((noStream || !sawTextDelta) && assistantText) {
      process.stdout.write(assistantText)
      if (!assistantText.endsWith('\n')) {
        process.stdout.write('\n')
      }
    } else if (sawTextDelta) {
      printer.ensureTrailingNewline()
    }

    if (activeSessionId) {
      printer.printInfo(`[kila] session ${activeSessionId} — use \`kila run --session ${activeSessionId}\` to continue`)
    }
  }

  if (streamError || finalReason === 'error') {
    return 1
  }
  if (stopRequested) {
    return 130
  }
  if (finalReason === 'stopped') {
    return 1
  }
  return 0
}
