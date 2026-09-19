import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { CodingTool } from '@kila/shared'
import {
  CodingToolError,
  WRITE_MAX_BYTES,
  WRITE_TOOL_PARAMETERS,
  parseWriteInput,
} from './schemas'
import type { CodingPathPolicy } from './path-policy'

export async function writeTextAtomically(targetPath: string, content: string): Promise<number> {
  const parent = dirname(targetPath)
  const temporaryPath = `${targetPath}.kila-${randomUUID()}.tmp`
  const handle = await open(temporaryPath, 'wx', 0o600)
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    await rename(temporaryPath, targetPath)
    return Buffer.byteLength(content, 'utf8')
  } catch (error) {
    try {
      await handle.close()
    } catch {
      // 文件句柄可能已经关闭。
    }
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export function createWriteTool(policy: CodingPathPolicy): CodingTool {
  return {
    name: 'write',
    label: 'Write',
    description: '将完整文本内容原子写入工作区内的文件。',
    parameters: WRITE_TOOL_PARAMETERS,
    permission: 'write',
    execute: async (_toolCallId, rawInput) => {
      const input = parseWriteInput(rawInput)
      const contentBytes = Buffer.byteLength(input.content, 'utf8')
      if (contentBytes > WRITE_MAX_BYTES) {
        throw new CodingToolError('coding_write_too_large', `写入内容超过 ${WRITE_MAX_BYTES} 字节限制`)
      }

      const targetPath = policy.resolveWritePath(input.path)
      await mkdir(dirname(targetPath), { recursive: true })
      const bytesWritten = await writeTextAtomically(targetPath, input.content)
      return {
        text: `已写入 ${targetPath}（${bytesWritten} 字节）`,
        details: { path: targetPath, bytesWritten },
      }
    },
  }
}
