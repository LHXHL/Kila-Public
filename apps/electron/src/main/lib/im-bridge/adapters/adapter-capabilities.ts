/**
 * 各渠道 adapter 的能力声明
 *
 * `approvalMode` 是权限闸门的关键输入：
 * - interactive → 支持按钮审批（Telegram / Discord）
 * - text_code   → 支持审批码文本审批（微信）
 * - desktop_only→ 无远程审批 UI，权限请求一律**默认拒绝**（飞书）
 */

import type { BridgeAdapterCapabilities } from '@kila/shared'

export const TELEGRAM_CAPABILITIES: BridgeAdapterCapabilities = {
  approvalMode: 'interactive',
  supportsTyping: false,
  supportsDeferredOutbound: false,
  supportsMediaUpload: false,
  outboundTextLimit: 4096,
}

export const DISCORD_CAPABILITIES: BridgeAdapterCapabilities = {
  approvalMode: 'interactive',
  supportsTyping: false,
  supportsDeferredOutbound: false,
  supportsMediaUpload: false,
  outboundTextLimit: 2000,
}

export const FEISHU_CAPABILITIES: BridgeAdapterCapabilities = {
  approvalMode: 'desktop_only',
  supportsTyping: false,
  supportsDeferredOutbound: false,
  supportsMediaUpload: true,
  outboundTextLimit: 4000,
}

/** 飞书无法远程审批时回给远端的说明文案 */
export const FEISHU_PERMISSION_DENIED_HINT =
  '飞书暂不支持远程审批，该请求已按默认拒绝处理，请在 Kila 桌面端继续。'
