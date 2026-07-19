/**
 * IPC 桥接轻量入口
 *
 * 仅导出 preload 所需的 IPC 通道常量和类型安全工具函数。
 * 不导出任何依赖重运行时包（如 @earendil-works/pi-ai、zod、ajv）的工具函数，
 * 避免 preload bundle 膨胀。
 */

// IPC 通道常量
export { IPC_CHANNELS, GIT_IPC_CHANNELS } from './types/runtime'
export { CHANNEL_IPC_CHANNELS } from './types/channel'
export { AGENT_IPC_CHANNELS } from './types/agent'
export { SESSION_IPC_CHANNELS } from './types/session'
export { SESSION_BOARD_IPC_CHANNELS } from './types/session-board'
export { ENVIRONMENT_IPC_CHANNELS } from './types/environment'
export { PROXY_IPC_CHANNELS } from './types/proxy'
export { GITHUB_RELEASE_IPC_CHANNELS } from './types/github'
export { PERSONALITY_IPC_CHANNELS } from './types/personality'
export { AGENT_TOOL_IPC_CHANNELS } from './types/agent-tool'
export { FEISHU_BRIDGE_IPC_CHANNELS, IM_BRIDGE_IPC_CHANNELS, WECHAT_BRIDGE_IPC_CHANNELS } from './types/im-bridge'
export { TOKEN_USAGE_IPC_CHANNELS } from './types/token-usage'
export { NOTIFICATION_IPC_CHANNELS } from './types/notification'
export { SCHEDULED_TASK_IPC_CHANNELS } from './types/scheduled-task'
export { INSTALLER_IPC_CHANNELS } from './types/installer'
export { SYSTEM_PROMPT_IPC_CHANNELS } from './types/system-prompt'
export { THEME_IPC_CHANNELS } from './theme/theme-schema'

// 类型安全 IPC 工具函数
export { typedInvoke, typedHandle, buildTypedApi } from './utils/typed-ipc'

// IPC 契约类型
export type {
  IpcContractChannel,
  IpcArgs,
  IpcResult,
} from './types/ipc-contract'

// Cua Driver 通道常量
export { CUA_DRIVER_IPC_CHANNELS } from './types/agent'
