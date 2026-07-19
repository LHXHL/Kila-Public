import type { BridgeChannelType } from '@kila/shared'

export interface OutboundChunk {
  text: string
  parseMode?: 'HTML'
}

export interface TelegramRenderedMessage {
  primary: OutboundChunk
  fallback: OutboundChunk
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```(\w+)?\n?/g, '').replace(/```/g, ''))
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
}

export function renderTelegramOutbound(text: string): TelegramRenderedMessage {
  const html = escapeHtml(text)
    .replace(/```(\w+)?\n([\s\S]*?)```/g, (_match, _lang, code) => `<pre><code>${escapeHtml(String(code).trim())}</code></pre>`)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`(.+?)`/g, '<code>$1</code>')

  return {
    primary: {
      text: html,
      parseMode: 'HTML',
    },
    fallback: {
      text: stripMarkdown(text),
    },
  }
}

function chunkText(text: string, limit: number): string[] {
  const chunks: string[] = []
  let remaining = text

  while (remaining.length > limit) {
    let splitIndex = remaining.lastIndexOf('\n\n', limit)
    if (splitIndex < Math.floor(limit * 0.5)) {
      splitIndex = remaining.lastIndexOf('\n', limit)
    }
    if (splitIndex < Math.floor(limit * 0.5)) {
      splitIndex = limit
    }

    const chunk = remaining.slice(0, splitIndex).trim()
    chunks.push(chunk || remaining.slice(0, limit))
    remaining = remaining.slice(splitIndex).trimStart()
  }

  if (remaining.trim()) {
    chunks.push(remaining.trim())
  }

  return chunks
}

export function chunkOutboundMessage(input: {
  channelType: BridgeChannelType
  text: string
}): OutboundChunk[] {
  if (input.channelType === 'telegram') {
    const rendered = renderTelegramOutbound(input.text)
    return chunkText(rendered.primary.text, 3500).map((text) => ({
      text,
      parseMode: 'HTML' as const,
    }))
  }

  if (input.channelType === 'feishu') {
    return [{ text: input.text }]
  }

  if (input.channelType === 'wechat') {
    return chunkText(input.text, 4000).map((text) => ({ text }))
  }

  return chunkText(input.text, 2000).map((text) => ({ text }))
}
