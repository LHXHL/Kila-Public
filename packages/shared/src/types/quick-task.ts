import type { FileDialogResult } from './attachment'

/** 快速任务提交输入。附件沿用文件选择器的 base64 载荷，由主进程原子落盘。 */
export interface QuickTaskSubmitInput {
  prompt: string
  projectPath?: string
  attachments?: FileDialogResult['files']
}

export interface QuickTaskSubmitResult {
  sessionId: string
}
