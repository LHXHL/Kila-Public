import type { FeishuWsClientLike, LarkWsClientLike } from './lark-sdk-types'

/**
 * 把 lark WSClient 包装成适配器内部的长连接契约。
 *
 * 注意：`@larksuiteoapi/node-sdk` 的 WSClient 只提供 `close()`，从来没有 `stop()`。
 * 历史实现写成 `(ws as any).stop?.()`，被 `any` 掩盖后成了永远不执行的空操作 ——
 * 结果是 FeishuAdapter.stop() 无法真正断开长连接。这里统一收敛到 `close()`。
 */
export function wrapLarkWsClient(
  ws: LarkWsClientLike,
  eventDispatcher: unknown,
): FeishuWsClientLike {
  return {
    start: async () => { await ws.start({ eventDispatcher }) },
    stop: () => ws.close(),
  }
}
