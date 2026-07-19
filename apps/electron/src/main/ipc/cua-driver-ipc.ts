/**
 * Cua Driver IPC 处理器
 *
 * 处理渲染进程对 cua-driver 状态查询、检测、安装和开关的请求。
 */

import { CUA_DRIVER_IPC_CHANNELS } from '@kila/shared'
import { handle } from './shared'
import { assertBoolean } from './validation'
import {
  getCuaDriverStatus,
  detectCuaDriver,
  installCuaDriver,
  toggleCuaDriver,
  testCuaDriverConnection,
} from '../lib/cua-driver-service'

export function registerCuaDriverHandlers(): void {
  // 获取 Cua Driver 状态
  handle(
    CUA_DRIVER_IPC_CHANNELS.GET_STATUS,
    async () => {
      return getCuaDriverStatus()
    },
  )

  // 检测本地安装
  handle(
    CUA_DRIVER_IPC_CHANNELS.DETECT,
    async () => {
      return detectCuaDriver()
    },
  )

  // 安装 Cua Driver
  handle(
    CUA_DRIVER_IPC_CHANNELS.INSTALL,
    async () => {
      return installCuaDriver()
    },
  )

  // 启用/禁用
  handle(
    CUA_DRIVER_IPC_CHANNELS.TOGGLE,
    async (_, enabled: boolean) => {
      return toggleCuaDriver(assertBoolean(enabled, 'enabled'))
    },
  )

  // 测试连接
  handle(
    CUA_DRIVER_IPC_CHANNELS.TEST,
    async () => {
      return testCuaDriverConnection()
    },
  )
}
