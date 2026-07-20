import type { ChannelTestFailureKind, ErrorCode } from '@kila/shared'

export interface ProviderErrorClassification {
  failureKind: ChannelTestFailureKind
  errorCode: ErrorCode
  title: string
  message: string
  canRetry: boolean
  statusCode?: number
}

function extractStatusCode(message: string): number | undefined {
  const statusMatch = message.match(/(?:^|\D)([1-5]\d{2})(?:\D|$)/)
  if (!statusMatch) return undefined
  const value = Number(statusMatch[1])
  return Number.isInteger(value) ? value : undefined
}

/**
 * 将 Provider 原始错误归类为用户可操作的错误，不把所有 403 都误报为 API Key 失效。
 */
export function classifyProviderError(message: string): ProviderErrorClassification {
  const lowered = message.toLowerCase()
  const statusCode = extractStatusCode(message)
  const withStatus = (classification: Omit<ProviderErrorClassification, 'statusCode'>): ProviderErrorClassification => ({
    ...classification,
    ...(statusCode ? { statusCode } : {}),
  })

  if (
    /region|country|location|geo(?:graphical)?|not available in your region|unsupported location/.test(lowered)
  ) {
    return withStatus({
      failureKind: 'region_restricted',
      errorCode: 'region_restricted',
      title: '区域限制',
      message: '当前出口区域无法调用该模型，请检查代理出口或供应商区域策略',
      canRetry: false,
    })
  }

  if (/request was blocked|waf|security policy|abuse|risk control|风控|请求被拦截/.test(lowered)) {
    return withStatus({
      failureKind: 'request_blocked',
      errorCode: 'request_blocked',
      title: '请求被拦截',
      message: '请求被供应商或网关安全策略拦截，请检查代理、网关和风控规则',
      canRetry: true,
    })
  }

  if (
    /does not allow|permission|forbidden|not authorized|access denied|not allowed|model access|group.*allow|acl/.test(lowered)
    || statusCode === 403
  ) {
    return withStatus({
      failureKind: 'permission_denied',
      errorCode: 'permission_denied',
      title: '权限不足',
      message: '凭证已到达供应商，但当前账号、用户组、协议或模型没有调用权限',
      canRetry: false,
    })
  }

  if (
    statusCode === 401
    || /unauthorized|authentication failed|invalid api key|incorrect api key|api key.*invalid|invalid token|missing api key/.test(lowered)
  ) {
    return withStatus({
      failureKind: 'invalid_api_key',
      errorCode: 'invalid_api_key',
      title: '认证失败',
      message: '无法通过 API 认证，请检查当前渠道的 API Key 或 Base URL',
      canRetry: true,
    })
  }

  if (/quota|billing|insufficient.*(?:credit|balance)|credit balance|payment required|subscription/.test(lowered) || statusCode === 402) {
    return withStatus({
      failureKind: 'billing_or_quota',
      errorCode: 'billing_error',
      title: '额度或计费异常',
      message: '当前账号额度、余额、套餐或计费状态不允许继续调用',
      canRetry: false,
    })
  }

  if (/rate limit|too many requests/.test(lowered) || statusCode === 429) {
    return withStatus({
      failureKind: 'rate_limited',
      errorCode: 'rate_limited',
      title: '请求频率限制',
      message: '请求过于频繁，请稍后再试',
      canRetry: true,
    })
  }

  if (
    /not found|unsupported.*(?:api|protocol|endpoint)|unknown endpoint|invalid url|cannot post|method not allowed|404|405/.test(lowered)
  ) {
    return withStatus({
      failureKind: 'protocol_mismatch',
      errorCode: 'protocol_mismatch',
      title: '协议或接口不匹配',
      message: '当前 Base URL 与 API 协议不匹配，请检查 Chat Completions、Responses 或 Anthropic Messages 配置',
      canRetry: false,
    })
  }

  if (/timeout|network|socket|fetch failed|econnreset|enotfound|econnrefused/.test(lowered)) {
    return withStatus({
      failureKind: 'network_error',
      errorCode: 'network_error',
      title: '网络错误',
      message,
      canRetry: true,
    })
  }

  return withStatus({
    failureKind: 'provider_error',
    errorCode: 'provider_error',
    title: '供应商请求失败',
    message,
    canRetry: true,
  })
}
