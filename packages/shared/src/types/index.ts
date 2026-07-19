/**
 * Shared type definitions for kila
 */

// Placeholder types - will be expanded as needed
export interface Workspace {
  id: string
  name: string
  path: string
}

// 运行时相关类型
export * from './runtime'

// 渠道（AI 供应商）相关类型
export * from './channel'

// 代理配置相关类型
export * from './proxy'

// 附件相关类型
export * from './attachment'

// 模型选择相关类型
export * from './model-option'

// Provider message 兼容类型
export * from './provider-message'

// Agent 相关类型
export * from './agent'

// Unified session 相关类型
export * from './session'

// 快速任务相关类型
export * from './quick-task'

// CLI bridge 相关类型
export * from './cli-bridge'

// Session Board 相关类型
export * from './session-board'

// 文件预览相关类型
export * from './file-preview'

// Agent Provider 适配器接口
export * from './agent-provider'

// 环境检测相关类型
export * from './environment'

// 安装器相关类型
export * from './installer'

// GitHub Release 相关类型
export * from './github'

// Personality 相关类型
export * from './personality'

// Generative UI 相关类型
export * from './generative-ui'

// Widget bridge 相关类型
export * from './widget-intent'

// Agent 工具（function calling）相关类型
export * from './agent-tool'

// IM bridge 相关类型
export * from './im-bridge'

// Scheduled task 相关类型
export * from './scheduled-task'

// Token usage 统计相关类型
export * from './token-usage'

// 站内通知相关类型
export * from './notification'

// IPC 类型安全契约
export * from './ipc-contract'

// 自定义系统提示词相关类型
export * from './system-prompt'
