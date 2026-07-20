/**
 * 渠道管理 IPC 处理器
 *
 * 渠道 CRUD、测试、模型拉取
 */

import { CHANNEL_IPC_CHANNELS } from '@kila/shared'
import type {
  Channel,
  ChannelCreateInput,
  ChannelUpdateInput,
  ChannelTestResult,
  ChannelTestInput,
  ProviderDoctorInput,
  FetchModelsInput,
  FetchModelsResult,
} from '@kila/shared'
import { handle } from './shared'
import {
  listChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  decryptApiKey,
  testChannel,
  testChannelDirect,
  fetchModels,
} from '../lib/channel-manager'

export function registerChannelHandlers(): void {
  // 获取所有渠道（apiKey 保持加密态）
  handle(
    CHANNEL_IPC_CHANNELS.LIST,
    async (): Promise<Channel[]> => {
      return listChannels()
    }
  )

  // 创建渠道
  handle(
    CHANNEL_IPC_CHANNELS.CREATE,
    async (_, input: ChannelCreateInput): Promise<Channel> => {
      return createChannel(input)
    }
  )

  // 更新渠道
  handle(
    CHANNEL_IPC_CHANNELS.UPDATE,
    async (_, id: string, input: ChannelUpdateInput): Promise<Channel> => {
      return updateChannel(id, input)
    }
  )

  // 删除渠道
  handle(
    CHANNEL_IPC_CHANNELS.DELETE,
    async (_, id: string): Promise<void> => {
      return deleteChannel(id)
    }
  )

  // 解密 API Key
  handle(
    CHANNEL_IPC_CHANNELS.DECRYPT_KEY,
    async (_, channelId: string): Promise<string> => {
      return decryptApiKey(channelId)
    }
  )

  // 测试渠道连接
  handle(
    CHANNEL_IPC_CHANNELS.TEST,
    async (_, input: ProviderDoctorInput): Promise<ChannelTestResult> => {
      return testChannel(input)
    }
  )

  // 直接测试连接（无需已保存渠道）
  handle(
    CHANNEL_IPC_CHANNELS.TEST_DIRECT,
    async (_, input: ChannelTestInput): Promise<ChannelTestResult> => {
      return testChannelDirect(input)
    }
  )

  // 从供应商拉取可用模型列表
  handle(
    CHANNEL_IPC_CHANNELS.FETCH_MODELS,
    async (_, input: FetchModelsInput): Promise<FetchModelsResult> => {
      return fetchModels(input)
    }
  )
}
