export type SleepBlockerType = 'prevent-display-sleep'

export interface SleepBlockerAdapter {
  start(type: SleepBlockerType): number
  stop(id: number): void
  isStarted(id: number): boolean
}

export function shouldPreventSleepForFeishuMirror(input: { mode?: string } | undefined): boolean {
  return input?.mode === 'stream'
}

export class FeishuMirrorSleepBlocker {
  private activeBlockerId: number | null = null

  constructor(private readonly adapter: SleepBlockerAdapter) {}

  sync(input: { mode?: string } | undefined): void {
    if (shouldPreventSleepForFeishuMirror(input)) {
      this.start()
      return
    }
    this.stop()
  }

  stop(): void {
    if (this.activeBlockerId === null) return

    const blockerId = this.activeBlockerId
    this.activeBlockerId = null
    if (this.adapter.isStarted(blockerId)) {
      this.adapter.stop(blockerId)
      console.log('[飞书防休眠] 已关闭')
    }
  }

  private start(): void {
    if (this.activeBlockerId !== null) {
      if (this.adapter.isStarted(this.activeBlockerId)) return
      this.activeBlockerId = null
    }

    this.activeBlockerId = this.adapter.start('prevent-display-sleep')
    console.log('[飞书防休眠] 已启用，会话镜像期间阻止系统自动休眠')
  }
}
