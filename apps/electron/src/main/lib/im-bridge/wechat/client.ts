import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import type { BridgeOutboundAttachment } from '@kila/shared'
import type {
  WeChatCredential,
  WeChatIlinkGetConfigResponse,
  WeChatIlinkLoginResponse,
  WeChatIlinkLoginStatusResponse,
  WeChatIlinkUpdateBatch,
} from './types'
import { DEFAULT_WECHAT_ILINK_BASE_URL } from './types'
import { getFetchFn } from '../../proxy-fetch'
import { getEffectiveProxyUrl } from '../../proxy-settings-service'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type IlinkApiResult<T> = T & {
  ret?: number
  errcode?: number
  errmsg?: string
}

const LEGACY_WECHAT_ILINK_BASE_URL = 'https://api-bot.weixin.qq.com'

interface WeChatIlinkClientDeps {
  credential?: WeChatCredential
  baseUrl?: string
  fetchImpl?: FetchLike
  getProxyUrl?: () => Promise<string | undefined>
}

interface WeChatApiEnvelope<T> {
  data?: T
  result?: T
  error?: string
  errmsg?: string
  message?: string
  errcode?: number
  code?: number
}

function normalizeBaseUrl(baseUrl?: string): string {
  const value = (baseUrl || DEFAULT_WECHAT_ILINK_BASE_URL).trim()
  if (!value || value === LEGACY_WECHAT_ILINK_BASE_URL) {
    return DEFAULT_WECHAT_ILINK_BASE_URL
  }
  return value.replace(/\/+$/, '')
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

function generateWechatUin(): string {
  const value = randomBytes(4).readUInt32LE()
  return Buffer.from(String(value)).toString('base64')
}

function getApiError(payload: WeChatApiEnvelope<unknown> | null): string | null {
  if (!payload) return null
  const code = payload.errcode ?? payload.code
  if (typeof code === 'number' && code !== 0) {
    return payload.errmsg || payload.error || payload.message || `iLink error ${code}`
  }
  if (payload.error) return payload.error
  return null
}

async function readJsonResponse<T>(response: Response, context: string): Promise<T> {
  let payload: WeChatApiEnvelope<T> | T | null = null
  try {
    payload = await response.json() as WeChatApiEnvelope<T> | T
  } catch {
    payload = null
  }

  if (!response.ok) {
    const detail = payload && typeof payload === 'object'
      ? ((payload as WeChatApiEnvelope<T>).errmsg || (payload as WeChatApiEnvelope<T>).message || response.statusText)
      : response.statusText
    throw new Error(`${context} failed (${response.status}${detail ? `: ${detail}` : ''})`)
  }

  if (payload && typeof payload === 'object') {
    const envelope = payload as WeChatApiEnvelope<T>
    if (typeof envelope.data !== 'undefined') {
      const error = getApiError(envelope)
      if (error) throw new Error(`${context} failed: ${error}`)
      return envelope.data
    }
    if (typeof envelope.result !== 'undefined') {
      const error = getApiError(envelope)
      if (error) throw new Error(`${context} failed: ${error}`)
      return envelope.result
    }
  }

  return payload as T
}

function assertIlinkOk<T>(result: IlinkApiResult<T>, context: string): T {
  const ret = result.ret
  const errcode = result.errcode
  if ((typeof ret === 'number' && ret !== 0) || (typeof errcode === 'number' && errcode !== 0)) {
    throw new Error(`${context} failed: ${result.errmsg || `ret=${ret ?? 'n/a'} errcode=${errcode ?? 'n/a'}`}`)
  }
  return result
}

export class WeChatIlinkClient {
  private readonly getProxyUrl: () => Promise<string | undefined>
  private readonly baseUrl: string
  private readonly wechatUin: string

  constructor(private readonly deps: WeChatIlinkClientDeps = {}) {
    this.getProxyUrl = deps.getProxyUrl ?? getEffectiveProxyUrl
    this.baseUrl = normalizeBaseUrl(deps.credential?.baseUrl || deps.baseUrl)
    this.wechatUin = generateWechatUin()
  }

  private get credential(): WeChatCredential | undefined {
    return this.deps.credential
  }

  private headers(json = true): HeadersInit {
    const headers: Record<string, string> = {}
    if (json) headers['content-type'] = 'application/json'
    if (this.credential?.botToken) {
      headers.Authorization = `Bearer ${this.credential.botToken}`
      headers.AuthorizationType = 'ilink_bot_token'
    }
    if (this.credential?.botToken) {
      headers['X-WECHAT-UIN'] = this.wechatUin
    }
    return headers
  }

  private async get<T>(
    path: string,
    input?: {
      signal?: AbortSignal
    },
  ): Promise<T> {
    const url = `${this.baseUrl}${normalizePath(path)}`
    let response: Response
    try {
      const proxyUrl = this.deps.fetchImpl ? undefined : await this.getProxyUrl()
      const fetchImpl = this.deps.fetchImpl ?? getFetchFn(proxyUrl)
      response = await fetchImpl(url, {
        method: 'GET',
        signal: input?.signal,
      })
    } catch (error) {
      const cause = error instanceof Error && error.cause instanceof Error
        ? `: ${error.cause.message}`
        : error instanceof Error
          ? `: ${error.message}`
          : ''
      throw new Error(`WeChat iLink request failed (${url})${cause}`)
    }
    return readJsonResponse<T>(response, path)
  }

  private async request<T>(
    path: string,
    input?: {
      method?: string
      body?: Record<string, unknown>
      signal?: AbortSignal
    },
  ): Promise<T> {
    const url = `${this.baseUrl}${normalizePath(path)}`
    let response: Response
    try {
      const proxyUrl = this.deps.fetchImpl ? undefined : await this.getProxyUrl()
      const fetchImpl = this.deps.fetchImpl ?? getFetchFn(proxyUrl)
      response = await fetchImpl(url, {
        method: input?.method ?? 'POST',
        headers: this.headers(),
        body: input?.body ? JSON.stringify(input.body) : undefined,
        signal: input?.signal,
      })
    } catch (error) {
      const cause = error instanceof Error && error.cause instanceof Error
        ? `: ${error.cause.message}`
        : error instanceof Error
          ? `: ${error.message}`
          : ''
      throw new Error(`WeChat iLink request failed (${url})${cause}`)
    }
    return readJsonResponse<T>(response, path)
  }

  startLogin(input?: { accountId?: string; label?: string; botType?: string }): Promise<WeChatIlinkLoginResponse> {
    const botType = encodeURIComponent(input?.botType || '3')
    return this.get<WeChatIlinkLoginResponse>(`/ilink/bot/get_bot_qrcode?bot_type=${botType}`)
  }

  refreshLogin(ticket: string): Promise<WeChatIlinkLoginStatusResponse> {
    return this.get<WeChatIlinkLoginStatusResponse>(`/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(ticket)}`)
  }

  getConfig(input?: { userId?: string; contextToken?: string }): Promise<WeChatIlinkGetConfigResponse> {
    return this.request<IlinkApiResult<WeChatIlinkGetConfigResponse>>('/ilink/bot/getconfig', {
      body: {
        ilink_user_id: input?.userId ?? this.credential?.ilinkUserId,
        context_token: input?.contextToken,
        base_info: {},
      },
    }).then((result) => assertIlinkOk(result, 'getconfig'))
  }

  getUpdates(input: {
    getUpdatesBuf?: string
    timeoutSeconds?: number
    signal?: AbortSignal
  }): Promise<WeChatIlinkUpdateBatch> {
    return this.request<WeChatIlinkUpdateBatch>('/ilink/bot/getupdates', {
      body: {
        get_updates_buf: input.getUpdatesBuf,
        base_info: { channel_version: '1.0.0' },
      },
      signal: input.signal,
    })
  }

  sendTyping(input: { userId: string; typingTicket: string; status: 'typing' | 'cancel' }): Promise<void> {
    return this.request<IlinkApiResult<Record<string, unknown>>>('/ilink/bot/sendtyping', {
      body: {
        ilink_user_id: input.userId,
        typing_ticket: input.typingTicket,
        status: input.status === 'typing' ? 1 : 0,
        base_info: {},
      },
    }).then((result) => {
      assertIlinkOk(result, 'sendtyping')
    })
  }

  sendMessage(input: {
    contextToken: string
    toUserId: string
    text?: string
    attachments?: BridgeOutboundAttachment[]
  }): Promise<void> {
    return this.request<IlinkApiResult<Record<string, unknown>>>('/ilink/bot/sendmessage', {
      body: {
        msg: {
          from_user_id: this.credential?.ilinkBotId,
          to_user_id: input.toUserId,
          client_id: `kila_${Date.now()}`,
          message_type: 2,
          message_state: 2,
          item_list: input.text
            ? [{ type: 1, text_item: { text: input.text } }]
            : input.attachments?.map((attachment) => ({
              type: attachment.mediaType.startsWith('image/') ? 2 : 4,
              file_item: {
                file_name: attachment.filename,
                media: {
                  encrypt_query_param: attachment.providerPayload?.wechat?.encryptQueryParam,
                  aes_key: attachment.providerPayload?.wechat?.aesKey,
                  full_url: attachment.providerPayload?.wechat?.cdnUrl,
                },
              },
            })),
          context_token: input.contextToken,
        },
        base_info: {},
      },
    }).then((result) => {
      assertIlinkOk(result, 'sendmessage')
    })
  }

  async uploadAttachment(input: {
    localPath: string
    filename: string
    mediaType: string
  }): Promise<BridgeOutboundAttachment> {
    const upload = await this.request<IlinkApiResult<{
      upload_url?: string
      file_id?: string
      file_key?: string
      headers?: Record<string, string>
    }>>('/ilink/bot/getuploadurl', {
      body: {
        filename: input.filename,
        media_type: input.mediaType,
      },
    }).then((result) => assertIlinkOk(result, 'getuploadurl'))

    if (!upload.upload_url) {
      throw new Error('iLink upload URL is missing')
    }

    const data = readFileSync(input.localPath)
    const proxyUrl = this.deps.fetchImpl ? undefined : await this.getProxyUrl()
    const fetchImpl = this.deps.fetchImpl ?? getFetchFn(proxyUrl)
    const response = await fetchImpl(upload.upload_url, {
      method: 'PUT',
      headers: {
        ...(upload.headers ?? {}),
        'content-type': input.mediaType,
      },
      body: data,
    })
    if (!response.ok) {
      throw new Error(`WeChat media upload failed (${response.status})`)
    }

    return {
      remoteId: upload.file_id || input.filename,
      filename: input.filename,
      mediaType: input.mediaType,
      size: data.byteLength,
      localPath: input.localPath,
      providerPayload: {
        wechat: {
          accountId: this.credential?.accountId ?? '',
          fileId: upload.file_id,
          fileKey: upload.file_key,
        },
      },
    }
  }
}
