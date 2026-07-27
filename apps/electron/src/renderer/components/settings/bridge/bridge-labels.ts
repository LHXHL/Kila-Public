/**
 * 远程渠道展示文案工具
 *
 * 渠道品牌名（Telegram / Discord / 飞书 Lark / 微信 WeChat）与连接状态在多个面板里
 * 重复出现，统一从这里取，避免每个组件各自维护一份映射表。
 */

import type { BridgeChannelType, BridgeConnectionStatus } from '@kila/shared'
import type { TFunction } from 'i18next'

/** 连接状态 → i18n key 片段（BridgeConnectionStatus 是 snake_case） */
const STATUS_KEYS: Record<BridgeConnectionStatus, string> = {
  disconnected: 'disconnected',
  connecting: 'connecting',
  connected: 'connected',
  error: 'error',
  waiting_scan: 'waitingScan',
  scanned: 'scanned',
  token_expired: 'tokenExpired',
}

/** 渠道品牌名（各语言下使用该渠道的官方名称） */
export function getBridgeChannelLabel(t: TFunction, channel: BridgeChannelType): string {
  return t(`settingsBridge.common.channel.${channel}`)
}

/** 连接状态文案 */
export function getBridgeStatusLabel(t: TFunction, status: BridgeConnectionStatus): string {
  return t(`settingsBridge.common.status.${STATUS_KEYS[status]}`)
}
