import type { MemoryDistillThreadMessage } from './types'

/**
 * 线程同步分批参数。
 *
 * Nowledge 的线程写入路径（创建 / 追加）会对每条消息做嵌入、去重与索引，
 * 长会话一次性全量发送容易撞上客户端超时（历史上线程同步失败全部是
 * 30s 超时：42 次 append + 22 次创建）。分批发送把单请求负载控制在服务器
 * 可快速处理的量级，且每批成功即推进 lastAppendedMessageSeq，中途失败时
 * 下一轮只补发剩余批次，不再整轮全量重发。
 */
export const THREAD_SYNC_BATCH_SIZE = 10

/** 单批消息总字符数上限；单条消息超限时该消息单独成批，避免单请求负载过大 */
export const THREAD_SYNC_BATCH_MAX_CHARS = 100_000

export interface ThreadBatch {
  /** 该批在全局消息序列中的结束位置（不含），用于推进 lastAppendedMessageSeq */
  endSeq: number
  messages: MemoryDistillThreadMessage[]
}

/** 按条数与字符数上限把消息切成顺序批次 */
export function chunkThreadMessages(
  messages: MemoryDistillThreadMessage[],
  options: { size?: number; maxChars?: number } = {},
): ThreadBatch[] {
  const size = options.size ?? THREAD_SYNC_BATCH_SIZE
  const maxChars = options.maxChars ?? THREAD_SYNC_BATCH_MAX_CHARS

  const batches: ThreadBatch[] = []
  let current: MemoryDistillThreadMessage[] = []
  let currentChars = 0
  let cursor = 0

  const flush = (): void => {
    if (current.length === 0) return
    batches.push({ endSeq: cursor, messages: current })
    current = []
    currentChars = 0
  }

  for (const message of messages) {
    const messageChars = message.content.length
    // 当前批非空且会超限（条数或字符数）时先收尾再开新批；
    // 单条超限消息在空批中单独入批，由下一条触发收尾。
    if (current.length > 0 && (current.length >= size || currentChars + messageChars > maxChars)) {
      flush()
    }
    current.push(message)
    currentChars += messageChars
    cursor += 1
    if (current.length >= size) flush()
  }
  flush()

  return batches
}
