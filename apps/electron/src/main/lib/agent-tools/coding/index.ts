import type { CodingTool } from '@kila/shared'
import { createBashTool } from './bash-tool'
import { createCodingPathPolicy } from './path-policy'
import { createEditTool } from './edit-tool'
import { createReadTool } from './read-tool'
import { createWriteTool } from './write-tool'

export function createKilaCodingTools(options: {
  sessionId: string
  cwd: string
  allowedRoots?: string[]
}): CodingTool[] {
  const policy = createCodingPathPolicy(options)
  return [
    createReadTool(policy),
    createWriteTool(policy),
    createEditTool(policy),
    createBashTool(policy),
  ]
}
