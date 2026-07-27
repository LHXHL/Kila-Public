/**
 * Provider 适配器类型定义
 *
 * 主链路已迁到 Pi runtime，core 仅保留两条非流式辅助能力：
 * - 会话标题生成（session-title-service / session-suggestion-service）
 * - 图片视觉描述（agent-tools/vision-tool）
 *
 * core 层不依赖 Electron / Node fs，适配器是纯逻辑，不执行 fetch。
 */

import type { FileAttachment, ProviderType } from '@kila/shared'

// ===== Tool Use（Function Calling）=====
// 以下工具类型不属于流式链路，仍被主进程 agent-tool-registry 与 agent-tools/*
// 复用（工具元数据、HTTP 工具调用与执行结果），因此保留。

/** 工具参数属性定义 */
export interface ToolParameterProperty {
  type: string
  description?: string
  enum?: string[]
}

/** 工具定义（供应商无关的统一格式） */
export interface ToolDefinition {
  /** 工具名称 */
  name: string
  /** 工具描述 */
  description: string
  /** JSON Schema 格式的参数定义 */
  parameters: {
    type: 'object'
    properties: Record<string, ToolParameterProperty>
    required?: string[]
  }
}

/** 模型返回的工具调用 */
export interface ToolCall {
  /** 工具调用 ID（用于匹配结果） */
  id: string
  /** 工具名称 */
  name: string
  /** 解析后的参数 */
  arguments: Record<string, unknown>
  /** 供应商特定的元数据（如 Google 的 thought_signature） */
  metadata?: Record<string, unknown>
}

/** 工具执行结果 */
export interface ToolResult {
  /** 对应的工具调用 ID */
  toolCallId: string
  /** 执行结果内容 */
  content: string
  /** 是否出错 */
  isError?: boolean
  /** 工具生成的附件（如生图工具的图片），附加到 assistant 消息展示 */
  generatedAttachments?: FileAttachment[]
}

// ===== HTTP 请求 =====

/** 构建好的 HTTP 请求配置（用于 fetch） */
export interface ProviderRequest {
  /** 完整的请求 URL */
  url: string
  /** HTTP 请求头 */
  headers: Record<string, string>
  /** JSON 序列化后的请求体 */
  body: string
}

// ===== 请求输入 =====

/** 标题生成请求的输入参数 */
export interface TitleRequestInput {
  /** 供应商 API Base URL */
  baseUrl: string
  /** 明文 API Key */
  apiKey: string
  /** 模型 ID */
  modelId: string
  /** 标题生成 prompt（已包含用户消息） */
  prompt: string
}

/** 视觉请求的输入参数 */
export interface VisionRequestInput {
  /** 供应商 API Base URL */
  baseUrl: string
  /** 明文 API Key */
  apiKey: string
  /** 模型 ID */
  modelId: string
  /** 图片 base64 数据 */
  image: { data: string; mimeType: string }
  /** 提示词（默认"请描述这张图片"） */
  prompt?: string
}

// ===== 适配器接口 =====

/**
 * AI 供应商适配器接口
 *
 * 每个供应商（Anthropic、OpenAI、Google）实现此接口。
 * 适配器只负责非流式请求构建与响应解析（标题 + 视觉描述），
 * 不执行 fetch，不访问文件系统。
 */
export interface ProviderAdapter {
  /** 供应商类型标识 */
  readonly providerType: ProviderType

  /**
   * 构建标题生成请求的 HTTP 配置（非流式）
   */
  buildTitleRequest(input: TitleRequestInput): ProviderRequest

  /**
   * 从标题请求的响应 JSON 中提取标题文本
   *
   * @param responseBody 响应 JSON 对象
   * @returns 提取的标题文本，失败返回 null
   */
  parseTitleResponse(responseBody: unknown): string | null

  /**
   * 构建视觉描述请求的 HTTP 配置（非流式）
   */
  buildVisionRequest(input: VisionRequestInput): ProviderRequest

  /**
   * 从视觉请求的响应 JSON 中提取描述文本
   */
  parseVisionResponse(responseBody: unknown): string | null
}
