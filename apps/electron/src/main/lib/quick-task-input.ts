import type { QuickTaskSubmitInput } from '@kila/shared'

export function buildQuickTaskTitle(prompt: string, maxLength = 36): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
}

export function normalizeQuickTaskInput(input: QuickTaskSubmitInput): QuickTaskSubmitInput {
  const prompt = input.prompt.trim()
  if (!prompt) throw new Error('请输入任务内容')
  if (prompt.length > 50_000) throw new Error('任务内容过长，请缩短后重试')
  return {
    prompt,
    projectPath: input.projectPath?.trim() || undefined,
    attachments: input.attachments?.slice(0, 20),
  }
}
