import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { AgentSavedFile } from '@kila/shared'

export function normalizeAgentUploadFilename(filename: string): string {
  const normalized = basename(filename.replace(/\\/g, '/')).trim()
  if (!normalized || normalized === '.' || normalized === '..' || normalized.includes('\0')) {
    throw new Error('附件文件名无效')
  }
  return normalized
}

/**
 * 将一批附件原子化写入指定目录。任一文件失败时删除本批次已经创建的文件。
 */
export function saveAgentFilesToRoot(
  rootDir: string,
  files: Array<{ filename: string; data: string }>,
  onSaved?: (targetPath: string, size: number) => void,
): AgentSavedFile[] {
  const results: AgentSavedFile[] = []
  const usedPaths = new Set<string>()
  const createdPaths: string[] = []

  try {
    for (const file of files) {
      const filename = normalizeAgentUploadFilename(file.filename)
      let targetPath = join(rootDir, filename)

      if (usedPaths.has(targetPath) || existsSync(targetPath)) {
        const dotIndex = filename.lastIndexOf('.')
        const baseName = dotIndex > 0 ? filename.slice(0, dotIndex) : filename
        const extension = dotIndex > 0 ? filename.slice(dotIndex) : ''
        let counter = 1
        let candidate = join(rootDir, `${baseName}-${counter}${extension}`)
        while (usedPaths.has(candidate) || existsSync(candidate)) {
          counter += 1
          candidate = join(rootDir, `${baseName}-${counter}${extension}`)
        }
        targetPath = candidate
      }
      usedPaths.add(targetPath)

      mkdirSync(dirname(targetPath), { recursive: true })
      const buffer = Buffer.from(file.data, 'base64')
      writeFileSync(targetPath, buffer)
      createdPaths.push(targetPath)

      const actualFilename = targetPath.slice(rootDir.length + 1)
      results.push({ filename: actualFilename, targetPath })
      onSaved?.(targetPath, buffer.length)
    }
  } catch (error) {
    for (const targetPath of createdPaths.reverse()) {
      try {
        unlinkSync(targetPath)
      } catch {
        // 尽力回滚；保留原始写入错误作为调用方诊断依据。
      }
    }
    throw error
  }

  return results
}
