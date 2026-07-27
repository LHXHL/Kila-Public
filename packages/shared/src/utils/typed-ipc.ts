/**
 * Typed IPC — 类型安全的 IPC handler/invoke 工具函数
 *
 * 在 main 侧使用 typedHandle 注册 handler，
 * 在 preload 侧使用 typedInvoke / buildTypedApi 生成桥接。
 *
 * 两者都从 IpcContract 推导类型，编译器自动捕获任何漂移。
 *
 * 关于事件类型：shared 层被 main / preload / renderer / cli 共用，不能依赖 electron 类型，
 * 因此把 Electron 注入的 invoke 事件抽成泛型参数 TEvent，由调用方（main/ipc/shared.ts）
 * 钉死为 Electron.IpcMainInvokeEvent，shared 层自身保持零 electron 依赖且不使用 any。
 */

import type { IpcContractChannel, IpcArgs, IpcResult } from '../types/ipc-contract'

// ===== Main process 侧 =====

/** Electron ipcMain 的最小结构约束（只取用到的 handle 方法） */
export interface IpcMainLike<TEvent> {
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: readonly unknown[]) => unknown,
  ) => void
}

/**
 * 类型安全的 ipcMain.handle 注册
 *
 * handler 的 args 和 return 类型由 IpcContract 推导，
 * event 类型由调用方通过 TEvent 指定（运行时由 Electron 注入）。
 *
 * 用法：
 * ```ts
 * typedHandle(ipcMain, 'channel:list', async (_event) => {
 *   return listChannels()
 * })
 * ```
 */
export function typedHandle<K extends IpcContractChannel, TEvent>(
  ipcMain: IpcMainLike<TEvent>,
  channel: K,
  handler: (event: TEvent, ...args: IpcArgs<K>) => Promise<IpcResult<K>>,
): void {
  ipcMain.handle(channel, (event, ...args) =>
    handler(event, ...(args as unknown as IpcArgs<K>)),
  )
}

// ===== Preload 侧 =====

/** Electron ipcRenderer 的最小结构约束（只取用到的 invoke 方法） */
export interface IpcRendererLike {
  invoke: (channel: string, ...args: readonly unknown[]) => Promise<unknown>
}

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
  ipcRenderer: IpcRendererLike,
  channel: K,
  ...args: IpcArgs<K>
): Promise<IpcResult<K>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<K>>
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
  ipcRenderer: IpcRendererLike,
  channels: readonly K[],
): { [C in K]: (...args: IpcArgs<C>) => Promise<IpcResult<C>> } {
  const api: Record<string, (...args: readonly unknown[]) => Promise<unknown>> = {}
  for (const channel of channels) {
    api[channel] = (...args) => ipcRenderer.invoke(channel, ...args)
  }
  return api as unknown as { [C in K]: (...args: IpcArgs<C>) => Promise<IpcResult<C>> }
}
