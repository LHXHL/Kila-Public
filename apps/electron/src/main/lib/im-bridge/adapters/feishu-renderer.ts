function truncateForFeishu(text: string, maxLength = 25_000): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}\n\n... [内容过长，请在 Kila 中查看完整回复]`
}

export function splitLongContent(text: string, maxLength = 25_000): string[] {
  if (text.length <= maxLength) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining)
      break
    }

    let splitIndex = remaining.lastIndexOf('\n\n', maxLength)
    if (splitIndex < maxLength * 0.5) {
      splitIndex = remaining.lastIndexOf('\n', maxLength)
    }
    if (splitIndex < maxLength * 0.5) {
      splitIndex = maxLength
    }

    chunks.push(remaining.slice(0, splitIndex))
    remaining = remaining.slice(splitIndex).trimStart()
  }

  return chunks
}

export function buildAgentReplyCard(text: string, subtitle?: string): Record<string, unknown> {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: 'Kila Agent' },
      ...(subtitle ? { subtitle: { tag: 'plain_text', content: subtitle } } : {}),
      template: 'blue',
    },
    elements: [
      { tag: 'markdown', content: truncateForFeishu(text) },
    ],
  }
}

export function buildErrorCard(errorMessage: string): Record<string, unknown> {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: 'Kila 提示' },
      template: 'red',
    },
    elements: [
      { tag: 'markdown', content: truncateForFeishu(errorMessage) },
    ],
  }
}
