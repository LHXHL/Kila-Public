import type { CliSessionSummary, SessionMeta } from '@kila/shared'
import { getSessionMessages } from '../session-manager'

export function toCliSessionSummary(session: SessionMeta): CliSessionSummary {
  return {
    id: session.id,
    title: session.title,
    projectPath: session.project.path,
    channelId: session.channelId,
    modelId: session.modelId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: getSessionMessages(session.id).length,
  }
}
