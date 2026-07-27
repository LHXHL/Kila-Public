/**
 * IM Bridge 相关的 IPC 入参校验
 *
 * 从 validation.ts 拆出：桥接配置字段多、白名单/大小上限等安全字段还会继续增长，
 * 集中在一处便于审计，也避免 validation.ts 继续膨胀。
 */

import type {
  BridgeBindingUpdateInput,
  BridgeChannelType,
  BridgeConfigInput,
  FeishuBotConfigInput,
  ThinkingLevel,
  WeChatBridgeStartLoginInput,
} from "@kila/shared"
import {
  assertRecord,
  assertString,
  assertOptionalString,
  assertBoolean,
  assertOptionalBoolean,
  assertOptionalNumber,
  optionalStringArray,
  assertEnum,
} from "./validation-primitives"

// 与 validation.ts 保持一致的思考等级集合（此处独立声明以避免模块循环依赖）
const BRIDGE_THINKING_LEVELS = new Set<ThinkingLevel>([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
])

function assertOptionalThinkingLevel(value: unknown): ThinkingLevel | undefined {
  if (value === undefined || value === null) return undefined
  return assertEnum(value, "thinkingLevel", BRIDGE_THINKING_LEVELS)
}

const BRIDGE_CHANNELS = new Set<BridgeChannelType>([
  'telegram',
  'discord',
  'feishu',
  'wechat',
])

function validateDefaultSession(value: unknown) {
  if (value === undefined || value === null) return undefined
  const input = assertRecord(value, 'defaultSession')
  const historyTurns =
    input.historyTurns === 'infinite'
      ? 'infinite'
      : assertOptionalNumber(
          input.historyTurns,
          'defaultSession.historyTurns',
          { min: 0, max: 500, integer: true }
        )
  return {
    channelId: assertOptionalString(
      input.channelId,
      'defaultSession.channelId',
      256
    ),
    modelId: assertOptionalString(input.modelId, 'defaultSession.modelId', 256),
    thinkingLevel: assertOptionalThinkingLevel(input.thinkingLevel),
    historyTurns: historyTurns as number | 'infinite' | undefined,
    enabledToolIds: optionalStringArray(
      input.enabledToolIds,
      'defaultSession.enabledToolIds',
      200
    ),
  }
}

function validateChannelSessionOverride(value: unknown, label: string) {
  if (value === undefined || value === null) return undefined
  const input = assertRecord(value, label)
  return {
    channelId: assertOptionalString(input.channelId, `${label}.channelId`, 256),
    modelId: assertOptionalString(input.modelId, `${label}.modelId`, 256),
    projectPath: assertOptionalString(
      input.projectPath,
      `${label}.projectPath`,
      2048
    ),
  }
}

export function validateFeishuBotConfigInput(
  value: unknown
): FeishuBotConfigInput {
  const input = assertRecord(value, 'feishu bot')
  return {
    id: assertOptionalString(input.id, 'feishu bot.id', 128),
    name: assertString(input.name, 'feishu bot.name', {
      nonEmpty: true,
      max: 128,
    }),
    enabled: assertBoolean(input.enabled, 'feishu bot.enabled'),
    appId: assertString(input.appId, 'feishu bot.appId', { max: 512 }),
    appSecret: assertString(input.appSecret, 'feishu bot.appSecret', {
      max: 8192,
    }),
    autoApprove: assertOptionalBoolean(
      input.autoApprove,
      'feishu bot.autoApprove'
    ),
    defaultSession: validateChannelSessionOverride(
      input.defaultSession,
      'feishu bot.defaultSession'
    ),
  }
}

export function validateBridgeChannel(value: unknown): BridgeChannelType {
  return assertEnum(value, 'bridge channel', BRIDGE_CHANNELS)
}

export function validateBridgeConfigInput(value: unknown): BridgeConfigInput {
  const input = assertRecord(value, 'Bridge 配置')
  return {
    enabled: assertBoolean(input.enabled, 'enabled'),
    autoStart: assertBoolean(input.autoStart, 'autoStart'),
    defaultSession: validateDefaultSession(input.defaultSession),
    telegram:
      input.telegram === undefined
        ? undefined
        : {
            ...assertRecord(input.telegram, 'telegram'),
            enabled: assertOptionalBoolean(
              assertRecord(input.telegram, 'telegram').enabled,
              'telegram.enabled'
            ),
            botToken: assertOptionalString(
              assertRecord(input.telegram, 'telegram').botToken,
              'telegram.botToken',
              8192
            ),
            allowedUserIds: optionalStringArray(
              assertRecord(input.telegram, 'telegram').allowedUserIds,
              'telegram.allowedUserIds',
              500
            ),
            maxInboundFileBytes: assertOptionalNumber(
              assertRecord(input.telegram, 'telegram').maxInboundFileBytes,
              'telegram.maxInboundFileBytes',
              { min: 0, max: 1024 * 1024 * 1024, integer: true }
            ),
            defaultSession: validateChannelSessionOverride(
              assertRecord(input.telegram, 'telegram').defaultSession,
              'telegram.defaultSession'
            ),
          },
    discord:
      input.discord === undefined
        ? undefined
        : {
            ...assertRecord(input.discord, 'discord'),
            enabled: assertOptionalBoolean(
              assertRecord(input.discord, 'discord').enabled,
              'discord.enabled'
            ),
            botToken: assertOptionalString(
              assertRecord(input.discord, 'discord').botToken,
              'discord.botToken',
              8192
            ),
            allowedUserIds: optionalStringArray(
              assertRecord(input.discord, 'discord').allowedUserIds,
              'discord.allowedUserIds',
              500
            ),
            allowedChannelIds: optionalStringArray(
              assertRecord(input.discord, 'discord').allowedChannelIds,
              'discord.allowedChannelIds',
              500
            ),
            allowedGuildIds: optionalStringArray(
              assertRecord(input.discord, 'discord').allowedGuildIds,
              'discord.allowedGuildIds',
              500
            ),
            requireMention: assertOptionalBoolean(
              assertRecord(input.discord, 'discord').requireMention,
              'discord.requireMention'
            ),
            maxInboundFileBytes: assertOptionalNumber(
              assertRecord(input.discord, 'discord').maxInboundFileBytes,
              'discord.maxInboundFileBytes',
              { min: 0, max: 1024 * 1024 * 1024, integer: true }
            ),
            defaultSession: validateChannelSessionOverride(
              assertRecord(input.discord, 'discord').defaultSession,
              'discord.defaultSession'
            ),
          },
    feishu:
      input.feishu === undefined
        ? undefined
        : {
            ...assertRecord(input.feishu, 'feishu'),
            enabled: assertOptionalBoolean(
              assertRecord(input.feishu, 'feishu').enabled,
              'feishu.enabled'
            ),
            appId: assertOptionalString(
              assertRecord(input.feishu, 'feishu').appId,
              'feishu.appId',
              512
            ),
            appSecret: assertOptionalString(
              assertRecord(input.feishu, 'feishu').appSecret,
              'feishu.appSecret',
              8192
            ),
            bots: Array.isArray(assertRecord(input.feishu, 'feishu').bots)
              ? (assertRecord(input.feishu, 'feishu').bots as unknown[]).map(
                  validateFeishuBotConfigInput
                )
              : undefined,
            sessionMirror:
              assertRecord(input.feishu, 'feishu').sessionMirror === undefined
                ? undefined
                : (() => {
                    const mirror = assertRecord(
                      assertRecord(input.feishu, 'feishu').sessionMirror,
                      'feishu.sessionMirror'
                    )
                    const mode = assertEnum(
                      mirror.mode,
                      'feishu.sessionMirror.mode',
                      new Set(['off', 'stream'] as const)
                    )
                    return {
                      mode,
                      botId: assertOptionalString(
                        mirror.botId,
                        'feishu.sessionMirror.botId',
                        128
                      ),
                      targetOpenId: assertOptionalString(
                        mirror.targetOpenId,
                        'feishu.sessionMirror.targetOpenId',
                        256
                      ),
                    }
                  })(),
            allowP2P: assertOptionalBoolean(
              assertRecord(input.feishu, 'feishu').allowP2P,
              'feishu.allowP2P'
            ),
            allowGroup: assertOptionalBoolean(
              assertRecord(input.feishu, 'feishu').allowGroup,
              'feishu.allowGroup'
            ),
            requireMention: assertOptionalBoolean(
              assertRecord(input.feishu, 'feishu').requireMention,
              'feishu.requireMention'
            ),
            allowedOpenIds: optionalStringArray(
              assertRecord(input.feishu, 'feishu').allowedOpenIds,
              'feishu.allowedOpenIds',
              500
            ),
            allowedChatIds: optionalStringArray(
              assertRecord(input.feishu, 'feishu').allowedChatIds,
              'feishu.allowedChatIds',
              500
            ),
            maxInboundFileBytes: assertOptionalNumber(
              assertRecord(input.feishu, 'feishu').maxInboundFileBytes,
              'feishu.maxInboundFileBytes',
              { min: 0, max: 1024 * 1024 * 1024, integer: true }
            ),
            streamingCards: assertOptionalBoolean(
              assertRecord(input.feishu, 'feishu').streamingCards,
              'feishu.streamingCards'
            ),
            quietWindowMs: assertOptionalNumber(
              assertRecord(input.feishu, 'feishu').quietWindowMs,
              'feishu.quietWindowMs',
              { min: 0, max: 600000, integer: true }
            ),
            maxConcurrent: assertOptionalNumber(
              assertRecord(input.feishu, 'feishu').maxConcurrent,
              'feishu.maxConcurrent',
              { min: 1, max: 100, integer: true }
            ),
            defaultSession: validateChannelSessionOverride(
              assertRecord(input.feishu, 'feishu').defaultSession,
              'feishu.defaultSession'
            ),
          },
    wechat:
      input.wechat === undefined
        ? undefined
        : {
            ...assertRecord(input.wechat, 'wechat'),
            enabled: assertOptionalBoolean(
              assertRecord(input.wechat, 'wechat').enabled,
              'wechat.enabled'
            ),
            baseUrl: assertOptionalString(
              assertRecord(input.wechat, 'wechat').baseUrl,
              'wechat.baseUrl',
              4096
            ),
            accountIds: optionalStringArray(
              assertRecord(input.wechat, 'wechat').accountIds,
              'wechat.accountIds',
              500
            ),
            allowedUserIds: optionalStringArray(
              assertRecord(input.wechat, 'wechat').allowedUserIds,
              'wechat.allowedUserIds',
              500
            ),
            maxInboundFileBytes: assertOptionalNumber(
              assertRecord(input.wechat, 'wechat').maxInboundFileBytes,
              'wechat.maxInboundFileBytes',
              { min: 0, max: 1024 * 1024 * 1024, integer: true }
            ),
            aggregateWindowMs: assertOptionalNumber(
              assertRecord(input.wechat, 'wechat').aggregateWindowMs,
              'wechat.aggregateWindowMs',
              { min: 0, max: 600000, integer: true }
            ),
            deferredOutboundTtlMs: assertOptionalNumber(
              assertRecord(input.wechat, 'wechat').deferredOutboundTtlMs,
              'wechat.deferredOutboundTtlMs',
              { min: 0, max: 86400000, integer: true }
            ),
            contextTtlMs: assertOptionalNumber(
              assertRecord(input.wechat, 'wechat').contextTtlMs,
              'wechat.contextTtlMs',
              { min: 0, max: 86400000, integer: true }
            ),
            defaultSession: validateChannelSessionOverride(
              assertRecord(input.wechat, 'wechat').defaultSession,
              'wechat.defaultSession'
            ),
          },
  }
}

export function validateBridgeBindingUpdateInput(
  value: unknown
): BridgeBindingUpdateInput {
  const input = assertRecord(value, 'Bridge binding')
  return {
    endpointKey: assertString(input.endpointKey, 'endpointKey', {
      nonEmpty: true,
      max: 512,
    }),
    sessionId: assertString(input.sessionId, 'sessionId', {
      nonEmpty: true,
      max: 128,
    }),
    projectPath: assertOptionalString(input.projectPath, 'projectPath', 2048),
  }
}

export function validateWeChatStartLoginInput(
  value: unknown
): WeChatBridgeStartLoginInput | undefined {
  if (value === undefined || value === null) return undefined
  const input = assertRecord(value, 'wechat start login input')
  return {
    accountId: assertOptionalString(input.accountId, 'accountId', 128),
    label: assertOptionalString(input.label, 'label', 200),
    botType: assertOptionalString(input.botType, 'botType', 128),
  }
}

