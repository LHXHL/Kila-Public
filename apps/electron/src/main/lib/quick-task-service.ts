import type {
  FileAttachment,
  QuickTaskSubmitInput,
  QuickTaskSubmitResult,
  SessionMeta,
  SessionSendInput,
} from '@kila/shared'
import { buildQuickTaskTitle } from './quick-task-input'

export interface QuickTaskSettings {
  agentChannelId?: string
  agentModelId?: string
}

export interface QuickTaskSubmitDeps<TMainTarget> {
  getSettings: () => QuickTaskSettings
  getMainTarget: () => TMainTarget | null
  createSession: (input: {
    title: string
    projectPath?: string
    channelId: string
    modelId?: string
  }) => SessionMeta
  saveAttachment: (input: {
    conversationId: string
    filename: string
    mediaType: string
    data: string
  }) => { attachment: FileAttachment }
  deleteSession: (sessionId: string) => void
  deleteSessionAttachments: (sessionId: string) => void
  watchSessionProject: (sessionId: string, projectPath: string) => void
  unwatchSessionProject: (sessionId: string) => void
  openSession: (input: { sessionId: string; title: string }) => void
  hideWindow: () => void
  sendMessage: (input: SessionSendInput, target: TMainTarget) => Promise<void>
  onBackgroundError?: (error: unknown, sessionId: string) => void
}

/**
 * 原子提交快速任务。
 *
 * 在创建 Session 前先验证主窗口；附件落盘、文件监听和打开主窗口任一步失败时，
 * 都回滚本次创建的 Session 与附件，避免产生不可见的孤儿数据。
 */
export function submitQuickTask<TMainTarget>(
  input: QuickTaskSubmitInput,
  deps: QuickTaskSubmitDeps<TMainTarget>,
): QuickTaskSubmitResult {
  const settings = deps.getSettings()
  if (!settings.agentChannelId) throw new Error('请先在设置中选择默认 Agent 渠道')

  const mainTarget = deps.getMainTarget()
  if (!mainTarget) throw new Error('主窗口尚未就绪，请稍后重试')

  let session: SessionMeta | null = null
  let watching = false
  try {
    session = deps.createSession({
      title: buildQuickTaskTitle(input.prompt),
      projectPath: input.projectPath,
      channelId: settings.agentChannelId,
      modelId: settings.agentModelId,
    })

    const attachments = input.attachments?.map((file) => deps.saveAttachment({
      conversationId: session!.id,
      filename: file.filename,
      mediaType: file.mediaType,
      data: file.data,
    }).attachment)

    deps.watchSessionProject(session.id, session.project.path)
    watching = true
    deps.openSession({ sessionId: session.id, title: session.title })
    deps.hideWindow()

    const sendInput: SessionSendInput = {
      sessionId: session.id,
      userMessage: input.prompt,
      attachments,
      channelId: settings.agentChannelId,
      modelId: settings.agentModelId,
      messageSource: 'manual',
    }
    void deps.sendMessage(sendInput, mainTarget).catch((error) => {
      deps.onBackgroundError?.(error, session!.id)
    })

    return { sessionId: session.id }
  } catch (error) {
    if (session) {
      if (watching) deps.unwatchSessionProject(session.id)
      // 两项清理都应尽力执行，不能因首个清理异常跳过另一个。
      try {
        deps.deleteSessionAttachments(session.id)
      } finally {
        deps.deleteSession(session.id)
      }
    }
    throw error
  }
}
