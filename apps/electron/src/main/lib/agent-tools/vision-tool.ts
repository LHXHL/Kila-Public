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
import { extname, isAbsolute, resolve } from 'node:path'
import { getAdapter, fetchVisionDescription } from '@kila/core'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import { Type } from '@sinclair/typebox'
import { resolveSessionTitleModelTargets } from '../session-title-model-resolver'
import { decryptApiKey, listChannels } from '../channel-manager'
import { getSettings } from '../settings-service'
import { getFetchFn } from '../proxy-fetch'
import { getEffectiveProxyUrl } from '../proxy-settings-service'
import { getAttachmentsDir, getConversationAttachmentsDir } from '../config-paths'
import { assertPathWithinAllowedRoots } from '../file-access-policy'
import { getSessionMeta } from '../session-manager'

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

/** 扩展名 → 图片 MIME 类型；不在表内的一律拒绝 */
const IMAGE_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

/**
 * 计算本次会话允许读取图片的根目录
 *
 * image_path 完全由模型决定，必须限制在：
 * - 本会话的附件目录（用户上传的图片）
 * - 当前 session 绑定的项目目录及其附加目录（Agent 自己生成/浏览的图片）
 *
 * 否则模型可以把 ~/.ssh/id_rsa 之类的任意本地文件读成 base64 发给第三方视觉 API。
 */
export function resolveVisionAllowedRoots(sessionId: string): string[] {
  const roots: string[] = [getConversationAttachmentsDir(sessionId)]

  const session = getSessionMeta(sessionId)
  if (session?.project?.path) {
    roots.push(session.project.path)
  }
  for (const dir of session?.attachedDirectories ?? []) {
    if (dir?.trim()) roots.push(dir)
  }

  return roots
}

/**
 * 把模型给出的 image_path 解析为受限的绝对路径
 *
 * - 绝对路径：直接按白名单校验
 * - 相对路径：先按附件 localPath（`{sessionId}/{uuid}.ext`，相对附件根）解释，
 *   命中不到再按项目相对路径解释；两种结果都必须落在允许的根目录内
 */
export function resolveVisionImagePath(imagePath: string, roots: string[]): string {
  if (typeof imagePath !== 'string' || imagePath.trim() === '' || imagePath.includes('\0')) {
    throw new Error('图片路径无效')
  }

  const candidates: string[] = isAbsolute(imagePath)
    ? [resolve(imagePath)]
    : [
        // 附件 localPath 形如 `{sessionId}/{uuid}.ext`，相对于附件根目录
        resolve(getAttachmentsDir(), imagePath),
        ...roots.map((root) => resolve(root, imagePath)),
      ]

  const existing = candidates.find((candidate) => existsSync(candidate))
  if (!existing) {
    throw new Error(`图片文件不存在: ${imagePath}`)
  }

  return assertPathWithinAllowedRoots(
    existing,
    roots,
    '图片路径超出当前会话的附件目录与项目目录范围',
  )
}

/**
 * 读取图片文件为 base64（路径受 roots 限制，类型无法确定时拒绝）
 */
export function readImageAsBase64(imagePath: string, roots: string[]): { data: string; mimeType: string } {
  const fullPath = resolveVisionImagePath(imagePath, roots)

  const ext = extname(fullPath).toLowerCase()
  const mimeType = IMAGE_MIME_MAP[ext]
  if (!mimeType) {
    // 无法确定类型时必须拒绝，不能一律当作 image/png 发给第三方视觉 API
    throw new Error(
      `无法确定图片类型: ${imagePath}。仅支持 ${Object.keys(IMAGE_MIME_MAP).join('、')}`,
    )
  }

  const buffer = readFileSync(fullPath)
  return { data: buffer.toString('base64'), mimeType }
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

      const roots = resolveVisionAllowedRoots(options.sessionId)
      const imageData = readImageAsBase64(params.image_path, roots)
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
