const MENTION_TOKEN_RE = /@file:(\S+)|\/skill:(\S+)|#mcp:(\S+)/g

function basename(input: string): string {
  const segments = input.split(/[\\/]/)
  return segments[segments.length - 1] || input
}

function toVisibleMentionText(match: string, filePath?: string, skillName?: string, mcpName?: string): string {
  if (filePath) return basename(filePath)
  if (skillName) return skillName
  if (mcpName) return mcpName
  return match
}

export function normalizeMeasurementText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(MENTION_TOKEN_RE, toVisibleMentionText)
    .replace(/\u00a0/g, ' ')
}
