import type { AgentToolResultImage } from '../types/agent'

export function extractKilaImageAttachments(text: string): {
  cleanedText: string
  images: AgentToolResultImage[]
} {
  const images: AgentToolResultImage[] = []
  const cleanedText = text.replace(
    /\[KILA_IMAGE_ATTACHMENT:(\{[^}]+\})\]/g,
    (_, json: string) => {
      try {
        images.push(JSON.parse(json) as AgentToolResultImage)
      } catch {
        // Ignore malformed marker payloads.
      }
      return ''
    },
  ).trim()

  return {
    cleanedText,
    images,
  }
}
