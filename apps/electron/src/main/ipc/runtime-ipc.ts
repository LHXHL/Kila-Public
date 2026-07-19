/**
 * 运行时状态 IPC 处理器
 *
 * 运行时检测、Git 状态、外部链接
 */

import { shell } from 'electron'
import { IPC_CHANNELS } from '@kila/shared'
import type { RuntimeStatus, GitRepoStatus } from '@kila/shared'
import { handle } from './shared'
import { getRuntimeStatus, getGitRepoStatus } from '../lib/runtime-init'


import { createLogger } from '../lib/logger'
const log = createLogger('IPC')

export function registerRuntimeHandlers(): void {
  // 获取运行时状态
  handle(
    IPC_CHANNELS.GET_RUNTIME_STATUS,
    async (): Promise<RuntimeStatus | null> => {
      return getRuntimeStatus()
    }
  )

  // 获取指定目录的 Git 仓库状态
  handle(
    IPC_CHANNELS.GET_GIT_REPO_STATUS,
    async (_, dirPath: string): Promise<GitRepoStatus | null> => {
      if (!dirPath || typeof dirPath !== 'string') {
        log.warn('[IPC] git:get-repo-status 收到无效的目录路径')
        return null
      }
      return getGitRepoStatus(dirPath)
    }
  )

  // 在系统默认浏览器中打开外部链接
  handle(
    IPC_CHANNELS.OPEN_EXTERNAL,
    async (_, url: string): Promise<void> => {
      if (!url || typeof url !== 'string') {
        log.warn('[IPC] shell:open-external 收到无效的 URL')
        return
      }
      // 仅允许 http/https 协议，防止安全风险
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        log.warn('[IPC] shell:open-external 仅支持 http/https 协议:', url)
        return
      }
      await shell.openExternal(url)
    }
  )
}
