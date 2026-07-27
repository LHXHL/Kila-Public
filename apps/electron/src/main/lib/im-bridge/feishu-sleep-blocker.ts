import { powerSaveBlocker } from 'electron'
import { FeishuMirrorSleepBlocker } from './feishu/sleep-blocker'
import type { SleepBlockerAdapter, SleepBlockerType } from './feishu/sleep-blocker'
import { imBridgeConfigManager } from './config-manager'
import { createLogger } from '../logger'

const log = createLogger('IM Bridge')

const electronSleepBlocker: SleepBlockerAdapter = {
  start: (type: SleepBlockerType): number => powerSaveBlocker.start(type),
  stop: (id: number): void => {
    powerSaveBlocker.stop(id)
  },
  isStarted: (id: number): boolean => powerSaveBlocker.isStarted(id),
}

const blocker = new FeishuMirrorSleepBlocker(electronSleepBlocker)

export function syncFeishuMirrorSleepBlocker(): void {
  try {
    blocker.sync(imBridgeConfigManager.getConfig().feishu.sessionMirror)
  } catch (error) {
    log.error('[IM Bridge][Feishu] 防休眠同步状态失败', error)
  }
}

export function stopFeishuMirrorSleepBlocker(): void {
  try {
    blocker.stop()
  } catch (error) {
    log.error('[IM Bridge][Feishu] 防休眠关闭失败', error)
  }
}
