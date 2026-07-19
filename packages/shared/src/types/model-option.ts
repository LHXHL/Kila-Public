import type { ModelMetadataOverride, ProviderType } from './channel'

/**
 * 模型选项（扁平化的渠道+模型组合）
 *
 * 用于渲染进程的模型选择器下拉列表。
 */
export interface ModelOption {
  /** 渠道 ID */
  channelId: string
  /** 渠道名称 */
  channelName: string
  /** 模型 ID */
  modelId: string
  /** 模型显示名称 */
  modelName: string
  /** AI 供应商类型 */
  provider: ProviderType
  /** 渠道 Base URL，用于模型元数据解析 */
  baseUrl?: string
  /** 用户手动覆盖的模型元数据 */
  metadataOverride?: ModelMetadataOverride
}
