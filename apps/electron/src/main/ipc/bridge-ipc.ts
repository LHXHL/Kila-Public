/**
 * IM Bridge IPC 处理器
 */

import { FEISHU_BRIDGE_IPC_CHANNELS, IM_BRIDGE_IPC_CHANNELS, WECHAT_BRIDGE_IPC_CHANNELS } from '@kila/shared'
import type {
  BridgeBinding,
  BridgeBindingUpdateInput,
  BridgeChannelType,
  BridgeConfig,
  BridgeConfigInput,
  BridgeStatus,
  BridgeTestResult,
  FeishuBotBridgeStatus,
  FeishuBotConfig,
  FeishuBotConfigInput,
  FeishuMultiBridgeStatus,
  FeishuRegisterAppQRCode,
  FeishuRegisterAppResult,
  FeishuRegisterAppStatus,
  WeChatBridgeAccountEntry,
  WeChatBridgeAccountStatus,
  WeChatBridgeLoginState,
  WeChatBridgeStartLoginInput,
} from '@kila/shared'
import { handle } from './shared'
import { bridgeManager } from '../lib/im-bridge/bridge-manager'
import {
  assertString,
  validateBridgeBindingUpdateInput,
  validateBridgeChannel,
  validateBridgeConfigInput,
  validateFeishuBotConfigInput,
  validateWeChatStartLoginInput,
} from './validation'

let activeRegisterAbort: AbortController | null = null

export function registerBridgeHandlers(): void {
  handle(
    IM_BRIDGE_IPC_CHANNELS.GET_CONFIG,
    async (): Promise<BridgeConfig> => {
      return bridgeManager.getConfig()
    }
  )

  handle(
    IM_BRIDGE_IPC_CHANNELS.SAVE_CONFIG,
    async (_, input: BridgeConfigInput): Promise<BridgeConfig> => {
      return bridgeManager.saveConfig(validateBridgeConfigInput(input))
    }
  )

  handle(
    IM_BRIDGE_IPC_CHANNELS.GET_SECRET,
    async (_, channel: BridgeChannelType): Promise<string> => {
      return bridgeManager.getSecret(validateBridgeChannel(channel))
    }
  )

  handle(
    IM_BRIDGE_IPC_CHANNELS.TEST_CHANNEL,
    async (_, channel: BridgeChannelType, input?: BridgeConfigInput): Promise<BridgeTestResult> => {
      return bridgeManager.testChannel(
        validateBridgeChannel(channel),
        input === undefined ? undefined : validateBridgeConfigInput(input),
      )
    }
  )

  handle(
    IM_BRIDGE_IPC_CHANNELS.START,
    async (): Promise<void> => {
      await bridgeManager.start()
    }
  )

  handle(
    IM_BRIDGE_IPC_CHANNELS.STOP,
    async (): Promise<void> => {
      bridgeManager.stop()
    }
  )

  handle(
    IM_BRIDGE_IPC_CHANNELS.RESTART,
    async (): Promise<void> => {
      await bridgeManager.restart()
    }
  )

  handle(
    IM_BRIDGE_IPC_CHANNELS.GET_STATUS,
    async (): Promise<BridgeStatus> => {
      return bridgeManager.getStatus()
    }
  )

  handle(
    IM_BRIDGE_IPC_CHANNELS.LIST_BINDINGS,
    async (): Promise<BridgeBinding[]> => {
      return bridgeManager.listBindings()
    }
  )

  handle(
    IM_BRIDGE_IPC_CHANNELS.UPDATE_BINDING,
    async (_, input: BridgeBindingUpdateInput): Promise<BridgeBinding | null> => {
      return bridgeManager.updateBinding(validateBridgeBindingUpdateInput(input))
    }
  )

  handle(
    IM_BRIDGE_IPC_CHANNELS.UPDATE_BINDING_PROJECT_PATH,
    async (_, endpointKey: string, projectPath: string): Promise<{ binding: BridgeBinding; sessionReplaced: boolean }> => {
      return bridgeManager.updateBindingProjectPath(
        assertString(endpointKey, 'endpointKey', { nonEmpty: true, max: 512 }),
        assertString(projectPath, 'projectPath', { nonEmpty: true, max: 2048 }),
      )
    }
  )

  handle(
    IM_BRIDGE_IPC_CHANNELS.REMOVE_BINDING,
    async (_, endpointKey: string): Promise<boolean> => {
      return bridgeManager.removeBinding(assertString(endpointKey, 'endpointKey', { nonEmpty: true, max: 512 }))
    }
  )

  handle(
    FEISHU_BRIDGE_IPC_CHANNELS.GET_BOTS,
    async (): Promise<FeishuBotConfig[]> => bridgeManager.listFeishuBots()
  )

  handle(
    FEISHU_BRIDGE_IPC_CHANNELS.SAVE_BOT,
    async (_, input: FeishuBotConfigInput): Promise<FeishuBotConfig> => {
      return bridgeManager.saveFeishuBot(validateFeishuBotConfigInput(input))
    }
  )

  handle(
    FEISHU_BRIDGE_IPC_CHANNELS.REMOVE_BOT,
    async (_, botId: string): Promise<boolean> => {
      return bridgeManager.removeFeishuBot(assertString(botId, 'botId', { nonEmpty: true, max: 128 }))
    }
  )

  handle(
    FEISHU_BRIDGE_IPC_CHANNELS.GET_BOT_SECRET,
    async (_, botId: string): Promise<string> => {
      return bridgeManager.getFeishuBotSecret(assertString(botId, 'botId', { nonEmpty: true, max: 128 }))
    }
  )

  handle(
    FEISHU_BRIDGE_IPC_CHANNELS.TEST_BOT,
    async (_, botId: string): Promise<BridgeTestResult> => {
      return bridgeManager.testFeishuBot(assertString(botId, 'botId', { nonEmpty: true, max: 128 }))
    }
  )

  handle(
    FEISHU_BRIDGE_IPC_CHANNELS.START_BOT,
    async (_, botId: string): Promise<void> => {
      await bridgeManager.startFeishuBot(assertString(botId, 'botId', { nonEmpty: true, max: 128 }))
    }
  )

  handle(
    FEISHU_BRIDGE_IPC_CHANNELS.STOP_BOT,
    async (_, botId: string): Promise<void> => {
      bridgeManager.stopFeishuBot(assertString(botId, 'botId', { nonEmpty: true, max: 128 }))
    }
  )

  handle(
    FEISHU_BRIDGE_IPC_CHANNELS.GET_MULTI_STATUS,
    async (): Promise<FeishuMultiBridgeStatus> => bridgeManager.getFeishuMultiStatus()
  )

  handle(
    FEISHU_BRIDGE_IPC_CHANNELS.REGISTER_APP_START,
    async (event): Promise<FeishuRegisterAppResult> => {
      activeRegisterAbort?.abort()
      const abort = new AbortController()
      activeRegisterAbort = abort
      try {
        const lark = require('@larksuiteoapi/node-sdk') as typeof import('@larksuiteoapi/node-sdk')
        const QRCode = (await import('qrcode')).default
        const result = await lark.registerApp({
          source: 'kila',
          signal: abort.signal,
          onQRCodeReady: async (info: { url: string; expireIn: number }) => {
            if (event.sender.isDestroyed()) return
            let dataUrl = ''
            try {
              dataUrl = await QRCode.toDataURL(info.url, { width: 280, margin: 2, errorCorrectionLevel: 'M' })
            } catch {
              dataUrl = ''
            }
            const payload: FeishuRegisterAppQRCode = {
              url: info.url,
              dataUrl,
              expireIn: info.expireIn,
            }
            event.sender.send(FEISHU_BRIDGE_IPC_CHANNELS.REGISTER_APP_QRCODE, payload)
          },
          onStatusChange: (info: FeishuRegisterAppStatus) => {
            if (event.sender.isDestroyed()) return
            event.sender.send(FEISHU_BRIDGE_IPC_CHANNELS.REGISTER_APP_STATUS, {
              status: info.status,
              interval: info.interval,
            } satisfies FeishuRegisterAppStatus)
          },
        })
        return {
          appId: result.client_id,
          appSecret: result.client_secret,
          tenantBrand: result.user_info?.tenant_brand,
          operatorOpenId: result.user_info?.open_id,
        }
      } finally {
        if (activeRegisterAbort === abort) activeRegisterAbort = null
      }
    }
  )

  handle(
    FEISHU_BRIDGE_IPC_CHANNELS.REGISTER_APP_CANCEL,
    async (): Promise<void> => {
      activeRegisterAbort?.abort()
      activeRegisterAbort = null
    }
  )

  handle(
    WECHAT_BRIDGE_IPC_CHANNELS.LIST_ACCOUNTS,
    async (): Promise<WeChatBridgeAccountEntry[]> => {
      return bridgeManager.listWeChatAccounts()
    }
  )

  handle(
    WECHAT_BRIDGE_IPC_CHANNELS.START_LOGIN,
    async (_, input?: WeChatBridgeStartLoginInput): Promise<WeChatBridgeLoginState> => {
      return bridgeManager.startWeChatLogin(validateWeChatStartLoginInput(input))
    }
  )

  handle(
    WECHAT_BRIDGE_IPC_CHANNELS.REFRESH_LOGIN,
    async (_, accountId: string): Promise<WeChatBridgeLoginState> => {
      return bridgeManager.refreshWeChatLogin(assertString(accountId, 'accountId', { nonEmpty: true, max: 128 }))
    }
  )

  handle(
    WECHAT_BRIDGE_IPC_CHANNELS.CANCEL_LOGIN,
    async (_, accountId: string): Promise<void> => {
      bridgeManager.cancelWeChatLogin(assertString(accountId, 'accountId', { nonEmpty: true, max: 128 }))
    }
  )

  handle(
    WECHAT_BRIDGE_IPC_CHANNELS.REMOVE_ACCOUNT,
    async (_, accountId: string): Promise<void> => {
      bridgeManager.removeWeChatAccount(assertString(accountId, 'accountId', { nonEmpty: true, max: 128 }))
    }
  )

  handle(
    WECHAT_BRIDGE_IPC_CHANNELS.START_ACCOUNT,
    async (_, accountId: string): Promise<WeChatBridgeAccountStatus> => {
      return bridgeManager.startWeChatAccount(assertString(accountId, 'accountId', { nonEmpty: true, max: 128 }))
    }
  )

  handle(
    WECHAT_BRIDGE_IPC_CHANNELS.STOP_ACCOUNT,
    async (_, accountId: string): Promise<WeChatBridgeAccountStatus> => {
      return bridgeManager.stopWeChatAccount(assertString(accountId, 'accountId', { nonEmpty: true, max: 128 }))
    }
  )

  handle(
    WECHAT_BRIDGE_IPC_CHANNELS.RELOGIN_ACCOUNT,
    async (_, accountId: string): Promise<WeChatBridgeLoginState> => {
      return bridgeManager.reloginWeChatAccount(assertString(accountId, 'accountId', { nonEmpty: true, max: 128 }))
    }
  )

  handle(
    WECHAT_BRIDGE_IPC_CHANNELS.GET_LOGIN_STATE,
    async (_, accountId: string): Promise<WeChatBridgeLoginState | null> => {
      return bridgeManager.getWeChatLoginState(assertString(accountId, 'accountId', { nonEmpty: true, max: 128 }))
    }
  )
}
