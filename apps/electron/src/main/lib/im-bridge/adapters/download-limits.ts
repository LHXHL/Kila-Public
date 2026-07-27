/**
 * 入站附件下载的统一防护
 *
 * 历史缺陷：`discord-files.ts` 不检查 `response.ok` 就 `arrayBuffer()` 全量进内存，
 * 且 telegram/discord 下载路径都没有字节上限，只有 `wechat/media-service.ts` 做对了。
 * 这里把「先看 content-length，再看真实字节数」的判定抽成共用函数。
 */

export const DEFAULT_MAX_INBOUND_FILE_BYTES = 10 * 1024 * 1024

export class InboundAttachmentTooLargeError extends Error {
  constructor(filename: string, size: number, maxBytes: number) {
    super(`入站附件超过大小上限：${filename}（${size} > ${maxBytes} 字节）`)
    this.name = 'InboundAttachmentTooLargeError'
  }
}

export function assertDownloadResponseOk(response: Response, filename: string): void {
  if (response.ok) return
  throw new Error(`入站附件下载失败：${filename} (${response.status})`)
}

/** 下载前的预检：content-length 已超阈值就直接中止，避免整份文件进内存 */
export function assertDeclaredSizeWithinLimit(
  response: Response,
  filename: string,
  maxBytes: number,
): void {
  const declared = Number(response.headers?.get?.('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new InboundAttachmentTooLargeError(filename, declared, maxBytes)
  }
}

/** 下载后的复检：部分服务端不返回 content-length，仍需按真实字节数拦截 */
export function assertActualSizeWithinLimit(
  byteLength: number,
  filename: string,
  maxBytes: number,
): void {
  if (byteLength > maxBytes) {
    throw new InboundAttachmentTooLargeError(filename, byteLength, maxBytes)
  }
}
