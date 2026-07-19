/**
 * 系统代理检测工具
 *
 * 支持 macOS、Windows、Linux 三个平台的系统代理自动检测。
 */

import type { SystemProxyDetectResult } from '@kila/shared'

/**
 * 检测系统代理配置
 *
 * @returns 检测结果，包含代理地址（如果有）
 */

import { createLogger } from './logger'
const log = createLogger('系统代理检测')

export async function detectSystemProxy(): Promise<SystemProxyDetectResult> {
  const platform = process.platform

  try {
    switch (platform) {
      case 'darwin':
        return await detectMacOSProxy()
      case 'win32':
        return await detectWindowsProxy()
      case 'linux':
        return detectLinuxProxy()
      default:
        return {
          success: false,
          message: `不支持的平台: ${platform}`,
        }
    }
  } catch (error) {
    log.error('[系统代理检测] 检测失败:', error)
    return {
      success: false,
      message: error instanceof Error ? error.message : '检测失败',
    }
  }
}

/**
 * 检测 macOS 系统代理
 *
 * 使用 networksetup 命令读取网络偏好设置中的 HTTP/HTTPS 代理配置。
 * macOS 的 networksetup 输出始终为 UTF-8，无需额外编码处理。
 */
async function detectMacOSProxy(): Promise<SystemProxyDetectResult> {
  try {
    const { execSync } = await import('node:child_process')

    let networkService = 'Wi-Fi'
    try {
      const services = execSync('networksetup -listallnetworkservices', { encoding: 'utf-8' })
      const serviceList = services.split('\n').filter((s) => s && !s.startsWith('*'))

      if (serviceList.includes('Wi-Fi')) {
        networkService = 'Wi-Fi'
      } else if (serviceList.includes('Ethernet')) {
        networkService = 'Ethernet'
      } else if (serviceList.length > 0) {
        networkService = serviceList[0]!
      }
    } catch {
      // 如果获取服务列表失败，使用默认的 Wi-Fi
    }

    const proxyOutput = execSync(`networksetup -getwebproxy "${networkService}"`, {
      encoding: 'utf-8',
    })

    const lines = proxyOutput.split('\n')
    let enabled = false
    let server = ''
    let port = ''

    for (const line of lines) {
      if (line.includes('Enabled: Yes')) {
        enabled = true
      } else if (line.includes('Server:')) {
        server = line.split(':')[1]?.trim() || ''
      } else if (line.includes('Port:')) {
        port = line.split(':')[1]?.trim() || ''
      }
    }

    if (enabled && server && port) {
      const proxyUrl = `http://${server}:${port}`
      return {
        success: true,
        proxyUrl,
        message: `检测到系统代理: ${proxyUrl}`,
      }
    }

    return {
      success: false,
      message: '系统未配置代理',
    }
  } catch (error) {
    log.error('[macOS 代理检测] 失败:', error)
    return {
      success: false,
      message: 'macOS 代理检测失败',
    }
  }
}

/**
 * 检测 Windows 系统代理
 *
 * 读取注册表中的 Internet Settings 代理配置。
 *
 * 注意：Windows 的 reg 命令输出使用系统代码页（中文 Windows 为 GBK/CP936），
 * 但注册表值本身只包含 ASCII 字符（IP、端口、REG_SZ 等标记），
 * 所以用 buffer 编码读取再以 latin1 解码，避免 UTF-8 乱码导致正则匹配失败。
 */
async function detectWindowsProxy(): Promise<SystemProxyDetectResult> {
  try {
    const { execSync } = await import('node:child_process')

    // 读取注册表中的代理设置（buffer 编码 + latin1 解码，避免 GBK 乱码）
    const regOutput = execSync(
      'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable',
      { encoding: 'buffer', windowsHide: true }
    ).toString('latin1')

    // 0x1 是纯 ASCII，latin1 解码后可正常匹配
    const proxyEnabled = regOutput.includes('0x1')

    if (!proxyEnabled) {
      return {
        success: false,
        message: '系统未启用代理',
      }
    }

    // 读取代理服务器地址
    const serverOutput = execSync(
      'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer',
      { encoding: 'buffer', windowsHide: true }
    ).toString('latin1')

    // ProxyServer、REG_SZ 和 URL 均为 ASCII，latin1 解码后正则可正常匹配
    const match = serverOutput.match(/ProxyServer\s+REG_SZ\s+(.+)/)
    if (match?.[1]) {
      let proxyUrl = match[1].trim()

      // 如果包含协议分隔符，提取 http 或 https 代理
      if (proxyUrl.includes('=')) {
        const httpMatch = proxyUrl.match(/https?=([^;]+)/)
        if (httpMatch?.[1]) {
          proxyUrl = httpMatch[1]
        }
      }

      // 确保有协议前缀
      if (!proxyUrl.startsWith('http://') && !proxyUrl.startsWith('https://')) {
        proxyUrl = `http://${proxyUrl}`
      }

      return {
        success: true,
        proxyUrl,
        message: `检测到系统代理: ${proxyUrl}`,
      }
    }

    return {
      success: false,
      message: '无法读取代理服务器地址',
    }
  } catch (error) {
    log.error('[Windows 代理检测] 失败:', error)
    return {
      success: false,
      message: 'Windows 代理检测失败',
    }
  }
}

/**
 * 检测 Linux 系统代理
 *
 * 读取环境变量 HTTP_PROXY / HTTPS_PROXY / http_proxy / https_proxy。
 */
function detectLinuxProxy(): SystemProxyDetectResult {
  const httpProxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy

  if (httpProxy) {
    return {
      success: true,
      proxyUrl: httpProxy,
      message: `检测到系统代理: ${httpProxy}`,
    }
  }

  return {
    success: false,
    message: '系统未配置代理环境变量',
  }
}
