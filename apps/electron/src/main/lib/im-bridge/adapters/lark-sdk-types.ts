/**
 * 飞书（Lark）SDK 边界类型
 *
 * `@larksuiteoapi/node-sdk` 的响应体和事件负载是宽泛的动态结构，历史实现直接用 `any` 承接。
 * 这里按 Kila 实际读取的字段收窄：只声明用到的部分，SDK 新增字段不影响本文件。
 * 收窄后字段访问路径与原实现完全一致，不改变任何运行时行为。
 */

/** 原生 lark.Client 实例类型（CardKit 2.0 等能力需要真实实例，mock client 不具备） */
export type LarkClientInstance = InstanceType<typeof import('@larksuiteoapi/node-sdk').Client>

/** im.message.create / im.message.reply 的响应：只用到新消息 ID */
export interface FeishuSendMessageResponse {
  code?: number
  msg?: string
  data?: { message_id?: string }
}

/** im.message.get 返回的历史消息条目 */
export interface FeishuHistoryMessage {
  message_id?: string
  msg_type?: string
  create_time?: string
  body?: { content?: string }
  sender?: { id?: { open_id?: string; name?: string } }
}

/** im.message.get 的响应 */
export interface FeishuGetMessageResponse {
  code?: number
  data?: { items?: FeishuHistoryMessage[] }
}

/** im.chat.create 的响应：新旧网关分别把 chat_id 放在 data 或 data.chat 下 */
export interface FeishuChatCreateResponse {
  code?: number
  data?: { chat_id?: string; chat?: { chat_id?: string } }
}

/** im.chat.update 的响应：只用 code 判断是否成功 */
export interface FeishuChatUpdateResponse {
  code?: number
  msg?: string
}

/** 飞书 SDK 抛出的 axios 风格错误 */
export interface FeishuApiError {
  response?: {
    status?: number
    data?: { code?: number; msg?: string }
  }
}

export interface FeishuMessageApi {
  create: (input: { params?: Record<string, unknown>; data: Record<string, unknown> }) => Promise<FeishuSendMessageResponse>
  reply: (input: { path: Record<string, unknown>; data: Record<string, unknown> }) => Promise<FeishuSendMessageResponse>
  get: (input: { path: Record<string, unknown> }) => Promise<FeishuGetMessageResponse>
}

export interface FeishuClientLike {
  /** 通用 HTTP 通道：各接口响应结构不同，由调用方按接口断言 */
  request: (input: { method: string; url: string }) => Promise<unknown>
  /** 只有真实 lark.Client 才带 CardKit 2.0 命名空间，用于识别是否可开流式卡片 */
  cardkit?: unknown
  im: {
    message: FeishuMessageApi
    chat: {
      create: (input: { data: Record<string, unknown>; params?: Record<string, unknown> }) => Promise<FeishuChatCreateResponse>
      update: (input: { path: Record<string, unknown>; data: Record<string, unknown> }) => Promise<FeishuChatUpdateResponse>
    }
  }
}

/** 附件下载所需的客户端形状（与 feishu-files.ts 的入参结构保持一致） */
export interface FeishuAttachmentClientLike {
  request: (input: { method: string; url: string; params?: Record<string, unknown> }) => Promise<{ data?: { file_key?: string } }>
  im: {
    message: {
      resource: (input: { path: Record<string, unknown>; params: Record<string, unknown> }) => Promise<{ data?: { file_key?: string } }>
    }
    file: {
      get: (input: { params: Record<string, unknown> }) => Promise<{ data?: { content?: string } }>
    }
  }
}

/** 适配器内部的长连接客户端契约（由 lark WSClient 包装而来，也可被测试注入） */
export interface FeishuWsClientLike {
  start: (input?: Record<string, unknown>) => Promise<void>
  stop?: () => void
}

/** lark WSClient 真实暴露的方法：注意只有 close()，没有 stop() */
export interface LarkWsClientLike {
  start(params: { eventDispatcher: unknown }): Promise<void>
  close(params?: { force?: boolean }): void
}

export interface FeishuChannelLike {
  rawClient: FeishuClientLike
  connect: () => Promise<void>
  disconnect?: () => Promise<void>
  on: (handlers: {
    message?: (message: Record<string, unknown>) => void | Promise<void>
    reject?: (event: Record<string, unknown>) => void
    error?: (error: unknown) => void
    reconnecting?: () => void
    reconnected?: () => void
  }) => () => void
}

export interface FeishuMention {
  key?: string
  id?: string | { open_id?: string; union_id?: string; user_id?: string }
  openId?: string
  userId?: string
  name?: string
}

export interface FeishuEventMessage {
  message_id: string
  chat_id: string
  chat_type?: string
  message_type?: string
  content?: unknown
  mentions?: FeishuMention[]
  parent_id?: string
  root_id?: string
}

export interface FeishuEventSender {
  sender_id?: { open_id?: string; user_id?: string; union_id?: string }
  type?: string
  sender_type?: string
}
