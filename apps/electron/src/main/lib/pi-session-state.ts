import { rmSync } from 'node:fs'
import { getPiSessionDir } from './config-paths'
import { createLogger } from './logger'

const log = createLogger('PiSessionState')

/**
 * 删除指定 Session 的 Pi sidecar（turn tree / compaction / model state）。
 * 下次运行会从 Kila JSONL transcript 重新建立 runtime 状态。
 */
export function clearPiSessionState(sessionId: string): void {
  try {
    rmSync(getPiSessionDir(sessionId), { recursive: true, force: true })
    log.info(`[Pi Session] 已清理 sessionId=${sessionId} 的持久化状态`)
  } catch (error) {
    log.warn(`[Pi Session] 清理 sessionId=${sessionId} 失败:`, error)
  }
}
