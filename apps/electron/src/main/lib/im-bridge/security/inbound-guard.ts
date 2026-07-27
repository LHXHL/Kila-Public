/**
 * 入站消息统一准入闸门
 *
 * 把原先散落在 `bridge-manager.handleInboundMessage` 里的三段检查收敛成纯函数 + 单一入口：
 * 1. 发送者身份白名单（默认拒绝）
 * 2. 出站专用绑定（Session 镜像群）不允许反向入站
 * 3. 频率限制
 * 4. 附件大小上限（四渠道统一，不再有 MAX_SAFE_INTEGER 缺口）
 */

import type { BridgeBinding, BridgeChannelType, BridgeConfig } from '@kila/shared'
import type { BridgeInboundMessage } from '../adapters/base-adapter'
import { isSenderAllowed } from './sender-allowlist'
import type { SenderAllowlistDenyReason } from './sender-allowlist'

export type InboundRejectReason =
  | SenderAllowlistDenyReason
  | 'outbound_only_binding'
  | 'rate_limited'
  | 'oversized_attachment'

export interface InboundGuardRejection {
  allowed: false
  reason: InboundRejectReason
  /** 回给远端用户的提示文案 */
  message: string
}

export type InboundGuardResult = { allowed: true } | InboundGuardRejection

export interface RateLimiterLike {
  allow: (key: string) => boolean
}

export interface EvaluateInboundGuardInput {
  message: BridgeInboundMessage
  config: BridgeConfig
  /** 已存在的绑定（若有），用于识别出站专用镜像群 */
  existingBinding?: BridgeBinding
  rateLimiter?: RateLimiterLike
}

/** 四渠道统一的入站附件上限 */
export function resolveMaxInboundFileBytes(
  channelType: BridgeChannelType,
  config: BridgeConfig,
): number {
  switch (channelType) {
    case 'telegram':
      return config.telegram.maxInboundFileBytes
    case 'discord':
      return config.discord.maxInboundFileBytes
    case 'feishu':
      return config.feishu.maxInboundFileBytes
    case 'wechat':
      return config.wechat.maxInboundFileBytes
  }
}

export function evaluateInboundGuard(input: EvaluateInboundGuardInput): InboundGuardResult {
  const { message, config } = input

  // 频率限制放最前：未授权发送者也会被限流，避免拒绝提示被放大成回复风暴
  if (input.rateLimiter && !input.rateLimiter.allow(message.endpointKey)) {
    return {
      allowed: false,
      reason: 'rate_limited',
      message: '消息过于频繁，请稍后重试。',
    }
  }

  const senderDecision = isSenderAllowed(message.channelType, config, message)
  if (!senderDecision.allowed) {
    return {
      allowed: false,
      reason: senderDecision.reason ?? 'sender_not_allowed',
      message: senderDecision.message ?? '未授权的发送者。',
    }
  }

  if (input.existingBinding?.outboundOnly) {
    return {
      allowed: false,
      reason: 'outbound_only_binding',
      message: '该会话仅用于接收 Kila 桌面端的同步内容，不接受远程指令。',
    }
  }

  const maxInboundFileBytes = resolveMaxInboundFileBytes(message.channelType, config)
  const oversized = message.attachments.find((attachment) => attachment.size > maxInboundFileBytes)
  if (oversized) {
    return {
      allowed: false,
      reason: 'oversized_attachment',
      message: `附件过大，已拒绝接收：${oversized.filename}`,
    }
  }

  return { allowed: true }
}
