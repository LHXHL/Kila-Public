/**
 * Bash 环境检测模块（Windows 平台）
 *
 * 检测策略：
 * - 打包模式：直接使用内置 busybox bash（开箱即用，不依赖系统 Git Bash）
 * - 开发模式：查找 PATH 中的 bash（开发者本机已安装 Git for Windows 等）
 *
 * 注意：busybox 使用 ash shell，不支持 `bash --version`，
 * 因此内置 bash 直接信任，不做版本验证。
 */

import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { GitBashStatus } from '@kila/shared'

import { createLogger } from './logger'
const log = createLogger('Bash 检测')

/**
 * 检测 Bash 环境
 *
 * 策略：
 * 1. 打包模式下直接使用内置 busybox bash
 * 2. 开发模式下查找系统 PATH 中的 bash
 *
 * @returns Bash 可用状态
 */
export async function detectGitBash(): Promise<GitBashStatus> {
  // 仅在 Windows 平台执行
  if (process.platform !== 'win32') {
    return {
      available: false,
      path: null,
      version: null,
      error: '非 Windows 平台',
    }
  }

  // 打包模式：直接使用内置 busybox bash
  if (app.isPackaged) {
    const bundledBashPath = join(process.resourcesPath, 'vendor', 'bash', 'bash.exe')
    if (existsSync(bundledBashPath)) {
      log.info(`[Bash 检测] 使用内置 bash: ${bundledBashPath}`)
      return {
        available: true,
        path: bundledBashPath,
        version: 'busybox',
        error: null,
      }
    }

    log.warn('[Bash 检测] 内置 bash 不存在')
    return {
      available: false,
      path: null,
      version: null,
      error: '内置 bash 缺失，请重新安装',
    }
  }

  // 开发模式：查找系统 bash
  const { execSync } = await import('node:child_process')
  try {
    const output = execSync('where bash', {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const bashPath = output.trim().split('\n')[0]?.trim()
    if (bashPath && existsSync(bashPath)) {
      log.info(`[Bash 检测] 开发模式，使用系统 bash: ${bashPath}`)
      return {
        available: true,
        path: bashPath,
        version: 'system',
        error: null,
      }
    }
  } catch {
    // where bash 失败
  }

  log.warn('[Bash 检测] 未找到可用的 bash 环境')
  return {
    available: false,
    path: null,
    version: null,
    error: '未找到 bash 环境',
  }
}
