/**
 * native-feel-ipc — Native-feel 相关 IPC 处理器
 */

import { clipboard } from 'electron'
import { handleUntyped } from './shared'
import { assertString } from './validation'

export function registerNativeFeelHandlers(): void {
  handleUntyped('native-feel:copy-rich-text', (_event, text: string, html: string) => {
    clipboard.write({
      text: assertString(text, 'text', { max: 2 * 1024 * 1024 }),
      html: assertString(html, 'html', { max: 4 * 1024 * 1024 }),
    })
  })
}
