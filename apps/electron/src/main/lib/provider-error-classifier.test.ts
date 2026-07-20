import { describe, expect, test } from 'bun:test'
import { classifyProviderError } from './provider-error-classifier'

describe('Provider 错误分类', () => {
  test('Given 用户组禁止 Anthropic 路由 When 分类 403 Then 返回权限不足而不是认证失败', () => {
    const result = classifyProviderError('403 This group does not allow /v1/messages dispatch')

    expect(result).toMatchObject({
      failureKind: 'permission_denied',
      errorCode: 'permission_denied',
      statusCode: 403,
    })
  })

  test('Given 模型受区域限制 When 分类 403 Then 返回区域限制', () => {
    const result = classifyProviderError('403 This model is not available in your region.')

    expect(result).toMatchObject({
      failureKind: 'region_restricted',
      errorCode: 'region_restricted',
      statusCode: 403,
    })
  })

  test('Given WAF 拦截 When 分类 403 Then 返回请求被拦截', () => {
    const result = classifyProviderError('403 Your request was blocked.')

    expect(result).toMatchObject({
      failureKind: 'request_blocked',
      errorCode: 'request_blocked',
      statusCode: 403,
    })
  })

  test('Given 401 When 分类 Then 仅此类认证错误映射为 invalid_api_key', () => {
    const result = classifyProviderError('401 invalid api key')

    expect(result).toMatchObject({
      failureKind: 'invalid_api_key',
      errorCode: 'invalid_api_key',
      statusCode: 401,
    })
  })
})
