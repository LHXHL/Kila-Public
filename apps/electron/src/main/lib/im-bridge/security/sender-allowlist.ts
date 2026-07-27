/**
 * 四渠道统一发送者身份校验
 *
 * 设计原则：
 * - **唯一真相源**：`BridgeManager.handleInboundMessage` 在进入 Agent 之前统一调用；
 *   各 adapter 内的同类过滤只作为纵深防御，漏写不再等于失守。
 * - **默认拒绝**：白名单为空表示“拒绝全部”，而不是历史上的“放行全部”。
 *   只填 botToken 就启用桥接时，任何陌生人都能驱动 Agent 是不可接受的。
 * - **无副作用**：纯函数，便于 BDD 测试覆盖每个渠道的边界。
 */

import type { BridgeChannelType, BridgeConfig } from '@kila/shared'

/** 入站消息中与身份相关的最小切片（`BridgeInboundMessage` 结构上兼容） */
export interface BridgeSenderIdentity {
  userId?: string
  chatId?: string
}

export interface SenderAllowlistDecision {
  allowed: boolean
  /** 审计日志用的机器可读原因 */
  reason?: SenderAllowlistDenyReason
  /** 回给远端用户的提示文案 */
  message?: string
}

export type SenderAllowlistDenyReason =
  | 'missing_sender_id'
  | 'empty_allowlist'
  | 'sender_not_allowed'
  | 'chat_not_allowed'

/** 身份不明（飞书解析失败时会退化成 'unknown'） */
const UNKNOWN_SENDER_IDS = new Set(['', 'unknown', 'undefined', 'null'])

const ALLOWED_MESSAGE = '未授权的发送者：请让 Kila 桌面端的持有者把你的用户 ID 加入该渠道白名单后再试。'
const EMPTY_ALLOWLIST_MESSAGE = '该远程渠道尚未配置任何允许的用户 ID，已按默认拒绝处理。请在 Kila 设置中填写白名单。'
const CHAT_NOT_ALLOWED_MESSAGE = '当前会话不在该渠道的允许列表内，已拒绝处理。'

function deny(reason: SenderAllowlistDenyReason, message: string): SenderAllowlistDecision {
  return { allowed: false, reason, message }
}

function normalizeId(value: string | undefined): string {
  return (value ?? '').trim()
}

function hasUsableSenderId(userId: string): boolean {
  return Boolean(userId) && !UNKNOWN_SENDER_IDS.has(userId.toLowerCase())
}

/** 白名单硬闸门：空 = 拒绝全部；命中才放行 */
function checkRequiredAllowlist(allowlist: string[], userId: string): SenderAllowlistDecision {
  if (!hasUsableSenderId(userId)) {
    return deny('missing_sender_id', ALLOWED_MESSAGE)
  }
  if (allowlist.length === 0) {
    return deny('empty_allowlist', EMPTY_ALLOWLIST_MESSAGE)
  }
  if (!allowlist.includes(userId)) {
    return deny('sender_not_allowed', ALLOWED_MESSAGE)
  }
  return { allowed: true }
}

/** 可选范围收窄：为空表示不额外限制 */
function checkOptionalScope(scope: string[], chatId: string): SenderAllowlistDecision {
  if (scope.length === 0) return { allowed: true }
  if (!chatId || !scope.includes(chatId)) {
    return deny('chat_not_allowed', CHAT_NOT_ALLOWED_MESSAGE)
  }
  return { allowed: true }
}

/**
 * 判断某条入站消息的发送者是否被授权驱动 Agent。
 *
 * 语义约定：
 * - telegram / discord / wechat → `allowedUserIds` 为硬闸门
 * - feishu → `allowedOpenIds` 为硬闸门，`allowedChatIds` 为可选范围收窄
 */
export function isSenderAllowed(
  channelType: BridgeChannelType,
  config: BridgeConfig,
  message: BridgeSenderIdentity,
): SenderAllowlistDecision {
  const userId = normalizeId(message.userId)
  const chatId = normalizeId(message.chatId)

  switch (channelType) {
    case 'telegram':
      return checkRequiredAllowlist(config.telegram.allowedUserIds, userId)

    case 'discord':
      return checkRequiredAllowlist(config.discord.allowedUserIds, userId)

    case 'wechat':
      return checkRequiredAllowlist(config.wechat.allowedUserIds, userId)

    case 'feishu': {
      const senderResult = checkRequiredAllowlist(config.feishu.allowedOpenIds ?? [], userId)
      if (!senderResult.allowed) return senderResult
      return checkOptionalScope(config.feishu.allowedChatIds ?? [], chatId)
    }
  }
}

/** 该渠道当前是否已具备可用的入站白名单（供设置页与启动自检提示） */
export function hasConfiguredSenderAllowlist(
  channelType: BridgeChannelType,
  config: BridgeConfig,
): boolean {
  switch (channelType) {
    case 'telegram':
      return config.telegram.allowedUserIds.length > 0
    case 'discord':
      return config.discord.allowedUserIds.length > 0
    case 'wechat':
      return config.wechat.allowedUserIds.length > 0
    case 'feishu':
      return (config.feishu.allowedOpenIds ?? []).length > 0
  }
}
