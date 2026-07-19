import type { AgentPendingFile } from '@kila/shared'

export interface PendingFilePayload {
  filename: string
  data: string
}

export interface PendingFilePreparationResult {
  files: PendingFilePayload[]
  missingFileNames: string[]
}

/**
 * 为附件保存事务准备 payload。缺少原始数据时显式返回文件名，禁止用空字符串静默降级。
 */
export function preparePendingFilePayloads(
  pendingFiles: AgentPendingFile[],
  pendingData: Map<string, string> | undefined,
): PendingFilePreparationResult {
  const files: PendingFilePayload[] = []
  const missingFileNames: string[] = []

  for (const file of pendingFiles) {
    const data = pendingData?.get(file.id)
    if (!data) {
      missingFileNames.push(file.filename)
      continue
    }
    files.push({ filename: file.filename, data })
  }

  return { files, missingFileNames }
}

/**
 * 发送失败时恢复原草稿，同时保留用户在请求期间新输入的内容。
 */
export function mergeRecoveredComposerDraft(failedDraft: string, currentDraft: string): string {
  const failed = failedDraft.trim()
  const current = currentDraft.trim()

  if (!failed) return currentDraft
  if (!current || current === failed) return failedDraft
  return `${failedDraft}\n\n${currentDraft}`
}
