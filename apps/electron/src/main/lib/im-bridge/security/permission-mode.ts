/**
 * 远程渠道权限模式解析
 *
 * 历史缺陷：飞书入站消息被硬编码成 `permissionModeOverride: 'auto'`，
 * 而 `agent-orchestrator-context.ts` 里 auto 会直接跳过唯一的权限闸门，
 * 等于任何能给机器人发消息的人都拿到了远程命令执行能力。
 *
 * 现在的规则：
 * - 默认不注入 override → 走会话/全局默认的 smart 模式（有权限闸门）
 * - 只有当某个飞书机器人显式勾选 `autoApprove`，**且**该渠道白名单非空时，
 *   才允许注入 'auto'；两个条件缺一不可。
 */

import type { BridgeChannelType, BridgeConfig, KilaPermissionMode } from '@kila/shared'
import { hasConfiguredSenderAllowlist } from './sender-allowlist'

export interface ResolveBridgePermissionModeInput {
  channelType: BridgeChannelType
  config: BridgeConfig
  botId?: string
}

export interface BridgePermissionModeDecision {
  /** undefined 表示不覆盖，交由会话默认权限模式处理 */
  mode?: KilaPermissionMode
  /** 审计日志用的判定原因 */
  reason: 'default_gate' | 'auto_approve_bot' | 'auto_approve_requires_allowlist'
}

export function resolveBridgePermissionMode(
  input: ResolveBridgePermissionModeInput,
): BridgePermissionModeDecision {
  if (input.channelType !== 'feishu' || !input.botId) {
    return { reason: 'default_gate' }
  }

  const bot = input.config.feishu.bots?.find((item) => item.id === input.botId)
  if (!bot?.autoApprove) {
    return { reason: 'default_gate' }
  }

  // 自动模式必须配合白名单：否则等于对任意陌生人开放全放行
  if (!hasConfiguredSenderAllowlist('feishu', input.config)) {
    return { reason: 'auto_approve_requires_allowlist' }
  }

  return { mode: 'auto', reason: 'auto_approve_bot' }
}
