import { IPC_CHANNELS } from '@kila/shared/ipc'
import type { RuntimeStatus } from '@kila/shared'
import { invoke } from '../invoke'

export interface RuntimePreloadApi {
  /** 获取 Bun、Git 等本地运行时状态。 */
  getRuntimeStatus: () => Promise<RuntimeStatus | null>
}

export function createRuntimeApi(): RuntimePreloadApi {
  return {
    getRuntimeStatus: () => invoke(IPC_CHANNELS.GET_RUNTIME_STATUS),
  }
}
