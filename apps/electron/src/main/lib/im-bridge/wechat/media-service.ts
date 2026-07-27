import { createDecipheriv } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { FileAttachment } from '@kila/shared'
import type { BridgeAttachmentReference } from '../adapters/base-adapter'
import { getImBridgeSessionFilesDir } from '../../config-paths-bridge'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

interface WeChatMediaServiceDeps {
  fetchImpl?: FetchLike
  maxBytes?: number
  /** 动态上限：跟随 `wechat.maxInboundFileBytes` 配置变化，优先于静态 maxBytes */
  getMaxBytes?: () => number
  allowedHosts?: string[]
}

const DEFAULT_ALLOWED_HOST_SUFFIXES = [
  '.weixin.qq.com',
  '.wechat.com',
  '.qpic.cn',
  '.qlogo.cn',
]
const DEFAULT_CDN_DOWNLOAD_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c/download'

function parseAesKey(value: string): Buffer {
  const trimmed = value.trim()
  const base64 = trimmed.replace(/-/g, '+').replace(/_/g, '/')
  const decoded = Buffer.from(base64, 'base64')
  if (decoded.byteLength === 16) return decoded
  if (decoded.byteLength === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString('ascii'))) {
    return Buffer.from(decoded.toString('ascii'), 'hex')
  }
  if (/^[a-f0-9]{32}$/i.test(trimmed)) return Buffer.from(trimmed, 'hex')
  return decoded
}

export function decryptWechatAes128Ecb(data: Buffer, aesKey: string): Buffer {
  const key = parseAesKey(aesKey)
  if (key.byteLength !== 16) {
    throw new Error('Invalid WeChat AES-128 key')
  }

  const decipher = createDecipheriv('aes-128-ecb', key, null)
  decipher.setAutoPadding(true)
  return Buffer.concat([decipher.update(data), decipher.final()])
}

function safeFilename(filename: string): string {
  const name = basename(filename).replace(/[^\w.\-()\s]/g, '_').trim()
  return name || `wechat-file-${Date.now()}`
}

function assertInside(parent: string, child: string): void {
  const root = resolve(parent)
  const target = resolve(child)
  if (!target.startsWith(`${root}/`) && target !== root) {
    throw new Error('Refusing to write WeChat attachment outside bridge files directory')
  }
}

export function isAllowedWechatMediaHost(hostname: string, allowedHosts = DEFAULT_ALLOWED_HOST_SUFFIXES): boolean {
  return allowedHosts.some((allowed) => {
    const normalized = allowed.toLowerCase()
    const host = hostname.toLowerCase()
    if (normalized.startsWith('.')) return host.endsWith(normalized)
    return host === normalized || host.endsWith(`.${normalized}`)
  })
}

function ensureAllowedHost(url: URL, allowedHosts: string[]): void {
  if (url.protocol !== 'https:') {
    throw new Error('WeChat attachment download requires HTTPS')
  }
  if (!isAllowedWechatMediaHost(url.hostname, allowedHosts)) {
    throw new Error(`WeChat attachment host is not allowed: ${url.hostname}`)
  }
}

export function buildWechatCdnDownloadUrl(encryptQueryParam?: string): string | null {
  const value = encryptQueryParam?.trim()
  if (!value) return null
  return `${DEFAULT_CDN_DOWNLOAD_BASE_URL}?encrypted_query_param=${encodeURIComponent(value)}`
}

export class WeChatMediaService {
  private readonly fetchImpl: FetchLike
  private readonly maxBytes: number
  private readonly allowedHosts: string[]

  constructor(private readonly deps: WeChatMediaServiceDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch
    this.maxBytes = deps.maxBytes ?? (25 * 1024 * 1024)
    this.allowedHosts = deps.allowedHosts ?? DEFAULT_ALLOWED_HOST_SUFFIXES
  }

  private get effectiveMaxBytes(): number {
    const configured = this.deps.getMaxBytes?.()
    return typeof configured === 'number' && configured > 0 ? configured : this.maxBytes
  }

  async downloadAttachments(attachments: BridgeAttachmentReference[], sessionId: string): Promise<FileAttachment[]> {
    const results: FileAttachment[] = []
    for (const attachment of attachments) {
      try {
        const downloaded = await this.downloadAttachment(attachment, sessionId)
        if (downloaded) results.push(downloaded)
      } catch {
        // Attachment failures are isolated so the text message can still run.
      }
    }
    return results
  }

  private async downloadAttachment(attachment: BridgeAttachmentReference, sessionId: string): Promise<FileAttachment | null> {
    const urlValue = attachment.downloadUrl
      || attachment.providerPayload?.wechat?.cdnUrl
      || buildWechatCdnDownloadUrl(attachment.providerPayload?.wechat?.encryptQueryParam)
    if (!urlValue) return null

    const url = new URL(urlValue)
    ensureAllowedHost(url, this.allowedHosts)
    const maxBytes = this.effectiveMaxBytes
    const response = await this.fetchImpl(url)
    if (!response.ok) {
      throw new Error(`WeChat attachment download failed (${response.status})`)
    }

    // 先看声明长度，避免超大文件整份进内存
    const declared = Number(response.headers?.get?.('content-length') ?? '')
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`WeChat attachment too large: ${attachment.filename}`)
    }

    const raw = Buffer.from(await response.arrayBuffer())
    if (raw.byteLength > maxBytes) {
      throw new Error(`WeChat attachment too large: ${attachment.filename}`)
    }

    const aesKey = attachment.providerPayload?.wechat?.aesKey
    const data = aesKey ? decryptWechatAes128Ecb(raw, aesKey) : raw
    const dir = getImBridgeSessionFilesDir(sessionId)
    const name = safeFilename(attachment.filename)
    let filePath = join(dir, name)
    let index = 1
    while (existsSync(filePath)) {
      filePath = join(dir, `${index}-${name}`)
      index += 1
    }

    assertInside(dir, filePath)
    writeFileSync(filePath, data)
    return {
      id: `wechat:${attachment.remoteId}`,
      filename: name,
      mediaType: attachment.mediaType,
      localPath: filePath,
      size: data.byteLength,
    }
  }
}
