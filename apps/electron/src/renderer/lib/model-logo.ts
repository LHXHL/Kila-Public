/**
 * 模型 Logo 解析工具
 *
 * 使用正则匹配模型 ID 来确定对应的 Logo。
 * Logo 通过静态 import 打包，确保 Vite 正确处理资源。
 *
 * 匹配规则：
 * - logoMap 的 key 作为正则表达式（忽略大小写）
 * - 按顺序匹配，越具体的规则排在越前面
 * - 未匹配到时返回默认图标
 */

// ===== 模型图标导入 =====

import DefaultLogo from '@/assets/models/default.png'

// Claude / Anthropic
import ClaudeLogo from '@/assets/models/claude.png'
import ClaudeDarkLogo from '@/assets/models/claude_dark.png'

// OpenAI / GPT 系列
import OpenAILogo from '@/assets/models/openai.svg'

// DeepSeek
import DeepSeekLogo from '@/assets/models/deepseek.png'
import DeepSeekDarkLogo from '@/assets/models/deepseek_dark.png'

// Google / Gemini
import GeminiLogo from '@/assets/models/gemini.png'
import GeminiDarkLogo from '@/assets/models/gemini_dark.png'
import GemmaLogo from '@/assets/models/gemma.png'
import GemmaDarkLogo from '@/assets/models/gemma_dark.png'

// 自定义 Gemini 衍生模型
import DeepGeminiLogo from '@/assets/models/deepgemini.png'
import KimiGeminiLogo from '@/assets/models/kimigemini.png'
import QwenGeminiLogo from '@/assets/models/qwengemini.png'
import SeedGeminiLogo from '@/assets/models/seedgemini.png'

// Qwen / 通义
import QwenLogo from '@/assets/models/qwen.png'
import QwenDarkLogo from '@/assets/models/qwen_dark.png'

// Grok / xAI
import GrokLogo from '@/assets/models/grok.png'
import GrokDarkLogo from '@/assets/models/grok_dark.png'

// Moonshot / Kimi
import MoonshotLogo from '@/assets/models/moonshot.png'

// Doubao / 豆包
import DoubaoLogo from '@/assets/models/doubao.png'
import DoubaoDarkLogo from '@/assets/models/doubao_dark.png'

// Zhipu / 智谱
import ZhipuLogo from '@/assets/models/zhipu.png'
import ZhipuDarkLogo from '@/assets/models/zhipu_dark.png'

// ChatGLM
import ChatGLMLogo from '@/assets/models/chatglm.png'
import ChatGLMDarkLogo from '@/assets/models/chatglm_dark.png'

// Llama / Meta
import LlamaLogo from '@/assets/models/llama.png'
import LlamaDarkLogo from '@/assets/models/llama_dark.png'

// Mistral / Mixtral
import MistralLogo from '@/assets/models/mixtral.png'
import MistralDarkLogo from '@/assets/models/mixtral_dark.png'
import CodestralLogo from '@/assets/models/codestral.png'

// Yi / 零一
import YiLogo from '@/assets/models/yi.png'
import YiDarkLogo from '@/assets/models/yi_dark.png'

// Hunyuan / 混元
import HunyuanLogo from '@/assets/models/hunyuan.png'
import HunyuanDarkLogo from '@/assets/models/hunyuan_dark.png'

// Wenxin / 文心 / ERNIE
import WenxinLogo from '@/assets/models/wenxin.png'
import WenxinDarkLogo from '@/assets/models/wenxin_dark.png'

// SparkDesk / 讯飞星火
import SparkDeskLogo from '@/assets/models/sparkdesk.png'
import SparkDeskDarkLogo from '@/assets/models/sparkdesk_dark.png'

// Step / 阶跃
import StepLogo from '@/assets/models/step.png'
import StepDarkLogo from '@/assets/models/step_dark.png'

// MiniMax
import MiniMaxLogo from '@/assets/models/minimax.png'

// Kila
import KilaLogo from '@/assets/models/kila.png'

// Cohere
import CohereLogo from '@/assets/models/cohere.png'
import CohereDarkLogo from '@/assets/models/cohere_dark.png'

// Embedding
import EmbeddingLogo from '@/assets/models/embedding.png'

// ===== 供应商类型 =====

import type { ProviderType } from '@kila/shared'

// ===== 正则匹配映射 =====

const OPENAI_MODEL_PATTERN = /(gpt|o1|o3|o4)/i
const OPENAI_CHANNEL_URL_PATTERN = /openai\.com/i

/**
 * 模型 Logo 映射表
 *
 * key 为正则表达式模式（忽略大小写匹配），
 * value 为对应的 Logo 资源路径。
 * 匹配顺序即为优先级，更具体的规则排前面。
 */
const MODEL_LOGO_MAP: Record<string, string> = {
  // === GPT 系列 ===
  [OPENAI_MODEL_PATTERN.source]: OpenAILogo,

  // === Claude / Anthropic ===
  '(claude|anthropic-)': ClaudeLogo,

  // === DeepSeek ===
  deepseek: DeepSeekLogo,

  // === 自定义 Gemini 衍生模型（必须在通用 gemini 规则之前） ===
  deepgemini: DeepGeminiLogo,
  kimigemini: KimiGeminiLogo,
  qwengemini: QwenGeminiLogo,
  seedgemini: SeedGeminiLogo,

  // === Google / Gemini ===
  veo: GeminiLogo,
  gemma: GemmaLogo,
  gemini: GeminiLogo,

  // === Qwen / 通义千问 ===
  '(qwen|qwq|qvq|wan-)': QwenLogo,

  // === Grok / xAI ===
  grok: GrokLogo,

  // === Moonshot / Kimi ===
  moonshot: MoonshotLogo,
  kimi: MoonshotLogo,

  // === Doubao / 豆包 ===
  doubao: DoubaoLogo,
  'ep-202': DoubaoLogo,

  // === Zhipu / 智谱 ===
  zhipu: ZhipuLogo,
  cogview: ZhipuLogo,
  glm: ChatGLMLogo,

  // === Meta / Llama ===
  llama: LlamaLogo,

  // === Mistral ===
  codestral: CodestralLogo,
  mixtral: MistralLogo,
  mistral: MistralLogo,
  ministral: MistralLogo,
  magistral: MistralLogo,

  // === Yi / 零一万物 ===
  'yi-': YiLogo,

  // === 百度文心 / ERNIE ===
  'ernie-': WenxinLogo,
  'tao-': WenxinLogo,

  // === 腾讯混元 ===
  hunyuan: HunyuanLogo,

  // === 讯飞星火 ===
  sparkdesk: SparkDeskLogo,
  generalv: SparkDeskLogo,

  // === Step / 阶跃星辰 ===
  step: StepLogo,

  // === MiniMax ===
  minimax: MiniMaxLogo,

  // === Cohere ===
  cohere: CohereLogo,
  command: CohereLogo,

  // === Embedding 通用 ===
  'text-embedding': EmbeddingLogo,
  embedding: EmbeddingLogo,
}

/**
 * 供应商 Logo 映射
 *
 * 当模型 ID 无法匹配时，按供应商类型回退。
 */
const PROVIDER_LOGO_MAP: Record<ProviderType, string> = {
  anthropic: ClaudeLogo,
  openai: OpenAILogo,
  deepseek: DeepSeekLogo,
  google: GeminiLogo,
  moonshot: MoonshotLogo,
  zhipu: ZhipuLogo,
  minimax: MiniMaxLogo,
  doubao: DoubaoLogo,
  qwen: QwenLogo,
  custom: DefaultLogo,
}

/**
 * Base URL 域名 → Logo 映射
 *
 * key 为正则表达式（忽略大小写），匹配 Base URL 域名部分。
 * 优先级高于 ProviderType，用于识别用户通过兼容格式接入的实际供应商。
 */
const URL_LOGO_MAP: Array<[RegExp, string]> = [
  [/kila\.cool/i, KilaLogo],
  [/moonshot\.cn|kimi/i, MoonshotLogo],
  [/bigmodel\.cn|zhipuai/i, ZhipuLogo],
  [/minimax/i, MiniMaxLogo],
  [/volces\.com|volcengine/i, DoubaoLogo],
  [/dashscope|aliyuncs/i, QwenLogo],
  [/deepseek/i, DeepSeekLogo],
  [/anthropic/i, ClaudeLogo],
  [OPENAI_CHANNEL_URL_PATTERN, OpenAILogo],
  [/googleapis|generativelanguage/i, GeminiLogo],
  [/grok|x\.ai/i, GrokLogo],
  [/stepfun/i, StepLogo],
  [/cohere/i, CohereLogo],
  [/spark-api|xfyun/i, SparkDeskLogo],
  [/hunyuan/i, HunyuanLogo],
  [/ernie|baidu/i, WenxinLogo],
  [/yi\.com|lingyiwanwu/i, YiLogo],
]

// ===== 公共 API =====

/**
 * 根据模型 ID 获取对应的 Logo
 *
 * 使用正则匹配，按优先级顺序遍历 MODEL_LOGO_MAP。
 * 未匹配到返回 undefined。
 *
 * @param modelId 模型 ID（如 "gpt-4-turbo"、"claude-3-opus-20240229"）
 */
export function getModelLogoById(modelId: string): string | undefined {
  if (!modelId) return undefined

  for (const key in MODEL_LOGO_MAP) {
    const regex = new RegExp(key, 'i')
    if (regex.test(modelId)) {
      return MODEL_LOGO_MAP[key]
    }
  }

  return undefined
}

/**
 * 根据模型 ID + 供应商获取 Logo（带回退）
 *
 * 优先使用模型 ID 正则匹配，未匹配到则回退到供应商 Logo，
 * 最终回退到默认图标。
 *
 * @param modelId 模型 ID
 * @param provider 供应商类型（可选）
 */
export function getModelLogo(modelId: string, provider?: ProviderType): string {
  return getModelLogoById(modelId)
    ?? (provider ? PROVIDER_LOGO_MAP[provider] : undefined)
    ?? DefaultLogo
}

/**
 * 判断模型 Logo 是否属于 OpenAI / GPT 家族
 *
 * 用于给单色 OpenAI 图标追加主题对比度处理，
 * 避免影响其他彩色供应商图标。
 */
export function isOpenAIModelLogo(modelId: string, provider?: ProviderType): boolean {
  if (modelId && OPENAI_MODEL_PATTERN.test(modelId)) {
    return true
  }

  return provider === 'openai'
}

/**
 * 根据供应商类型获取 Logo
 *
 * @param provider 供应商类型
 */
export function getProviderLogo(provider: ProviderType): string {
  return PROVIDER_LOGO_MAP[provider] ?? DefaultLogo
}

/**
 * 根据 Base URL 获取渠道 Logo
 *
 * 按 URL 域名匹配实际供应商，未匹配到则返回默认图标。
 * 适用于渠道列表展示，即使用户用兼容格式接入也能识别真实供应商。
 *
 * @param baseUrl 渠道的 Base URL
 */
export function getChannelLogo(baseUrl: string): string {
  if (baseUrl) {
    for (const [regex, logo] of URL_LOGO_MAP) {
      if (regex.test(baseUrl)) {
        return logo
      }
    }
  }
  return DefaultLogo
}

/**
 * 判断渠道 Logo 是否属于 OpenAI 官方域名
 */
export function isOpenAIChannelLogo(baseUrl: string): boolean {
  return OPENAI_CHANNEL_URL_PATTERN.test(baseUrl)
}

/**
 * 首字母头像色板（用于 DB provider 兜底）
 *
 * 按 name hash 取色，保证同一个 provider 跨会话颜色稳定。
 */
const LETTER_AVATAR_COLORS = [
  'hsl(220 70% 55%)',
  'hsl(280 65% 55%)',
  'hsl(330 70% 55%)',
  'hsl(20 75% 55%)',
  'hsl(45 80% 50%)',
  'hsl(140 55% 45%)',
  'hsl(180 60% 45%)',
  'hsl(15 70% 50%)',
]

/** 计算 provider name 的稳定 hash → 用于色板索引 */
function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0
  }
  return h
}

/**
 * 根据 provider name 生成首字母头像 data URL（SVG → base64）
 *
 * 用于 DB provider 没有内置 logo 时的兜底。
 * 颜色稳定 hash，跨会话一致；首字母大写。
 */
export function getProviderLetterAvatar(name: string): string {
  const trimmed = (name || '?').trim()
  const letter = trimmed.charAt(0).toUpperCase()
  const colorIdx = hashString(trimmed) % LETTER_AVATAR_COLORS.length
  const color = LETTER_AVATAR_COLORS[colorIdx]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${color}"/><text x="32" y="42" font-family="-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif" font-size="32" font-weight="600" fill="white" text-anchor="middle">${letter}</text></svg>`
  return `data:image/svg+xml;base64,${btoa(svg)}`
}

/**
 * 综合解析 provider 图标 URL
 *
 * 优先级：
 * 1. baseUrl 域名匹配（getChannelLogo）
 * 2. capabilityProviderId / provider 命中内置 PROVIDER_LOGO_MAP
 * 3. letter avatar 兜底（基于 displayName 或 provider id）
 *
 * 用于 DB 驱动的预设列表与渠道列表渲染。
 */
export function getProviderLogoResolved(input: {
  baseUrl?: string
  provider?: string
  capabilityProviderId?: string
  displayName?: string
}): string {
  const { baseUrl, provider, capabilityProviderId, displayName } = input
  // 1. baseUrl 命中已知域名
  if (baseUrl) {
    for (const [regex, logo] of URL_LOGO_MAP) {
      if (regex.test(baseUrl)) return logo
    }
  }
  // 2. provider / capabilityProviderId 命中内置 map
  const lookupKey = capabilityProviderId ?? provider
  if (lookupKey && lookupKey in PROVIDER_LOGO_MAP) {
    return PROVIDER_LOGO_MAP[lookupKey as ProviderType] ?? DefaultLogo
  }
  // 3. letter avatar 兜底
  return getProviderLetterAvatar(displayName || capabilityProviderId || provider || '?')
}

/** 默认模型图标 */
export { DefaultLogo, KilaLogo }
