/**
 * Kila 渠道到 Pi canonical ModelRuntime 的桥接。
 *
 * Pi 0.80 起，coding-agent 内部以 CredentialStore + ModelRuntime 作为模型、认证、
 * Provider header/baseUrl 与请求流的唯一真相源。这里不再伪造 ModelRegistry，避免
 * SDK 新增认证或 Provider 行为后出现结构性兼容问题。
 */

import type { Api, CredentialStore, InMemoryCredentialStore, Model } from '@earendil-works/pi-ai'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { Channel } from '@kila/shared'

export type PiModel = Model<Api>

type PiAiModule = typeof import('@earendil-works/pi-ai')
type PiCodingAgentModule = typeof import('@earendil-works/pi-coding-agent')

type PiQueryChannel = Pick<Channel, 'provider' | 'baseUrl'>

export interface KilaModelRuntime {
  credentials: InMemoryCredentialStore
  modelRuntime: ModelRuntime
  model: PiModel
  providerId: string
}

export interface CreateKilaModelRuntimeOptions {
  piAi: PiAiModule
  sdk: PiCodingAgentModule
  channel: PiQueryChannel
  model: PiModel
  apiKey: string
}

function safeProviderSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'custom'
}

/**
 * 每个 Kila runtime 都拥有独立 ModelRuntime，因此 providerId 只需在单 runtime 内稳定。
 * 不复用 Pi 内置 providerId，避免自定义 Base URL/模型覆盖官方 catalog。
 */
export function createKilaPiProviderId(channel: PiQueryChannel): string {
  return `kila-${safeProviderSegment(channel.provider)}`
}

async function setRuntimeCredential(
  credentials: CredentialStore,
  providerId: string,
  apiKey: string,
): Promise<void> {
  // Pi coding-agent 当前要求请求认证必须能解析出非空 apiKey。
  // 对无需认证的本地 OpenAI-compatible 服务使用本地占位值，保持旧 Kila 行为。
  const key = apiKey.trim() || 'kila-local-no-auth'
  await credentials.modify(providerId, async () => ({ type: 'api_key', key }))
}

export async function updateKilaModelRuntimeApiKey(
  runtime: Pick<KilaModelRuntime, 'credentials' | 'providerId'>,
  apiKey: string,
): Promise<void> {
  await setRuntimeCredential(runtime.credentials, runtime.providerId, apiKey)
}

export async function createKilaModelRuntime(
  options: CreateKilaModelRuntimeOptions,
): Promise<KilaModelRuntime> {
  const providerId = createKilaPiProviderId(options.channel)
  const credentials = new options.piAi.InMemoryCredentialStore()
  await setRuntimeCredential(credentials, providerId, options.apiKey)

  const modelRuntime = await options.sdk.ModelRuntime.create({
    credentials,
    // Kila 的渠道/模型配置是业务真相源，不读取 ~/.pi/agent/models.json。
    modelsPath: null,
    allowModelNetwork: false,
  })

  modelRuntime.registerProvider(providerId, {
    name: `Kila ${options.channel.provider}`,
    // registerProvider 需要显式认证策略；请求时 CredentialStore 中的动态 key 优先。
    apiKey: options.apiKey.trim() || 'kila-local-no-auth',
    api: options.model.api,
    baseUrl: options.channel.baseUrl,
    models: [{
      id: options.model.id,
      name: options.model.name,
      api: options.model.api,
      baseUrl: options.model.baseUrl,
      reasoning: options.model.reasoning,
      thinkingLevelMap: options.model.thinkingLevelMap,
      input: [...options.model.input],
      cost: options.model.cost,
      contextWindow: options.model.contextWindow,
      maxTokens: options.model.maxTokens,
      headers: options.model.headers
        ? Object.fromEntries(
            Object.entries(options.model.headers).filter(
              (entry): entry is [string, string] => entry[1] !== null,
            ),
          )
        : undefined,
      compat: options.model.compat,
    }],
  })
  await modelRuntime.refresh({ allowNetwork: false })

  const model = modelRuntime.getModel(providerId, options.model.id)
  if (!model) {
    throw new Error(`Pi ModelRuntime 注册模型失败: ${providerId}/${options.model.id}`)
  }

  return {
    credentials,
    modelRuntime,
    model,
    providerId,
  }
}
