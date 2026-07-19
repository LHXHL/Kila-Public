/**
 * 应用设置服务
 *
 * 管理应用设置（主题模式等）的读写。
 * 存储在 ~/.kila/settings.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { getSettingsPath } from './config-paths'
import { DEFAULT_THEME_ID, isBuiltinThemeId, isCustomThemeId } from '@kila/shared'
import { resolveTheme } from './theme-service'
import { DEFAULT_THEME_MODE, DEFAULT_LOCALE, DEFAULT_THEME_ID_SETTING } from '../../types'
import type { AppSettings } from '../../types'

/**
 * 获取应用设置
 *
 * 如果文件不存在，返回默认设置。
 */

import { createLogger } from './logger'
const log = createLogger('设置')

function normalizePositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : undefined
}

function normalizePositiveNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value > 0 ? value : undefined
}

function normalizeThemeId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return DEFAULT_THEME_ID_SETTING
  const themeId = value.trim()
  if (isBuiltinThemeId(themeId)) return themeId
  if (isCustomThemeId(themeId) && resolveTheme(themeId).id === themeId) return themeId
  return DEFAULT_THEME_ID
}

function normalizePermissionMode(value: unknown): AppSettings['agentPermissionMode'] {
  if (value === 'auto' || value === 'smart') return value
  if (value === 'supervised') return 'smart'
  return undefined
}

function removeLegacyBashRiskSettings(data: Record<string, unknown>): void {
  delete data.bashRiskAutoAllowMaxScore
  delete data.bashRiskDangerousScore
  delete data.bashRiskAutoDenyMinScore
}

function removeLegacyMemorySettings(data: Record<string, unknown>): void {
  delete data.memoryProviderMode
  delete data.memoryMemosBaseUrl
  delete data.memoryMemosApiKey
  delete data.memoryMemosUserId
  delete data.memorySessionDigestEnabled
  delete data.memoryDigestMinIntervalMs
}

export function getSettings(): AppSettings {
  const filePath = getSettingsPath()
  if (!existsSync(filePath)) {
    return {
      themeMode: DEFAULT_THEME_MODE,
      themeId: DEFAULT_THEME_ID_SETTING,
      onboardingCompleted: false,
      environmentCheckSkipped: false,
      notificationsEnabled: true,
      locale: DEFAULT_LOCALE,
      unifiedSessionsBootstrapped: false,
      sessionProjectModelBootstrapped: false,
      memoryNowledgeEnabled: false,
      tokenMonthlyBudgetUsd: undefined,
      tokenMonthlyBudgetTokens: undefined,
      memoryNowledgeTimeoutMs: 8_000,
      memorySessionContextEnabled: true,
    }
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as Partial<AppSettings> & Record<string, unknown>
    removeLegacyBashRiskSettings(data)
    removeLegacyMemorySettings(data)
    return {
      ...data,
      themeMode: data.themeMode || DEFAULT_THEME_MODE,
      themeId: normalizeThemeId(data.themeId),
      onboardingCompleted: data.onboardingCompleted ?? false,
      environmentCheckSkipped: data.environmentCheckSkipped ?? false,
      notificationsEnabled: data.notificationsEnabled ?? true,
      locale: data.locale ?? DEFAULT_LOCALE,
      unifiedSessionsBootstrapped: data.unifiedSessionsBootstrapped ?? false,
      sessionProjectModelBootstrapped: data.sessionProjectModelBootstrapped ?? false,
      agentPermissionMode: normalizePermissionMode(data.agentPermissionMode),
      memoryNowledgeEnabled: data.memoryNowledgeEnabled ?? false,
      tokenMonthlyBudgetUsd: normalizePositiveNumber(data.tokenMonthlyBudgetUsd),
      tokenMonthlyBudgetTokens: normalizePositiveInt(data.tokenMonthlyBudgetTokens),
      memoryNowledgeBaseUrl: typeof data.memoryNowledgeBaseUrl === 'string'
        ? (data.memoryNowledgeBaseUrl.trim() || undefined)
        : undefined,
      memoryNowledgeApiKey: typeof data.memoryNowledgeApiKey === 'string'
        ? (data.memoryNowledgeApiKey.trim() || undefined)
        : undefined,
      memoryNowledgeTimeoutMs: normalizePositiveInt(data.memoryNowledgeTimeoutMs)
        ?? 8_000,
      memorySessionContextEnabled: data.memorySessionContextEnabled ?? true,
    }
  } catch (error) {
    log.error('[设置] 读取失败:', error)
    return {
      themeMode: DEFAULT_THEME_MODE,
      themeId: DEFAULT_THEME_ID_SETTING,
      onboardingCompleted: false,
      environmentCheckSkipped: false,
      notificationsEnabled: true,
      locale: DEFAULT_LOCALE,
      unifiedSessionsBootstrapped: false,
      sessionProjectModelBootstrapped: false,
      memoryNowledgeEnabled: false,
      tokenMonthlyBudgetUsd: undefined,
      tokenMonthlyBudgetTokens: undefined,
      memoryNowledgeTimeoutMs: 8_000,
      memorySessionContextEnabled: true,
    }
  }
}

/**
 * 修复持久化设置中的失效主题 ID。
 *
 * 主题目录监听触发时调用；只有原始值与归一化结果不一致才写盘。
 */
export function repairStoredThemeId(): AppSettings | null {
  const filePath = getSettingsPath()
  if (!existsSync(filePath)) return null

  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8')) as Partial<AppSettings>
    const normalizedThemeId = normalizeThemeId(data.themeId)
    if (data.themeId === normalizedThemeId) return null
    return updateSettings({ themeId: normalizedThemeId })
  } catch {
    // 设置文件本身损坏时沿用 getSettings() 的完整降级逻辑，不在主题监听中覆盖其他字段。
    return null
  }
}

/**
 * 更新应用设置。
 *
 * 合并更新字段并写入文件。
 */
export function updateSettings(updates: Partial<AppSettings>): AppSettings {
  const current = getSettings()
  const has = <K extends keyof AppSettings>(key: K): boolean => Object.prototype.hasOwnProperty.call(updates, key)
  const resolveOptionalTrimmed = (key: 'memoryNowledgeBaseUrl' | 'memoryNowledgeApiKey'): string | undefined => {
    const value = has(key) ? updates[key] : current[key]
    return typeof value === 'string' ? value.trim() || undefined : undefined
  }
  const updated: AppSettings = {
    ...current,
    ...updates,
    themeId: normalizeThemeId(updates.themeId ?? current.themeId),
    agentPermissionMode: normalizePermissionMode(updates.agentPermissionMode ?? current.agentPermissionMode),
    memoryNowledgeEnabled: updates.memoryNowledgeEnabled ?? current.memoryNowledgeEnabled ?? false,
    tokenMonthlyBudgetUsd: normalizePositiveNumber(updates.tokenMonthlyBudgetUsd ?? current.tokenMonthlyBudgetUsd),
    tokenMonthlyBudgetTokens: normalizePositiveInt(updates.tokenMonthlyBudgetTokens ?? current.tokenMonthlyBudgetTokens),
    memoryNowledgeBaseUrl: resolveOptionalTrimmed('memoryNowledgeBaseUrl'),
    memoryNowledgeApiKey: resolveOptionalTrimmed('memoryNowledgeApiKey'),
    memoryNowledgeTimeoutMs: normalizePositiveInt(updates.memoryNowledgeTimeoutMs ?? current.memoryNowledgeTimeoutMs) ?? 8_000,
    memorySessionContextEnabled: updates.memorySessionContextEnabled ?? current.memorySessionContextEnabled ?? true,
  }
  removeLegacyBashRiskSettings(updated as unknown as Record<string, unknown>)
  removeLegacyMemorySettings(updated as unknown as Record<string, unknown>)

  const filePath = getSettingsPath()

  try {
    writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8')
    log.info(`[设置] 已更新 ${Object.keys(updates).length} 个字段`)
  } catch (error) {
    log.error('[设置] 写入失败:', error)
    throw new Error('写入应用设置失败')
  }

  return updated
}
