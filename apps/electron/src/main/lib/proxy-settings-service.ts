/**
 * 全局代理配置服务
 *
 * 管理应用的全局代理配置，支持系统代理自动检测和手动配置。
 * 配置文件存储在 ~/.kila/proxy-settings.json。
 */

import { existsSync } from 'node:fs'
import type { ProxyConfig } from '@kila/shared'
import { getProxySettingsPath } from './config-paths'
import { detectSystemProxy } from './system-proxy-detector'
import { readJsonWithBackup, writeTextAtomicWithBackup } from './safe-json-file'

/**
 * 默认代理配置
 */

import { createLogger } from './logger'
const log = createLogger('代理配置')

const DEFAULT_PROXY_CONFIG: ProxyConfig = {
  enabled: false,
  mode: 'system',
  manualUrl: '',
}

/**
 * 归一化磁盘上的代理配置。
 *
 * 结构不合法时直接抛错，交给 readJsonWithBackup 回退 .bak；
 * 否则 JSON.parse 出的 null / 数组会被当成合法配置继续往下传。
 */
function normalizeProxyConfig(value: unknown): ProxyConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('代理配置不是合法的 JSON 对象')
  }

  const data = value as Partial<ProxyConfig>
  return {
    enabled: data.enabled ?? DEFAULT_PROXY_CONFIG.enabled,
    mode: data.mode === 'manual' ? 'manual' : 'system',
    manualUrl: typeof data.manualUrl === 'string' ? data.manualUrl : '',
  }
}

/**
 * 读取代理配置
 *
 * 如果配置文件不存在，返回默认配置。
 */
export async function getProxySettings(): Promise<ProxyConfig> {
  const configPath = getProxySettingsPath()

  if (!existsSync(configPath)) {
    log.info('[代理配置] 配置文件不存在，使用默认配置')
    return DEFAULT_PROXY_CONFIG
  }

  try {
    return readJsonWithBackup(configPath, (raw) => normalizeProxyConfig(JSON.parse(raw)))
  } catch (error) {
    // 代理配置是整体覆盖写，不存在「用兜底值抹掉历史」的风险，因此只降级不锁写。
    log.error('[代理配置] 读取配置失败，本次回退默认配置:', error)
    return DEFAULT_PROXY_CONFIG
  }
}

/**
 * 保存代理配置
 *
 * @param config 代理配置
 */
export async function saveProxySettings(config: ProxyConfig): Promise<void> {
  const configPath = getProxySettingsPath()

  try {
    // 原子写 + 备份：写入中断不会留下半截 JSON，导致下次启动读不出代理配置
    writeTextAtomicWithBackup(configPath, JSON.stringify(config, null, 2))
    log.info(`[代理配置] 配置已保存: enabled=${config.enabled}, mode=${config.mode}`)
  } catch (error) {
    log.error('[代理配置] 保存配置失败:', error)
    throw new Error('保存代理配置失败')
  }
}

/**
 * 获取当前生效的代理 URL
 *
 * 根据配置返回实际使用的代理地址：
 * - 如果代理未启用，返回 undefined
 * - 如果是系统代理模式，自动检测系统代理
 * - 如果是手动模式，返回手动配置的地址
 *
 * @returns 代理 URL（如果有）
 */
export async function getEffectiveProxyUrl(): Promise<string | undefined> {
  const config = await getProxySettings()

  if (!config.enabled) {
    return undefined
  }

  if (config.mode === 'system') {
    const result = await detectSystemProxy()
    if (result.success && result.proxyUrl) {
      log.info('[代理配置] 已启用系统代理')
      return result.proxyUrl
    }
    log.info('[代理配置] 系统代理检测失败:', result.message)
    return undefined
  }

  // 手动模式
  if (config.manualUrl.trim()) {
    log.info('[代理配置] 已启用手动代理')
    return config.manualUrl.trim()
  }

  return undefined
}
