/**
 * 用户档案服务
 *
 * 管理用户档案（用户名、头像、时区、位置）的读写。
 * 存储在 ~/.kila/user-profile.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'path'
import { getUserProfilePath } from './config-paths'
import { DEFAULT_USER_AVATAR, DEFAULT_USER_NAME } from '../../types'
import type { UserProfile } from '../../types'

import { createLogger } from './logger'
const log = createLogger('用户档案')

/** 缓存的 Kila logo base64 data URL */
let cachedDefaultAvatar: string | null = null

function getSystemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function isValidTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat('zh-CN', { timeZone: value }).format(new Date())
    return true
  } catch {
    return false
  }
}

function normalizeTimeZone(value: unknown): string {
  if (typeof value !== 'string') {
    return getSystemTimeZone()
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return getSystemTimeZone()
  }

  return isValidTimeZone(trimmed) ? trimmed : getSystemTimeZone()
}

function normalizeOptionalText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeUserProfile(data: Partial<UserProfile>): UserProfile {
  const avatar = data.avatar && data.avatar !== '🧑‍💻'
    ? data.avatar
    : getDefaultAvatar()

  return {
    userName: normalizeOptionalText(data.userName) || DEFAULT_USER_NAME,
    avatar,
    timeZone: normalizeTimeZone(data.timeZone),
    city: normalizeOptionalText(data.city),
    country: normalizeOptionalText(data.country),
  }
}

/** 获取 Kila logo 作为默认头像 */
export function getDefaultAvatar(): string {
  if (cachedDefaultAvatar) return cachedDefaultAvatar

  try {
    const logoPath = join(__dirname, 'resources', 'kila-logos', 'icon-source.png')
    if (existsSync(logoPath)) {
      const buf = readFileSync(logoPath)
      cachedDefaultAvatar = `data:image/png;base64,${buf.toString('base64')}`
      return cachedDefaultAvatar
    }
  } catch (error) {
    log.error('[用户档案] 加载默认头像失败:', error)
  }

  return ''
}

export function getUserProfile(): UserProfile {
  const filePath = getUserProfilePath()

  if (!existsSync(filePath)) {
    return normalizeUserProfile({})
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as Partial<UserProfile>
    return normalizeUserProfile(data)
  } catch (error) {
    log.error('[用户档案] 读取失败:', error)
    return normalizeUserProfile({})
  }
}

export function updateUserProfile(updates: Partial<UserProfile>): UserProfile {
  const current = getUserProfile()
  const updated = normalizeUserProfile({
    ...current,
    ...updates,
  })

  const filePath = getUserProfilePath()

  try {
    writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8')
    log.info(`[用户档案] 已更新: ${updated.userName}`)
  } catch (error) {
    log.error('[用户档案] 写入失败:', error)
    throw new Error('写入用户档案失败')
  }

  return updated
}
