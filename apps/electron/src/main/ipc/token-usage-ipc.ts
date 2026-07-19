/**
 * Token 使用统计 IPC 处理器 + 事件追踪初始化
 */

import { TOKEN_USAGE_IPC_CHANNELS } from '@kila/shared'
import type { TokenUsageStats } from '@kila/shared'
import { handle } from './shared'
import { getTokenUsageStats } from '../lib/token-usage-service'

export function registerTokenUsageHandlers(): void {
  handle(
    TOKEN_USAGE_IPC_CHANNELS.GET_STATS,
    async (_, days: number): Promise<TokenUsageStats> => {
      return getTokenUsageStats(days)
    },
  )
}
