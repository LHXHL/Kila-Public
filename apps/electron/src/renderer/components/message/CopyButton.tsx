/**
 * CopyButton - 复制消息内容按钮
 *
 * 使用 MessageAction + Copy/Check 图标切换。
 * 移植自 kila-frontend 的 chat-view/copy-button.tsx。
 */

import { useState, useCallback } from 'react'
import { CopyIcon, CheckIcon } from 'lucide-react'
import { MessageAction } from '@/components/ai-elements/message'

interface CopyButtonProps {
  /** 要复制的内容 */
  content: string
}

export function CopyButton({ content }: CopyButtonProps): React.ReactElement {
  const [copied, setCopied] = useState(false)

  const fallbackCopy = useCallback((text: string): boolean => {
    if (typeof document === 'undefined') return false

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
  }, [])

  const handleCopy = useCallback(async () => {
    try {
      // Native-feel: 同时写入纯文本 + HTML 到剪贴板
      if (window.electronAPI?.copyRichText) {
        // 将 markdown 内容包裹为 HTML（保留换行）
        const html = `<pre style="font-family: inherit; white-space: pre-wrap;">${content
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')}</pre>`
        await window.electronAPI.copyRichText(content, html)
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content)
      } else if (!fallbackCopy(content)) {
        throw new Error('Clipboard API unavailable')
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      if (fallbackCopy(content)) {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
        return
      }
      console.error('复制失败:', error)
    }
  }, [content, fallbackCopy])

  return (
    <MessageAction
      tooltip={copied ? '已复制' : '复制'}
      onClick={handleCopy}
    >
      {copied ? (
        <CheckIcon className="size-4" />
      ) : (
        <CopyIcon className="size-4" />
      )}
    </MessageAction>
  )
}
