/**
 * Provider DB IPC 处理器
 *
 * 暴露 3 个查询通道给渲染进程：
 * - provider-db:list       列出所有 DB provider 摘要（预设页用）
 * - provider-db:lookup     按 providerId 查完整 provider（含 models）
 * - provider-db:find-model 跨 provider 全局搜模型
 */

import { handle } from './shared'
import {
  findProviderDbModel,
  getProviderById,
  listProviderDbSummaries,
} from '../lib/provider-db-loader'

export function registerProviderDbHandlers(): void {
  handle('provider-db:list', async () => {
    return listProviderDbSummaries()
  })

  handle('provider-db:lookup', async (_, providerId: string) => {
    const provider = getProviderById(providerId)
    return provider ?? null
  })

  handle('provider-db:find-model', async (_, modelId: string) => {
    const hit = findProviderDbModel(modelId)
    return hit ?? null
  })
}
