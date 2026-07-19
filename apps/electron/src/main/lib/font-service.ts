/**
 * 系统字体枚举服务
 *
 * 使用 font-list 包获取系统已安装字体列表。
 * 结果做内存缓存（字体列表不会频繁变化）。
 */

import { exec } from 'node:child_process'

/** 缓存 */

import { createLogger } from './logger'
const log = createLogger('字体')

let cachedFonts: string[] | null = null

/**
 * 获取系统已安装字体名称（去重、排序）
 */
export async function getSystemFonts(): Promise<string[]> {
  if (cachedFonts) return cachedFonts

  try {
    const fonts = await listFontsMac()
    cachedFonts = fonts
    return fonts
  } catch (error) {
    log.error('[字体] 枚举失败:', error)
    return []
  }
}

/**
 * macOS: 使用 system_profiler 或 fc-list 列出字体
 */
function listFontsMac(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    // 使用 NSFontManager 通过 osascript 获取字体列表（更快更准确）
    const script = `osascript -e 'use framework "AppKit"' -e 'set fontNames to (current application\\'s NSFontManager\\'s sharedFontManager()\\'s availableFontFamilies()) as list' -e 'set text item delimiters to linefeed' -e 'fontNames as text'`

    exec(script, { maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) {
        // fallback: fc-list
        exec('fc-list : family', { maxBuffer: 1024 * 1024 }, (err2, stdout2) => {
          if (err2) {
            reject(err2)
            return
          }
          const fonts = parseFontList(stdout2)
          resolve(fonts)
        })
        return
      }

      const fonts = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('.'))
      const unique = [...new Set(fonts)].sort((a, b) => a.localeCompare(b, 'zh-CN'))
      resolve(unique)
    })
  })
}

/**
 * 解析 fc-list 输出
 */
function parseFontList(raw: string): string[] {
  const families = raw
    .split('\n')
    .flatMap((line) => line.split(','))
    .map((name) => name.trim())
    .filter((name) => name.length > 0 && !name.startsWith('.'))

  return [...new Set(families)].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}
