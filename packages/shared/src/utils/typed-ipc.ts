/**
 * Typed IPC — 类型安全的 IPC handler/invoke 工具函数
 *
 * 在 main 侧使用 typedHandle 注册 handler，
 * 在 preload 侧使用 typedInvoke / buildTypedApi 生成桥接。
 *
 * 两者都从 IpcContract 推导类型，编译器自动捕获任何漂移。
 */

import type { IpcContractChannel, IpcArgs, IpcResult } from '../types/ipc-contract'

// ===== Main process 侧 =====

/**
 * 类型安全的 ipcMain.handle 注册
 *
 * handler 的 args 和 return 类型由 IpcContract 推导，
 * event 参数类型不限制（由 Electron 运行时注入 IpcMainInvokeEvent）。
 *
 * 用法：
 * ```ts
 * typedHandle(ipcMain, 'channel:list', async (_event) => {
 *   return listChannels()
 * })
 * ```
 */
export function typedHandle<K extends IpcContractChannel>(
  ipcMain: { handle: (...args: any[]) => any },
  channel: K,
  handler: (event: any, ...args: IpcArgs<K>) => Promise<IpcResult<K>>
): void {
  ipcMain.handle(channel, handler)
}

// ===== Preload 侧 =====

/**
 * 类型安全的 ipcRenderer.invoke 调用
 *
 * 用法：
 * ```ts
 * const channels = await typedInvoke(ipcRenderer, 'channel:list')
 * //    ^? Channel[]
 * ```
 */
export function typedInvoke<K extends IpcContractChannel>(
  ipcRenderer: { invoke: (...args: any[]) => any },
  channel: K,
  ...args: IpcArgs<K>
): Promise<IpcResult<K>> {
  return ipcRenderer.invoke(channel, ...args)
}

/**
 * 为 preload 批量生成类型安全的 API 方法
 *
 * 用法：
 * ```ts
 * const api = buildTypedApi(ipcRenderer, [
 *   'channel:list',
 *   'channel:create',
 * ] as const)
 *
 * // api['channel:list']()  => Promise<Channel[]>
 * // api['channel:create'](input) => Promise<Channel>
 * ```
 */
export function buildTypedApi<K extends IpcContractChannel>(
  ipcRenderer: { invoke: (...args: any[]) => any },
  channels: readonly K[]
): { [C in K]: (...args: IpcArgs<C>) => Promise<IpcResult<C>> } {
  const api = {} as Record<string, (...args: any[]) => any>
  for (const channel of channels) {
    api[channel] = (...args: any[]) => ipcRenderer.invoke(channel, ...args)
  }
  return api as { [C in K]: (...args: IpcArgs<C>) => Promise<IpcResult<C>> }
}
