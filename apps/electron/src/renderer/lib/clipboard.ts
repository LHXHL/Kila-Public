/**
 * Renderer 剪贴板写入工具。
 *
 * Electron 原生剪贴板不受 Renderer Clipboard API 权限状态影响，因此优先使用；
 * 浏览器 API 与 execCommand 仅作为开发环境和异常场景的降级路径。
 */

export interface PlainTextClipboardRuntime {
  copyText?: (text: string) => Promise<void>
  writeText?: (text: string) => Promise<void>
  legacyCopy?: (text: string) => boolean
}

function legacyCopyText(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '-9999px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  textarea.setSelectionRange(0, text.length)

  try {
    return document.execCommand('copy')
  } finally {
    document.body.removeChild(textarea)
  }
}

function getDefaultRuntime(): PlainTextClipboardRuntime {
  return {
    copyText: typeof window !== 'undefined'
      ? window.electronAPI?.copyText
      : undefined,
    writeText: typeof navigator !== 'undefined'
      ? navigator.clipboard?.writeText.bind(navigator.clipboard)
      : undefined,
    legacyCopy: legacyCopyText,
  }
}

/**
 * 将纯文本写入系统剪贴板。
 *
 * 每一级失败后继续尝试下一级，全部失败时抛错，调用方必须给用户明确反馈。
 */
export async function copyPlainText(
  text: string,
  runtime: PlainTextClipboardRuntime = getDefaultRuntime(),
): Promise<void> {
  const errors: unknown[] = []

  if (runtime.copyText) {
    try {
      await runtime.copyText(text)
      return
    } catch (error) {
      errors.push(error)
    }
  }

  if (runtime.writeText) {
    try {
      await runtime.writeText(text)
      return
    } catch (error) {
      errors.push(error)
    }
  }

  try {
    if (runtime.legacyCopy?.(text)) return
  } catch (error) {
    errors.push(error)
  }

  throw new AggregateError(errors, '无法写入系统剪贴板')
}
