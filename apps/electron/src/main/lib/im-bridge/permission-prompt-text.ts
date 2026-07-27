/**
 * 远程渠道权限提示文案
 *
 * 统一强调：远程渠道只提供「允许一次 / 拒绝」，不提供「总是允许」——
 * 一次误点就会把危险工具永久写进会话白名单。
 */

import type { BridgeChannelType } from '@kila/shared'

export interface PermissionPromptTextInput {
  channelType: BridgeChannelType
  toolName: string
  description: string
  approvalCode?: string
}

export function buildPermissionPromptText(prompt: PermissionPromptTextInput): string {
  if (prompt.channelType === 'wechat') {
    const code = prompt.approvalCode ?? 'CODE'
    return [
      `权限请求：${prompt.toolName}`,
      prompt.description,
      `审批码：${code}`,
      `回复 /allow ${code} 允许一次`,
      `回复 /deny ${code} 拒绝`,
      '远程渠道不支持“总是允许”，如需长期授权请在桌面端处理。',
    ].join('\n')
  }

  return [
    `权限请求：${prompt.toolName}`,
    prompt.description,
    '请选择允许一次 / 拒绝（远程渠道不支持“总是允许”）',
  ].join('\n')
}
