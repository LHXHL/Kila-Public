/**
 * Provider Doctor
 *
 * 通过 Pi ModelRuntime 发起一次最小真实推理，确保诊断路径与 Agent 的协议、
 * Base URL 规范化、认证和模型选择保持一致。模型列表接口只用于发现模型，
 * 不作为“可用”的判断依据。
 */

import type { Api, AssistantMessage, Model } from '@earendil-works/pi-ai'
import type {
  Channel,
  ChannelTestResult,
  ModelCapabilitiesOverride,
  ModelMetadataOverride,
  ProviderDbModel,
} from '@kila/shared'
import {
  buildPiModel,
  loadPiAi,
  loadPiCodingAgent,
} from './adapters/pi-agent-adapter'
import {
  createKilaModelRuntime,
  type KilaModelRuntime,
} from './adapters/pi-model-runtime'
import { classifyProviderError } from './provider-error-classifier'

type ProbeChannel = Pick<Channel, 'provider' | 'apiType' | 'baseUrl' | 'capabilityProviderId'>
type PiModel = Model<Api>

export interface ProviderProbeInput {
  channel: ProbeChannel
  apiKey: string
  modelId: string
  modelMetadata?: ModelMetadataOverride
  modelCapabilities?: ModelCapabilitiesOverride
  providerDbEntry?: ProviderDbModel
  timeoutMs?: number
}

interface ProviderProbeRuntime {
  modelRuntime: Pick<KilaModelRuntime['modelRuntime'], 'completeSimple'>
  model: PiModel
}

export interface ProviderProbeDependencies {
  buildModel?: (
    channel: ProbeChannel,
    modelId: string,
    metadataOverride?: ModelMetadataOverride,
    capabilitiesOverride?: ModelCapabilitiesOverride,
    hasImages?: boolean,
    providerDbEntry?: ProviderDbModel,
  ) => Promise<PiModel>
  createRuntime?: (options: {
    channel: ProbeChannel
    model: PiModel
    apiKey: string
  }) => Promise<ProviderProbeRuntime>
}

function invalidConfiguration(message: string, modelId?: string): ChannelTestResult {
  return {
    success: false,
    message,
    failureKind: 'invalid_configuration',
    ...(modelId ? { modelId } : {}),
  }
}

async function createDefaultRuntime(options: {
  channel: ProbeChannel
  model: PiModel
  apiKey: string
}): Promise<ProviderProbeRuntime> {
  const [piAi, sdk] = await Promise.all([
    loadPiAi(),
    loadPiCodingAgent(),
  ])
  return createKilaModelRuntime({
    piAi,
    sdk,
    ...options,
  })
}

/** 发起无 Session、无工具、无 MCP/Skills 的最小真实生成请求。 */
export async function runProviderProbe(
  input: ProviderProbeInput,
  dependencies: ProviderProbeDependencies = {},
): Promise<ChannelTestResult> {
  const modelId = input.modelId.trim()
  if (!modelId) {
    return invalidConfiguration('未指定用于真实推理测试的模型')
  }
  if (!input.channel.baseUrl.trim()) {
    return invalidConfiguration('Base URL 不能为空', modelId)
  }

  let resolvedApi: string | undefined
  let responseStatus: number | undefined

  try {
    const buildModel = dependencies.buildModel ?? buildPiModel
    const createRuntime = dependencies.createRuntime ?? createDefaultRuntime
    const model = await buildModel(
      input.channel,
      modelId,
      input.modelMetadata,
      input.modelCapabilities,
      false,
      input.providerDbEntry,
    )
    resolvedApi = model.api

    const runtime = await createRuntime({
      channel: input.channel,
      model,
      apiKey: input.apiKey,
    })
    resolvedApi = runtime.model.api

    const timeoutMs = input.timeoutMs ?? 15_000
    const response: AssistantMessage = await runtime.modelRuntime.completeSimple(
      runtime.model,
      {
        messages: [{
          role: 'user',
          content: 'Reply with OK.',
          timestamp: Date.now(),
        }],
      },
      {
        maxTokens: 8,
        reasoning: undefined,
        maxRetryDelayMs: 0,
        timeoutMs,
        signal: AbortSignal.timeout(timeoutMs),
        onResponse: (providerResponse) => {
          responseStatus = providerResponse.status
        },
      },
    )

    if (response.stopReason === 'error' || response.stopReason === 'aborted') {
      const detail = response.errorMessage
        ?? (response.stopReason === 'aborted' ? 'Provider Doctor 请求已中止或超时' : '供应商返回未知错误')
      throw new Error(responseStatus && !detail.includes(String(responseStatus))
        ? `${responseStatus} ${detail}`
        : detail)
    }

    return {
      success: true,
      message: '真实推理成功',
      resolvedApi,
      modelId,
    }
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error)
    const message = responseStatus && !rawMessage.includes(String(responseStatus))
      ? `${responseStatus} ${rawMessage}`
      : rawMessage
    const classification = classifyProviderError(message)

    return {
      success: false,
      message: `${classification.title}: ${classification.message}`,
      resolvedApi,
      modelId,
      failureKind: classification.failureKind,
      statusCode: classification.statusCode ?? responseStatus,
    }
  }
}
