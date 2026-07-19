/**
 * 代理 Fetch 工具
 *
 * 基于 undici ProxyAgent 创建支持 HTTP 代理的 fetch 函数。
 * 用于渠道配置了代理地址时，让 AI API 请求走指定代理。
 * [Native-feel] 提供全局统一的网络请求兜底超时策略，防止请求死锁。
 */

import { ProxyAgent, fetch as undiciFetch } from 'undici'
import type { RequestInfo, RequestInit } from 'undici'

/** 统一全局超时兜底时长（30秒） */
const GLOBAL_FETCH_TIMEOUT_MS = 30_000

/**
 * 为 fetch 配置注入默认超时信号
 */
function withDefaultTimeout(init?: RequestInit | globalThis.RequestInit): RequestInit | globalThis.RequestInit {
  if (init?.signal) return init || {}
  return {
    ...init,
    signal: AbortSignal.timeout(GLOBAL_FETCH_TIMEOUT_MS),
  }
}

/**
 * 创建代理 fetch 函数
 *
 * @param proxyUrl 代理地址（如 http://127.0.0.1:7890）
 * @returns 走代理的 fetch 函数，签名兼容全局 fetch
 */
export function createProxyFetch(proxyUrl: string): typeof globalThis.fetch {
  const dispatcher = new ProxyAgent(proxyUrl)

  return ((input: RequestInfo | URL, init?: RequestInit) => {
    return undiciFetch(input as RequestInfo, {
      ...(withDefaultTimeout(init) as RequestInit),
      dispatcher,
    })
  }) as unknown as typeof globalThis.fetch
}

/**
 * 创建带超时兜底的普通 fetch 函数
 */
const timeoutFetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  return fetch(input, withDefaultTimeout(init) as Parameters<typeof fetch>[1])
}) as typeof globalThis.fetch

/**
 * 根据代理地址获取 fetch 函数
 *
 * 如果 proxyUrl 有值则返回代理 fetch，否则返回带有超时机制的兜底 fetch。
 */
export function getFetchFn(proxyUrl?: string): typeof globalThis.fetch {
  if (proxyUrl?.trim()) {
    return createProxyFetch(proxyUrl.trim())
  }
  return timeoutFetch
}
