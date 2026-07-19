import { ipcRenderer } from 'electron'
import { typedInvoke } from '@kila/shared/ipc'
import type { IpcArgs, IpcContractChannel, IpcResult } from '@kila/shared/ipc'

/**
 * 类型安全的 IPC invoke 封装。
 * 所有 Preload API 模块通过这里调用主进程，避免重复依赖 Electron 细节。
 */
export function invoke<K extends IpcContractChannel>(
  channel: K,
  ...args: IpcArgs<K>
): Promise<IpcResult<K>> {
  return typedInvoke(ipcRenderer, channel, ...args)
}
