export interface TextTruncation {
  truncated: boolean
  nextOffset?: number
  omittedBytes?: number
}

export function truncateUtf8Tail(text: string, maxBytes: number): {
  text: string
  truncation: TextTruncation
} {
  const buffer = Buffer.from(text, 'utf8')
  if (buffer.byteLength <= maxBytes) {
    return { text, truncation: { truncated: false } }
  }

  const sliced = buffer.subarray(buffer.byteLength - maxBytes)
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(sliced)
  return {
    text: decoded,
    truncation: {
      truncated: true,
      omittedBytes: buffer.byteLength - sliced.byteLength,
    },
  }
}

export function truncateUtf8Head(text: string, maxBytes: number): {
  text: string
  truncated: boolean
} {
  const buffer = Buffer.from(text, 'utf8')
  if (buffer.byteLength <= maxBytes) return { text, truncated: false }
  return {
    text: new TextDecoder('utf-8', { fatal: false }).decode(buffer.subarray(0, maxBytes)),
    truncated: true,
  }
}

