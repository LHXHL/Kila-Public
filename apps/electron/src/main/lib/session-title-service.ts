/**
 * Session title service
 *
 * 为 unified session / agent 主链路提供独立的标题生成能力，
 * 避免活跃运行时再反向依赖 legacy chat service。
 */

import type { AgentGenerateTitleInput } from '@kila/shared'
import { getAdapter, fetchTitle } from '@kila/core'
import { decryptApiKey, listChannels } from './channel-manager'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import { getSettings } from './settings-service'
import { generateSessionTitleWithFallback } from './session-title-model-resolver'


import { createLogger } from './logger'
const log = createLogger('标题生成')

const TITLE_PROMPT = '根据用户的第一条消息，生成一个简短的对话标题（10字以内）。只输出标题，不要有任何其他内容、标点符号或引号。如果消息内容过短或无明确主题，直接使用原始消息作为标题。\n\n用户消息：'
const SHORT_MESSAGE_THRESHOLD = 4
const MAX_TITLE_LENGTH = 20

function buildFallbackTitle(userMessage: string): string | null {
  const trimmed = userMessage.trim()
  return trimmed ? trimmed.slice(0, MAX_TITLE_LENGTH) : null
}

export async function generateSessionTitle(input: AgentGenerateTitleInput): Promise<string | null> {
  const { userMessage, channelId, modelId } = input
  log.info('[标题生成] 开始生成标题:', { channelId, modelId, userMessageChars: userMessage.length })

  const trimmedMessage = userMessage.trim()
  if (trimmedMessage.length <= SHORT_MESSAGE_THRESHOLD) {
    const shortTitle = trimmedMessage.slice(0, MAX_TITLE_LENGTH)
    log.info('[标题生成] 消息过短，直接使用原文作为标题:', { titleChars: shortTitle.length })
    return shortTitle
  }

  const channels = listChannels()
  const channel = channels.find((item) => item.id === channelId)
  if (!channel) {
    log.warn('[标题生成] 渠道不存在:', channelId)
    return null
  }



  let apiKey: string
  try {
    apiKey = decryptApiKey(channelId)
  } catch {
    log.warn('[标题生成] 解密 API Key 失败')
    return null
  }

  try {
    const adapter = getAdapter(channel.provider)
    const request = adapter.buildTitleRequest({
      baseUrl: channel.baseUrl,
      apiKey,
      modelId,
      prompt: TITLE_PROMPT + userMessage,
    })

    const proxyUrl = await getEffectiveProxyUrl()
    const fetchFn = getFetchFn(proxyUrl)
    const title = await fetchTitle(request, adapter, fetchFn)
    if (!title) {
      log.warn('[标题生成] API 返回空标题')
      return null
    }

    const cleaned = title.trim().replace(/^["'""'']+|["'""'']+$/g, '').trim()
    const result = cleaned.slice(0, MAX_TITLE_LENGTH) || null
    log.info('[标题生成] 成功生成标题:', { titleChars: result?.length ?? 0 })
    return result
  } catch (error) {
    log.warn('[标题生成] 请求失败:', error)
    return null
  }
}

export async function generateSessionTitleForSession(input: {
  userMessage: string
  sessionChannelId?: string
  sessionModelId?: string
}): Promise<string | null> {
  const title = await generateSessionTitleWithFallback(input, {
    getSettings,
    listChannels,
    generateSingleTitle: generateSessionTitle,
  })

  return title ?? buildFallbackTitle(input.userMessage)
}
