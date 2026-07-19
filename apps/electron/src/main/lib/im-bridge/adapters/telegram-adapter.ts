import type { FileAttachment, TelegramBridgeConfig } from '@kila/shared'
import type { BridgeTestResult } from '@kila/shared'
import { BaseImAdapter } from './base-adapter'
import type { BridgeAttachmentReference, BridgeOutboundMessage, BridgePermissionPromptMessage } from './base-adapter'
import { downloadTelegramAttachments } from './telegram-files'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

interface TelegramAdapterDeps {
  getConfig: () => TelegramBridgeConfig
  fetchImpl?: FetchLike
  getPollOffset?: () => number | undefined
  setPollOffset?: (offset: number) => void
}

interface TelegramApiPayload<T> {
  ok?: boolean
  result?: T
  description?: string
}

function buildCallbackData(
  behavior: 'allow' | 'deny',
  callbackToken: string,
  alwaysAllow: boolean,
): string {
  return `imbridge|${behavior}|${callbackToken}|${alwaysAllow ? 'always' : 'once'}`
}

function parseCallbackData(data: string | undefined): { behavior: 'allow' | 'deny'; callbackToken: string; alwaysAllow: boolean } | null {
  if (!data) return null
  const [prefix, behavior, callbackToken, mode] = data.split('|')
  if (prefix !== 'imbridge') return null
  if (behavior !== 'allow' && behavior !== 'deny') return null
  if (!callbackToken) return null

  return {
    behavior,
    callbackToken,
    alwaysAllow: mode === 'always',
  }
}

async function readTelegramApiResult<T>(response: Response, context: string): Promise<T> {
  let payload: TelegramApiPayload<T> | null = null

  try {
    payload = await response.json() as TelegramApiPayload<T>
  } catch {
    payload = null
  }

  if (!response.ok) {
    const detail = payload?.description?.trim()
    throw new Error(detail
      ? `${context}失败 (${response.status}: ${detail})`
      : `${context}失败 (${response.status})`)
  }

  if (!payload?.ok) {
    const detail = payload?.description?.trim()
    throw new Error(detail ? `${context}失败: ${detail}` : `${context}失败`)
  }

  return payload.result as T
}

export class TelegramAdapter extends BaseImAdapter {
  readonly channelType = 'telegram' as const
  private readonly fetchImpl: FetchLike
  private abortController: AbortController | null = null
  private pollPromise: Promise<void> | null = null

  constructor(private readonly deps: TelegramAdapterDeps) {
    super('telegram')
    this.fetchImpl = deps.fetchImpl ?? fetch
  }

  private get config(): TelegramBridgeConfig {
    return this.deps.getConfig()
  }

  async testConnection(): Promise<BridgeTestResult> {
    const token = this.config.botToken.trim()
    if (!token) {
      return { channel: 'telegram', success: false, message: '缺少 Telegram 机器人令牌' }
    }

    try {
      const response = await this.fetchImpl(`https://api.telegram.org/bot${token}/getMe`)
      const result = await readTelegramApiResult<{ username?: string }>(response, 'Telegram 连接检测')
      return {
        channel: 'telegram',
        success: true,
        message: `Telegram 机器人已连接 @${result?.username ?? 'bot'}`,
      }
    } catch (error) {
      return {
        channel: 'telegram',
        success: false,
        message: error instanceof Error ? error.message : 'Telegram 连接失败',
      }
    }
  }

  async start(): Promise<void> {
    if (this.abortController) return

    const result = await this.testConnection()
    if (!result.success) {
      this.updateStatus({
        enabled: this.config.enabled,
        status: 'error',
        errorMessage: result.message,
      })
      throw new Error(result.message)
    }

    this.abortController = new AbortController()
    this.updateStatus({
      enabled: this.config.enabled,
      status: 'connected',
      connectedAt: Date.now(),
      lastConnectedAt: Date.now(),
      errorMessage: undefined,
    })
    this.pollPromise = this.pollLoop(this.abortController.signal)
  }

  stop(): void {
    this.abortController?.abort()
    this.abortController = null
    this.pollPromise = null
    this.updateStatus({
      enabled: this.config.enabled,
      status: 'disconnected',
      errorMessage: undefined,
    })
  }

  private async pollLoop(signal: AbortSignal): Promise<void> {
    let nextOffset = this.deps.getPollOffset?.()

    while (!signal.aborted) {
      try {
        const response = await this.fetchImpl(`https://api.telegram.org/bot${this.config.botToken}/getUpdates`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            timeout: 25,
            offset: nextOffset,
            allowed_updates: ['message', 'callback_query'],
          }),
          signal,
        })
        const updates = await readTelegramApiResult<Array<Record<string, any>>>(response, 'Telegram 轮询')

        for (const update of updates ?? []) {
          await this.handleUpdate(update)
          if (typeof update.update_id === 'number') {
            nextOffset = update.update_id + 1
            this.deps.setPollOffset?.(nextOffset)
          }
        }
      } catch (error) {
        if (signal.aborted) return
        this.updateStatus({
          enabled: this.config.enabled,
          status: 'error',
          errorMessage: error instanceof Error ? error.message : String(error),
        })
        await new Promise((resolve) => setTimeout(resolve, 1500))
        this.updateStatus({
          enabled: this.config.enabled,
          status: 'connected',
          errorMessage: undefined,
          lastConnectedAt: Date.now(),
        })
      }
    }
  }

  async handleUpdate(update: Record<string, any>): Promise<void> {
    const callbackQuery = update.callback_query
    if (callbackQuery) {
      const parsed = parseCallbackData(callbackQuery.data)
      if (!parsed) return

      const response = await this.fetchImpl(`https://api.telegram.org/bot${this.config.botToken}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQuery.id,
        }),
      })
      await readTelegramApiResult<boolean>(response, 'Telegram 回调确认')

      const chatId = String(callbackQuery.message?.chat?.id ?? '')
      this.emit({
        type: 'permission_action',
        action: {
          channelType: 'telegram',
          endpointKey: `telegram:${chatId}`,
          chatId,
          userId: String(callbackQuery.from?.id ?? ''),
          callbackToken: parsed.callbackToken,
          behavior: parsed.behavior,
          alwaysAllow: parsed.alwaysAllow,
        },
      })
      return
    }

    const message = update.message
    if (!message || message.chat?.type !== 'private') return

    const userId = String(message.from?.id ?? '')
    if (
      this.config.allowedUserIds.length > 0
      && !this.config.allowedUserIds.includes(userId)
    ) {
      return
    }

    const chatId = String(message.chat?.id ?? '')
    const attachments: BridgeAttachmentReference[] = []

    if (message.document?.file_id) {
      attachments.push({
        remoteId: String(message.document.file_id),
        filename: String(message.document.file_name ?? 'telegram-document'),
        mediaType: String(message.document.mime_type ?? 'application/octet-stream'),
        size: Number(message.document.file_size ?? 0),
      })
    }

    if (Array.isArray(message.photo) && message.photo.length > 0) {
      const bestPhoto = message.photo[message.photo.length - 1]
      attachments.push({
        remoteId: String(bestPhoto.file_id),
        filename: `telegram-photo-${bestPhoto.file_id}.jpg`,
        mediaType: 'image/jpeg',
        size: Number(bestPhoto.file_size ?? 0),
      })
    }

    this.emit({
      type: 'message',
      message: {
        channelType: 'telegram',
        endpointKey: `telegram:${chatId}`,
        chatId,
        userId,
        displayName: message.from?.username ? `@${message.from.username}` : 'Telegram 私聊',
        messageId: String(message.message_id ?? ''),
        text: String(message.text ?? message.caption ?? ''),
        attachments,
      },
    })
  }

  async sendMessage(input: BridgeOutboundMessage): Promise<void> {
    const response = await this.fetchImpl(`https://api.telegram.org/bot${this.config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: input.chatId,
        text: input.text,
        parse_mode: input.parseMode,
        disable_web_page_preview: true,
      }),
    })
    await readTelegramApiResult<Record<string, unknown>>(response, 'Telegram 消息发送')
  }

  async sendPermissionPrompt(input: BridgePermissionPromptMessage): Promise<void> {
    const response = await this.fetchImpl(`https://api.telegram.org/bot${this.config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: input.chatId,
        text: input.promptText,
        reply_markup: {
          inline_keyboard: [[
            { text: '允许一次', callback_data: buildCallbackData('allow', input.callbackToken, false) },
            { text: '总是允许', callback_data: buildCallbackData('allow', input.callbackToken, true) },
            { text: '拒绝', callback_data: buildCallbackData('deny', input.callbackToken, false) },
          ]],
        },
      }),
    })
    await readTelegramApiResult<Record<string, unknown>>(response, 'Telegram 权限提示发送')
  }

  async downloadAttachments(attachments: BridgeAttachmentReference[], sessionId: string): Promise<FileAttachment[]> {
    return downloadTelegramAttachments({
      fetchImpl: this.fetchImpl,
      botToken: this.config.botToken,
      attachments,
      sessionId,
    })
  }
}
