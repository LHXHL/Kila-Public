/**
 * 复制消息内容组件
 *
 * - CopyButton：主复制按钮，复制 Markdown（markdown 原文 + <pre> 富文本壳）
 * - CopyMenuButton：三点菜单，放在操作栏最右，提供「复制 Markdown / 复制纯文本」
 *
 * trigger 直接用 Button（forwardRef），不套 Tooltip，避免与 Radix DropdownMenu
 * 的 ref / pointer 事件冲突导致点击无响应或卡死。
 */

import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyIcon, CheckIcon, MoreHorizontal } from 'lucide-react'
import { MessageAction } from '@/components/ai-elements/message'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { markdownToPlainText } from '@/lib/markdown-to-plain-text'

// HTML 特殊字符转义（拼接构造实体，避免字面实体被工具链误处理）
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&' + 'amp;')
    .replace(/</g, '&' + 'lt;')
    .replace(/>/g, '&' + 'gt;')
}

// 兜底复制（无 Clipboard API 时）
function fallbackCopy(text: string): boolean {
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
}

// 复制 Markdown：markdown 原文 + <pre> 富文本壳（富文本行为）
async function writeMarkdown(content: string): Promise<boolean> {
  try {
    if (window.electronAPI?.copyRichText) {
      const html = `<pre style="font-family: inherit; white-space: pre-wrap;">${escapeHtml(content)}</pre>`
      await window.electronAPI.copyRichText(content, html)
      return true
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(content)
      return true
    }
    return fallbackCopy(content)
  } catch {
    return fallbackCopy(content)
  }
}

// 复制纯文本：markdown 渲染成无语法符号的可读纯文本，只写 text
async function writePlainText(content: string): Promise<boolean> {
  const plain = markdownToPlainText(content)
  try {
    if (window.electronAPI?.copyText) {
      await window.electronAPI.copyText(plain)
      return true
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(plain)
      return true
    }
    return fallbackCopy(plain)
  } catch {
    return fallbackCopy(plain)
  }
}

interface CopyButtonProps {
  /** 要复制的内容（markdown 纯文本） */
  content: string
}

/** 复制按钮：默认复制 Markdown（富文本） */
export function CopyButton({ content }: CopyButtonProps): React.ReactElement {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    if (await writeMarkdown(content)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } else {
      console.error('复制失败: Clipboard API unavailable')
    }
  }, [content])

  return (
    <MessageAction tooltip={copied ? t('common.copied') : t('common.copy')} onClick={handleCopy}>
      {copied ? (
        <CheckIcon className="size-4" />
      ) : (
        <CopyIcon className="size-4" />
      )}
    </MessageAction>
  )
}

interface CopyMenuButtonProps {
  /** 要复制的内容（markdown 纯文本） */
  content: string
}

/** 三点复制菜单：复制 Markdown / 复制纯文本，放在操作栏最右 */
export function CopyMenuButton({ content }: CopyMenuButtonProps): React.ReactElement {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const flash = useCallback(() => {
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [])

  const handleMarkdown = useCallback(async () => {
    if (await writeMarkdown(content)) flash()
    else console.error('复制失败: Clipboard API unavailable')
  }, [content, flash])

  const handlePlainText = useCallback(async () => {
    if (await writePlainText(content)) flash()
    else console.error('复制失败: Clipboard API unavailable')
  }, [content, flash])

  return (
    // modal={false}: 非模态菜单，避免 Radix 与 OverlayScrollbars/消息列表
    // 滚动容器组合时锁住整页 pointer events（点一下无响应甚至卡死）
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="ml-auto titlebar-no-drag"
          aria-label={t('agent.message.moreCopyOptions')}
        >
          {copied ? <CheckIcon className="size-4" /> : <MoreHorizontal className="size-4" />}
        </Button>
      </DropdownMenuTrigger>
      {/* z-[100]: 压过消息卡片的阴影/层叠上下文，否则下拉框被遮住看不见 */}
      <DropdownMenuContent align="end" className="z-[100]">
        <DropdownMenuItem onSelect={handleMarkdown}>
          <CopyIcon className="size-4" />
          {t('agent.message.copyMarkdown')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handlePlainText}>
          <CopyIcon className="size-4" />
          {t('agent.message.copyPlainText')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
