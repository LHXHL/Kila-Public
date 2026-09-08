// ===== Cua Driver（Computer Use） =====

/** Cua Driver 安装状态 */
export type CuaDriverInstallStatus = 'not-installed' | 'installed' | 'unknown'

/** Cua Driver 运行时状态 */
export interface CuaDriverStatus {
  /** 是否已在 MCP 配置中注册 */
  registered: boolean
  /** 是否已启用 */
  enabled: boolean
  /** 安装状态 */
  installStatus: CuaDriverInstallStatus
  /** 检测到的二进制路径（空字符串 = 未找到） */
  binaryPath: string
  /** 检测到的版本（空字符串 = 未知） */
  version: string
  /** 最后一次检测时间 */
  lastCheckedAt: number
  /** 当前平台 */
  platform: 'macos' | 'windows' | 'linux'
}

/** Cua Driver 检测结果 */
export interface CuaDriverDetectResult {
  found: boolean
  binaryPath: string
  version: string
}

/** Cua Driver 安装结果 */
export interface CuaDriverInstallResult {
  success: boolean
  message: string
  binaryPath?: string
  version?: string
}

/** Cua Driver IPC 通道 */
export const CUA_DRIVER_IPC_CHANNELS = {
  /** 获取 Cua Driver 状态 */
  GET_STATUS: 'cua-driver:get-status',
  /** 检测本地安装 */
  DETECT: 'cua-driver:detect',
  /** 安装 Cua Driver */
  INSTALL: 'cua-driver:install',
  /** 启用/禁用 Cua Driver */
  TOGGLE: 'cua-driver:toggle',
  /** 测试 Cua Driver 连接 */
  TEST: 'cua-driver:test',
} as const
