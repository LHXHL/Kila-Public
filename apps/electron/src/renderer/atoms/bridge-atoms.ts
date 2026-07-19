import { atom } from 'jotai'
import type {
  BridgeBinding,
  BridgeStatus,
  WeChatBridgeAccountEntry,
  WeChatBridgeAccountStatus,
  WeChatBridgeLoginState,
} from '@kila/shared'

export const bridgeStatusAtom = atom<BridgeStatus>({
  enabled: false,
  running: false,
  activeBindings: 0,
  channels: {
    telegram: {
      channel: 'telegram',
      enabled: false,
      status: 'disconnected',
    },
    discord: {
      channel: 'discord',
      enabled: false,
      status: 'disconnected',
    },
    feishu: {
      channel: 'feishu',
      enabled: false,
      status: 'disconnected',
    },
    wechat: {
      channel: 'wechat',
      enabled: false,
      status: 'disconnected',
    },
  },
})

export const bridgeBindingsAtom = atom<BridgeBinding[]>([])
export const wechatBridgeAccountsAtom = atom<WeChatBridgeAccountEntry[]>([])
export const wechatBridgeLoginStateAtom = atom<Record<string, WeChatBridgeLoginState>>({})
export const wechatBridgeAccountStatusAtom = atom<Record<string, WeChatBridgeAccountStatus>>({})
