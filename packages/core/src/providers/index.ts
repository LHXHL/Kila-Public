/**
 * Provider 适配器注册表
 *
 * 集中管理所有已注册的供应商适配器，
 * 通过 ProviderType 查找对应的适配器实例。
 *
 * S2 之后 ProviderType 开放化为 string：
 * - 内置白名单 provider 仍走 Map 精确查找
 * - 未注册的 provider（聚合商/自定义）默认走 OpenAI 兼容协议
 * - 调用方可传 apiType 优先决定协议（'anthropic' | 'openai' | 'google' | ...）
 */

import type { ProviderType } from '@kila/shared'
import type { ProviderAdapter } from './types.ts'
import { AnthropicAdapter } from './anthropic-adapter.ts'
import { OpenAIAdapter } from './openai-adapter.ts'
import { GoogleAdapter } from './google-adapter.ts'

// 导出所有类型和工具
export * from './types.ts'
export * from './sse-reader.ts'
export * from './url-utils.ts'

// 导出适配器类
export { AnthropicAdapter } from './anthropic-adapter.ts'
export { OpenAIAdapter } from './openai-adapter.ts'
export { GoogleAdapter } from './google-adapter.ts'

/** 供应商适配器注册表 */
const adapterRegistry = new Map<ProviderType, ProviderAdapter>([
  ['anthropic', new AnthropicAdapter()],
  ['openai', new OpenAIAdapter()],
  ['deepseek', new OpenAIAdapter()],      // DeepSeek 使用 OpenAI 兼容协议
  ['moonshot', new OpenAIAdapter()],      // Moonshot/Kimi 使用 OpenAI 兼容协议
  ['zhipu', new OpenAIAdapter()],         // 智谱 AI 使用 OpenAI 兼容协议
  ['minimax', new OpenAIAdapter()],       // MiniMax 使用 OpenAI 兼容协议
  ['doubao', new OpenAIAdapter()],        // 豆包使用 OpenAI 兼容协议
  ['qwen', new OpenAIAdapter()],          // 通义千问使用 OpenAI 兼容协议
  ['custom', new OpenAIAdapter()],        // 自定义也使用 OpenAI 兼容协议
  ['google', new GoogleAdapter()],
])

/** OpenAI 兼容协议 fallback（聚合商 OpenRouter/AiHubMix/SiliconFlow 等未注册 provider 共用） */
const openaiFallback = new OpenAIAdapter()

/**
 * 按 apiType 解析适配器，未指定时按 provider 反推。
 */
function resolveAdapter(provider: ProviderType, apiType?: string): ProviderAdapter {
  if (apiType === 'anthropic') return adapterRegistry.get('anthropic')!
  if (apiType === 'google') return adapterRegistry.get('google')!
  if (apiType === 'ollama' || apiType === 'custom' || apiType === 'openai' || apiType === 'openai-responses') {
    return openaiFallback
  }
  // 老路径：按 provider 反推，未知 provider 走 OpenAI 兼容协议
  return adapterRegistry.get(provider) ?? openaiFallback
}

/**
 * 根据供应商类型获取适配器
 *
 * @param provider 供应商类型（开放 string）
 * @param apiType 可选协议类型，优先级高于 provider
 * @returns 对应的适配器实例
 */
export function getAdapter(provider: ProviderType, apiType?: string): ProviderAdapter {
  return resolveAdapter(provider, apiType)
}
