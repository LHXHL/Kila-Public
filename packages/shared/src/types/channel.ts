/**
 * 渠道（Channel）相关类型定义
 *
 * 渠道是用户配置的 AI 供应商连接，包含 API Key、模型列表等信息。
 * API Key 使用 Electron safeStorage 加密后存储在本地配置文件中。
 *
 * 颗粒度：
 * - provider：开放 string，作为 provider 实例标识（用户可填 openrouter/aihubmix 等聚合商）
 * - apiType：协议类型，决定走哪个 adapter（'anthropic' | 'openai' | 'google' | ...）
 * - capabilityProviderId：引用 Provider DB 的 ID（详见 model-catalog/provider-db.ts）
 *
 * 老配置兼容：未设置 apiType 时，按 provider 反推（inferApiTypeFromProvider）
 */

import type { ModelAbilities, ModelPricing } from '../model-catalog/types'

/**
 * 内置 provider ID 白名单（用于 IDE 提示 + Record key 兜底）。
 *
 * 渠道 provider 字段是开放 string，允许填入 DB 里的 148 个 provider 之一
 * （如 'openrouter' / 'aihubmix' / 'siliconflow' / 'ppio'），也允许填用户自定义 ID。
 */
export const BUILTIN_PROVIDER_IDS = [
  'anthropic',
  'openai',
  'deepseek',
  'google',
  'moonshot',
  'zhipu',
  'minimax',
  'doubao',
  'qwen',
  'openrouter',
  'aihubmix',
  'siliconflow',
  'ppio',
  'together',
  'groq',
  'mistral',
  'azure-openai',
  'aws-bedrock',
  'ollama',
  'lmstudio',
  'custom',
] as const

/** 内置 provider ID 字面量类型（仅用于 IDE 自动补全） */
export type BuiltinProviderId = (typeof BUILTIN_PROVIDER_IDS)[number]

/**
 * Provider 类型 — 开放 string，保兼容老配置。
 *
 * 历史值（'anthropic' | 'openai' | 'deepseek' | 'google' | 'moonshot' | 'zhipu'
 * | 'minimax' | 'doubao' | 'qwen' | 'custom'）继续可用；
 * 同时允许聚合商 ID（'openrouter' / 'aihubmix' / 'siliconflow' 等）。
 */
export type ProviderType = string

/**
 * API 协议类型 — 决定走哪个 adapter。
 *
 * 与 ProviderType 解耦：同一个 apiType='openai' 可以承载 OpenAI/OpenRouter/AiHubMix/...
 */
export type ApiType =
  | 'anthropic' // Anthropic Messages API
  | 'openai' // OpenAI Chat Completions（OpenAI 兼容格式）
  | 'openai-responses' // OpenAI Responses API（新协议）
  | 'google' // Google Generative Language API
  | 'ollama' // Ollama 本地 API
  | 'custom' // 兜底（用户自定义协议）

/**
 * 各内置 provider 的默认 Base URL。
 *
 * 对未列入的 provider（聚合商 / 自定义），通过 Provider DB 查询其 `api` 字段。
 */
export const PROVIDER_DEFAULT_URLS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com',
  google: 'https://generativelanguage.googleapis.com',
  moonshot: 'https://api.moonshot.cn/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  minimax: 'https://api.minimax.chat/v1',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  aihubmix: 'https://aihubmix.com/v1',
  siliconflow: 'https://api.siliconflow.cn/v1',
  ppio: 'https://api.ppinfra.com/v2/openai',
  together: 'https://api.together.xyz/v1',
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  ollama: 'http://127.0.0.1:11434/v1',
  lmstudio: 'http://127.0.0.1:1234/v1',
  custom: '',
}

/**
 * 各内置 provider 的显示名称。
 */
export const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  google: 'Google',
  moonshot: 'Moonshot / Kimi',
  zhipu: '智谱 AI',
  minimax: 'MiniMax',
  doubao: '豆包',
  qwen: '通义千问',
  openrouter: 'OpenRouter',
  aihubmix: 'AiHubMix',
  siliconflow: 'SiliconFlow',
  ppio: 'PPIO',
  together: 'Together AI',
  groq: 'Groq',
  mistral: 'Mistral',
  'azure-openai': 'Azure OpenAI',
  'aws-bedrock': 'AWS Bedrock',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  custom: 'OpenAI 兼容格式',
}

/**
 * OpenAI 协议下 chat 路径（用于 baseUrl 拼接）。
 *
 * 非 OpenAI 协议（anthropic/google）走自己的路径，不在这里处理。
 */
export const PROVIDER_CHAT_PATHS: Record<string, string> = {
  anthropic: '/v1/messages',
  openai: '/chat/completions',
  deepseek: '/chat/completions',
  moonshot: '/chat/completions',
  zhipu: '/chat/completions',
  minimax: '/chat/completions',
  doubao: '/chat/completions',
  qwen: '/chat/completions',
  openrouter: '/chat/completions',
  aihubmix: '/chat/completions',
  siliconflow: '/chat/completions',
  ppio: '/chat/completions',
  together: '/chat/completions',
  groq: '/chat/completions',
  mistral: '/chat/completions',
  custom: '/chat/completions',
}

/**
 * 按 provider ID 反推 apiType。
 *
 * 老配置只有 provider 字段时，自动调用此函数补全 apiType。
 */
export function inferApiTypeFromProvider(provider: string): ApiType {
  switch (provider) {
    case 'anthropic':
      return 'anthropic'
    case 'google':
      return 'google'
    case 'ollama':
    case 'lmstudio':
      return 'ollama'
    // OpenAI 兼容协议（OpenAI/DeepSeek/Moonshot/Zhipu/MiniMax/Doubao/Qwen
    // + 所有聚合商 OpenRouter/AiHubMix/SiliconFlow/PPIO/Together/Groq/Mistral）
    default:
      return 'openai'
  }
}

/**
 * 模型能力覆盖配置
 *
 * 用户可手动指定模型能力，优先于自动检测。
 */
export interface ModelCapabilitiesOverride {
  /** 是否支持视觉（图片输入） */
  supportsVision?: boolean
  /** 是否支持思维链/推理 */
  supportsThinking?: boolean
  /** 是否支持工具调用 */
  supportsTools?: boolean
}

/**
 * 模型元数据覆盖配置
 *
 * 用户可手动覆盖内置模型目录的上下文、能力和价格信息。
 */
export interface ModelMetadataOverride {
  /** 总上下文窗口 token 数 */
  contextWindowTokens?: number
  /** 最大输出 token 数 */
  maxOutputTokens?: number
  /** 模型能力覆盖 */
  abilities?: Partial<ModelAbilities>
  /** 价格覆盖，单位为 USD / 1M tokens */
  pricing?: Partial<ModelPricing>
}

/**
 * 渠道中的模型配置
 */
export interface ChannelModel {
  /** 模型唯一标识（如 claude-sonnet-4-5-20250929） */
  id: string
  /** 模型显示名称 */
  name: string
  /** 是否启用 */
  enabled: boolean
  /** 手动覆盖模型元数据（可选，优先于内置目录和自动检测） */
  metadataOverride?: ModelMetadataOverride
  /** @deprecated 旧能力覆盖格式。读取时会迁移为 metadataOverride.abilities。 */
  capabilities?: ModelCapabilitiesOverride
}

/**
 * 渠道配置
 *
 * 存储在 ~/.kila/channels.json 中，apiKey 字段为加密后的 base64 字符串
 */
export interface Channel {
  /** 渠道唯一标识 */
  id: string
  /** 渠道名称（用户自定义） */
  name: string
  /** Provider 标识（开放 string，可填内置 ID 或聚合商/自定义 ID） */
  provider: ProviderType
  /**
   * 协议类型，决定走哪个 adapter。
   * 老配置未设置时，由 inferApiTypeFromProvider(provider) 自动反推。
   */
  apiType?: ApiType
  /**
   * 引用 Provider DB 的 providerId（如 'anthropic' / 'openrouter' / 'aihubmix'）。
   * 用于查询模型能力画像（extra_capabilities.reasoning 等）。
   * 与 provider 字段可不同：例如 provider='my-aihubmix-1'（用户自命名）+ capabilityProviderId='aihubmix'。
   */
  capabilityProviderId?: string
  /** API Base URL */
  baseUrl: string
  /** 加密后的 API Key（base64 编码） */
  apiKey: string
  /** 可用模型列表 */
  models: ChannelModel[]
  /** 是否启用 */
  enabled: boolean
  /** 创建时间戳 */
  createdAt: number
  /** 更新时间戳 */
  updatedAt: number
}

/**
 * 创建渠道时的输入数据（apiKey 为明文）
 */
export interface ChannelCreateInput {
  name: string
  provider: ProviderType
  /** 可选：未设置时由 provider 反推 */
  apiType?: ApiType
  /** 可选：引用 Provider DB 的 providerId */
  capabilityProviderId?: string
  baseUrl: string
  /** 明文 API Key，主进程会加密后存储 */
  apiKey: string
  models: ChannelModel[]
  enabled: boolean
}

/**
 * 更新渠道时的输入数据（所有字段可选）
 */
export interface ChannelUpdateInput {
  name?: string
  provider?: ProviderType
  apiType?: ApiType
  capabilityProviderId?: string
  baseUrl?: string
  /** 明文 API Key，为空字符串表示不更新 */
  apiKey?: string
  models?: ChannelModel[]
  enabled?: boolean
}

/**
 * 渠道配置文件格式
 */
export interface ChannelsConfig {
  /** 配置版本号 */
  version: number
  /** 渠道列表 */
  channels: Channel[]
}

/**
 * 连接测试结果
 */
export interface ChannelTestResult {
  /** 是否成功 */
  success: boolean
  /** 结果消息 */
  message: string
}

/**
 * 拉取模型的输入参数（无需已保存的渠道，直接传入凭证）
 */
export interface FetchModelsInput {
  provider: ProviderType
  baseUrl: string
  /** 明文 API Key */
  apiKey: string
}

/**
 * 拉取模型的结果
 */
export interface FetchModelsResult {
  /** 是否成功 */
  success: boolean
  /** 结果消息 */
  message: string
  /** 获取到的模型列表 */
  models: ChannelModel[]
}

/**
 * 渠道相关 IPC 通道常量
 */
export const CHANNEL_IPC_CHANNELS = {
  /** 获取所有渠道列表 */
  LIST: 'channel:list',
  /** 创建渠道 */
  CREATE: 'channel:create',
  /** 更新渠道 */
  UPDATE: 'channel:update',
  /** 删除渠道 */
  DELETE: 'channel:delete',
  /** 解密获取明文 API Key */
  DECRYPT_KEY: 'channel:decrypt-key',
  /** 测试渠道连接 */
  TEST: 'channel:test',
  /** 从供应商拉取可用模型列表 */
  FETCH_MODELS: 'channel:fetch-models',
  /** 直接测试连接（无需已保存渠道，传入明文凭证） */
  TEST_DIRECT: 'channel:test-direct',
  /** 列出 Provider DB 摘要（预设页用） */
  PROVIDER_DB_LIST: 'provider-db:list',
  /** 按 providerId 查 Provider DB 详情 */
  PROVIDER_DB_LOOKUP: 'provider-db:lookup',
  /** 跨 provider 全局搜模型 */
  PROVIDER_DB_FIND_MODEL: 'provider-db:find-model',
} as const
