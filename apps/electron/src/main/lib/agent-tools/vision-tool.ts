/**
 * 视觉分析工具
 *
 * 当对话模型不支持原生视觉能力时，
 * 通过 utility 模型（后台轻任务模型）分析图片并返回文字描述。
 *
 * 复用 resolveSessionTitleModelTargets 的降级链（utility → session model），
 * 以及 @kila/core Provider adapter 的 buildVisionRequest。
 */

import { existsSync, readFileSync } from 'node:fs'
import { getAdapter, fetchVisionDescription } from '@kila/core'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import { Type } from '@sinclair/typebox'
import { resolveSessionTitleModelTargets } from '../session-title-model-resolver'
import { decryptApiKey, listChannels } from '../channel-manager'
import { getSettings } from '../settings-service'
import { getFetchFn } from '../proxy-fetch'
import { getEffectiveProxyUrl } from '../proxy-settings-service'
import { resolveAttachmentPath } from '../config-paths'

import { createLogger } from '../logger'
const log = createLogger('视觉工具')

const VISION_ANALYZE_SCHEMA = Type.Object({
  image_path: Type.String({ description: '图片附件的本地路径' }),
  prompt: Type.Optional(Type.String({ description: '分析指令，如"描述图片内容"、"识别图中的代码"。默认为通用图片描述。' })),
})

interface VisionTarget {
  channelId: string
  channelProvider: string
  modelId: string
  apiKey: string
  baseUrl: string
}

const DEFAULT_VISION_PROMPT = '请详细描述这张图片的内容。如果是代码截图请还原代码，如果是图表请解读数据，如果是 UI 截图请描述布局和元素。'

/**
 * 解析可用的视觉模型降级链
 */
async function resolveVisionTargets(
  sessionChannelId?: string,
  sessionModelId?: string,
): Promise<VisionTarget[]> {
  const settings = getSettings()
  const channels = listChannels()

  const targets = resolveSessionTitleModelTargets({
    settings,
    channels,
    sessionChannelId,
    sessionModelId,
  })

  const result: VisionTarget[] = []

  for (const target of targets) {
    const channel = channels.find((c) => c.id === target.channelId && c.enabled)
    if (!channel) continue

    let apiKey: string
    try {
      apiKey = decryptApiKey(channel.id)
    } catch {
      log.warn(`[视觉工具] 解密渠道 ${channel.name} API Key 失败，跳过`)
      continue
    }

    result.push({
      channelId: channel.id,
      channelProvider: channel.provider,
      modelId: target.modelId,
      apiKey,
      baseUrl: channel.baseUrl,
    })
  }

  return result
}

/**
 * 读取图片文件为 base64
 */
function readImageAsBase64(imagePath: string): { data: string; mimeType: string } {
  const fullPath = resolveAttachmentPath(imagePath, { allowAbsolute: true })

  if (!existsSync(fullPath)) {
    throw new Error(`图片文件不存在: ${imagePath}`)
  }

  const buffer = readFileSync(fullPath)
  const ext = imagePath.toLowerCase().split('.').pop()

  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
  }

  return {
    data: buffer.toString('base64'),
    mimeType: mimeMap[ext ?? ''] ?? 'image/png',
  }
}

/**
 * 调用视觉模型分析图片，按降级链逐一尝试
 */
async function callVisionModel(
  imageData: { data: string; mimeType: string },
  prompt: string,
  targets: VisionTarget[],
): Promise<string> {
  const proxyUrl = await getEffectiveProxyUrl()
  const fetchFn = getFetchFn(proxyUrl)

  for (const target of targets) {
    try {
      const adapter = getAdapter(target.channelProvider as never)
      const request = adapter.buildVisionRequest({
        baseUrl: target.baseUrl,
        apiKey: target.apiKey,
        modelId: target.modelId,
        image: imageData,
        prompt,
      })

      const description = await fetchVisionDescription(request, adapter, fetchFn)
      if (description) {
        log.info(`[视觉工具] 成功获取图片描述 (渠道: ${target.channelId}, 模型: ${target.modelId})`)
        return description
      }

      log.warn(`[视觉工具] 模型 ${target.modelId} 返回空描述，尝试下一个`)
    } catch (error) {
      log.warn(`[视觉工具] 渠道 ${target.channelId} 模型 ${target.modelId} 调用失败:`, error)
    }
  }

  throw new Error('所有视觉模型调用均失败。请在「通用设置 → 后台轻任务模型」中配置一个支持视觉的模型（如 Claude、GPT-4o、Gemini）。')
}

/**
 * 创建 analyze_image AgentTool
 */
export function createVisionTool(options: {
  sessionId: string
  sessionChannelId?: string
  sessionModelId?: string
}): AgentTool<typeof VISION_ANALYZE_SCHEMA> {
  return {
    name: 'analyze_image',
    label: 'Analyze Image',
    description: [
      '分析用户发送的图片并返回文字描述。',
      '当用户在消息中粘贴或上传了图片，但你无法直接看到图片时使用此工具。',
      '调用时传入图片路径和可选的分析指令。',
    ].join(' '),
    parameters: VISION_ANALYZE_SCHEMA,
    execute: async (_toolCallId, params) => {
      const prompt = params.prompt?.trim() || DEFAULT_VISION_PROMPT

      log.info(`[视觉工具] 开始分析图片: ${params.image_path}`)

      const imageData = readImageAsBase64(params.image_path)
      const targets = await resolveVisionTargets(options.sessionChannelId, options.sessionModelId)

      if (targets.length === 0) {
        throw new Error('没有可用的视觉模型。请在「通用设置 → 后台轻任务模型」中配置一个支持视觉的模型。')
      }

      const description = await callVisionModel(imageData, prompt, targets)

      return {
        content: [{ type: 'text' as const, text: description }],
        details: {
          imagePath: params.image_path,
          targetCount: targets.length,
        },
      }
    },
  }
}
