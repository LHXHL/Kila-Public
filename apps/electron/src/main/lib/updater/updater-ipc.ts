/**
 * 自动更新 IPC 处理器
 *
 * 注册更新相关的 IPC 通道，供渲染进程调用。
 * 仅支持检查更新和获取状态，不提供下载/安装功能。
 */

import { UPDATER_IPC_CHANNELS } from './updater-types'
import type { UpdateStatus } from './updater-types'
import { handleUntyped } from '../../ipc/shared'
import {
  checkForUpdates,
  getUpdateStatus,
} from './auto-updater'

/** 注册更新 IPC 处理器 */

import { createLogger } from '../logger'
const log = createLogger('更新 IPC')

export function registerUpdaterIpc(): void {
  log.info('[更新 IPC] 正在注册更新 IPC 处理器...')

  // 检查更新
  handleUntyped(
    UPDATER_IPC_CHANNELS.CHECK_FOR_UPDATES,
    async (): Promise<void> => {
      await checkForUpdates()
    }
  )

  // 获取当前更新状态
  handleUntyped(
    UPDATER_IPC_CHANNELS.GET_STATUS,
    async (): Promise<UpdateStatus> => {
      return getUpdateStatus()
    }
  )

  log.info('[更新 IPC] 更新 IPC 处理器注册完成')
}
