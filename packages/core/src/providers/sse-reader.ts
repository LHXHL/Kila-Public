/**
 * 供应商非流式请求执行器
 *
 * 主链路流式已由 Pi runtime 接管，core 的 SSE 流式机器已整体移除。
 * 本文件只保留两条仍在使用的非流式辅助请求：
 * - fetchTitle：会话标题生成
 * - fetchVisionDescription：图片视觉描述
 *
 * 注意：core 是共享包，不能引入主进程 logger。
 * 为避免泄漏用户会话内容与 Provider 原始响应，这里不打印任何请求体/响应体。
 */

import type { ProviderAdapter, ProviderRequest } from './types.ts'

/**
 * 执行非流式标题生成请求
 *
 * @param request 构建好的 HTTP 请求配置
 * @param adapter 供应商适配器（用于解析响应）
 * @returns 提取的标题文本，失败返回 null
 */
export async function fetchTitle(
  request: ProviderRequest,
  adapter: ProviderAdapter,
  fetchFn: typeof globalThis.fetch = fetch,
): Promise<string | null> {
  try {
    const response = await fetchFn(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
    })

    if (!response.ok) {
      return null
    }

    const data: unknown = await response.json()
    return adapter.parseTitleResponse(data)
  } catch {
    return null
  }
}

/**
 * 调用视觉模型获取图片描述（非流式）
 *
 * 复用 fetchTitle 的请求/响应模式，
 * 区别是请求中包含图片数据、max_tokens 更大。
 */
export async function fetchVisionDescription(
  request: ProviderRequest,
  adapter: ProviderAdapter,
  fetchFn: typeof globalThis.fetch = fetch,
): Promise<string | null> {
  try {
    const response = await fetchFn(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
    })

    if (!response.ok) {
      return null
    }

    const data: unknown = await response.json()
    return adapter.parseVisionResponse(data)
  } catch {
    return null
  }
}
