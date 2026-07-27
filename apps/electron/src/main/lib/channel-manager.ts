/**
 * 渠道管理器
 *
 * 负责渠道的 CRUD 操作、API Key 加密/解密、连接测试。
 * 使用 Electron safeStorage 进行 API Key 加密（底层使用 OS 级加密）。
 * 数据持久化到 ~/.kila/channels.json。
 */

import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { getChannelsPath } from './config-paths'
import { readJsonWithBackup, writeTextAtomicWithBackup } from './safe-json-file'
import { createDegradedConfigRegistry, degradeCorruptConfig } from './config-file-guard'
import type {
  Channel,
  ChannelCreateInput,
  ChannelUpdateInput,
  ChannelsConfig,
  ChannelTestResult,
  ChannelTestInput,
  ProviderDoctorInput,
  ChannelModel,
  FetchModelsInput,
  FetchModelsResult,
  ProviderType,
} from '@kila/shared'
import { normalizeModelMetadataOverride } from '@kila/shared'
import {
  BUILTIN_PROVIDER_IDS,
  inferApiTypeFromProvider,
} from '@kila/shared'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import { normalizeAnthropicBaseUrl, normalizeBaseUrl } from '@kila/core'
import { resolveChannelModel } from './channel-model-resolution'
import { lookupProviderDbModel } from './provider-db-loader'
import { runProviderProbe } from './provider-doctor'

/** 当前配置版本 */

import { createLogger } from './logger'
const log = createLogger('渠道管理')

const CONFIG_VERSION = 1

/**
 * 渠道配置降级只读登记表。
 *
 * channels.json 主备双双解析失败时，内存里只有一个空列表；写回会把 safeStorage
 * 加密的 API Key 连同 .bak 一起抹掉，且无法从密文之外的任何地方恢复。
 */
const degradedChannelConfigs = createDegradedConfigRegistry()

interface SafeStorageLike {
  isEncryptionAvailable: () => boolean
  encryptString: (plain: string) => Buffer
  decryptString: (encrypted: Buffer) => string
}

function getSafeStorage(): SafeStorageLike {
  try {
    const electron = require('electron') as {
      safeStorage?: SafeStorageLike
    }

    if (electron.safeStorage) {
      return electron.safeStorage
    }
  } catch {
    // ignore: fallback below
  }

  return {
    isEncryptionAvailable: () => false,
    encryptString: (plain: string) => Buffer.from(plain, 'utf-8'),
    decryptString: (encrypted: Buffer) => encrypted.toString('utf-8'),
  }
}

function migrateChannelModel(model: ChannelModel): { model: ChannelModel; changed: boolean } {
  if (!model.capabilities) {
    return { model, changed: false }
  }

  const metadataOverride = normalizeModelMetadataOverride(model.metadataOverride, model.capabilities)
  const migrated: ChannelModel = {
    id: model.id,
    name: model.name,
    enabled: model.enabled,
    ...(metadataOverride ? { metadataOverride } : {}),
  }

  return { model: migrated, changed: true }
}

function migrateChannel(channel: Channel): { channel: Channel; changed: boolean } {
  let changed = false
  const models = (channel.models ?? []).map((model) => {
    const result = migrateChannelModel(model)
    changed = changed || result.changed
    return result.model
  })

  // apiType 缺失时按 provider 反推（向后兼容老配置）
  let apiType = channel.apiType
  if (!apiType) {
    apiType = inferApiTypeFromProvider(channel.provider)
    changed = true
  }

  // capabilityProviderId 缺失但 provider 是内置白名单 ID 时，自动补全
  let capabilityProviderId = channel.capabilityProviderId
  if (!capabilityProviderId && (BUILTIN_PROVIDER_IDS as readonly string[]).includes(channel.provider)) {
    capabilityProviderId = channel.provider
    changed = true
  }

  if (!changed) return { channel, changed: false }

  return {
    channel: {
      ...channel,
      models,
      apiType,
      ...(capabilityProviderId ? { capabilityProviderId } : {}),
      updatedAt: Date.now(),
    },
    changed: true,
  }
}

/**
 * 读取渠道配置文件
 */
function readConfig(): ChannelsConfig {
  const configPath = getChannelsPath()

  // 文件不存在是可信的首次运行；「存在但读不出来」才是不可信状态。
  if (!existsSync(configPath)) {
    return { version: CONFIG_VERSION, channels: [] }
  }

  let parsed: ChannelsConfig
  try {
    parsed = readJsonWithBackup(configPath, (raw) => {
      const data = JSON.parse(raw) as Partial<ChannelsConfig>
      if (!data || typeof data !== 'object' || !Array.isArray(data.channels)) {
        throw new Error('channels 字段缺失或不是数组')
      }
      return { version: data.version ?? CONFIG_VERSION, channels: data.channels }
    })
  } catch (error) {
    degradeCorruptConfig(degradedChannelConfigs, { filePath: configPath, label: '渠道配置', error })
    return { version: CONFIG_VERSION, channels: [] }
  }

  let changed = false
  const channels = parsed.channels.map((channel) => {
    const result = migrateChannel(channel)
    changed = changed || result.changed
    return result.channel
  })
  const config = {
    version: parsed.version ?? CONFIG_VERSION,
    channels,
  }
  if (changed) {
    writeConfig(config)
  }
  return config
}



/**
 * 写入渠道配置文件
 *
 * 原子写 + 备份；配置处于降级只读状态时直接拒绝，避免用空列表覆盖加密凭证。
 */
function writeConfig(config: ChannelsConfig): void {
  const configPath = getChannelsPath()
  const degradedReason = degradedChannelConfigs.getDegradedReason(configPath)
  if (degradedReason) {
    log.error(`[渠道管理] 配置处于降级只读模式，已拒绝写入: ${degradedReason}`)
    throw new Error(`渠道配置处于降级只读模式，已拒绝写入以避免 API Key 丢失（${degradedReason}）`)
  }

  try {
    writeTextAtomicWithBackup(configPath, JSON.stringify(config, null, 2))
  } catch (error) {
    log.error('[渠道管理] 写入配置文件失败:', error)
    throw new Error('写入渠道配置失败')
  }
}

/**
 * 加密 API Key
 *
 * 使用 Electron safeStorage 加密，底层使用：
 * - macOS: Keychain
 * - Windows: DPAPI
 * - Linux: Secret Service API
 *
 * @returns base64 编码的加密字符串
 */
function encryptApiKey(plainKey: string): string {
  const safeStorage = getSafeStorage()

  if (!safeStorage.isEncryptionAvailable()) {
    log.warn('[渠道管理] safeStorage 加密不可用，将以明文存储')
    return plainKey
  }

  const encrypted = safeStorage.encryptString(plainKey)
  return encrypted.toString('base64')
}

/**
 * 解密 API Key
 *
 * @param encryptedKey base64 编码的加密字符串
 * @returns 明文 API Key
 */
function decryptKey(encryptedKey: string): string {
  const safeStorage = getSafeStorage()

  if (!safeStorage.isEncryptionAvailable()) {
    // 如果加密不可用，假设存储的是明文
    return encryptedKey
  }

  try {
    const buffer = Buffer.from(encryptedKey, 'base64')
    return safeStorage.decryptString(buffer)
  } catch (error) {
    log.error('[渠道管理] 解密 API Key 失败:', error)
    throw new Error('解密 API Key 失败')
  }
}

/**
 * 获取所有渠道
 *
 * 返回的渠道中 apiKey 保持加密状态。
 */
export function listChannels(): Channel[] {
  const config = readConfig()
  return config.channels
}

/**
 * 按 ID 获取渠道
 *
 * 返回的渠道中 apiKey 保持加密状态。
 */
export function getChannelById(id: string): Channel | undefined {
  const config = readConfig()
  return config.channels.find((c) => c.id === id)
}

/**
 * 创建新渠道
 *
 * @param input 渠道创建数据（apiKey 为明文，会自动加密）
 * @returns 创建后的渠道（apiKey 为加密态）
 */
export function createChannel(input: ChannelCreateInput): Channel {
  const config = readConfig()
  const now = Date.now()
  const channel: Channel = {
    id: randomUUID(),
    name: input.name,
    provider: input.provider,
    apiType: input.apiType,
    capabilityProviderId: input.capabilityProviderId,
    baseUrl: input.baseUrl,
    apiKey: encryptApiKey(input.apiKey),
    models: input.models,
    enabled: input.enabled,
    createdAt: now,
    updatedAt: now,
  }

  config.channels.push(channel)
  writeConfig(config)

  log.info(`[渠道管理] 已创建渠道: ${channel.name} (${channel.id})`)
  return channel
}

/**
 * 更新渠道
 *
 * @param id 渠道 ID
 * @param input 更新数据（apiKey 为明文，空字符串表示不更新）
 * @returns 更新后的渠道
 */
export function updateChannel(id: string, input: ChannelUpdateInput): Channel {
  const config = readConfig()
  const index = config.channels.findIndex((c) => c.id === id)

  if (index === -1) {
    throw new Error(`渠道不存在: ${id}`)
  }

  const existing = config.channels[index]!
  const provider = input.provider ?? existing.provider

  const updated: Channel = {
    ...existing,
    name: input.name ?? existing.name,
    provider,
    apiType: input.apiType !== undefined ? input.apiType : existing.apiType,
    capabilityProviderId: input.capabilityProviderId !== undefined
      ? input.capabilityProviderId
      : existing.capabilityProviderId,
    baseUrl: input.baseUrl ?? existing.baseUrl,
    apiKey: typeof input.apiKey === 'string' && input.apiKey.length > 0
      ? encryptApiKey(input.apiKey)
      : existing.apiKey,
    models: input.models ?? existing.models,
    enabled: input.enabled ?? existing.enabled,
    updatedAt: Date.now(),
  }

  config.channels[index] = updated
  writeConfig(config)

  log.info(`[渠道管理] 已更新渠道: ${updated.name} (${updated.id})`)
  return updated
}

/**
 * 删除渠道
 */
export function deleteChannel(id: string): void {
  const config = readConfig()
  const index = config.channels.findIndex((c) => c.id === id)

  if (index === -1) {
    throw new Error(`渠道不存在: ${id}`)
  }

  const removed = config.channels.splice(index, 1)[0]!
  writeConfig(config)

  log.info(`[渠道管理] 已删除渠道: ${removed.name} (${removed.id})`)
}

/**
 * 解密渠道的 API Key
 *
 * 仅在用户需要查看时调用。
 */
export function decryptApiKey(channelId: string): string {
  const config = readConfig()
  const channel = config.channels.find((c) => c.id === channelId)

  if (!channel) {
    throw new Error(`渠道不存在: ${channelId}`)
  }

  return decryptKey(channel.apiKey)
}

/**
 * 测试已保存渠道。
 *
 * Provider Doctor 必须完成一次真实最小推理；/models 只用于模型发现，不能证明
 * 当前协议、模型和账号权限可用于 Agent 请求。
 */
export async function testChannel(input: ProviderDoctorInput): Promise<ChannelTestResult> {
  const config = readConfig()
  const channel = config.channels.find((candidate) => candidate.id === input.channelId)

  if (!channel) {
    return {
      success: false,
      message: '渠道不存在',
      failureKind: 'invalid_configuration',
    }
  }

  const resolution = resolveChannelModel(channel, {
    requestedModelId: input.modelId,
  })
  if (!resolution.ok) {
    return {
      success: false,
      message: resolution.error,
      failureKind: 'invalid_configuration',
    }
  }

  const channelModel = channel.models.find((model) => model.id === resolution.modelId)
  const providerDbEntry = lookupProviderDbModel(
    channel.capabilityProviderId ?? channel.provider,
    resolution.modelId,
  )

  return runProviderProbe({
    channel,
    apiKey: decryptKey(channel.apiKey),
    modelId: resolution.modelId,
    modelMetadata: channelModel?.metadataOverride,
    modelCapabilities: channelModel?.capabilities,
    providerDbEntry,
  })
}

// ===== 直接测试连接 =====

/**
 * 直接测试连接（无需已保存渠道）。
 * 使用表单当前的协议、模型、Base URL 和明文凭证走与 Agent 相同的 Pi runtime。
 */
export async function testChannelDirect(input: ChannelTestInput): Promise<ChannelTestResult> {
  const providerDbEntry = lookupProviderDbModel(
    input.capabilityProviderId ?? input.provider,
    input.modelId,
  )

  return runProviderProbe({
    channel: {
      provider: input.provider,
      apiType: input.apiType,
      baseUrl: input.baseUrl,
      capabilityProviderId: input.capabilityProviderId,
    },
    apiKey: input.apiKey,
    modelId: input.modelId,
    modelMetadata: input.modelMetadata,
    modelCapabilities: input.modelCapabilities,
    providerDbEntry,
  })
}

// ===== 模型拉取相关 =====

/**
 * 从供应商 API 拉取可用模型列表
 *
 * 直接使用传入的凭证（无需已保存渠道），支持创建渠道时预先拉取模型。
 * 针对不同供应商使用不同的 API 端点和响应解析。
 */
export async function fetchModels(input: FetchModelsInput): Promise<FetchModelsResult> {
  try {
    const proxyUrl = await getEffectiveProxyUrl()

    switch (input.provider) {
      case 'anthropic':
        return await fetchAnthropicModels(input.baseUrl, input.apiKey, proxyUrl)
      case 'openai':
      case 'deepseek':
      case 'moonshot':
      case 'zhipu':
      case 'minimax':
      case 'doubao':
      case 'qwen':
      case 'custom':
        return await fetchOpenAICompatibleModels(input.baseUrl, input.apiKey, proxyUrl)
      case 'google':
        return await fetchGoogleModels(input.baseUrl, input.apiKey, proxyUrl)
      default:
        return { success: false, message: '不支持的供应商', models: [] }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    log.error('[渠道管理] 拉取模型列表失败:', error)
    return { success: false, message: `拉取模型失败: ${message}`, models: [] }
  }
}

/**
 * Anthropic API 模型响应项
 */
interface AnthropicModelItem {
  id: string
  display_name?: string
  type?: string
}

/**
 * 从 Anthropic API 拉取模型列表
 *
 * 先规范化 baseUrl 确保包含 /v1，再请求 /models。
 * 文档: https://docs.anthropic.com/en/api/models-list
 */
async function fetchAnthropicModels(baseUrl: string, apiKey: string, proxyUrl?: string): Promise<FetchModelsResult> {
  const url = normalizeAnthropicBaseUrl(baseUrl)
  const fetchFn = getFetchFn(proxyUrl)

  const response = await fetchFn(`${url}/models`, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      Authorization: `Bearer ${apiKey}`,
      'anthropic-version': '2023-06-01',
    },
  })

  if (response.status === 401) {
    const text = await response.text().catch(() => '')
    return { success: false, message: `API Key 无效${text ? `: ${text.slice(0, 150)}` : ''}`, models: [] }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return { success: false, message: `请求失败 (${response.status}): ${text.slice(0, 200)}`, models: [] }
  }

  const data = await response.json() as { data?: AnthropicModelItem[] }
  const items = data.data ?? []

  const models: ChannelModel[] = items.map((item) => ({
    id: item.id,
    name: item.display_name || item.id,
    enabled: true,
  }))

  return {
    success: true,
    message: `成功获取 ${models.length} 个模型`,
    models,
  }
}

/**
 * OpenAI 兼容 API 模型响应项
 */
interface OpenAIModelItem {
  id: string
  owned_by?: string
}

/**
 * 从 OpenAI 兼容 API 拉取模型列表（OpenAI / DeepSeek / Custom）
 *
 * API: GET {baseUrl}/models
 * 通用 OpenAI 兼容格式，适用于大部分第三方供应商。
 */
async function fetchOpenAICompatibleModels(baseUrl: string, apiKey: string, proxyUrl?: string): Promise<FetchModelsResult> {
  const url = normalizeBaseUrl(baseUrl)
  const fetchFn = getFetchFn(proxyUrl)

  const response = await fetchFn(`${url}/models`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })

  if (response.status === 401) {
    return { success: false, message: 'API Key 无效', models: [] }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return { success: false, message: `请求失败 (${response.status}): ${text.slice(0, 200)}`, models: [] }
  }

  const data = await response.json() as { data?: OpenAIModelItem[] }
  const items = data.data ?? []

  const models: ChannelModel[] = items.map((item) => ({
    id: item.id,
    name: item.id,
    enabled: true,
  }))

  // 按模型 ID 字母排序，方便用户查找
  models.sort((a, b) => a.id.localeCompare(b.id))

  return {
    success: true,
    message: `成功获取 ${models.length} 个模型`,
    models,
  }
}

/**
 * Google Generative AI 模型响应项
 */
interface GoogleModelItem {
  name: string
  displayName?: string
  description?: string
  supportedGenerationMethods?: string[]
}

/**
 * 从 Google Generative AI API 拉取模型列表
 *
 * API: GET /v1beta/models?key={apiKey}
 * 仅返回支持 generateContent 的模型（排除纯 embedding 模型）。
 */
async function fetchGoogleModels(baseUrl: string, apiKey: string, proxyUrl?: string): Promise<FetchModelsResult> {
  const url = normalizeBaseUrl(baseUrl)
  const fetchFn = getFetchFn(proxyUrl)

  const response = await fetchFn(`${url}/v1beta/models?key=${apiKey}`, {
    method: 'GET',
  })

  if (response.status === 400 || response.status === 403) {
    return { success: false, message: 'API Key 无效', models: [] }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return { success: false, message: `请求失败 (${response.status}): ${text.slice(0, 200)}`, models: [] }
  }

  const data = await response.json() as { models?: GoogleModelItem[] }
  const items = data.models ?? []

  // 过滤出支持 generateContent 的模型（排除纯 embedding 模型）
  const chatModels = items.filter((item) =>
    item.supportedGenerationMethods?.includes('generateContent')
  )

  const models: ChannelModel[] = chatModels.map((item) => {
    // Google 模型 name 格式为 "models/gemini-pro"，提取实际 ID
    const id = item.name.replace(/^models\//, '')
    return {
      id,
      name: item.displayName || id,
      enabled: true,
    }
  })

  return {
    success: true,
    message: `成功获取 ${models.length} 个模型`,
    models,
  }
}
