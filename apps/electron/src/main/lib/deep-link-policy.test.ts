import { describe, expect, test } from 'bun:test'
import { parseKilaDeepLink } from './deep-link-policy'

describe('deep link policy', () => {
  test('Given 合法 Session 和设置链接，When 解析，Then 仅返回受约束路由数据', () => {
    expect(parseKilaDeepLink('kila://session/550e8400-e29b-41d4-a716-446655440000')).toEqual({
      kind: 'session',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
    })
    expect(parseKilaDeepLink('kila://settings/channels')).toEqual({
      kind: 'settings',
      requestedTab: 'channels',
    })
  })

  test('Given Provider 导入链接，When 解析，Then 标准化 URL、去重模型且保留显式密钥标记', () => {
    expect(parseKilaDeepLink(
      'kila://provider/install?provider=openrouter&name=OpenRouter&baseUrl=https%3A%2F%2Fopenrouter.ai%2Fapi%2Fv1&apiKey=secret&apiType=openai&models=m1,m2,m1',
    )).toEqual({
      kind: 'provider-install',
      provider: 'openrouter',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'secret',
      apiType: 'openai',
      models: ['m1', 'm2'],
    })
  })

  test('Given 危险协议、URL 凭据或非法标识，When 解析，Then 拒绝链接', () => {
    expect(parseKilaDeepLink('https://provider/install?provider=openai')).toBeNull()
    expect(parseKilaDeepLink('kila://provider/install?provider=openai&baseUrl=file%3A%2F%2F%2Ftmp%2Fsecret')).toBeNull()
    expect(parseKilaDeepLink('kila://provider/install?provider=openai&baseUrl=https%3A%2F%2Fuser%3Apass%40example.com')).toBeNull()
    expect(parseKilaDeepLink('kila://provider/install?provider=bad%20provider')).toBeNull()
    expect(parseKilaDeepLink('kila://session/%E0%A4%A')).toBeNull()
  })

  test('Given 超长密钥或过量模型，When 解析，Then 在进入业务逻辑前拒绝', () => {
    const oversizedKey = 'x'.repeat(8_193)
    expect(parseKilaDeepLink(`kila://provider/install?provider=openai&apiKey=${oversizedKey}`)).toBeNull()

    const models = Array.from({ length: 101 }, (_, index) => `model-${index}`).join(',')
    expect(parseKilaDeepLink(`kila://provider/install?provider=openai&models=${models}`)).toBeNull()
  })
})
