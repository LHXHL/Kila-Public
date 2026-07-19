/**
 * Agent Tool 模块化系统类型定义
 *
 * Agent runtime 的工具注册、配置、执行相关共享类型。
 * agent-tools.json 管理工具开关和工具凭据。
 */

// ===== 工具元数据 =====

/** 工具参数定义（简化格式，供用户/Agent 创建） */
export interface AgentToolParam {
  /** 参数名 */
  name: string
  /** 参数类型 */
  type: 'string' | 'number' | 'boolean'
  /** 参数描述 */
  description: string
  /** 是否必填 */
  required?: boolean
  /** 可选值枚举 */
  enum?: string[]
}

/** HTTP 执行器配置（自定义工具用） */
export interface AgentToolHttpConfig {
  /** 请求 URL 模板，支持 {{param}} 占位符 */
  urlTemplate: string
  /** HTTP 方法 */
  method: 'GET' | 'POST'
  /** 请求头 */
  headers?: Record<string, string>
  /** 请求体模板（JSON 字符串，支持 {{param}} 占位符） */
  bodyTemplate?: string
  /** 响应结果提取的 JSONPath（可选，默认取全部） */
  resultPath?: string
}

/** 工具元数据（描述一个工具"是什么"） */
export interface AgentToolMeta {
  /** 工具唯一标识（slug 格式） */
  id: string
  /** 显示名称 */
  name: string
  /** 描述（同时作为 LLM 的 tool description） */
  description: string
  /** 参数列表 */
  params: AgentToolParam[]
  /** 图标名称（lucide 图标名，可选） */
  icon?: string
  /** 工具类别 */
  category: 'builtin' | 'custom'
  /** 系统提示词追加（启用时注入） */
  systemPromptAppend?: string
  /** 执行器类型：builtin 由代码处理，http 由配置的 endpoint 处理 */
  executorType: 'builtin' | 'http'
  /** HTTP 执行器配置（executorType === 'http' 时使用） */
  httpConfig?: AgentToolHttpConfig
}

// ===== 配置持久化 =====

/** 单个工具的开关配置 */
export interface AgentToolState {
  /** 是否启用 */
  enabled: boolean
}

/** 配置文件结构（~/.kila/agent-tools.json） */
export interface AgentToolsFileConfig {
  /** 各工具的开关状态，key 为工具 id */
  toolStates: Record<string, AgentToolState>
  /** 工具凭据，key 为工具 id */
  toolCredentials: Record<string, Record<string, string>>
  /** 自定义工具定义列表 */
  customTools: AgentToolMeta[]
}

// ===== 渲染进程交互 =====

/** 渲染进程看到的完整工具信息 */
export interface AgentToolInfo {
  /** 工具元数据 */
  meta: AgentToolMeta
  /** 开关状态 */
  enabled: boolean
  /** 工具是否可用（凭据已配置） */
  available: boolean
}

// ===== IPC 通道 =====

export const AGENT_TOOL_IPC_CHANNELS = {
  /** 获取所有可用工具信息 */
  GET_ALL_TOOLS: 'agent-tool:get-all-tools',
  /** 获取工具凭据 */
  GET_TOOL_CREDENTIALS: 'agent-tool:get-credentials',
  /** 更新单个工具的开关状态 */
  UPDATE_TOOL_STATE: 'agent-tool:update-state',
  /** 更新工具凭据 */
  UPDATE_TOOL_CREDENTIALS: 'agent-tool:update-credentials',
  /** 测试工具连接 */
  TEST_TOOL: 'agent-tool:test',
  /** 创建自定义工具 */
  CREATE_CUSTOM_TOOL: 'agent-tool:create-custom',
  /** 删除自定义工具 */
  DELETE_CUSTOM_TOOL: 'agent-tool:delete-custom',
  /** 自定义工具配置变更通知（文件监听触发） */
  CUSTOM_TOOL_CHANGED: 'agent-tool:custom-tool-changed',
} as const
