const TOOL_UPDATE_BATCH_WINDOW_MS = 50
const TOOL_UPDATE_BATCH_BYTES = 32 * 1024

/** 将工具增量按时间或大小合并，并保持发送顺序。 */
export class RuntimeToolUpdateAggregator {
  private buffer = ''
  private bufferBytes = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private sendChain = Promise.resolve()
  private failure: Error | undefined

  constructor(private readonly send: (text: string) => Promise<void>) {}

  push(text: string): Promise<void> {
    if (this.failure) return Promise.reject(this.failure)
    this.buffer += text
    this.bufferBytes += Buffer.byteLength(text, 'utf8')
    if (this.bufferBytes >= TOOL_UPDATE_BATCH_BYTES) return this.flush()
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined
        void this.flush().catch((error: unknown) => {
          this.failure = error instanceof Error ? error : new Error(String(error))
        })
      }, TOOL_UPDATE_BATCH_WINDOW_MS)
      this.timer.unref?.()
    }
    return Promise.resolve()
  }

  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.failure) return Promise.reject(this.failure)
    if (!this.buffer) return this.sendChain
    const text = this.buffer
    this.buffer = ''
    this.bufferBytes = 0
    this.sendChain = this.sendChain.then(() => this.send(text))
    return this.sendChain.catch((error: unknown) => {
      this.failure = error instanceof Error ? error : new Error(String(error))
      throw this.failure
    })
  }

  async close(): Promise<void> {
    await this.flush()
  }
}
