const FRIENDLY_ERROR_MESSAGES: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /not logged in|please run \/login/i,
    message: '请检查是否选择了正确的 Kila 供应渠道和模型',
  },
]

const PROMPT_TOO_LONG_PATTERNS = [
  'prompt is too long',
  'prompt_too_long',
  'input is too long',
  'context_length_exceeded',
  'maximum context length',
  'token limit',
  'exceeds the model',
  'request too large',
] as const

export function friendlyErrorMessage(raw: string): string {
  for (const { pattern, message } of FRIENDLY_ERROR_MESSAGES) {
    if (pattern.test(raw)) return message
  }
  return raw
}

export function isPromptTooLongError(...messages: string[]): boolean {
  const combined = messages.join(' ').toLowerCase()
  return PROMPT_TOO_LONG_PATTERNS.some((pattern) => combined.includes(pattern))
}
