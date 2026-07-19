import type { BridgeInboundMessage } from '../adapters/base-adapter'

interface WeChatMessageAggregatorDeps {
  aggregateWindowMs: () => number
  flush: (message: BridgeInboundMessage) => void | Promise<void>
  setTimeoutImpl?: typeof setTimeout
  clearTimeoutImpl?: typeof clearTimeout
}

interface PendingMessage {
  message: BridgeInboundMessage
  timer: ReturnType<typeof setTimeout>
}

function aggregateKey(message: BridgeInboundMessage): string {
  const ctx = message.providerContext?.wechat
  return `${ctx?.accountId ?? 'unknown'}:${ctx?.peerId ?? message.chatId}`
}

function mergeMessage(left: BridgeInboundMessage, right: BridgeInboundMessage): BridgeInboundMessage {
  const text = [left.text, right.text]
    .map((item) => item.trim())
    .filter(Boolean)
    .join('\n\n')
  const leftWechat = left.providerContext?.wechat
  const rightWechat = right.providerContext?.wechat
  const wechat = leftWechat && rightWechat
    ? {
      ...leftWechat,
      ...rightWechat,
    }
    : rightWechat ?? leftWechat

  return {
    ...left,
    ...right,
    text,
    attachments: [...left.attachments, ...right.attachments],
    providerContext: {
      ...left.providerContext,
      ...right.providerContext,
      ...(wechat ? { wechat } : {}),
    },
  }
}

export class WeChatMessageAggregator {
  private readonly pending = new Map<string, PendingMessage>()
  private readonly setTimeoutImpl: typeof setTimeout
  private readonly clearTimeoutImpl: typeof clearTimeout

  constructor(private readonly deps: WeChatMessageAggregatorDeps) {
    this.setTimeoutImpl = deps.setTimeoutImpl ?? setTimeout
    this.clearTimeoutImpl = deps.clearTimeoutImpl ?? clearTimeout
  }

  ingest(message: BridgeInboundMessage): void {
    const key = aggregateKey(message)
    const existing = this.pending.get(key)

    if (existing) {
      this.clearTimeoutImpl(existing.timer)
      existing.message = mergeMessage(existing.message, message)
      existing.timer = this.createTimer(key)
      return
    }

    this.pending.set(key, {
      message,
      timer: this.createTimer(key),
    })
  }

  flushAll(): void {
    for (const key of Array.from(this.pending.keys())) {
      this.flushKey(key)
    }
  }

  private createTimer(key: string): ReturnType<typeof setTimeout> {
    return this.setTimeoutImpl(() => {
      this.flushKey(key)
    }, this.deps.aggregateWindowMs())
  }

  private flushKey(key: string): void {
    const pending = this.pending.get(key)
    if (!pending) return
    this.pending.delete(key)
    void this.deps.flush(pending.message)
  }
}
